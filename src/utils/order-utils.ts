/**
 * Pure logic utility functions for GeoSpatial Studio orders, validation,
 * state machine, privacy masking, and CSV formula-safe export.
 */

export type ServiceType =
  | 'thematic_map'
  | 'spatial_processing'
  | 'script_dev'
  | 'webgis_dev'
  | 'remote_sensing';

export type OrderStatus =
  | 'pending_review'
  | 'pending_quote'
  | 'pending_payment'
  | 'in_progress'
  | 'pending_acceptance'
  | 'completed'
  | 'cancelled';

export interface OrderItem {
  id: string;
  orderNumber: string;
  serviceType: ServiceType;
  title: string;
  description: string;
  studyArea?: string;
  dataFormats?: string;
  budgetRange?: string;
  expectedDeliveryDate?: string;
  contactMethod: 'email' | 'wechat';
  contactValue: string;
  status: OrderStatus;
  manualQuote?: number;
  adminNotes?: string;
  clientNotes?: string;
  queryTokenHash?: string;
  queryTokenUpdatedAt?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicOrderView {
  orderNumber: string;
  serviceType: ServiceType;
  title: string;
  description: string;
  studyArea: string;
  dataFormats: string;
  budgetRange: string;
  expectedDeliveryDate: string;
  contactMethod: 'email' | 'wechat';
  maskedContact: string;
  status: OrderStatus;
  manualQuote?: number;
  clientNotes: string;
  createdAt: string;
  updatedAt: string;
}

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  thematic_map: 'QGIS/ArcGIS 专题地图制作',
  spatial_processing: 'GIS 空间数据处理与自动化',
  script_dev: 'Python / PyQGIS / GDAL 脚本开发',
  webgis_dev: 'WebGIS 可视化与轻量系统开发',
  remote_sensing: '遥感影像与植被变化分析',
};

export const SERVICE_STARTING_PRICES: Record<ServiceType, number> = {
  thematic_map: 49,
  spatial_processing: 99,
  script_dev: 99,
  webgis_dev: 99,
  remote_sensing: 199,
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_review: '待确认',
  pending_quote: 'pending_quote' in {} ? '' : '待报价',
  pending_payment: '待付款',
  in_progress: '进行中',
  pending_acceptance: '待验收',
  completed: '已完成',
  cancelled: '已取消',
};

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'pending_review',
  'pending_quote',
  'pending_payment',
  'in_progress',
  'pending_acceptance',
  'completed',
];

/**
 * Explicit state transition table:
 * 待确认 → 待报价 → 待付款 → 进行中 → 待验收 → 已完成
 * Supports reasonable cancellation, return for clarification, and re-quoting.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_review: ['pending_review', 'pending_quote', 'pending_payment', 'cancelled'],
  pending_quote: ['pending_quote', 'pending_review', 'pending_payment', 'cancelled'],
  pending_payment: ['pending_payment', 'pending_quote', 'in_progress', 'cancelled'],
  in_progress: ['in_progress', 'pending_quote', 'pending_acceptance', 'cancelled'],
  pending_acceptance: ['pending_acceptance', 'in_progress', 'completed', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled', 'pending_review'],
};

export function isAllowedStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ALLOWED_STATUS_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

const SAFE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function getCryptoRandomIndex(max: number): number {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0] % max;
  }
  return Math.floor(Math.random() * max);
}

/**
 * Generate a unique internal order ID using CSPRNG
 */
export function generateOrderId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.randomUUID) {
    return `ord-${globalThis.crypto.randomUUID()}`;
  }
  let suffix = '';
  for (let i = 0; i < 16; i++) {
    suffix += SAFE_ALPHABET.charAt(getCryptoRandomIndex(SAFE_ALPHABET.length));
  }
  return `ord-${Date.now()}-${suffix}`;
}

/**
 * Generate a readable unique order number: GEO-YYYYMMDD-XXXXXX (6 random chars from 32-char alphabet)
 */
