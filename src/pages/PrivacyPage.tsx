import React from 'react';
import { ShieldCheck, Lock, FileWarning, Award, HelpCircle, Mail, Database } from 'lucide-react';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-50 border border-teal-200/80 text-teal-800 text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>合规审查 · 数据保密 · 诚实守信</span>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
          地理空间技术服务隐私协议与业务边界声明
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
          GeoSpatial Studio 秉持严谨的工程态度，严格遵守国家测绘地理信息法律法规与网络安全准则，保障委托方权益。
        </p>
      </div>

      {/* Main Sections */}
      <div className="space-y-6 text-xs sm:text-sm text-slate-700 leading-relaxed">
        {/* Section 1: 国家测绘法规底线 */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-3 shadow-sm">
          <div className="flex items-center gap-2.5 text-base font-bold text-slate-900">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <FileWarning className="w-4 h-4" />
            </div>
            <h2>一、国家测绘与地图红线绝对遵从</h2>
          </div>
          <p className="text-slate-600">
            根据《中华人民共和国测绘法》、《地图管理条例》等法规，本工作室执行严格的内容合规筛查：
          </p>
          <ul className="space-y-2 list-disc list-inside text-slate-600 pl-1">
            <li>
              <strong>坚决拒绝涉密业务</strong>：涉及军事禁区、国防工程、未公开涉密水利地质数据及其他保密级测绘地理成果，一律谢绝承接。
            </li>
            <li>
              <strong>标准规范中国国界</strong>：所有涉及中国国界及行政区划的专题地图，均严格基于自然资源部标准地图服务系统（GS审图号底图）制作，坚决维护国家主权和领土完整，杜绝错绘、漏绘问题。
            </li>
            <li>
              <strong>坐标系保密转换</strong>：涉及公共在线地图发布的要素，必须按照国家规定遵循合规的坐标混淆或加密政策。
            </li>
          </ul>
        </div>

        {/* Section 2: 实际收集字段、数据库存储与凭证机制 */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-3 shadow-sm">
          <div className="flex items-center gap-2.5 text-base font-bold text-slate-900">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <h2>二、工单收集字段、云端持久化存储与查询凭证机制</h2>
          </div>
          <p className="text-slate-600">
            为确保委托评估与进度跟踪透明可核查，本平台对收集的数据字段与存储架构作如下如实披露：
          </p>
          <ul className="space-y-2 list-disc list-inside text-slate-600 pl-1">
            <li>
              <strong>实际收集的工单字段</strong>：仅收集您主动填写的服务类型（<code>serviceType</code>）、需求标题（<code>title</code>）、需求详述（<code>description</code>）、研究区范围（<code>studyArea</code>）、数据格式（<code>dataFormats</code>）、预算区间（<code>budgetRange</code>）、期望交付日期（<code>expectedDeliveryDate</code>）以及联系渠道与联系值（<code>contactMethod</code> / <code>contactValue</code>）。同时系统会记录请求源 IP 的哈希值用于短时防刷限流。
            </li>
            <li>
              <strong>权威存储与访问控制</strong>：工单记录通过服务端受控接口持久化于 Google Cloud / Firebase Firestore 权威数据库，客户端直连读写权限已全部关闭（<code>allow read, write: if false</code>）。仅通过服务端 Firebase Admin SDK 验证 ID Token 且列入服务端 <code>ADMIN_UIDS</code> 白名单的管理员可读取完整联系信息。
            </li>
            <li>
              <strong>高熵查询凭证与联系方式脱敏</strong>：提交工单时系统使用密码学安全随机数（CSPRNG）生成一次性专属查询凭证（<code>QK-XXXX-XXXX-XXXX</code>），数据库仅保存其 HMAC-SHA256 哈希值（<code>queryTokenHash</code>），不保存明文凭证。公开工单查询接口仅返回脱敏后的联系方式（如 <code>cl***s@163.com</code>）且严格剥离内部管理备注（<code>adminNotes</code>）。
            </li>
          </ul>
        </div>

        {/* Section 3: 委托方数据隐私保护与保留期限 */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-3 shadow-sm">
          <div className="flex items-center gap-2.5 text-base font-bold text-slate-900">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
            <h2>三、委托方业务数据安全与保留期限</h2>
          </div>
          <p className="text-slate-600">
            地理空间数据常包含科研学术成果与商业运营敏感资产，我们采取以下技术与管理防护措施：
          </p>
          <ul className="space-y-2 list-disc list-inside text-slate-600 pl-1">
            <li>
              <strong>第一版不开放公网直接附件上传</strong>：避免公共云存储潜在的越权下载与恶意脚本上传风险。待工单初审后，由工程师通过点对点微信或加密电子邮箱接收您的矢量/栅格测试样本。
            </li>
            <li>
              <strong>受限生产隔离</strong>：您的原始空间数据仅在项目开发专用受限工作机上加载计算，不上传至任何第三方未加密公共网盘或大模型训练库。
            </li>
            <li>
              <strong>数据保留与销毁周期</strong>：项目全款交付验收后保留 14 天作为售后答疑期；答疑期满后，所有客户原始空间数据文件将被彻底安全擦除。在线工单文本记录可根据客户邮件申请随时予以匿名化或删除。
            </li>
          </ul>
        </div>

        {/* Section 4: 标价与人工评估机制 */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-3 shadow-sm">
          <div className="flex items-center gap-2.5 text-base font-bold text-slate-900">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <HelpCircle className="w-4 h-4" />
            </div>
            <h2>四、标价规则与人工确认机制</h2>
          </div>
          <p className="text-slate-600">
            本站首页与服务页列出的价格（如专题地图 49元起、空间数据处理 99元起、遥感分析 199元起）均为
            <strong>单项任务的基础参考起价</strong>。
          </p>
          <ul className="space-y-2 list-disc list-inside text-slate-600 pl-1">
            <li>
              <strong>不作自动扣款承诺</strong>：提交工单不会产生任何费用扣款，生成工单号仅代表登记意向。
            </li>
            <li>
              <strong>人工评估确认</strong>：工程师在查阅您的研究区跨度、数据量大小、图层复杂度和交付时限后，出具唯一准确的人工核定报价并载明技术路线。
            </li>
            <li>
              <strong>双方确认后再开工</strong>：只有在您充分认可技术方案与核定报价后，双方才会确定委托并推进开工，杜绝任何阶段性隐形收费。
            </li>
          </ul>
        </div>

        {/* Section 5: 知识产权与成果归属 */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-3 shadow-sm">
          <div className="flex items-center gap-2.5 text-base font-bold text-slate-900">
            <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
            <h2>五、知识产权归属与使用授权</h2>
          </div>
          <p className="text-slate-600">
            1. 客户为完成项目而提供的所有原始空间数据、文本及附带资产，其知识产权完全归属于客户自身。
            <br />
            2. 本工作室为客户定制开发的 QGIS/ArcGIS 工程包、Python 定制脚本与处理后派生矢量数据，在完成最终款项结清后，客户拥有完全的自主使用、二次修改、学术发表及商业化应用权。
            <br />
            3. 尊重学术诚信：本站案例展示严格使用公开合规数据集（如 OpenStreetMap、NASA SRTM、ESA Sentinel-2）并明确标注为 Demo 技术演示，绝不将任何过往客户的非公开成果截图或私有代码作为宣传物料。
          </p>
        </div>

        {/* Contact info for privacy concerns */}
        <div className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white space-y-3">
          <h3 className="font-bold text-base">隐私与技术合规监督联系</h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            如您对数据安全保护、合规审查、工单删除或保密协议（NDA）有任何特殊要求，欢迎直接与工作室主工程师取得联系：
          </p>
          <div className="flex items-center gap-2 font-mono text-teal-400 text-xs">
            <Mail className="w-4 h-4" />
            <span>yeston463@gmail.com</span>
          </div>
        </div>
      </div>
    </div>
  );
};
