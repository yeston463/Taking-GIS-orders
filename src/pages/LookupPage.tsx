import React, { useState, useEffect } from 'react';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  FileText,
  Copy,
  MessageSquare,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_FLOW,
  SERVICE_TYPE_LABELS,
  getStatusStepIndex,
  formatRMB,
  PublicOrderView,
} from '../utils/order-utils.ts';

interface LookupPageProps {
  initialOrderNumber?: string;
  initialQueryToken?: string;
}

export const LookupPage: React.FC<LookupPageProps> = ({
  initialOrderNumber = '',
  initialQueryToken = '',
}) => {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [queryToken, setQueryToken] = useState(initialQueryToken);
  const [isLoading, setIsLoading] = useState(false);
  const [order, setOrder] = useState<PublicOrderView | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialOrderNumber && initialQueryToken) {
      setOrderNumber(initialOrderNumber);
      setQueryToken(initialQueryToken);
      performQuery(initialOrderNumber, initialQueryToken);
    }
  }, [initialOrderNumber, initialQueryToken]);

  const performQuery = async (ordNo: string, token: string) => {
    if (!ordNo.trim() || !token.trim()) {
      setErrorMsg('请同时填写工单编号以及提交时生成的专属查询凭证（格式如 QK-XXXX-XXXX-XXXX）');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: ordNo.trim().toUpperCase(),
          queryToken: token.trim().toUpperCase(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || '工单编号或查询凭证无效，请核对后重试。');
      }

      setOrder(data.order);
    } catch (err: any) {
      setOrder(null);
      setErrorMsg(err.message || '查询出现异常，请核对信息后重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performQuery(orderNumber, queryToken);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentStep = order ? getStatusStepIndex(order.status) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Page Title */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-50 border border-teal-200/80 text-teal-800 text-xs font-medium">
          <KeyRound className="w-3.5 h-3.5" />
          <span>高强度凭证校验 · 客户隐私脱敏保护</span>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">工单进度与报价查询</h1>
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
          输入您的工单编号（如 GEO-20261029-XXXXXX）与提交需求时获取的专属查询凭证（如 QK-XXXX-XXXX-XXXX），实时查阅审核进度、正式报价与交付状态。
        </p>
      </div>

      {/* Query Form */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-4">
        <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor="lookup-order-number" className="block text-xs font-medium text-slate-700 mb-1">
              工单编号 (Order Number)
            </label>
            <input
              id="lookup-order-number"
              type="text"
              placeholder="例如：GEO-20261029-XXXXXX"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm font-mono uppercase bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              required
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="lookup-query-token" className="block text-xs font-medium text-slate-700 mb-1">
              专属查询凭证 (Query Token)
            </label>
            <input
              id="lookup-query-token"
              type="text"
              placeholder="例如：QK-XXXX-XXXX-XXXX"
              value={queryToken}
              onChange={(e) => setQueryToken(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm font-mono uppercase bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              required
            />
          </div>

          <div className="sm:col-span-1 flex items-end">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-semibold text-xs sm:text-sm transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>立即查询</span>
                </>
              )}
            </button>
          </div>
        </form>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-[11px] text-slate-500 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
          <span>
            <strong>遗失查询凭证说明：</strong>
            为防止通过撞库邮箱或微信号枚举客户工单，本系统已全面升级为一次性高熵查询凭证校验。若您不慎遗失凭证，请使用提交工单时预留的邮箱或微信联系工作室工程师，人工核实身份后可为您重置并签发新凭证。
          </span>
        </div>
      </div>

      {/* Query Result Card */}
      {order && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-fadeIn space-y-6">
          {/* Top Banner */}
          <div className="p-6 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono">工单编号</span>
                <span className="text-xl font-mono font-bold text-teal-400">{order.orderNumber}</span>
                <button
                  onClick={() => handleCopy(order.orderNumber)}
                  className="text-slate-400 hover:text-white p-1 cursor-pointer"
                  title="复制工单号"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {copied && <span className="text-[10px] text-teal-300">已复制</span>}
              </div>
              <h2 className="text-lg font-bold text-white">{order.title}</h2>
            </div>

            <div className="flex items-center gap-3 self-start md:self-auto">
              <span className="text-xs text-slate-400">当前工单状态：</span>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40">
                {ORDER_STATUS_LABELS[order.status]}
              </span>
            </div>
          </div>

          {/* 7-Step Timeline Progress Bar */}
          <div className="px-6 sm:px-8 py-4">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-6">
              全流程状态流转节点
            </h3>

            {order.status === 'cancelled' ? (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 text-xs">
                当前工单已标记为【已取消】。如需继续推进，请重新发起或联系工程师。
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {ORDER_STATUS_FLOW.map((st, idx) => {
                  const isDone = currentStep > idx;
                  const isCurrent = currentStep === idx;
                  return (
                    <div
                      key={st}
                      className={`p-3 rounded-xl border text-center transition ${
                        isCurrent
                          ? 'border-teal-500 bg-teal-50 text-teal-950 ring-2 ring-teal-500/20 font-bold'
                          : isDone
                          ? 'border-slate-200 bg-slate-50 text-slate-700'
                          : 'border-slate-100 bg-white text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-center mb-1">
                        {isDone ? (
                          <CheckCircle2 className="w-4 h-4 text-teal-600" />
                        ) : isCurrent ? (
                          <span className="w-4 h-4 rounded-full bg-teal-600 text-white flex items-center justify-center text-[10px] font-mono animate-pulse">
                            {idx + 1}
                          </span>
                        ) : (
                          <span className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 flex items-center justify-center text-[10px] font-mono">
                            {idx + 1}
                          </span>
                        )}
                      </div>
                      <span className="text-xs block">{ORDER_STATUS_LABELS[st]}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Details & Quote Card */}
          <div className="p-6 sm:p-8 pt-0 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            {/* Col 1 & 2: Order Information */}
            <div className="md:col-span-2 space-y-4">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-teal-600" />
                  <span>委托规格详情</span>
                </h4>

                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div>
                    <span className="text-slate-400 block">服务类型</span>
                    <span className="font-semibold text-slate-800">
                      {SERVICE_TYPE_LABELS[order.serviceType] || order.serviceType}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">研究区范围</span>
                    <span className="font-semibold text-slate-800">{order.studyArea || '未限定'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">数据格式</span>
                    <span className="font-semibold text-slate-800">{order.dataFormats || '待商定'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">期望交付日期</span>
                    <span className="font-semibold text-slate-800">
                      {order.expectedDeliveryDate || '按常规周期'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 block">预留联系方式（已脱敏保护）</span>
                    <span className="font-mono font-semibold text-slate-700">
                      {order.contactMethod === 'email' ? '邮箱' : '微信'}：{order.maskedContact}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 text-slate-600 leading-relaxed">
                  <span className="text-slate-400 block text-[10px] mb-0.5">详细需求描述</span>
                  <p className="whitespace-pre-line">{order.description}</p>
                </div>
              </div>

              {/* Client Notes / Engineer Feedback */}
              {order.clientNotes && (
                <div className="bg-teal-50/60 border border-teal-200/80 p-4 rounded-2xl text-teal-950 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <MessageSquare className="w-3.5 h-3.5 text-teal-600" />
                    <span>工作室工程师实时反馈</span>
                  </div>
                  <p className="text-xs leading-relaxed text-teal-900">{order.clientNotes}</p>
                </div>
              )}
            </div>

            {/* Col 3: Official Manual Quote & Timestamps */}
            <div className="space-y-4 flex flex-col justify-between">
              <div className="bg-white border-2 border-slate-200 p-5 rounded-2xl shadow-sm text-center space-y-3">
                <span className="text-xs text-slate-400 font-medium block">工作室正式人工确认报价</span>
                <div className="py-2">
                  <span className="text-3xl font-extrabold text-teal-600">
                    {formatRMB(order.manualQuote)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {typeof order.manualQuote === 'number'
                    ? '工程师已核算工作量。请通过预留微信或邮件核对后启动开发。'
                    : '工程师正在核对数据体量与算力，将在12小时内在此处更新明确报价。'}
                </p>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-[11px] space-y-1.5 text-slate-500 font-mono">
                <div className="flex justify-between">
                  <span>创建时间：</span>
                  <span>{new Date(order.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>最后更新：</span>
                  <span>{new Date(order.updatedAt).toLocaleString('zh-CN')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