export function generateOrderNumber(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  let randomPart = '';
  for (let i = 0; i < 6; i++) {
    randomPart += SAFE_ALPHABET.charAt(getCryptoRandomIndex(SAFE_ALPHABET.length));
  }
  return `GEO-${y}${m}${d}-${randomPart}`;
}

/**
 * Generate a high-entropy customer query token: QK-XXXX-XXXX-XXXX (12 random base32 chars = 60 bits entropy)
 */
export function generateQueryToken(): string {
  const group = () => {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += SAFE_ALPHABET.charAt(getCryptoRandomIndex(SAFE_ALPHABET.length));
    }
    return s;
  };
  return `QK-${group()}-${group()}-${group()}`;
}

/**
 * Normalize a query token for comparison (trim, uppercase)
 */
export function normalizeQueryToken(token: string): string {
  return String(token || '').trim().toUpperCase();
}

/**
 * Mask customer contact value for safe display in lookup views
 */
export function maskContactValue(method: 'email' | 'wechat', value: string): string {
  const v = String(value || '').trim();
  if (!v) return '***';
  if (method === 'email' && v.includes('@')) {
    const [local, domain] = v.split('@');
    if (local.length <= 2) {
      return `${local[0] || '*'}***@${domain}`;
    }
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  }
  if (v.length <= 3) {
    return `${v[0]}***`;
  }
  return `${v.slice(0, 2)}***${v.slice(-2)}`;
}

/**
 * Convert an internal OrderItem to a sanitized customer-visible PublicOrderView
 * (Never exposes adminNotes, queryTokenHash, id, or full plaintext contactValue)
 */
export function toPublicOrderView(order: OrderItem): PublicOrderView {
  const view: PublicOrderView = {
    orderNumber: order.orderNumber,
    serviceType: order.serviceType,
    title: order.title,
    description: order.description,
    studyArea: order.studyArea || '未指定特定区域',
    dataFormats: order.dataFormats || '待沟通确定',
    budgetRange: order.budgetRange || '待评估',
    expectedDeliveryDate: order.expectedDeliveryDate || '',
    contactMethod: order.contactMethod,
    maskedContact: maskContactValue(order.contactMethod, order.contactValue),
    status: order.status,
    clientNotes: order.clientNotes || '',
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
  if (typeof order.manualQuote === 'number' && Number.isFinite(order.manualQuote)) {
    view.manualQuote = order.manualQuote;
  }
  return view;
}

export interface OrderInputPayload {
  serviceType: string;
  title: string;
  description: string;
  studyArea?: string;
  dataFormats?: string;
  budgetRange?: string;
  expectedDeliveryDate?: string;
  contactMethod: 'email' | 'wechat';
  contactValue: string;
  agreePrivacy: boolean;
  honeypot?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

const VALID_BUDGET_RANGES = ['49-200', '200-500', '500-1500', '1500+', '待评估', ''];

/**
 * Validates public order submission input with strict schema & type checks
 */
export function validateOrderInput(payload: unknown): ValidationResult {
  const errors: Record<string, string> = {};

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: { form: '请求负载格式非法' } };
  }

  const data = payload as Record<string, unknown>;

  if (typeof data.honeypot === 'string' && data.honeypot.trim().length > 0) {
    errors.honeypot = 'Invalid submission detected';
    return { valid: false, errors };
  }

  const validServices: ServiceType[] = [
    'thematic_map',
    'spatial_processing',
    'script_dev',
    'webgis_dev',
    'remote_sensing',
  ];
  if (typeof data.serviceType !== 'string' || !validServices.includes(data.serviceType as ServiceType)) {
    errors.serviceType = '请选择合法的服务类型';
  }

  if (typeof data.title !== 'string' || data.title.trim().length < 2) {
    errors.title = '需求简述至少需 2 个字';
  } else if (data.title.trim().length > 100) {
    errors.title = '需求简述不能超过 100 字';
  }

  if (typeof data.description !== 'string' || data.description.trim().length < 5) {
    errors.description = '详细需求描述至少需 5 个字';
  } else if (data.description.trim().length > 2000) {
    errors.description = '详细描述不能超过 2000 字';
  }

  if (data.studyArea !== undefined && data.studyArea !== null) {
    if (typeof data.studyArea !== 'string' || data.studyArea.length > 120) {
      errors.studyArea = '研究区范围不能超过 120 字';
    }
  }

  if (data.dataFormats !== undefined && data.dataFormats !== null) {
    if (typeof data.dataFormats !== 'string' || data.dataFormats.length > 200) {
      errors.dataFormats = '数据格式说明不能超过 200 字';
    }
  }

  if (data.budgetRange !== undefined && data.budgetRange !== null) {
    if (typeof data.budgetRange !== 'string' || data.budgetRange.length > 60 || !VALID_BUDGET_RANGES.includes(data.budgetRange)) {
      errors.budgetRange = '请选择合法的预算区间';
    }
  }

  if (data.expectedDeliveryDate !== undefined && data.expectedDeliveryDate !== null && data.expectedDeliveryDate !== '') {
    if (
      typeof data.expectedDeliveryDate !== 'string' ||
      data.expectedDeliveryDate.length > 30 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.expectedDeliveryDate)
    ) {
      errors.expectedDeliveryDate = '期望交付日期格式须为 YYYY-MM-DD';
    }
  }

  if (data.contactMethod !== 'email' && data.contactMethod !== 'wechat') {
    errors.contactMethod = '请选择联系方式类型（邮箱或微信）';
  }

  if (typeof data.contactValue !== 'string' || data.contactValue.trim().length < 3) {
    errors.contactValue = '请输入有效的联系方式';
  } else {
    const val = data.contactValue.trim();
    if (val.length > 120) {
      errors.contactValue = '联系方式长度不能超过 120 字符';
    } else if (data.contactMethod === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(val)) {
        errors.contactValue = '请输入正确的电子邮箱格式';
      }
    } else {
      if (val.length < 5 || val.length > 30 || !/^[a-zA-Z0-9_\-+@.\u4e00-\u9fa5]+$/.test(val)) {
        errors.contactValue = '微信号或手机号格式不合法（5-30 位）';
      }
    }
  }

  if (data.agreePrivacy !== true) {
    errors.agreePrivacy = '需阅读并同意隐私政策与合规声明';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Format RMB currency
 */
export function formatRMB(amount?: number | null): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return '待人工评估';
  }
  return `¥${amount.toFixed(2)}`;
}

