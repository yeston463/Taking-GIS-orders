import React from 'react';
import {
  Map,
  Database,
  Terminal,
  Globe2,
  Satellite,
  Check,
  AlertTriangle,
  Clock,
  PackageCheck,
  ArrowRight,
  ShieldAlert,
  HelpCircle,
} from 'lucide-react';
import { ServiceType, SERVICE_TYPE_LABELS } from '../utils/order-utils.ts';

interface ServicesPageProps {
  onSelectService: (serviceType: ServiceType) => void;
}

interface ServiceDetail {
  id: ServiceType;
  title: string;
  startingPrice: number;
  period: string;
  icon: React.ComponentType<{ className?: string }>;
  scenarios: string[];
  deliverables: string[];
  boundaries: string[];
  techStack: string[];
}

export const ServicesPage: React.FC<ServicesPageProps> = ({ onSelectService }) => {
  const serviceDetails: ServiceDetail[] = [
    {
      id: 'thematic_map',
      title: 'QGIS / ArcGIS 专题地图制作',
      startingPrice: 49,
      period: '1 - 3 个工作日',
      icon: Map,
      scenarios: [
        '学术论文、科研基金申报所需的区位图、样点分布图与研究区概况图',
        '规划设计方案、政府报告与可行性研究报告中的专题规划分析底图',
        '多源人口、经济、环境等统计指标的空间分级分段与热力填色制图',
        '出版物插图与具备标准图例、指北针、经纬网及比例尺的专业地图',
      ],
      deliverables: [
        '印刷级 300+ DPI 高清位图（TIFF / PNG / JPG）或无损可缩放矢量 PDF / SVG',
        '完整 QGIS 工程包（.qgz/.qgs）或 ArcGIS Pro 工程（.aprx）/ ArcMap 工程（.mxd）',
        '清洗整理后的分层矢量要素图层包（Shapefile 或 GeoPackage 格式）',
        '制图样式文件（QGIS QML / SLD 样式表或 ArcGIS .lyrx）',
      ],
      boundaries: [
        '需客户明确提供或界定研究区范围与必需的背景底图图层要求。',
        '严禁承接国家涉密地图、未公开军事设施周边测绘成果制图。',
        '中国国界与行政区划底图必须严格使用自然资源部标准地图服务（GS审图号底图），严禁制作违规地图。',
      ],
      techStack: ['QGIS 3.34+ LTR', 'ArcGIS Pro 3.x', 'Adobe Illustrator GIS插件', 'GeoPandas'],
    },
    {
      id: 'spatial_processing',
      title: 'GIS 空间数据处理与自动化清洗',
      startingPrice: 99,
      period: '1 - 4 个工作日',
      icon: Database,
      scenarios: [
        '多源异构空间数据批量坐标系投影转换（如 WGS84、CGCS2000、UTM、高斯克吕格等）',
        '矢量自相交、重叠缝隙、悬挂节点等几何拓扑自动检测与无损批量修复',
        '多期栅格遥感影像批量裁剪（Mask Clip）、镶嵌（Mosaic）与投影重采样',
        '空间点面关联、多边形分区汇总统计（Zonal Statistics）与空间属性关联入库',
      ],
      deliverables: [
        '修复拓扑与清洗后的空间矢量成果（提供 GeoPackage / Shapefile / FileGDB）',
        '坐标系转换前后元数据对比报告与数据质量校核清单',
        '可复现运行的批处理流水线脚本（Python / Shell / SQL）',
        '支持导入 PostGIS / SpatiaLite 的标准化空间表结构导出文件',
      ],
      boundaries: [
        '客户需说明原始数据的体量与已知损坏情况；对于严重缺损的脏数据需先评估修复可行性。',
        '对于 GB 级以上海量点云或倾斜三维模型批处理，按实际计算资源与耗时另行核算。',
        '不负责对客户提供的源数据进行法律溯源，请确保源数据具备合法使用权。',
      ],
      techStack: ['GDAL/OGR CLI', 'PostGIS 3.4', 'SpatiaLite', 'Shapely', 'Fiona', 'Rasterio'],
    },
    {
      id: 'script_dev',
      title: 'Python / PyQGIS / GDAL 脚本定制开发',
      startingPrice: 99,
      period: '2 - 5 个工作日',
      icon: Terminal,
      scenarios: [
        '无需打开 GUI 界面的独立后台空间批处理脚本，支持 Windows/Linux 自动化定时任务',
        '基于 PyQGIS 的自动化批量出图脚本（自动遍历图斑、缩放至图层、套用样式并导出PDF）',
        '空间分析开源算法定制（如 Voronoi 泰森多边形、网络连通度、最小路径分析等）',
        '空间数据批量格式转换与 API 对接爬取清洗流水线',
      ],
      deliverables: [
        '符合 PEP 8 规范、附带详尽中文文档与行级注释的 Python 源代码（.py / Jupyter Notebook）',
        '包含所有依赖包的 requirements.txt 或 Conda environment.yml 环境配置文件',
        '包含示例输入数据与预期输出成果的单步测试运行说明（README.md）',
        '交付后提供 7 天内本地运行环境排错与答疑服务',
      ],
      boundaries: [
        '交付能够在约定的标准化开源 Python / QGIS 环境下正常运行的无害代码。',
        '不承担因客户本地专有闭源商业软件版本不兼容或破解版插件异常引发的未知故障。',
        '若需封装为图形界面应用（PyQt/Tkinter 桌面工具），需根据界面复杂度单独计价。',
      ],
      techStack: ['Python 3.10+', 'PyQGIS API', 'GDAL C++ Python Binding', 'NetworkX', 'Dask'],
    },
    {
      id: 'webgis_dev',
      title: 'WebGIS 可视化与轻量系统定制开发',
      startingPrice: 99,
      period: '3 - 7 个工作日',
      icon: Globe2,
      scenarios: [
        '科研课题、成果汇报或业务管理轻量 WebGIS 地图大屏与响应式看板',
        '空间点/线/面要素多图层叠加、动态分类筛选、自定义气泡弹窗（Popup）交互',
        '轨迹动态回放、热力图（Heatmap）平滑渲染与海量点聚合标记（Marker Cluster）',
        '离线/内网环境地图切片瓦片加载与私有化 GeoJSON / 矢量瓦片托管部署',
      ],
      deliverables: [
        '基于 React / TypeScript / Vue + Leaflet / Mapbox GL 的前端交互工程源码',
        '空间数据静态切片包或 GeoJSON 格式化配置文件',
        '标准生产编译包（可直接上传至任意 Nginx / Apache / GitHub Pages 静态服务器）',
        '本地开发启动与生产部署保姆级操作指南',
      ],
      boundaries: [
        '本项目提供前端交互与轻量级空间展示定制；若需复杂服务端空间分析引擎需评估后端工程量。',
        '若需使用商业商业底图服务（如高德、百度、天地图），需由客户自行提供合规开发者 Key。',
        '不提供未经许可的商业三维实景倾斜模型违规在线发布。',
      ],
      techStack: ['Leaflet 1.9+', 'Mapbox GL JS', 'TypeScript', 'Tailwind CSS', 'Vite', 'Turf.js'],
    },
    {
      id: 'remote_sensing',
      title: '遥感影像与植被变化分析',
      startingPrice: 199,
      period: '3 - 7 个工作日',
      icon: Satellite,
      scenarios: [
        '基于多时相哨兵二号 (Sentinel-2) / Landsat 的 NDVI 植被覆盖度与生长状态反演',
        '水体面积季节性消长 (NDWI / MNDWI) 与水体富营养化/蓝藻空间分布提取',
        '森林覆盖度变化、森林砍伐或造林成效土地利用转移矩阵（Land Cover Transition）',
        '干旱指数 (TVDI) 与地表温度 (LST) 热岛效应反演制图',
      ],
      deliverables: [
        '各时相多光谱影像预处理成果（辐射定标、大气校正、云掩膜去云后合成切片）',
        '计算得到的专题指数浮点型 GeoTIFF 栅格图层（NDVI / NDWI 严格值域归一化）',
        '地表覆被变化演变转移矩阵数据统计 Excel 报表与统计折线/柱状图',
        '高分辨率对比专题图（双期对比图、时序变化热度图等，含标准审图色标）',
      ],
      boundaries: [
        '基于公开合规的开放遥感数据源（如 ESA Copernicus Sentinel-2、USGS Landsat 8/9 等）。',
        '如需使用高分一号/二号等商业超高分辨率国产卫星数据，需客户自行持有合法采购授权。',
        '受光学卫星云量覆盖制约，无法承诺多云多雾天气下特定自然日期的无云影像。',
      ],
      techStack: ['SNAP', 'GDAL/Rasterio', 'Google Earth Engine (GEE)', 'QGIS SCP', 'NumPy'],
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Header */}
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 text-xs font-mono text-teal-600 bg-teal-50 border border-teal-200/80 px-2.5 py-1 rounded-md mb-3">
          <span>SERVICES & DELIVERABLES SPECIFICATION</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          专业 GIS 服务清单与交付物标准
        </h1>
        <p className="text-sm sm:text-base text-slate-600 mt-3 leading-relaxed">
          GeoSpatial Studio 坚持以工程师严谨标准对待每一次委托。所有业务均明确标明基础参考起价、交付物包含项、常规周期及技术边界。
        </p>
      </div>

      {/* Notice on Pricing */}
      <div className="bg-slate-100 border-l-4 border-teal-600 rounded-r-xl p-4 sm:p-5 text-slate-700 text-xs sm:text-sm space-y-1.5">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <HelpCircle className="w-4 h-4 text-teal-600" />
          <span>关于“参考起价”的人工确认机制说明</span>
        </div>
        <p className="leading-relaxed text-slate-600">
          地理空间数据因研究区跨度、原始文件损坏程度、坐标系错乱及精度要求差异巨大，无法采用标准化死板一口价。
          <strong>网页所列价格均为基础起步参考价</strong>。提交需求后，工程师将在 12 小时内审阅数据量并出具最终确认报价。在您确认之前绝不产生任何费用或承诺。
        </p>
      </div>

      {/* Services Detailed Cards List */}
      <div className="space-y-8">
        {serviceDetails.map((item, index) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:border-slate-300 transition"
            >
              {/* Card Header */}
              <div className="p-6 bg-slate-50/60 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-slate-400">0{index + 1}</span>
                      <h2 className="text-lg sm:text-xl font-bold text-slate-900">{item.title}</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        周期：{item.period}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 pt-3 md:pt-0 border-slate-200">
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 block">基础参考起价</span>
                    <span className="text-2xl font-black text-slate-900">¥{item.startingPrice}</span>
                    <span className="text-xs text-slate-500 ml-1">起</span>
                  </div>

                  <button
                    onClick={() => onSelectService(item.id)}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs transition cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                    <span>定制此项服务</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
                {/* Col 1: Scenarios */}
                <div className="space-y-3">
                  <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-600"></span>
                    常见应用场景
                  </h3>
                  <ul className="space-y-2 text-slate-600 leading-relaxed">
                    {item.scenarios.map((sc, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-teal-600 font-bold">•</span>
                        <span>{sc}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Col 2: Deliverables */}
                <div className="space-y-3 bg-teal-50/40 p-4 rounded-xl border border-teal-100/60">
                  <h3 className="font-bold text-teal-950 flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <PackageCheck className="w-4 h-4 text-teal-600" />
                    标准交付物清单
                  </h3>
                  <ul className="space-y-2 text-slate-700 leading-relaxed">
                    {item.deliverables.map((dl, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                        <span>{dl}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Col 3: Boundaries & Exclusions */}
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    服务边界与排除事项
                  </h3>
                  <ul className="space-y-2 text-slate-600 leading-relaxed">
                    {item.boundaries.map((bd, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-amber-600 font-bold">!</span>
                        <span>{bd}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-[10px] text-slate-400 block mb-1">主要技术支持：</span>
                    <div className="flex flex-wrap gap-1">
                      {item.techStack.map((tech) => (
                        <span
                          key={tech}
                          className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 text-[10px] font-mono"
                        >
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Compliance Guarantee */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-start gap-4 shadow-sm">
        <ShieldAlert className="w-6 h-6 text-teal-600 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs text-slate-600 leading-relaxed">
          <h4 className="font-bold text-slate-900 text-sm">合规与知识产权说明</h4>
          <p>
            交付完成后，由本工作室为客户定制编写的代码及专题地图衍生图件，客户拥有完整使用权与修改权。
            对于客户提供的原始数据，本工作室仅在项目委托期内进行计算，并在验收交付后两周内从生产机进行全量安全物理擦除，坚决维护您的商业机密与科研首发权。
          </p>
        </div>
      </div>
    </div>
  );
};
