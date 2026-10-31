import React, { useState, useEffect } from 'react';
import {
  FileText,
  Send,
  CheckCircle,
  Copy,
  AlertCircle,
  Shield,
  Clock,
  Search,
  KeyRound,
} from 'lucide-react';
import {
  ServiceType,
  SERVICE_TYPE_LABELS,
  SERVICE_STARTING_PRICES,
  validateOrderInput,
  OrderInputPayload,
} from '../utils/order-utils.ts';

interface InquiryPageProps {
  initialService?: ServiceType;
  onGoToLookup: (orderNumber: string, queryToken: string) => void;
}

export const InquiryPage: React.FC<InquiryPageProps> = ({ initialService, onGoToLookup }) => {
  const [formData, setFormData] = useState<OrderInputPayload>({
    serviceType: initialService || 'thematic_map',
    title: '',
    description: '',
    studyArea: '',
    dataFormats: '',
    budgetRange: '49-200',
    expectedDeliveryDate: '',
    contactMethod: 'email',
    contactValue: '',
    agreePrivacy: false,
    honeypot: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<{
    orderNumber: string;
    queryToken: string;
    message: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<'order' | 'token' | 'both' | null>(null);

  useEffect(() => {
    if (initialService) {
      setFormData((prev) => ({ ...prev, serviceType: initialService }));
    }
  }, [initialService]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const validation = validateOrderInput(formData);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (data.errors && typeof data.errors === 'object') {
          setErrors(data.errors);
        }
        throw new Error(data.message || '提交失败，请稍后重试');
      }

      setSubmitSuccess({
        orderNumber: data.orderNumber,
        queryToken: data.queryToken,
        message: data.message,
      });
    } catch (err: any) {
      setSubmitError(err.message || '网络连接或服务器异常，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyText = (text: string, field: 'order' | 'token' | 'both') => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2200);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Title */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-50 border border-teal-200/80 text-teal-800 text-xs font-medium">
          <FileText className="w-3.5 h-3.5" />
          <span>工单登记 · 人工审核报价 · 不自动扣款</span>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">提交您的 GIS 技术需求</h1>
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
          填写您的项目信息与期望时效，系统将立即生成唯一工单编号与高强度查询凭证。工程师将在 12
          小时内细致评估技术可行性并出具确认报价。
        </p>
      </div>

      {submitSuccess ? (
        /* Success Card */
        <div className="bg-white rounded-3xl border border-teal-500/40 p-8 shadow-xl text-center space-y-6 animate-fadeIn">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-200 text-teal-600 mx-auto flex items-center justify-center">
            <CheckCircle className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900">需求已成功提交登记！</h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto">{submitSuccess.message}</p>
          </div>

          {/* Order Number & One-Time Query Token Box */}
          <div className="bg-slate-900 text-white border border-slate-800 rounded-2xl p-6 max-w-lg mx-auto space-y-4 text-left">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-teal-400 text-xs font-bold">
                <KeyRound className="w-4 h-4" />
                <span>工单查询安全凭证（请立即保存）</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleCopyText(
                    `GeoSpatial Studio 工单编号: ${submitSuccess.orderNumber}\n专属查询凭证: ${submitSuccess.queryToken}`,
                    'both'
                  )
                }
                className="px-3 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedField === 'both' ? '已全部复制' : '一键复制两项凭证'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-800/90 rounded-xl p-3.5 border border-slate-700">
                <span className="text-[11px] text-slate-400 block">1. 唯一工单编号 (Order Number)</span>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-sm sm:text-base font-mono font-bold text-white tracking-wider">
                    {submitSuccess.orderNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(submitSuccess.orderNumber, 'order')}
                    className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer shrink-0"
                  >
                    {copiedField === 'order' ? '已复制' : '复制'}
                  </button>
                </div>
              </div>

              <div className="bg-slate-800/90 rounded-xl p-3.5 border border-teal-500/40">
                <span className="text-[11px] text-teal-300 block">2. 专属查询凭证 (Query Token)</span>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-sm sm:text-base font-mono font-bold text-teal-300 tracking-wider">
                    {submitSuccess.queryToken}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(submitSuccess.queryToken, 'token')}
                    className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer shrink-0"
                  >
                    {copiedField === 'token' ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-amber-300 leading-relaxed bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
              安全提示：为保护您的客户隐私与报价信息，服务端仅存储查询凭证的加密哈希值，
              <strong>专属查询凭证仅在此页面显示一次</strong>
              。后续查询工单状态必须同时输入「工单编号 + 专属查询凭证」。
            </p>
          </div>

          {/* Subsequent steps reminder */}
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 max-w-lg mx-auto text-left text-xs text-amber-900 space-y-2">
            <div className="font-bold flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-600" />
              <span>后续对接流程提示</span>
            </div>
            <p className="leading-relaxed">
              1. 工程师正在查阅您提交的研究区与技术指标；
              <br />
              2. <strong>关于原始数据文件</strong>：为确保安全合规，本站首版不开放公开附件上传。初审通过后，工程师将通过
              <strong>您预留的 {formData.contactMethod === 'email' ? '邮箱' : '微信'}</strong>{' '}
              与您建立点对点安全数据交接；
              <br />
              3. 人工出具正式报价后，您可自行决定是否付款开工。
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={() => onGoToLookup(submitSuccess.orderNumber, submitSuccess.queryToken)}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs transition cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" />
              <span>立即跟踪工单进度</span>
            </button>
            <button
              onClick={() => {
                setSubmitSuccess(null);
                setFormData({
                  serviceType: 'thematic_map',
                  title: '',
                  description: '',
                  studyArea: '',
                  dataFormats: '',
                  budgetRange: '49-200',
                  expectedDeliveryDate: '',
                  contactMethod: 'email',
                  contactValue: '',
                  agreePrivacy: false,
                  honeypot: '',
                });
              }}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium text-xs transition cursor-pointer"
            >
              再提交一笔新需求
            </button>
          </div>
        </div>
      ) : (
        /* Form Card */
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm space-y-8"
        >
          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-800 text-xs">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">提交未成功</strong>
                <span>{submitError}</span>
              </div>
            </div>
          )}

          {/* Section 1: Service Type */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider">
              1. 选择技术服务类型 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(
                [
                  'thematic_map',
                  'spatial_processing',
                  'script_dev',
                  'webgis_dev',
                  'remote_sensing',
                ] as ServiceType[]
              ).map((st) => {
                const isSelected = formData.serviceType === st;
                return (
                  <label
                    key={st}
                    className={`relative p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      isSelected
                        ? 'border-teal-600 bg-teal-50/40 text-slate-900 ring-2 ring-teal-500/20'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-xs font-bold">{SERVICE_TYPE_LABELS[st]}</span>
                      <input
                        type="radio"
                        name="serviceType"
                        value={st}
                        checked={isSelected}
                        onChange={handleChange}
                        className="accent-teal-600 ml-2"
                      />
                    </div>
                    <span className="text-[11px] text-teal-700 font-medium mt-2">
                      参考起价：¥{SERVICE_STARTING_PRICES[st]} 起
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.serviceType && <p className="text-xs text-red-600">{errors.serviceType}</p>}
          </div>

          {/* Section 2: Requirements Description */}
          <div className="space-y-4">
            <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider">
              2. 需求描述与技术规格 <span className="text-red-500">*</span>
            </label>

            <div>
              <label className="block text-xs text-slate-700 font-medium mb-1">
                需求简述 / 项目标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="例如：杭州市西湖区生态红线保护专题地图制作 / 500个SHP批量重投影脚本"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                  errors.title ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title}</p>}
            </div>

            <div>
              <label className="block text-xs text-slate-700 font-medium mb-1">
                详细需求内容与交付目标 <span className="text-red-500">*</span>
              </label>
              <textarea
                name="description"
                rows={5}
                value={formData.description}
                onChange={handleChange}
                placeholder="请尽可能详尽描述：&#10;1. 具体的业务目的与使用场景（如期刊论文配图、大屏汇报、后台日常自动化处理）；&#10;2. 您手头已有数据的格式、体量与质量；&#10;3. 所需的分辨率、比例尺、坐标系或功能逻辑细节。"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 leading-relaxed ${
                  errors.description ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {errors.description && <p className="text-xs text-red-600 mt-1">{errors.description}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-700 font-medium mb-1">研究区范围（Extent）</label>
                <input
                  type="text"
                  name="studyArea"
                  value={formData.studyArea}
                  onChange={handleChange}
                  placeholder="例如：浙江省杭州市、太湖流域、全国县域"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-700 font-medium mb-1">数据格式要求</label>
                <input
                  type="text"
                  name="dataFormats"
                  value={formData.dataFormats}
                  onChange={handleChange}
                  placeholder="例如：Shapefile、GeoTIFF、GeoPackage、DXF、PostGIS"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Budget and Schedule */}
          <div className="space-y-4">
            <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider">
              3. 预算区间与期望时效
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-700 font-medium mb-1">心理预算区间 (CNY)</label>
                <select
                  name="budgetRange"
                  value={formData.budgetRange}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="49-200">¥49 - ¥200（基础出图 / 简单清洗）</option>
                  <option value="200-500">¥200 - ¥500（标准工程 / 批处理脚本）</option>
                  <option value="500-1500">¥500 - ¥1500（复杂时序遥感 / WebGIS 大屏）</option>
                  <option value="1500+">¥1500 以上（系统性深度定制 / 长期合作）</option>
                  <option value="待评估">暂不明确，请工程师评估后建议</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  最终以人工确认报价为准，绝不做强制收费。
                </span>
              </div>

              <div>
                <label className="block text-xs text-slate-700 font-medium mb-1">期望交付日期</label>
                <input
                  type="date"
                  name="expectedDeliveryDate"
                  value={formData.expectedDeliveryDate}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Contact & Privacy */}
          <div className="space-y-4">
            <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider">
              4. 联系对接方式 <span className="text-red-500">*</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label className="block text-xs text-slate-700 font-medium mb-1">联系渠道</label>
                <select
                  name="contactMethod"
                  value={formData.contactMethod}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="email">电子邮箱 (Email)</option>
                  <option value="wechat">微信 ID (WeChat)</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-700 font-medium mb-1">
                  {formData.contactMethod === 'email' ? '邮箱地址' : '微信号 / 绑定的手机号'}{' '}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="contactValue"
                  value={formData.contactValue}
                  onChange={handleChange}
                  placeholder={
                    formData.contactMethod === 'email'
                      ? '例如：your_name@domain.com'
                      : '例如：gis_developer_2026'
                  }
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                    errors.contactValue ? 'border-red-500' : 'border-slate-200'
                  }`}
                />
                {errors.contactValue && (
                  <p className="text-xs text-red-600 mt-1">{errors.contactValue}</p>
                )}
              </div>
            </div>

            {/* Honeypot field (hidden from real users to trap spam bots) */}
            <div className="hidden" aria-hidden="true">
              <label>Website (do not fill)</label>
              <input
                type="text"
                name="honeypot"
                value={formData.honeypot}
                onChange={handleChange}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            {/* Note on files */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-500 flex items-start gap-2">
              <Shield className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <span>
                <strong>数据安全机制说明</strong>：本平台首版<strong>不开放直接网页附件上传</strong>
                ，以防止未经审查的数据泄露与网络风险。需求评估后，我们将通过预留微信或加密邮箱安全交接您的矢量/栅格测试样本。
              </span>
            </div>

            {/* Privacy Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  name="agreePrivacy"
                  checked={formData.agreePrivacy}
                  onChange={handleChange}
                  className="mt-1 rounded accent-teal-600 w-4 h-4"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  我已阅读并同意{' '}
                  <span className="text-teal-700 font-semibold">《地理空间技术服务隐私协议与合规声明》</span>
                  ，并承诺所提报项目及后续提供的数据符合中华人民共和国测绘地理信息法律法规，不包含任何国家秘密、军事涉密地理信息或违规国界图斑。
                  <span className="text-red-500 ml-1">*</span>
                </span>
              </label>
              {errors.agreePrivacy && (
                <p className="text-xs text-red-600 mt-1 ml-7">{errors.agreePrivacy}</p>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-xs text-slate-400">
              提交后将立即为您生成唯一工单号与一次性查询凭证，无需先行付款。
            </span>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-8 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-bold text-xs sm:text-sm transition cursor-pointer shadow-md flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>正在加密登记工单...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>提交需求并获取查询凭证</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
