import React, { useState } from 'react';
import { MapShowcase, MapFocusPreset } from '../components/MapShowcase.tsx';
import {
  Code2,
  FileCheck,
  CheckCircle2,
  Globe2,
  Info,
  ExternalLink,
  MapPin,
} from 'lucide-react';
import { ServiceType } from '../utils/order-utils.ts';

interface CaseStudyItem {
  id: string;
  title: string;
  serviceType: ServiceType;
  categoryLabel: string;
  summary: string;
  techTags: string[];
  challenge: string;
  solution: string;
  deliverables: string[];
  dataNotice: string;
  mapFocus: MapFocusPreset;
}

const CaseVisualPreview: React.FC<{ caseId: string; categoryLabel: string }> = ({
  caseId,
  categoryLabel,
}) => {
  return (
    <div className="relative w-full h-48 sm:h-56 bg-slate-900 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center select-none">
      {/* Background coordinate grid */}
      <svg className="w-full h-full" viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id={`grid-${caseId}`} width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="600" height="220" fill={`url(#grid-${caseId})`} />

        {caseId === 'case-1' && (
          <g>
            {/* Topology & Polygon Buffer Visual */}
            <polygon
              points="90,50 190,35 240,95 200,175 100,165 65,110"
              fill="#0284c7"
              fillOpacity="0.25"
              stroke="#38bdf8"
              strokeWidth="2"
              strokeDasharray="5,4"
            />
            <polygon
              points="110,65 180,55 215,100 185,155 115,148 88,108"
              fill="#0d9488"
              fillOpacity="0.45"
              stroke="#2dd4bf"
              strokeWidth="2.5"
            />
            <polygon
              points="310,45 450,55 490,130 420,180 320,160"
              fill="#0f766e"
              fillOpacity="0.35"
              stroke="#5eead4"
              strokeWidth="2"
            />
            {/* Vertices */}
            {[
              [110, 65],
              [180, 55],
              [215, 100],
              [185, 155],
              [115, 148],
              [88, 108],
              [310, 45],
              [450, 55],
              [490, 130],
            ].map(([cx, cy], idx) => (
              <circle key={idx} cx={cx} cy={cy} r="4" fill="#f8fafc" stroke="#0d9488" strokeWidth="2" />
            ))}
            <text x="270" y="110" fill="#94a3b8" fontSize="11" fontFamily="monospace">
              ST_MakeValid() → EPSG:4490
            </text>
          </g>
        )}

        {caseId === 'case-2' && (
          <g>
            {/* Contour & Hillshade Thematic Map Visual */}
            <ellipse
              cx="300"
              cy="115"
              rx="210"
              ry="78"
              fill="#065f46"
              fillOpacity="0.3"
              stroke="#34d399"
              strokeWidth="1.5"
            />
            <ellipse
              cx="295"
              cy="112"
              rx="160"
              ry="58"
              fill="#047857"
              fillOpacity="0.35"
              stroke="#6ee7b7"
              strokeWidth="1.5"
            />
            <ellipse
              cx="290"
              cy="110"
              rx="110"
              ry="38"
              fill="#0284c7"
              fillOpacity="0.5"
              stroke="#7dd3fc"
              strokeWidth="2"
            />
            {/* North Arrow & Scale bar */}
            <path d="M 530 35 L 540 65 L 530 58 L 520 65 Z" fill="#2dd4bf" />
            <text x="526" y="28" fill="#e2e8f0" fontSize="10" fontFamily="monospace">
              N
            </text>
            <line x1="480" y1="185" x2="550" y2="185" stroke="#cbd5e1" strokeWidth="2" />
            <text x="492" y="178" fill="#cbd5e1" fontSize="9" fontFamily="monospace">
              1:50,000
            </text>
          </g>
        )}

        {caseId === 'case-3' && (
          <g>
            {/* NDVI Multi-temporal Raster Matrix Visual */}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((col) =>
              [0, 1, 2, 3].map((row) => {
                const colors = ['#14532d', '#15803d', '#22c55e', '#84cc16', '#facc15', '#0284c7'];
                const color = colors[(col + row * 2) % colors.length];
                return (
                  <rect
                    key={`${col}-${row}`}
                    x={110 + col * 46}
                    y={36 + row * 36}
                    width="42"
                    height="32"
                    rx="3"
                    fill={color}
                    fillOpacity="0.75"
                    stroke="#0f172a"
                    strokeWidth="1"
                  />
                );
              })
            )}
            <text x="115" y="198" fill="#a7f3d0" fontSize="10" fontFamily="monospace">
              NDVI = (NIR - RED) / (NIR + RED) · Sentinel-2 10m
            </text>
          </g>
        )}

        {caseId === 'case-4' && (
          <g>
            {/* WebGIS Hazard Monitoring & Cluster Visual */}
            <path
              d="M 70 160 Q 190 60 310 120 T 520 75"
              fill="none"
              stroke="#0ea5e9"
              strokeWidth="3"
              strokeDasharray="6,4"
            />
            {[
              { x: 140, y: 115, r: 16, c: '#0d9488', label: '12' },
              { x: 280, y: 105, r: 22, c: '#f59e0b', label: '28' },
              { x: 430, y: 92, r: 18, c: '#ef4444', label: '07' },
            ].map((node, i) => (
              <g key={i}>
                <circle cx={node.x} cy={node.y} r={node.r + 6} fill={node.c} fillOpacity="0.25" />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={node.c}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
                <text
                  x={node.x - 7}
                  y={node.y + 4}
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {node.label}
                </text>
              </g>
            ))}
          </g>
        )}

        {caseId === 'case-5' && (
          <g>
            {/* PyQGIS Automated Pipeline Visual */}
            <rect
              x="70"
              y="65"
              width="120"
              height="80"
              rx="8"
              fill="#1e293b"
              stroke="#38bdf8"
              strokeWidth="2"
            />
            <text x="88" y="102" fill="#e2e8f0" fontSize="11" fontFamily="monospace">
              DEM / SHP
            </text>
            <text x="88" y="120" fill="#38bdf8" fontSize="9" fontFamily="monospace">
              300+ Counties
            </text>

            <line x1="195" y1="105" x2="240" y2="105" stroke="#2dd4bf" strokeWidth="2" />

            <rect
              x="245"
              y="65"
              width="135"
              height="80"
              rx="8"
              fill="#134e4a"
              stroke="#2dd4bf"
              strokeWidth="2"
            />
            <text x="262" y="102" fill="#5eead4" fontSize="11" fontFamily="monospace">
              qgis.processing
            </text>
            <text x="262" y="120" fill="#cbd5e1" fontSize="9" fontFamily="monospace">
              Headless Worker
            </text>

            <line x1="385" y1="105" x2="430" y2="105" stroke="#2dd4bf" strokeWidth="2" />

            <rect
              x="435"
              y="65"
              width="110"
              height="80"
              rx="8"
              fill="#1e293b"
              stroke="#34d399"
              strokeWidth="2"
            />
            <text x="452" y="102" fill="#6ee7b7" fontSize="11" fontFamily="monospace">
              PDF + CSV
            </text>
            <text x="452" y="120" fill="#94a3b8" fontSize="9" fontFamily="monospace">
              300 DPI Output
            </text>
          </g>
        )}
      </svg>

      {/* Top-left badge */}
      <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-slate-950/85 border border-slate-700 text-[11px] font-mono text-teal-300">
        {categoryLabel} · 工程示意图
      </div>

      {/* Bottom-right explicit Demo Watermark */}
      <div className="absolute bottom-2.5 right-3 px-2.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-mono text-amber-200">
        DEMO 演示图件 · 公开脱敏数据
      </div>
    </div>
  );
};