/**
 * Get step progress index for status timeline (0-5) or -1 for cancelled
 */
export function getStatusStepIndex(status: OrderStatus): number {
  if (status === 'cancelled') return -1;
  const idx = ORDER_STATUS_FLOW.indexOf(status);
  return idx >= 0 ? idx : 0;
}

export interface AdminOrderUpdateInput {
  status: unknown;
  manualQuote?: unknown;
  adminNotes?: unknown;
  clientNotes?: unknown;
}

/**
 * Validates admin updates to an order:
 * 1. Enforces state machine transition rules (`ALLOWED_STATUS_TRANSITIONS`).
 * 2. Strict numeric validation on `manualQuote` (rejects NaN, Infinity, negative, zero, > 1,000,000, non-numeric types).
 * 3. Blocks entering `pending_payment`, `in_progress`, `pending_acceptance`, or `completed` without a positive quote.
 * 4. Prevents modifying an already-confirmed quote once the order is in `in_progress`, `pending_acceptance`, or `completed`
 *    unless the status is first transitioned back to `pending_quote`.
 */
export function validateAdminOrderUpdate(
  input: AdminOrderUpdateInput,
  existingQuote?: number,
  currentStatus?: OrderStatus
): { valid: boolean; error?: string; parsedQuote?: number } {
  const validStatuses: OrderStatus[] = [
    'pending_review',
    'pending_quote',
    'pending_payment',
    'in_progress',
    'pending_acceptance',
    'completed',
    'cancelled',
  ];

  if (typeof input.status !== 'string' || !validStatuses.includes(input.status as OrderStatus)) {
    return { valid: false, error: '无效的订单状态' };
  }

  const targetStatus = input.status as OrderStatus;

  // Check state transition rules if currentStatus is provided
  if (currentStatus) {
    const allowedNext = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedNext.includes(targetStatus)) {
      return {
        valid: false,
        error: `状态流转不合法：不允许从【${ORDER_STATUS_LABELS[currentStatus]}】直接变更为【${ORDER_STATUS_LABELS[targetStatus]}】`,
      };
    }
  }

  // Validate manualQuote
  let parsedQuote: number | undefined = existingQuote;
  const rawQuote = input.manualQuote;

  if (rawQuote !== undefined && rawQuote !== null) {
    if (typeof rawQuote === 'boolean' || typeof rawQuote === 'object') {
      return { valid: false, error: '人工报价字段类型非法' };
    }
    if (typeof rawQuote === 'number') {
      if (!Number.isFinite(rawQuote) || rawQuote <= 0 || rawQuote > 1000000) {
        return { valid: false, error: '请输入合法的人工报价金额（大于 0 且不超过 1,000,000 元）' };
      }
      parsedQuote = Math.round(rawQuote * 100) / 100;
    } else if (typeof rawQuote === 'string') {
      const trimmed = rawQuote.trim();
      if (trimmed === '') {
        parsedQuote = undefined;
      } else {
        if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
          return { valid: false, error: '报价金额格式不合法，请输入大于 0 的数字（最多两位小数）' };
        }
        const num = Number(trimmed);
        if (!Number.isFinite(num) || num <= 0 || num > 1000000) {
          return { valid: false, error: '请输入合法的人工报价金额（大于 0 且不超过 1,000,000 元）' };
        }
        parsedQuote = num;
      }
    } else {
      return { valid: false, error: '人工报价字段类型非法' };
    }
  }

  // Check quote conflict on locked active states
  const lockedQuoteStatuses: OrderStatus[] = ['in_progress', 'pending_acceptance', 'completed'];
  if (
    currentStatus &&
    lockedQuoteStatuses.includes(currentStatus) &&
    lockedQuoteStatuses.includes(targetStatus) &&
    typeof existingQuote === 'number' &&
    parsedQuote !== existingQuote
  ) {
    return {
      valid: false,
      error: '订单已处于进行中/待验收/已完成阶段，禁止直接篡改已确认的报价金额；如需变更报价请先退回【待报价】状态。',
    };
  }

  const requiresQuoteStatuses: OrderStatus[] = [
    'pending_payment',
    'in_progress',
    'pending_acceptance',
    'completed',
  ];

  if (requiresQuoteStatuses.includes(targetStatus)) {
    if (typeof parsedQuote !== 'number' || !Number.isFinite(parsedQuote) || parsedQuote <= 0) {
      return {
        valid: false,
        error: '所有订单必须由管理员人工确认有效报价（大于 0 元）后，才能进入“待付款”及后续推进状态。',
      };
    }
  }

  if (input.adminNotes !== undefined && input.adminNotes !== null) {
    if (typeof input.adminNotes !== 'string' || input.adminNotes.length > 2000) {
      return { valid: false, error: '内部备注必须为字符串且不能超过 2000 字' };
    }
  }

  if (input.clientNotes !== undefined && input.clientNotes !== null) {
    if (typeof input.clientNotes !== 'string' || input.clientNotes.length > 1000) {
      return { valid: false, error: '客户进度提示必须为字符串且不能超过 1000 字' };
    }
  }

  return { valid: true, parsedQuote };
}

