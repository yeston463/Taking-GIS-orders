import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOrderId,
  generateOrderNumber,
  generateQueryToken,
  normalizeQueryToken,
  maskContactValue,
  toPublicOrderView,
  isAllowedStatusTransition,
  validateOrderInput,
  formatRMB,
  getStatusStepIndex,
  filterAndSortOrders,
  sanitizeCSVField,
  exportOrdersToCSV,
  validateAdminOrderUpdate,
  cleanOrderForFirestore,
  OrderItem,
} from './order-utils.ts';

test('generateOrderNumber and generateQueryToken use CSPRNG with high-entropy formats', () => {
  const date = new Date(2026, 9, 29);
  const num = generateOrderNumber(date);
  assert.match(num, /^GEO-20261029-[2-9A-HJ-NP-Z]{6}$/);

  const id = generateOrderId();
  assert.match(id, /^ord-[0-9a-zA-Z-]{20,40}$/);

  const token = generateQueryToken();
  assert.match(token, /^QK-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(normalizeQueryToken('  qk-abcd-efgh-jklm '), 'QK-ABCD-EFGH-JKLM');
});

test('maskContactValue masks emails and WeChat IDs to protect customer privacy', () => {
  assert.equal(maskContactValue('email', 'client_gis@163.com'), 'c***s@163.com');
  assert.equal(maskContactValue('email', 'ab@edu.cn'), 'a***@edu.cn');
  assert.equal(maskContactValue('wechat', 'spatial_analyst_wu'), 'sp***wu');
  assert.equal(maskContactValue('wechat', 'abc'), 'a***');
});

test('toPublicOrderView strips contactValue, adminNotes, and queryTokenHash', () => {
  const fullOrder: OrderItem = {
    id: 'ord-123456',
    orderNumber: 'GEO-20261029-ABCDEF',
    serviceType: 'thematic_map',
    title: '专题地图测试',
    description: '需要制作高精度矢量专题图',
    contactMethod: 'email',
    contactValue: 'secret_customer@domain.com',
    status: 'pending_payment',
    manualQuote: 360,
    adminNotes: '内部敏感备注：客户服务器IP与特殊折扣',
    clientNotes: '外部可见进度：已完成初稿评估',
    queryTokenHash: 'a'.repeat(64),
    createdAt: '2026-10-29T10:00:00.000Z',
    updatedAt: '2026-10-29T11:00:00.000Z',
  };

  const pub = toPublicOrderView(fullOrder);
  assert.equal(pub.orderNumber, 'GEO-20261029-ABCDEF');
  assert.equal(pub.maskedContact, 's***r@domain.com');
  assert.equal('contactValue' in (pub as any), false);
  assert.equal('adminNotes' in (pub as any), false);
  assert.equal('queryTokenHash' in (pub as any), false);
  assert.equal('id' in (pub as any), false);
});

test('validateOrderInput rejects invalid, non-object, or honeypot-triggered inputs', () => {
  assert.equal(validateOrderInput(null).valid, false);
  assert.equal(validateOrderInput([]).valid, false);

  const emptyRes = validateOrderInput({});
  assert.equal(emptyRes.valid, false);
  assert.ok(emptyRes.errors.serviceType);
  assert.ok(emptyRes.errors.title);
  assert.ok(emptyRes.errors.description);
  assert.ok(emptyRes.errors.contactValue);
  assert.ok(emptyRes.errors.agreePrivacy);

  const honeypotRes = validateOrderInput({
    serviceType: 'thematic_map',
    title: '制作等高线专题图',
    description: '杭州市西湖区10米等高线矢量制图需求描述',
    contactMethod: 'email',
    contactValue: 'test@example.com',
    agreePrivacy: true,
    honeypot: 'bot-spam-content',
  });
  assert.equal(honeypotRes.valid, false);
  assert.ok(honeypotRes.errors.honeypot);
});

test('validateOrderInput accepts complete valid input with email or wechat', () => {
  const validEmail = validateOrderInput({
    serviceType: 'spatial_processing',
    title: '批量格式转换与投影变换',
    description: '将500个Shapefile文件清洗拓扑并批量转换为GeoPackage与EPSG:4490',
    studyArea: '浙江省全省',
    dataFormats: 'SHP -> GPKG',
    budgetRange: '200-500',
    contactMethod: 'email',
    contactValue: 'client@gis-lab.cn',
    agreePrivacy: true,
  });
  assert.equal(validEmail.valid, true);

  const validWeChat = validateOrderInput({
    serviceType: 'script_dev',
    title: 'PyQGIS 批量出图脚本定制',
    description: '开发基于PyQGIS的无界面独立脚本，自动循环导出高分辨率PDF',
    contactMethod: 'wechat',
    contactValue: 'gis_developer_pro',
    agreePrivacy: true,
  });
  assert.equal(validWeChat.valid, true);
});

test('Order state machine enforces valid transitions and blocks illegal jumps', () => {
  assert.equal(isAllowedStatusTransition('pending_review', 'pending_quote'), true);
  assert.equal(isAllowedStatusTransition('pending_review', 'completed'), false);
  assert.equal(isAllowedStatusTransition('completed', 'in_progress'), false);
  assert.equal(isAllowedStatusTransition('cancelled', 'pending_payment'), false);
});

test('validateAdminOrderUpdate blocks invalid quotes, NaN, Infinity, >1M, state jumps, and locked quote tampering', () => {
  // Cannot enter pending_payment without quote > 0
  const noQuote = validateAdminOrderUpdate(
    { status: 'pending_payment', manualQuote: '' },
    undefined,
    'pending_quote'
  );
  assert.equal(noQuote.valid, false);

  // Reject NaN, Infinity, negative, zero, > 1,000,000, boolean, array
  for (const bad of [0, -100, NaN, Infinity, 1000001, true, false, [100], 'abc', 'Infinity']) {
    const res = validateAdminOrderUpdate(
      { status: 'pending_payment', manualQuote: bad },
      undefined,
      'pending_quote'
    );
    assert.equal(res.valid, false, `Expected quote ${String(bad)} to be rejected`);
  }

  // Reject illegal state jump: pending_review -> completed
  const illegalJump = validateAdminOrderUpdate(
    { status: 'completed', manualQuote: 500 },
    500,
    'pending_review'
  );
  assert.equal(illegalJump.valid, false);
  assert.ok(illegalJump.error?.includes('状态流转不合法'));

  // Reject modifying quote when already in in_progress / pending_acceptance / completed
  const tamperInProgress = validateAdminOrderUpdate(
    { status: 'in_progress', manualQuote: 999 },
    300,
    'in_progress'
  );
  assert.equal(tamperInProgress.valid, false);
  assert.ok(tamperInProgress.error?.includes('禁止直接篡改已确认的报价金额'));

  // Valid transition pending_quote -> pending_payment with valid quote
  const validQuote = validateAdminOrderUpdate(
    { status: 'pending_payment', manualQuote: 299.5 },
    undefined,
    'pending_quote'
  );
  assert.equal(validQuote.valid, true);
  assert.equal(validQuote.parsedQuote, 299.5);
});

test('sanitizeCSVField and exportOrdersToCSV neutralize formula injection (=, +, -, @, tab, CR)', () => {
  assert.equal(sanitizeCSVField("=CMD|' /C calc'!A0"), `"'=CMD|' /C calc'!A0"`);
  assert.equal(sanitizeCSVField('+SUM(A1:A10)'), '"\'+SUM(A1:A10)"');
  assert.equal(sanitizeCSVField('-2+3+cmd'), '"\'-2+3+cmd"');
  assert.equal(sanitizeCSVField('@IMPORTXML(...)'), '"\'@IMPORTXML(...)"');
  assert.equal(sanitizeCSVField('\t=1+1'), '"\'\t=1+1"');

  const maliciousOrders: OrderItem[] = [
    {
      id: '1',
      orderNumber: 'GEO-20261029-A1B2C3',
      serviceType: 'thematic_map',
      title: '=HYPERLINK("http://evil.example/steal", "Click")',
      description: '@SUM(1+1)',
      studyArea: '+WestLake',
      contactMethod: 'wechat',
      contactValue: '-malicious_user',
      status: 'pending_review',
      manualQuote: 99,
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:00:00.000Z',
    },
  ];

  const csv = exportOrdersToCSV(maliciousOrders);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=HYPERLINK(""http://evil.example/steal"", ""Click"")"'));
  assert.ok(csv.includes('"\'@SUM(1+1)"'));
  assert.ok(csv.includes('"\'+WestLake"'));
  assert.ok(csv.includes('"\'-malicious_user"'));
});

test('formatRMB, getStatusStepIndex, filterAndSortOrders, and cleanOrderForFirestore work accurately', () => {
  assert.equal(formatRMB(undefined), '待人工评估');
  assert.equal(formatRMB(null), '待人工评估');
  assert.equal(formatRMB(NaN), '待人工评估');
  assert.equal(formatRMB(49), '¥49.00');
  assert.equal(formatRMB(199.5), '¥199.50');

  assert.equal(getStatusStepIndex('pending_review'), 0);
  assert.equal(getStatusStepIndex('completed'), 5);
  assert.equal(getStatusStepIndex('cancelled'), -1);

  const sampleOrders: OrderItem[] = [
    {
      id: '1',
      orderNumber: 'GEO-20261029-A1B2C3',
      serviceType: 'thematic_map',
      title: '高精生态红线专题图',
      description: '制作ArcGIS矢量专题图',
      studyArea: '太湖流域',
      contactMethod: 'email',
      contactValue: 'user1@example.com',
      status: 'pending_review',
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:00:00.000Z',
    },
  ];

  assert.equal(filterAndSortOrders(sampleOrders, { search: '太湖' }).length, 1);

  const cleaned = cleanOrderForFirestore(sampleOrders[0]);
  assert.equal(cleaned.orderNumber, 'GEO-20261029-A1B2C3');
  assert.equal('manualQuote' in cleaned, false);
});