export const CasesPage: React.FC<{ onSelectService: (serviceType: ServiceType) => void }> = ({
  onSelectService,
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [activeMapPreset, setActiveMapPreset] = useState<MapFocusPreset | null>(null);

  const cases: CaseStudyItem[] = [
    {
      id: 'case-1',
      title: '长三角城市群多源矢量自动化清洗与 PostGIS 空间入库管道',
      serviceType: 'spatial_processing',
      categoryLabel: '空间数据自动化处理',
      summary:
        '处理多达 800 余个来自不同来源的异构 Shapefile 与 CAD DXF 矢量，解决坐标系杂乱、自相交自重叠、悬挂节点以及属性编码乱码问题。',
      techTags: ['Python', 'GDAL/OGR', 'PostGIS 3.4', 'Shapely', 'Fiona'],
      challenge:
        '原始图层坐标系涵盖 WGS84、CGCS2000 3度带等，几何要素包含大量碎片微小自交缝隙，导致原有系统无法执行空间拓扑包含查询。',
      solution:
        '编写 Python 流水线程序，利用 Fiona 批量检测投影元数据并统一重投影至 CGCS2000 (EPSG:4490)；利用 Shapely 2.0 空间几何算子批量执行拓扑修复与消除微小碎多边形（Sliver Polygon），最终入库至 PostGIS 并建立 GiST 空间索引。',
      deliverables: [
        '拓扑完全闭合且无自相交的统一 GeoPackage 与 PostGIS 数据库导出包',
        '全量字段属性清洗映射对照表 (Excel)',
        '自动化检测与入库全流程 Python 批处理源码脚本',
      ],
      dataNotice: '【Demo 演示数据说明】：基于开源地理边界与模拟城市要素构建，不含任何非公开商业或涉密数据。',
      mapFocus: {
        id: 'case-1',
        center: [30.245, 120.141],
        zoom: 14,
        feature: {
          name: '一级生态水文500米缓冲区 (拓扑清洗样例)',
          category: '空间缓冲区与拓扑修复演示',
          areaKm2: 12.14,
          description: '基于 Shapely / GDAL 空间算子生成的等距空间缓冲区与无损拓扑闭合多边形。',
        },
      },
    },
    {
      id: 'case-2',
      title: '高精流域生态红线与水环境敏感性评价专题地图制作',
      serviceType: 'thematic_map',
      categoryLabel: 'QGIS/ArcGIS 专题地图',
      summary:
        '面向流域生态红线保护规划成果汇报，按照标准制图规范制作多层次大比例尺专题出图。',
      techTags: ['QGIS 3.34 LTR', 'ArcGIS Pro', 'Carto Styling', '300 DPI TIFF'],
      challenge:
        '需要在同一图幅中协调流域DEM地形起伏阴影、水系廊道、敏感斑块分级与行政边界，要求符号系统具备清晰阅读层级，且满足打印出版 CMYK 严格色域。',
      solution:
        '在 QGIS 中采用多方向山体阴影（Multi-directional Hillshade）与高程假彩色融合技术，构建精致的地形底图；制定严格的连续渐变色阶（ColorBrewer 配色体系），设置动态标注防压盖，并按制图规范配置指北针、图例及比例尺。',
      deliverables: [
        '300+ DPI 出版级高分辨率 GeoTIFF 与 CMYK 印刷矢量 PDF',
        '包含完整符号库与关联数据源的 QGIS 独立工程文件（.qgz）',
        '标准化 QGIS 样式文件（.qml）与导出图层元数据说明',
      ],
      dataNotice: '【Demo 演示数据说明】：地形底图基于 NASA SRTM 30m DEM 开源高程数据，水系提取自 HydroSHEDS 公开数据库。',
      mapFocus: {
        id: 'case-2',
        center: [30.244, 120.142],
        zoom: 14,
        feature: {
          name: '西湖水体核心保护区专题要素',
          category: '水文与生态红线专题制图',
          areaKm2: 6.38,
          description: '演示出版级多图层叠置制图要素：水体边界、缓冲廊道与标准色标配置。',
        },
      },
    },
    {
      id: 'case-3',
      title: '哨兵二号 (Sentinel-2) 多时相遥感影像 NDVI 湿地演变反演',
      serviceType: 'remote_sensing',
      categoryLabel: '遥感影像与植被变化分析',
      summary:
        '利用 2023 至 2026 年同一季节的欧洲航天局 (ESA) 哨兵二号多光谱影像，反演湖泊湿地植被覆盖演化趋势并提取转移矩阵。',
      techTags: ['Sentinel-2 L2A', 'GEE', 'NDVI/MNDWI', 'GDAL/Rasterio', 'NumPy'],
      challenge:
        '湿地地区水汽多云，多期影像云量不同，且水陆交界处浅水沼泽与沉水植物光谱特征交织，单一阈值法容易产生误判。',
      solution:
        '采用 SCL (Scene Classification Layer) 掩膜消除云与云阴影，使用波段 8 (NIR) 与波段 4 (Red) 计算归一化植被指数 (NDVI)，并结合 MNDWI 改进水体指数进行联合双阈值分割，利用 Python NumPy 阵列矩阵计算前后两期的地物转移概率矩阵。',
      deliverables: [
        '10米高精度 NDVI 浮点型时序 GeoTIFF 栅格产品',
        '湿地/水体/陆生植被分类演变专题图 (PNG/PDF)',
        '地表覆被变化转移面积与百分比统计明细 Excel 报表',
      ],
      dataNotice: '【Demo 演示数据说明】：全部影像源自 ESA Copernicus Open Access Hub 公开可下载数据。',
      mapFocus: {
        id: 'case-3',
        center: [30.235, 120.118],
        zoom: 14,
        feature: {
          name: '高密山林与茶园植被覆盖格网',
          category: '遥感植被指数 (NDVI) 反演',
          ndviValue: 0.88,
          sensor: 'Sentinel-2 L2A (10m)',
          description: '基于红光与近红外波段差值比值法反演计算：(B8 - B4) / (B8 + B4)，当前栅格均值 0.88。',
        },
      },
    },
    {
      id: 'case-4',
      title: '基于 Leaflet 的地质灾害隐患点轻量 WebGIS 实时监测看板',
      serviceType: 'webgis_dev',
      categoryLabel: 'WebGIS 可视化开发',
      summary:
        '面向野外勘查场景构建的轻量化移动端适配 WebGIS 工具，支持矢量底图切换、隐患点分类查看与图元属性交互检索。',
      techTags: ['Leaflet 1.9', 'TypeScript', 'Tailwind CSS', 'Vite', 'GeoJSON'],
      challenge:
        '传统重型 GIS 平台加载耗时长且移动端交互不便，需要一个能在手机与桌面浏览器快速打开并支持多图层叠加过滤的轻量系统。',
      solution:
        '使用现代 Vite + TypeScript 构建轻量 WebGIS，采用 Leaflet 引擎渲染 GeoJSON 矢量图层，提供底图切换、图层开关、透明度滑块与自定义属性检查器弹窗。',
      deliverables: [
        '开箱即用的 WebGIS 前端工程完整源码',
        '标准化的地质灾害隐患点 GeoJSON 格式规范与图元字典',
        '一键部署至 Cloud Run / Nginx 的部署配置文档',
      ],
      dataNotice: '【Demo 演示数据说明】：点位数据采用公开脱敏经纬度坐标与模拟测值，绝不涉及真实客户私密台账。',
      mapFocus: {
        id: 'case-4',
        center: [30.232, 120.142],
        zoom: 15,
        feature: {
          name: '南山路排渍汇水节点 #3',
          category: 'WebGIS 空间离散监测点',
          elevationM: 22,
          riskLevel: '汛期预警',
          description: '演示 WebGIS 交互式监测点位：支持点击唤醒属性面板并高亮显示风险等级。',
        },
      },
    },
    {
      id: 'case-5',
      title: '基于 PyQGIS 的批量自动裁剪、多波段合成与统计出表独立脚本',
      serviceType: 'script_dev',
      categoryLabel: 'Python / PyQGIS 脚本开发',
      summary:
        '无头 (Headless) 空间数据批处理自动化流水线，替代原本需要重复手工点击 QGIS 菜单数百次的繁重操作。',
      techTags: ['PyQGIS 3', 'Python 3.10', 'QgsProcessing', 'Pandas', 'CLI'],
      challenge:
        '需要对数百个分区的遥感图斑分别进行掩膜提取、统计其内部平均坡度、并导出符合特定格式的 Excel，人工操作耗时且容易出错。',
      solution:
        '基于 QGIS 的 Standalone Python 脚本架构，导入 `qgis.core` 和 `qgis.analysis` 模块，编写命令行参数解析器，实现自动迭代面要素、动态掩膜切片并利用 Pandas 输出结构化 CSV 报表，全程无需开启 QGIS 图形窗口。',
      deliverables: [
        '独立运行的 Python 源码脚本 (.py)，附带完整中文注释',
        '详细的使用指南 (命令行传参说明、示例输入输出目录结构)',
        '包含 Conda 环境配置文件的一键初始化说明',
      ],
      dataNotice: '【Demo 演示数据说明】：示例测试样本采用开源行政边界与公开 SRTM DEM 切片。',
      mapFocus: {
        id: 'case-5',
        center: [30.241, 120.115],
        zoom: 14,
        feature: {
          name: '龙井地质边坡位移监测点 #1 (DEM 坡度提取区)',
          category: 'PyQGIS 自动批处理样区',
          elevationM: 165,
          riskLevel: '轻微扰动',
          description: '通过 PyQGIS 脚本自动遍历采样区提取高程、坡度并生成结构化统计报表。',
        },
      },
    },
  ];

  const filteredCases =
    filterType === 'all' ? cases : cases.filter((c) => c.serviceType === filterType);

  const handleLocateOnMap = (preset: MapFocusPreset) => {
    setActiveMapPreset({ ...preset });
    const mapEl = document.getElementById('cases-interactive-map');
    if (mapEl) {
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Header */}
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 text-xs font-mono text-teal-600 bg-teal-50 border border-teal-200/80 px-2.5 py-1 rounded-md mb-3">
          <span>PORTFOLIO & OPEN DATA DEMO</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          技术案例演示与可交互地图沙盒
        </h1>
        <p className="text-sm sm:text-base text-slate-600 mt-3 leading-relaxed">
          所有技术案例均清晰展示案例图件、技术标签、工程方案与交付物标准。
          为严格保护过往客户隐私与学术诚信，本页全部采用<strong>明确标注的公开合法 Demo 数据</strong>演示，
          <strong>绝不捏造客户名称、商业 Logo 或虚构评价</strong>。
        </p>
      </div>

      {/* Embedded Leaflet Sandbox */}
      <div id="cases-interactive-map" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Globe2 className="w-4 h-4 text-teal-600" />
            <span>实时 Leaflet 空间技术演示沙盒</span>
          </div>
          <span className="text-xs text-slate-500">
            支持缩放、切换底图与专题图层、点击图元或点击下方案例的“在地图中定位演示”
          </span>
        </div>
        <MapShowcase focusPreset={activeMapPreset} />
      </div>

      {/* Case Filter Tabs */}
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
          <span className="text-xs text-slate-400 font-medium mr-2">按服务类型筛选：</span>
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              filterType === 'all'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            全部案例 (5)
          </button>
          <button
            onClick={() => setFilterType('spatial_processing')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              filterType === 'spatial_processing'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            空间数据处理
          </button>
          <button
            onClick={() => setFilterType('thematic_map')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              filterType === 'thematic_map'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            专题制图工程
          </button>
          <button
            onClick={() => setFilterType('remote_sensing')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              filterType === 'remote_sensing'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            遥感变化分析
          </button>
          <button
            onClick={() => setFilterType('webgis_dev')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              filterType === 'webgis_dev'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            WebGIS 开发
          </button>
          <button
            onClick={() => setFilterType('script_dev')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              filterType === 'script_dev'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Python 脚本定制
          </button>
        </div>

        {/* Case Cards Grid */}
        <div className="grid grid-cols-1 gap-8">
          {filteredCases.map((cs) => (
            <div
              key={cs.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6 hover:border-slate-300 transition"
            >
              {/* Case Image / Cartographic Diagram Preview */}
              <CaseVisualPreview caseId={cs.id} categoryLabel={cs.categoryLabel} />

              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-teal-50 border border-teal-200/80 text-teal-800 font-medium text-xs">
                      {cs.categoryLabel}
                    </span>
                    <span className="text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-medium">
                      公开合法 Demo 数据样例
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{cs.title}</h2>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{cs.summary}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0 self-start">
                  <button
                    type="button"
                    onClick={() => handleLocateOnMap(cs.mapFocus)}
                    className="px-3.5 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                  >
                    <MapPin className="w-3.5 h-3.5 text-teal-600" />
                    <span>在交互地图中定位演示</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectService(cs.serviceType)}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-teal-600 text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                  >
                    <span>定制类似项目</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Technical breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                {/* Challenge & Solution */}
                <div className="space-y-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      工程挑战与难点
                    </h4>
                    <p className="text-slate-600 leading-relaxed">{cs.challenge}</p>
                  </div>

                  <div className="bg-teal-50/40 p-4 rounded-xl border border-teal-100 space-y-1.5">
                    <h4 className="font-bold text-teal-950 flex items-center gap-1.5 text-xs">
                      <Code2 className="w-4 h-4 text-teal-600" />
                      技术路线与算法实现
                    </h4>
                    <p className="text-slate-700 leading-relaxed">{cs.solution}</p>
                  </div>
                </div>

                {/* Deliverables & Tags */}
                <div className="space-y-4 flex flex-col justify-between">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                      <FileCheck className="w-4 h-4 text-emerald-600" />
                      实际交付文件标准
                    </h4>
                    <ul className="space-y-1.5 text-slate-600">
                      {cs.deliverables.map((dl, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                          <span>{dl}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Tech stack badges */}
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1.5 font-medium">
                      技术标签 (Tech Stack)：
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {cs.techTags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px] border border-slate-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Notice Footnote */}
              <div className="pt-3 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
                <Info className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span>{cs.dataNotice}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
