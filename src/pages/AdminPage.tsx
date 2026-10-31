import React, { useState, useEffect } from 'react';
import {
  Lock,
  LogOut,
  ShieldAlert,
  Search,
  Download,
  CheckCircle,
  Copy,
  AlertCircle,
  RefreshCw,
  KeyRound,
  ExternalLink,
} from 'lucide-react';
import {
  auth,
  signInAdminWithGoogle,
  signInAdminWithGoogleRedirect,
  resolveGoogleRedirectResult,
  logoutAdmin,
  getAdminBearerToken,
} from '../lib/firebase.ts';
import {
  OrderItem,
  OrderStatus,
  ORDER_STATUS_LABELS,
  SERVICE_TYPE_LABELS,
  ALLOWED_STATUS_TRANSITIONS,
  formatRMB,
  filterAndSortOrders,
  validateAdminOrderUpdate,
} from '../utils/order-utils.ts';

export const AdminPage: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);
  const [unwhitelistedUid, setUnwhitelistedUid] = useState<string | null>(null);
  const isEmbeddedIframe =
    typeof window !== 'undefined' && window.self !== window.top;
  const standaloneAdminUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#admin`
      : '#admin';

  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Active editing order in modal
  const [editingOrder, setEditingOrder] = useState<OrderItem | null>(null);
  const [modalForm, setModalForm] = useState<{
    status: OrderStatus;
    manualQuote: string;
    adminNotes: string;
    clientNotes: string;
  }>({
    status: 'pending_review',
    manualQuote: '',
    adminNotes: '',
    clientNotes: '',
  });
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);

  // Query token rotation state in modal
  const [isRotatingToken, setIsRotatingToken] = useState(false);
  const [rotatedTokenResult, setRotatedTokenResult] = useState<string | null>(null);
  const [copiedRotatedToken, setCopiedRotatedToken] = useState(false);
  const [isAnonymizing, setIsAnonymizing] = useState(false);

  // Listen to Firebase Auth state & resolve redirect sign-in results
  useEffect(() => {
    if (!auth) {
      setCurrentUser(null);
      setIsAdmin(false);
      setAuthChecking(false);
      return;
    }

    resolveGoogleRedirectResult().catch((err: any) => {
      if (err?.message) {
        setAuthError(err.message);
        setAuthErrorCode(err.code || null);
      }
    });

    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setAuthChecking(true);
      setUnwhitelistedUid(null);
      if (user) {
        setCurrentUser(user);
        await verifyAdminPrivilegeWithBearerToken();
      } else {
        setCurrentUser(null);
        setIsAdmin(false);
        setAuthChecking(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const parseJsonResponse = async (res: Response): Promise<any> => {
    const rawText = await res.text();
    try {
      return rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(
        `服务端或反向代理返回了非 JSON 响应 (HTTP ${res.status})。请刷新页面后重试。`
      );
    }
  };

  const verifyAdminPrivilegeWithBearerToken = async () => {
    setAuthError(null);
    setUnwhitelistedUid(null);
    try {
      const idToken = await getAdminBearerToken();
      if (!idToken) {
        setIsAdmin(false);
        setAuthError('未获取到有效的 Firebase ID Token，请使用 Google 账号登录。');
        return;
      }

      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Firebase-Auth': `Bearer ${idToken}`,
        },
        body: JSON.stringify({}),
      });
      const data = await parseJsonResponse(res);

      if (res.ok && data.isAdmin) {
        setIsAdmin(true);
        await fetchOrdersFromServer();
      } else {
        setIsAdmin(false);
        const detectedUid = data.uid || auth?.currentUser?.uid || null;
        if (detectedUid) {
          setUnwhitelistedUid(detectedUid);
        }
        setAuthError(
          data.message || '当前已认证账号未在服务端 ADMIN_UIDS 白名单内，且无 admin Custom Claim。'
        );
      }
    } catch (err: any) {
      if (auth?.currentUser?.uid) {
        setUnwhitelistedUid(auth.currentUser.uid);
      }
      setAuthError('服务端权限校验异常：' + (err.message || '网络错误'));
      setIsAdmin(false);
    } finally {
      setAuthChecking(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setAuthErrorCode(null);
    try {
      const user = await signInAdminWithGoogle();
      if (user) {
        await verifyAdminPrivilegeWithBearerToken();
      }
    } catch (err: any) {
      setAuthErrorCode(err?.code || null);
      setAuthError(err.message || 'Google 登录未完成或被取消');
    }
  };

  const handleGoogleRedirectLogin = async () => {
    setAuthError(null);
    setAuthErrorCode(null);
    try {
      await signInAdminWithGoogleRedirect();
    } catch (err: any) {
      setAuthErrorCode(err?.code || null);
      setAuthError(err.message || '页面重定向登录启动失败');
    }
  };

  const handleLogout = async () => {
    await logoutAdmin();
    setCurrentUser(null);
    setIsAdmin(false);
    setOrders([]);
    setUnwhitelistedUid(null);
  };

  const fetchOrdersFromServer = async () => {
    setIsLoadingOrders(true);
    setBannerNotice(null);
    try {
      const idToken = await getAdminBearerToken();
      if (!idToken) {
        throw new Error('登录状态已失效，请重新登录。');
      }

      const res = await fetch('/api/admin/orders', {
        headers: {
          'X-Firebase-Auth': `Bearer ${idToken}`,
        },
      });
      const data = await parseJsonResponse(res);

      if (!res.ok || !data.success) {
        throw new Error(data.message || `读取工单失败 (HTTP ${res.status})`);
      }

      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (err: any) {
      setBannerNotice({
        type: 'error',
        text: err.message || '加载权威数据库工单列表失败',
      });
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const handleOpenEditModal = (order: OrderItem) => {
    setEditingOrder(order);
    setModalForm({
      status: order.status,
      manualQuote: order.manualQuote !== undefined ? String(order.manualQuote) : '',
      adminNotes: order.adminNotes || '',
      clientNotes: order.clientNotes || '',
    });
    setModalError(null);
    setSaveSuccessMsg(null);
    setRotatedTokenResult(null);
  };

  const handleCloseModal = () => {
    setEditingOrder(null);
    setModalError(null);
    setSaveSuccessMsg(null);
    setRotatedTokenResult(null);
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder || !currentUser) return;

    setModalError(null);
    setSaveSuccessMsg(null);

    const check = validateAdminOrderUpdate(
      {
        status: modalForm.status,
        manualQuote: modalForm.manualQuote,
        adminNotes: modalForm.adminNotes,
        clientNotes: modalForm.clientNotes,
      },
      editingOrder.manualQuote,
      editingOrder.status
    );

    if (!check.valid) {
      setModalError(check.error || '请检查输入项');
      return;
    }

    setIsSaving(true);

    try {
      const idToken = await getAdminBearerToken();
      if (!idToken) {
        throw new Error('未获取到有效登录凭证，请重新登录');
      }

      const payload: any = {
        status: modalForm.status,
        manualQuote: modalForm.manualQuote.trim() !== '' ? check.parsedQuote : '',
        adminNotes: modalForm.adminNotes,
        clientNotes: modalForm.clientNotes,
      };

      const res = await fetch(`/api/admin/orders/${encodeURIComponent(editingOrder.orderNumber)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Firebase-Auth': `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await parseJsonResponse(res);
      if (!res.ok || !data.success) {
        throw new Error(data.message || '更新工单失败');
      }

      const updatedOrder: OrderItem = data.order;
      setOrders((prev) =>
        prev.map((o) => (o.orderNumber === editingOrder.orderNumber ? updatedOrder : o))
      );
      setEditingOrder(updatedOrder);
      setSaveSuccessMsg('工单已通过服务端事务成功更新并持久化！');
      setTimeout(() => {
        handleCloseModal();
      }, 900);
    } catch (err: any) {
      setModalError(err.message || '保存失败，请稍后重试');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRotateQueryToken = async () => {
    if (!editingOrder || !currentUser) return;
    if (
      !window.confirm(
        '重置后客户当前保存的查询凭证会立即失效。请确认已通过预留渠道核实客户身份，是否继续？'
      )
    ) {
      return;
    }
    setIsRotatingToken(true);
    setModalError(null);
    setRotatedTokenResult(null);

    try {
      const idToken = await getAdminBearerToken();
      if (!idToken) {
        throw new Error('未获取到有效登录凭证，请重新登录');
      }

      const res = await fetch(
        `/api/admin/orders/${encodeURIComponent(editingOrder.orderNumber)}/rotate-token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Firebase-Auth': `Bearer ${idToken}`,
          },
          body: JSON.stringify({}),
        }
      );
      const data = await parseJsonResponse(res);
      if (!res.ok || !data.success) {
        throw new Error(data.message || '重置查询凭证失败');
      }
      setRotatedTokenResult(data.newQueryToken);
    } catch (err: any) {
      setModalError(err.message || '重置查询凭证失败');
    } finally {
      setIsRotatingToken(false);
    }
  };

  const handleAnonymizeOrder = async () => {
    if (!editingOrder || !currentUser) return;
    if (
      !window.confirm(
        '匿名化会清除客户联系方式、需求正文、研究区和内部备注，并立即作废查询凭证。此操作不可撤销，是否继续？'
      )
    ) {
      return;
    }

    setIsAnonymizing(true);
    setModalError(null);
    setSaveSuccessMsg(null);
    setRotatedTokenResult(null);
    try {
      const idToken = await getAdminBearerToken();
      if (!idToken) {
        throw new Error('未获取到有效登录凭证，请重新登录');
      }
      const res = await fetch(
        `/api/admin/orders/${encodeURIComponent(editingOrder.orderNumber)}/anonymize`,
        {
          method: 'POST',
          headers: { 'X-Firebase-Auth': `Bearer ${idToken}` },
        }
      );
      const data = await parseJsonResponse(res);
      if (!res.ok || !data.success) {
        throw new Error(data.message || '匿名化工单失败');
      }
      const updatedOrder: OrderItem = data.order;
      setOrders((prev) =>
        prev.map((o) => (o.orderNumber === editingOrder.orderNumber ? updatedOrder : o))
      );
      setEditingOrder(updatedOrder);
      setSaveSuccessMsg('客户文本与联系方式已匿名化，原查询凭证已失效。');
      setTimeout(() => {
        handleCloseModal();
      }, 1200);
    } catch (err: any) {
      setModalError(err.message || '匿名化工单失败');
    } finally {
      setIsAnonymizing(false);
    }
  };

  const handleExportCSV = async () => {
    if (!currentUser || !isAdmin) return;
    try {
      const idToken = await getAdminBearerToken();
      if (!idToken) {
        throw new Error('登录状态已失效，请重新登录。');
      }
      const res = await fetch('/api/admin/export-csv', {
        headers: { 'X-Firebase-Auth': `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const data = await parseJsonResponse(res);
        throw new Error(data.message || `导出失败 (HTTP ${res.status})`);
      }
      const csvContent = await res.text();
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `geospatial-orders-${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setBannerNotice({
        type: 'success',
        text: '已从权威数据库导出 CSV（单次最多 10,000 条，已启用公式注入防护）。',
      });
    } catch (err: any) {
      setBannerNotice({
        type: 'error',
        text: err.message || '导出全量 CSV 失败',
      });
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const filteredOrders = filterAndSortOrders(orders, {
    status: statusFilter,
    serviceType: serviceFilter,
    search: searchQuery,
  });

  // KPI Calculations
  const totalOrders = orders.length;
  const pendingReviewCount = orders.filter(
    (o) => o.status === 'pending_review' || o.status === 'pending_quote'
  ).length;
  const inProgressCount = orders.filter(
    (o) => o.status === 'in_progress' || o.status === 'pending_acceptance'
  ).length;
  const completedCount = orders.filter((o) => o.status === 'completed').length;
  const totalQuotedValue = orders.reduce((sum, o) => sum + (o.manualQuote || 0), 0);

  const getStatusBadgeClass = (status: OrderStatus) => {
    switch (status) {
      case 'pending_review':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'pending_quote':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'pending_payment':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'in_progress':
        return 'bg-teal-100 text-teal-800 border-teal-300';
      case 'pending_acceptance':
        return 'bg-indigo-100 text-indigo-800 border-indigo-300';
      case 'completed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'cancelled':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  // Compute allowed target statuses for the currently editing order
  const allowedModalStatuses: OrderStatus[] = editingOrder
    ? Array.from(
        new Set<OrderStatus>([
          editingOrder.status,
          ...(ALLOWED_STATUS_TRANSITIONS[editingOrder.status] || []),
        ])
      )
    : [];

  const isQuoteLockedInCurrentState =
    editingOrder &&
    ['in_progress', 'pending_acceptance', 'completed'].includes(editingOrder.status) &&
    modalForm.status !== 'pending_quote';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Auth Screen when not signed in or not admin */}
      {(!currentUser || !isAdmin) && (
        <div className="max-w-md mx-auto bg-white rounded-3xl border border-slate-200 p-8 shadow-xl text-center space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 text-teal-400 mx-auto flex items-center justify-center">
            <Lock className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">工作室工单管理后台</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              管理后台采用 Firebase Authentication Google 登录，并由服务端使用 Firebase Admin SDK
              验证 Bearer ID Token 签名与服务端 ADMIN_UIDS 白名单。未经授权无法访问任何客户工单。
            </p>
          </div>

          {authError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-700 text-left space-y-2">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
              {(unwhitelistedUid || currentUser?.uid) && (
                <div className="bg-white border border-red-200 rounded-lg p-2.5 font-mono text-[11px] text-slate-800 flex items-center justify-between gap-2">
                  <span className="truncate">
                    您的真实 UID: {unwhitelistedUid || currentUser?.uid}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(unwhitelistedUid || currentUser?.uid)}
                    className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] shrink-0 cursor-pointer"
                  >
                    {copiedText ? '已复制' : '复制 UID'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3 pt-2">
            <button
              onClick={handleGoogleLogin}
              disabled={authChecking && !!currentUser}
              className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>使用 Google 账号安全登录</span>
            </button>

            {!isEmbeddedIframe && authErrorCode === 'auth/popup-blocked' && (
              <button
                type="button"
                onClick={handleGoogleRedirectLogin}
                className="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
              >
                <span>使用当前页面跳转登录（免弹窗）</span>
              </button>
            )}

            {(isEmbeddedIframe || authErrorCode === 'auth/popup-blocked') && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left space-y-2">
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {authErrorCode === 'auth/popup-blocked'
                    ? '检测到浏览器或预览内嵌框拦截了登录弹窗。您可以点击浏览器地址栏右侧图标允许弹窗，或直接在独立标签页中打开管理后台完成登录：'
                    : '提示：若在 AI Studio 预览框内遇到浏览器拦截 Google 登录弹窗，可在独立浏览器标签页中打开本后台进行登录与管理：'}
                </p>
                <a
                  href={standaloneAdminUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-3 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-teal-600" />
                  <span>在独立新标签页中打开管理后台 (#admin)</span>
                </a>
              </div>
            )}

            {currentUser && !isAdmin && (
              <button
                onClick={handleLogout}
                className="w-full py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium transition cursor-pointer"
              >
                切换其他 Google 账号
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Admin Dashboard */}
      {currentUser && isAdmin && (
        <div className="space-y-8 animate-fadeIn">
          {/* Top Admin Header Bar */}
          <div className="bg-slate-900 rounded-3xl p-6 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 font-mono text-[10px] font-bold border border-teal-500/30">
                  FIREBASE ADMIN TOKEN VERIFIED
                </span>
                <span className="text-xs text-slate-300 font-mono">{currentUser.email}</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  (UID: {currentUser.uid})
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold">工单全生命周期管理系统</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={fetchOrdersFromServer}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
                title="从权威数据库刷新工单列表"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-teal-400 ${isLoadingOrders ? 'animate-spin' : ''}`} />
                <span>刷新数据</span>
              </button>

              <button
                onClick={handleExportCSV}
                className="px-3.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>导出工单 CSV</span>
              </button>

              <button
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-900 text-slate-300 hover:text-white text-xs transition cursor-pointer flex items-center gap-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>退出</span>
              </button>
            </div>
          </div>

          {bannerNotice && (
            <div
              className={`p-4 rounded-2xl border text-xs flex items-center justify-between ${
                bannerNotice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {bannerNotice.type === 'success' ? (
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                )}
                <span>{bannerNotice.text}</span>
              </div>
              <button
                onClick={() => setBannerNotice(null)}
                className="text-slate-400 hover:text-slate-700 px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Metric KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-slate-400 block font-medium">总工单量</span>
              <span className="text-2xl font-bold text-slate-900">{totalOrders}</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">权威库累计记录</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-amber-600 block font-medium">待确认 / 待报价</span>
              <span className="text-2xl font-bold text-amber-600">{pendingReviewCount}</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">需尽快人工评估</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-teal-600 block font-medium">进行中 / 待验收</span>
              <span className="text-2xl font-bold text-teal-600">{inProgressCount}</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">正在研发制作</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-emerald-600 block font-medium">已交付完成</span>
              <span className="text-2xl font-bold text-emerald-600">{completedCount}</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">成果已归档</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm col-span-2 sm:col-span-1">
              <span className="text-[11px] text-slate-400 block font-medium">工单累计报价估值</span>
              <span className="text-2xl font-bold text-slate-900">{formatRMB(totalQuotedValue)}</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">所有已报价总额</span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">状态：</span>
                <select
                  aria-label="按工单状态筛选"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-500 font-medium"
                >
                  <option value="all">全部状态 ({orders.length})</option>
                  <option value="pending_review">待确认</option>
                  <option value="pending_quote">待报价</option>
                  <option value="pending_payment">待付款</option>
                  <option value="in_progress">进行中</option>
                  <option value="pending_acceptance">待验收</option>
                  <option value="completed">已完成</option>
                  <option value="cancelled">已取消</option>
                </select>
              </div>

              {/* Service Type Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">服务：</span>
                <select
                  aria-label="按服务类型筛选"
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-500 font-medium"
                >
                  <option value="all">全部业务类型</option>
                  <option value="thematic_map">专题地图制作</option>
                  <option value="spatial_processing">空间数据处理</option>
                  <option value="script_dev">Python 脚本开发</option>
                  <option value="webgis_dev">WebGIS 开发</option>
                  <option value="remote_sensing">遥感变化分析</option>
                </select>
              </div>
            </div>

            {/* Keyword Search */}
            <div className="relative max-w-xs w-full">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索工单号、需求、客户联系方式..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Orders Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-medium">
                  <tr>
                    <th className="px-5 py-3.5">工单编号</th>
                    <th className="px-4 py-3.5">业务类别</th>
                    <th className="px-4 py-3.5">需求简述 / 研究区</th>
                    <th className="px-4 py-3.5">客户对接方式</th>
                    <th className="px-4 py-3.5">工单状态</th>
                    <th className="px-4 py-3.5">人工核定报价</th>
                    <th className="px-4 py-3.5">登记时间</th>
                    <th className="px-5 py-3.5 text-right">操作管理</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoadingOrders ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                        正在从权威数据库加载工单数据...
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                        未检索到匹配的工单记录
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((ord) => (
                      <tr key={ord.id || ord.orderNumber} className="hover:bg-slate-50/80 transition">
                        <td className="px-5 py-4 font-mono font-bold text-teal-700 whitespace-nowrap">
                          {ord.orderNumber}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-slate-700">
                          {SERVICE_TYPE_LABELS[ord.serviceType] || ord.serviceType}
                        </td>
                        <td className="px-4 py-4 max-w-xs">
                          <div className="font-semibold text-slate-900 truncate" title={ord.title}>
                            {ord.title}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            研究区：{ord.studyArea || '未限定'}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className="text-[10px] text-slate-400 block">
                            {ord.contactMethod === 'email' ? '邮箱' : '微信'}
                          </span>
                          <span className="font-mono text-slate-800">{ord.contactValue}</span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${getStatusBadgeClass(
                              ord.status
                            )}`}
                          >
                            {ORDER_STATUS_LABELS[ord.status]}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap font-mono font-bold text-slate-900">
                          {formatRMB(ord.manualQuote)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-slate-400 text-[11px] font-mono">
                          {new Date(ord.createdAt).toLocaleDateString('zh-CN')}
                        </td>
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleOpenEditModal(ord)}
                            aria-label={`审核与更新 ${ord.orderNumber}`}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-teal-600 hover:text-white text-slate-700 font-semibold transition cursor-pointer"
                          >
                            审核与更新
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Order Detail & Action Modal */}
          {editingOrder && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-order-title"
                className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-fadeIn"
              >
                <div className="p-6 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-10">
                  <div>
                    <span className="text-[11px] font-mono text-teal-400 block">
                      工单详情 · {editingOrder.orderNumber}
                    </span>
                    <h2 id="modal-order-title" className="text-base font-bold text-white mt-0.5">
                      {editingOrder.title}
                    </h2>
                  </div>
                  <button
                    onClick={handleCloseModal}
                    aria-label="关闭工单详情弹窗"
                    className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSaveModal} className="p-6 space-y-6 text-xs">
                  {modalError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 font-medium flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <span>{modalError}</span>
                    </div>
                  )}

                  {saveSuccessMsg && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-800 font-semibold flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <span>{saveSuccessMsg}</span>
                    </div>
                  )}

                  {/* Customer Submitted Info (Read-only reference) */}
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                    <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                      客户提交信息核对
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                      <div>
                        <span className="text-slate-400 block">服务类别</span>
                        <span className="font-medium text-slate-800">
                          {SERVICE_TYPE_LABELS[editingOrder.serviceType]}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">客户预算</span>
                        <span className="font-medium text-slate-800">
                          {editingOrder.budgetRange || '待评估'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">研究区范围</span>
                        <span className="font-medium text-slate-800">
                          {editingOrder.studyArea || '未限定'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">数据格式要求</span>
                        <span className="font-medium text-slate-800">
                          {editingOrder.dataFormats || '待商定'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">期望交付时效</span>
                        <span className="font-medium text-slate-800">
                          {editingOrder.expectedDeliveryDate || '未指定'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">联系方式（仅授权管理员可见完整值）</span>
                        <div className="flex items-center gap-1 font-mono font-semibold text-teal-800">
                          <span>
                            {editingOrder.contactMethod === 'email' ? '邮箱' : '微信'}:{' '}
                            {editingOrder.contactValue}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(editingOrder.contactValue)}
                            className="p-1 hover:text-teal-600 cursor-pointer"
                            title="复制联系信息"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          {copiedText && <span className="text-[9px] text-teal-600">已复制</span>}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200">
                      <span className="text-slate-400 block text-[10px] mb-1">需求详述：</span>
                      <p className="text-slate-700 leading-relaxed whitespace-pre-line bg-white p-2.5 rounded-lg border border-slate-200">
                        {editingOrder.description}
                      </p>
                    </div>
                  </div>

                  {/* Customer Query Token Re-issue Section (P0-D) */}
                  <div className="bg-slate-900 text-white p-4 rounded-2xl space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-teal-400 flex items-center gap-1.5">
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>客户查询凭证应急重置</span>
                        </span>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          当客户遗失查询凭证并通过预留邮箱/微信联系核实身份后，可点击生成新凭证（旧凭证立即作废）。
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isRotatingToken}
                        onClick={handleRotateQueryToken}
                        className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 text-white font-semibold text-xs transition cursor-pointer shrink-0"
                      >
                        {isRotatingToken ? '正在签发...' : '重置并签发新查询凭证'}
                      </button>
                    </div>

                    {rotatedTokenResult && (
                      <div className="bg-slate-800 border border-teal-500/40 rounded-xl p-3 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] text-teal-300 block">
                            新签发的专属查询凭证（请发送给已核实身份的客户）：
                          </span>
                          <span className="font-mono font-bold text-sm text-white tracking-wider">
                            {rotatedTokenResult}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(rotatedTokenResult);
                            setCopiedRotatedToken(true);
                            setTimeout(() => setCopiedRotatedToken(false), 2000);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-teal-600/30 hover:bg-teal-600/50 text-teal-200 text-xs cursor-pointer"
                        >
                          {copiedRotatedToken ? '已复制' : '复制新凭证'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Customer deletion / anonymization right */}
                  <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl space-y-3 text-rose-950">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                          <span>客户数据删除权 / 匿名化</span>
                        </span>
                        <p className="text-[11px] text-rose-800 mt-0.5">
                          仅在核实客户身份并收到删除或匿名化请求后使用。操作将清除联系方式、需求正文、研究区与备注，并作废查询凭证。
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isAnonymizing || isRotatingToken}
                        onClick={handleAnonymizeOrder}
                        className="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:bg-rose-300 text-white font-semibold text-xs transition cursor-pointer shrink-0"
                      >
                        {isAnonymizing ? '正在匿名化...' : '匿名化客户信息'}
                      </button>
                    </div>
                  </div>

                  {/* Management Inputs */}
                  <div className="space-y-4">
                    <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                      管理操作与人工评估报价
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Status */}
                      <div>
                        <label htmlFor="modal-status-select" className="block font-medium text-slate-700 mb-1">
                          标记工单状态（受控状态机）
                        </label>
                        <select
                          id="modal-status-select"
                          value={modalForm.status}
                          onChange={(e) => {
                            setModalForm({ ...modalForm, status: e.target.value as OrderStatus });
                            setModalError(null);
                          }}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                          {allowedModalStatuses.map((st) => (
                            <option key={st} value={st}>
                              {ORDER_STATUS_LABELS[st]} ({st})
                            </option>
                          ))}
                        </select>
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          仅展示当前状态（{ORDER_STATUS_LABELS[editingOrder.status]}）允许流转的目标节点。
                        </span>
                      </div>

                      {/* Manual Quote (CNY) */}
                      <div>
                        <label htmlFor="modal-quote-input" className="block font-medium text-slate-700 mb-1">
                          人工核定报价 (人民币 元)
                        </label>
                        <input
                          id="modal-quote-input"
                          type="number"
                          step="0.01"
                          min="0.01"
                          max="1000000"
                          disabled={Boolean(isQuoteLockedInCurrentState)}
                          placeholder="例如：280"
                          value={modalForm.manualQuote}
                          onChange={(e) => {
                            setModalForm({ ...modalForm, manualQuote: e.target.value });
                            setModalError(null);
                          }}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white disabled:bg-slate-100 disabled:text-slate-500 font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          {isQuoteLockedInCurrentState
                            ? '当前处于进行中/待验收/已完成锁定阶段，不可直接篡改已约定报价。'
                            : '必须为 0.01 ~ 1,000,000 之间的有效数值方可进入待付款阶段。'}
                        </span>
                      </div>
                    </div>

                    {/* Studio Client Notes (Visible to customer) */}
                    <div>
                      <label htmlFor="modal-client-notes" className="block font-medium text-slate-700 mb-1">
                        客户可见进度反馈 (公开显示在查询页)
                      </label>
                      <input
                        id="modal-client-notes"
                        type="text"
                        placeholder="例如：数据格式已校核通过，已进入 QGIS 自动化出图排版阶段..."
                        value={modalForm.clientNotes}
                        onChange={(e) => setModalForm({ ...modalForm, clientNotes: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    {/* Admin Notes (Strictly private) */}
                    <div>
                      <label htmlFor="modal-admin-notes" className="block font-medium text-slate-700 mb-1">
                        内部管理备注 (仅管理员可见，客户查询接口严格剥离)
                      </label>
                      <textarea
                        id="modal-admin-notes"
                        rows={3}
                        placeholder="记录工程环境、数据存放路径、微信沟通备忘、特定技术注意点..."
                        value={modalForm.adminNotes}
                        onChange={(e) => setModalForm({ ...modalForm, adminNotes: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 leading-relaxed"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="px-6 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-bold transition cursor-pointer shadow-sm flex items-center gap-1.5"
                    >
                      {isSaving ? (
                        <span>保存中...</span>
                      ) : (
                        <>
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>保存更新</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
