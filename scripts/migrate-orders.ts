import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';
import { OrderItem, cleanOrderForFirestore, generateQueryToken } from '../src/utils/order-utils.ts';
import {
  createDefaultOrderService,
  hashQueryToken,
  DatabaseUnavailableError,
} from '../src/server/order-service.ts';

export interface MigrationCandidateReport {
  orderNumber: string;
  id: string;
  classification: 'DEMO_SEED' | 'REAL_CUSTOMER';
  status: string;
  createdAt: string;
  updatedAt: string;
  hasQueryTokenHash: boolean;
  action: 'SKIP_DEMO' | 'READY_TO_MIGRATE' | 'CONFLICT_OLDER_OR_EQUAL' | 'CONFLICT_NEWER';
}

export interface MigrationCheckSummary {
  sourceFile: string;
  sourceExists: boolean;
  totalSourceRecords: number;
  demoRecordsCount: number;
  realRecordsCount: number;
  duplicateOrderNumbersInSource: string[];
  targetReachable: boolean;
  targetError?: string;
  candidates: MigrationCandidateReport[];
}

export async function analyzeLocalOrdersMigration(
  sourceFilePath = path.resolve(process.cwd(), '.data', 'orders.json')
): Promise<MigrationCheckSummary> {
  if (!fs.existsSync(sourceFilePath)) {
    return {
      sourceFile: sourceFilePath,
      sourceExists: false,
      totalSourceRecords: 0,
      demoRecordsCount: 0,
      realRecordsCount: 0,
      duplicateOrderNumbersInSource: [],
      targetReachable: false,
      candidates: [],
    };
  }

  const raw = fs.readFileSync(sourceFilePath, 'utf-8');
  const parsed: OrderItem[] = JSON.parse(raw);
  const records = Array.isArray(parsed) ? parsed : [];

  const seenOrderNumbers = new Set<string>();
  const duplicates = new Set<string>();

  for (const r of records) {
    const no = String(r.orderNumber || '').trim().toUpperCase();
    if (seenOrderNumbers.has(no)) {
      duplicates.add(no);
    }
    seenOrderNumbers.add(no);
  }

  const candidates: MigrationCandidateReport[] = [];
  let demoCount = 0;
  let realCount = 0;

  for (const rec of records) {
    const isDemo =
      Boolean(rec.isDemo) ||
      String(rec.id || '').startsWith('demo-order-') ||
      ['client_gis@163.com', 'spatial_analyst_wu', 'academic_geo@edu.cn'].includes(
        String(rec.contactValue || '').trim()
      );

    if (isDemo) {
      demoCount++;
      candidates.push({
        orderNumber: rec.orderNumber,
        id: rec.id,
        classification: 'DEMO_SEED',
        status: rec.status,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        hasQueryTokenHash: Boolean(rec.queryTokenHash),
        action: 'SKIP_DEMO',
      });
    } else {
      realCount++;
      candidates.push({
        orderNumber: rec.orderNumber,
        id: rec.id,
        classification: 'REAL_CUSTOMER',
        status: rec.status,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        hasQueryTokenHash: Boolean(rec.queryTokenHash),
        action: 'READY_TO_MIGRATE',
      });
    }
  }

  // Probe target database only if there are real records or if requested
  let targetReachable = false;
  let targetError: string | undefined;

  const service = createDefaultOrderService();
  const repo = service.getRepository();

  try {
    for (const c of candidates) {
      if (c.classification === 'REAL_CUSTOMER') {
        const existing = await repo.getOrderByNumber(c.orderNumber);
        if (existing) {
          const srcTime = new Date(c.updatedAt).getTime();
          const dstTime = new Date(existing.updatedAt).getTime();
          c.action = srcTime > dstTime ? 'CONFLICT_NEWER' : 'CONFLICT_OLDER_OR_EQUAL';
        }
      }
    }
    targetReachable = true;
  } catch (err: any) {
    targetReachable = false;
    targetError = err instanceof DatabaseUnavailableError ? `${err.code}: ${err.message}` : err?.message;
  }

  return {
    sourceFile: sourceFilePath,
    sourceExists: true,
    totalSourceRecords: records.length,
    demoRecordsCount: demoCount,
    realRecordsCount: realCount,
    duplicateOrderNumbersInSource: Array.from(duplicates),
    targetReachable,
    targetError,
    candidates,
  };
}

