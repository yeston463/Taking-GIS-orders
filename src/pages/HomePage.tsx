import React from 'react';
import {
  Map,
  Database,
  Terminal,
  Globe2,
  Satellite,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Code,
  FileCode,
  Search,
  Sparkles,
} from 'lucide-react';
import { MapShowcase } from '../components/MapShowcase.tsx';

interface HomePageProps {
  onTabChange: (tab: string, serviceParam?: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onTabChange }) => {
  const services = [
    {
      id: 'thematic_map',
      title: 'QGIS / ArcGIS 专题地图制作',
      price: '49',
      unit: '起',
      icon: Map,
      desc: '学术论文图、规划汇报图、生态红线、热力分布图。符合期刊与国家出版规范，提供高精矢量与工程工程包。',
      tags: ['QGIS .qgz', 'ArcGIS aprx', '300+ DPI', 'CMYK/RGB'],
    },
    {
      id: 'spatial_processing',
      title: 'GIS 空间数据处理与自动化',
      price: '99',
      unit: '起',
      icon: Database,
      desc: '坐标转换 (CGCS2000/WGS84)、几何拓扑修复、多源矢量栅格裁剪、分区融合汇总与标准空间数据库入库。',
      tags: ['PostGIS', 'GeoPackage', '拓扑清洗', '空间重采样'],
    },
    {
      id: 'script_dev',
      title: 'Python / PyQGIS / GDAL 脚本开发',
      price: '99',
      unit: '起',
      icon: Terminal,
      desc: '空间批处理脚本、PyQGIS 自动化批量出图、GDAL/OGR 格式流水线定制、开源算法复现。带完整文档注释。',
      tags: ['PyQGIS', 'GDAL/OGR', 'GeoPandas', 'Shapely'],
    },
    {
      id: 'webgis_dev',
      title: 'WebGIS 可视化与轻量系统开发',
      price: '99',
      unit: '起',
      icon: Globe2,
      desc: '基于 Leaflet / Mapbox GL 的地理信息轻量展示大屏、轨迹动态回放、热力渲染、空间点线面交互过滤系统。',
      tags: ['Leaflet', 'GeoJSON', '矢量瓦片', '响应式大屏'],
    },
    {
      id: 'remote_sensing',
      title: '遥感影像与植被变化分析',
      price: '199',
      unit: '起',
      icon: Satellite,
      desc: '多时相哨兵二号 (Sentinel-2) / Landsat 数据预处理、NDVI 植被覆盖度计算、水体/湿地演变转移矩阵分析。',
      tags: ['NDVI / NDWI', '时序反演', '转移矩阵', '地物分类'],
    },
  ];

  const workflowSteps = [
    {
      step: '01',
      title: '在线提交需求与范围',
      desc: '在线登记服务类型、研究区域、数据格式及期望时效。不强制预付款，生成唯一工单号。',
    },
    {
      step: '02',
      title: '工程师人工评估与确认报价',
      desc: '工程师查阅数据量与技术难度，12小时内出具明确技术路线与最终核实报价，杜绝隐形加价。',
    },
    {
      step: '03',
      title: '签订委托与数据交接',
      desc: '双方确认技术指标与成果规格。通过安全微信或加密邮箱交接工作数据，严格脱敏保密。',
    },
    {
      step: '04',
      title: '阶段预览与交互初验',
      desc: '制作过程提供阶段成果样例或测试版本，客户确认制图样式或算法逻辑，保障方向不偏航。',
    },
    {
      step: '05',
      title: '工程全套交付与售后答疑',
      desc: '交付全部分层矢量、高清出图、无遮蔽源码及工程原件，提供 7 天内免费运行答疑。',
    },
  ];

  return (
    <div className="space-y-16 py-8">
      {/* Hero Section */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-700 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>
            <span>专业 GIS 个人技术服务 · 代码与工程原件全交付</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
            工程级地理空间技术定制
            <br />
            <span className="text-teal-600">透明定价 · 源码可溯 · 人工评估</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
            专注 QGIS/ArcGIS 专题地图制作、空间数据自动化处理、Python/GDAL 脚本开发、WebGIS 可视化及遥感植被分析。由资深
            GIS 工程师直达沟通，杜绝模板套用与中介加价。
          </p>

          {/* Pricing Badges */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-slate-700 font-medium">
            <span className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
              地图制作 <strong className="text-teal-600 font-bold">49元起</strong>
            </span>
            <span className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
              空间数据清洗 <strong className="text-teal-600 font-bold">99元起</strong>
            </span>
            <span className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
              Python/GDAL 脚本 <strong className="text-teal-600 font-bold">99元起</strong>
            </span>
            <span className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
              遥感变化分析 <strong className="text-teal-600 font-bold">199元起</strong>
            </span>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <button
              onClick={() => onTabChange('inquiry')}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition shadow-lg shadow-teal-600/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>立即提交需求询价</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onTabChange('cases')}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm border border-slate-200 shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>体验交互地图案例</span>
              <Map className="w-4 h-4 text-teal-600" />
            </button>
          </div>

          {/* Trust Guarantees */}
          <div className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-slate-500 border-t border-slate-200">
            <div className="flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-500" />
              <span>标价均为参考起价</span>
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-500" />
              <span>人工最终确认报价</span>
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-500" />
              <span>拒绝虚假评价与夸大</span>
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-500" />
              <span>严格遵循测绘法规</span>
            </div>
          </div>
        </div>
      </section>

      {/* Services Grid Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">核心服务业务</h2>
          <p className="text-sm text-slate-600 mt-2">
            清晰的交付物标准、透明的价格区间与严谨的技术边界，每个项目皆附带完整工程文件。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md hover:border-teal-500/50 transition flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 group-hover:scale-105 transition">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-400 block font-normal">参考起价</span>
                      <span className="text-2xl font-bold text-slate-900">¥{item.price}</span>
                      <span className="text-xs text-slate-500 ml-0.5">{item.unit}</span>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 group-hover:text-teal-600 transition">
                    {item.title}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed mt-2">{item.desc}</p>

                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => onTabChange('services')}
                    className="text-xs text-slate-500 hover:text-slate-800 transition cursor-pointer"
                  >
                    查看交付物标准 →
                  </button>
                  <button
                    onClick={() => onTabChange('inquiry', item.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-600 hover:text-white transition cursor-pointer"
                  >
                    预定此项
                  </button>
                </div>
              </div>
            );
          })}

          {/* Extra Card: Studio Capability Statement */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-teal-500/20 text-teal-300 text-xs font-mono mb-3">
                <Code className="w-3.5 h-3.5" />
                <span>技术自研 · 拒绝二道贩子</span>
              </div>
              <h3 className="text-base font-bold text-white">工程级代码与交付物标准</h3>
              <p className="text-xs text-slate-300 leading-relaxed mt-2">
                不仅交付最终地图与图表，还包括清洗后的规范矢量 (SHP/GPKG/PostGIS 导出)、带完整中文注释的 Python
                处理代码、QGIS 制图工程样式包，让您的空间分析完全具备自主复现能力。
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-800">
              <button
                onClick={() => onTabChange('inquiry')}
                className="w-full py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-xs transition cursor-pointer"
              >
                填写您的非标定制需求
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Map Showcase Section on Home */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-mono text-teal-400 mb-2">
                <Globe2 className="w-4 h-4" />
                <span>REAL-TIME INTERACTIVE MAP</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                空间数据可视化与分析实战演示
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
                基于 Leaflet 轻量引擎构建的真实地图沙盒，演示专题图层加载、空间缓冲区计算、植被覆盖度
                (NDVI) 伪彩栅格以及矢量属性即时检索能力。
              </p>
            </div>

            <button
              onClick={() => onTabChange('cases')}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer self-start md:self-auto"
            >
              查看更多技术案例与详情 →
            </button>
          </div>

          {/* Leaflet Component */}
          <MapShowcase />
        </div>
      </section>

      {/* Workflow Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">严谨的工作流程</h2>
          <p className="text-sm text-slate-600 mt-2">
            从需求评估到最终成果归档，5 个标准步骤确保交付质量可控、价格透明无争议。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {workflowSteps.map((ws, idx) => (
            <div
              key={ws.step}
              className="bg-white p-5 rounded-2xl border border-slate-200 relative flex flex-col justify-between"
            >
              <div>
                <span className="text-2xl font-mono font-bold text-teal-600 block mb-2">{ws.step}</span>
                <h4 className="text-sm font-bold text-slate-900 mb-2">{ws.title}</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{ws.desc}</p>
              </div>
              {idx < workflowSteps.length - 1 && (
                <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-400 text-xs">
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Principles & Anti-Fraud Notice */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="space-y-3 text-xs sm:text-sm text-amber-900">
              <h3 className="font-bold text-base text-amber-950">服务原则与真实性承诺</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 leading-relaxed">
                <div className="bg-white/80 p-3.5 rounded-xl border border-amber-200">
                  <strong className="block text-slate-900 font-semibold mb-1">
                    1. 绝不伪造商业评价与虚假客户
                  </strong>
                  本站绝不堆砌虚构的“名企背书”、“客户五星好评”或虚假头像。技术案例均使用公开脱敏数据演示。
                </div>
                <div className="bg-white/80 p-3.5 rounded-xl border border-amber-200">
                  <strong className="block text-slate-900 font-semibold mb-1">
                    2. 标价为参考起价，最终人工确认
                  </strong>
                  GIS 业务差异巨大，涉及坐标系、数据源质量、范围与算力。所有标价均为基础起价，绝不承诺系统自动成交。
                </div>
                <div className="bg-white/80 p-3.5 rounded-xl border border-amber-200">
                  <strong className="block text-slate-900 font-semibold mb-1">
                    3. 严守测绘法与数据保密红线
                  </strong>
                  谢绝国家涉密地图、未公开军事测绘、涉密地质数据及违规中国国界地图制作。客户数据签署保密协议，结项后按期销毁。
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-900 rounded-3xl p-8 sm:p-12 text-center text-white relative overflow-hidden border border-slate-800">
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              准备好开始您的地理空间技术项目了吗？
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              只需 2 分钟填写您的研究区、数据格式与预期目标，工程师将在 12 小时内为您完成评估并出具明细方案。
            </p>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => onTabChange('inquiry')}
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm transition cursor-pointer shadow-lg shadow-teal-500/20"
              >
                立即免费提交工单询价
              </button>
              <button
                onClick={() => onTabChange('lookup')}
                className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition cursor-pointer"
              >
                通过工单号追踪已有进度
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