/**
 * Clean an OrderItem into a plain object without undefined values for Firestore storage
 */
export function cleanOrderForFirestore(order: OrderItem): Record<string, any> {
  const docData: Record<string, any> = {
    id: order.id,
    orderNumber: order.orderNumber,
    serviceType: order.serviceType,
    title: order.title.slice(0, 100),
    description: order.description.slice(0, 2000),
    studyArea: (order.studyArea || '未指定特定区域').slice(0, 120),
    dataFormats: (order.dataFormats || '待沟通确定').slice(0, 200),
    budgetRange: (order.budgetRange || '待评估').slice(0, 60),
    expectedDeliveryDate: (order.expectedDeliveryDate || '').slice(0, 30),
    contactMethod: order.contactMethod,
    contactValue: order.contactValue.slice(0, 120),
    status: order.status,
    adminNotes: (order.adminNotes || '').slice(0, 2000),
    clientNotes: (order.clientNotes || '').slice(0, 1000),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
  if (typeof order.manualQuote === 'number' && Number.isFinite(order.manualQuote)) {
    docData.manualQuote = order.manualQuote;
  }
  if (order.queryTokenHash) {
    docData.queryTokenHash = order.queryTokenHash;
  }
  if (order.queryTokenUpdatedAt) {
    docData.queryTokenUpdatedAt = order.queryTokenUpdatedAt;
  }
  if (typeof order.isDemo === 'boolean') {
    docData.isDemo = order.isDemo;
  }
  return docData;
}

export interface OrderFilterOptions {
  status?: string;
  serviceType?: string;
  search?: string;
}

/**
 * Filter and sort orders
 */
export function filterAndSortOrders(orders: OrderItem[], filters: OrderFilterOptions): OrderItem[] {
  return orders
    .filter((o) => {
      if (filters.status && filters.status !== 'all' && o.status !== filters.status) {
        return false;
      }
      if (filters.serviceType && filters.serviceType !== 'all' && o.serviceType !== filters.serviceType) {
        return false;
      }
      if (filters.search && filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        const matchesNumber = o.orderNumber.toLowerCase().includes(q);
        const matchesTitle = o.title.toLowerCase().includes(q);
        const matchesDesc = o.description.toLowerCase().includes(q);
        const matchesContact = o.contactValue.toLowerCase().includes(q);
        const matchesArea = (o.studyArea || '').toLowerCase().includes(q);
        if (!matchesNumber && !matchesTitle && !matchesDesc && !matchesContact && !matchesArea) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Defends against CSV Formula Injection (CSV Injection / DDE Injection).
 * Any cell whose text starts with =, +, -, @, Tab (\t), or CR (\r) (including after leading whitespace)
 * is prefixed with a single quote (') so spreadsheet software treats it strictly as a literal string.
 */
export function sanitizeCSVField(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '""';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? `"${val}"` : '""';
  }
  let str = String(val);
  // Check if string starts with dangerous formula trigger characters (even after leading spaces/newlines)
  if (/^[\s\u0000-\u001f]*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Export orders list into standard CSV format with UTF-8 BOM and Formula Injection protection
 */
export function exportOrdersToCSV(orders: OrderItem[]): string {
  const headers = [
    '工单编号',
    '服务类型',
    '需求简述',
    '需求详述',
    '研究区',
    '数据格式',
    '预算区间',
    '期望交付日期',
    '联系方式',
    '联系号码/账号',
    '当前状态',
    '人工报价(元)',
    '内部备注',
    '客户提示',
    '创建时间',
    '更新时间',
  ];

  const rows = orders.map((o) => [
    sanitizeCSVField(o.orderNumber),
    sanitizeCSVField(SERVICE_TYPE_LABELS[o.serviceType] || o.serviceType),
    sanitizeCSVField(o.title),
    sanitizeCSVField(o.description),
    sanitizeCSVField(o.studyArea || ''),
    sanitizeCSVField(o.dataFormats || ''),
    sanitizeCSVField(o.budgetRange || ''),
    sanitizeCSVField(o.expectedDeliveryDate || ''),
    sanitizeCSVField(o.contactMethod === 'email' ? '邮箱' : '微信'),
    sanitizeCSVField(o.contactValue),
    sanitizeCSVField(ORDER_STATUS_LABELS[o.status] || o.status),
    sanitizeCSVField(typeof o.manualQuote === 'number' ? o.manualQuote : ''),
    sanitizeCSVField(o.adminNotes || ''),
    sanitizeCSVField(o.clientNotes || ''),
    sanitizeCSVField(o.createdAt),
    sanitizeCSVField(o.updatedAt),
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  // Prepend UTF-8 BOM so Excel opens Chinese text without garbled characters
  return '\uFEFF' + csvContent;
}