// CLI entry point (pathToFileURL keeps this guard working on Windows and POSIX)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  const shouldExecute = args.has('--execute') && args.has('--approve');

  analyzeLocalOrdersMigration()
    .then(async (summary) => {
      console.log('=== GeoSpatial Studio 数据迁移检查与预览报告 ===');
      console.log(`源文件: ${summary.sourceFile} (存在: ${summary.sourceExists})`);
      console.log(`总记录数: ${summary.totalSourceRecords}`);
      console.log(`  - Demo 种子工单 (默认跳过): ${summary.demoRecordsCount}`);
      console.log(`  - 真实客户工单 (待迁移): ${summary.realRecordsCount}`);
      console.log(
        `源文件内重复工单号: ${
          summary.duplicateOrderNumbersInSource.length === 0
            ? '无'
            : summary.duplicateOrderNumbersInSource.join(', ')
        }`
      );
      console.table(
        summary.candidates.map((c) => ({
          orderNumber: c.orderNumber,
          id: c.id,
          type: c.classification,
          status: c.status,
          hasTokenHash: c.hasQueryTokenHash,
          action: c.action,
        }))
      );

      if (!shouldExecute) {
        console.log(
          '\n[DRY-RUN 预览模式] 未对目标数据库执行任何写入，也未修改或删除 .data/orders.json。'
        );
        console.log('如需在人工审批后正式执行真实工单迁移，请附带参数: --execute --approve');
        return;
      }

      if (summary.realRecordsCount === 0) {
        console.log('\n没有需要迁移的真实客户工单（全部为 Demo 种子数据）。');
        return;
      }

      if (summary.duplicateOrderNumbersInSource.length > 0) {
        console.error('\n源文件存在重复工单号，已拒绝执行迁移。请先人工合并重复记录。');
        process.exitCode = 1;
        return;
      }

      if (!summary.targetReachable) {
        console.error(
          `\n目标数据库不可达，已拒绝执行迁移：${summary.targetError || '未知错误'}`
        );
        process.exitCode = 1;
        return;
      }

      const rawSource = JSON.parse(fs.readFileSync(summary.sourceFile, 'utf-8'));
      if (!Array.isArray(rawSource)) {
        console.error('\n源文件格式非法：预期为工单数组，已拒绝执行迁移。');
        process.exitCode = 1;
        return;
      }
      const recordsByNumber = new Map<string, OrderItem>();
      for (const rec of rawSource as OrderItem[]) {
        recordsByNumber.set(String(rec.orderNumber || '').trim().toUpperCase(), rec);
      }

      const service = createDefaultOrderService();
      const repo = service.getRepository();
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const candidate of summary.candidates) {
        if (candidate.classification !== 'REAL_CUSTOMER') continue;
        if (candidate.action === 'CONFLICT_OLDER_OR_EQUAL') {
          skipped++;
          console.log(`SKIP   ${candidate.orderNumber} (目标已有相同或更新版本)`);
          continue;
        }

        const record = recordsByNumber.get(candidate.orderNumber.toUpperCase());
        if (!record) {
          failed++;
          console.error(`FAILED ${candidate.orderNumber} (源记录缺失)`);
          continue;
        }

        try {
          const result = await repo.importOrderAtomic(record, 'if-newer');
          if (result === 'created') created++;
          else if (result === 'updated') updated++;
          else skipped++;
          console.log(`${result.toUpperCase().padEnd(6)} ${candidate.orderNumber}`);
        } catch (err: any) {
          failed++;
          console.error(`FAILED ${candidate.orderNumber}: ${err?.message || err}`);
        }
      }

      console.log(
        `\n迁移完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}，失败 ${failed}。`
      );
      if (failed > 0) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error('迁移检查执行异常:', err);
      process.exitCode = 1;
    });
}
