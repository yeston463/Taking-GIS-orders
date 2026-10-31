import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, Eye, Info, ZoomIn, RefreshCw, MapPin, Activity } from 'lucide-react';

export interface FeatureProperty {
  name: string;
  category: string;
  areaKm2?: number;
  elevationM?: number;
  ndviValue?: number;
  riskLevel?: string;
  sensor?: string;
  description: string;
}

export interface MapFocusPreset {
  id: string;
  center: [number, number];
  zoom: number;
  feature: FeatureProperty;
}

export const MapShowcase: React.FC<{ focusPreset?: MapFocusPreset | null }> = ({ focusPreset }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const baseLayersRef = useRef<{ [key: string]: L.TileLayer }>({});
  const overlayLayersRef = useRef<{ [key: string]: L.LayerGroup }>({});

  const [activeBase, setActiveBase] = useState<'carto' | 'satellite' | 'dark'>('carto');
  const [showWater, setShowWater] = useState(true);
  const [showNdvi, setShowNdvi] = useState(true);
  const [showMonitoring, setShowMonitoring] = useState(true);
  const [ndviOpacity, setNdviOpacity] = useState(0.7);
  const [selectedFeature, setSelectedFeature] = useState<FeatureProperty | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Center on Hangzhou West Lake & surrounding hills (classic GIS demonstration extent)
    const map = L.map(mapContainerRef.current, {
      center: [30.245, 120.135],
      zoom: 13,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    // Basemaps
    const cartoLight = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }
    );

    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 18,
      }
    );

    const cartoDark = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
      }
    );

    cartoLight.addTo(map);
    baseLayersRef.current = {
      carto: cartoLight,
      satellite,
      dark: cartoDark,
    };

    // Layer Groups for Overlays
    const waterGroup = L.layerGroup();
    const ndviGroup = L.layerGroup();
    const monitoringGroup = L.layerGroup();

    // 1. Waterbody & Buffer Feature (West Lake Polygon Demo)
    const westLakeCoords: [number, number][] = [
      [30.258, 120.138],
      [30.252, 120.155],
      [30.241, 120.158],
      [30.231, 120.147],
      [30.232, 120.132],
      [30.242, 120.125],
      [30.253, 120.128],
    ];

    const waterPolygon = L.polygon(westLakeCoords, {
      color: '#0284c7',
      fillColor: '#38bdf8',
      fillOpacity: 0.5,
      weight: 2,
    });

    waterPolygon.on('click', () => {
      setSelectedFeature({
        name: '西湖水体核心保护区',
        category: '水文与生态红线矢量',
        areaKm2: 6.38,
        description: '矢量边界通过多期高分影像精细化套合修正，已完成拓扑缝隙与自相交修复。',
      });
    });
    waterPolygon.addTo(waterGroup);

    // Water buffer boundary
    const bufferCoords: [number, number][] = [
      [30.264, 120.142],
      [30.258, 120.163],
      [30.237, 120.165],
      [30.224, 120.152],
      [30.226, 120.126],
      [30.244, 120.117],
      [30.260, 120.122],
    ];
    const bufferPolygon = L.polygon(bufferCoords, {
      color: '#0369a1',
      fillColor: '#bae6fd',
      fillOpacity: 0.15,
      weight: 1.5,
      dashArray: '4, 4',
    });
    bufferPolygon.on('click', () => {
      setSelectedFeature({
        name: '一级生态水文500米缓冲区',
        category: '空间缓冲区分析',
        areaKm2: 12.14,
        description: '基于 Shapely / GDAL 空间算子生成的等距空间缓冲区，用于环境敏感性排查。',
      });
    });
    bufferPolygon.addTo(waterGroup);

    // 2. NDVI Vegetation Grid Simulation Layer
    const ndviCells = [
      { bounds: [[30.235, 120.110], [30.245, 120.122]] as [[number, number], [number, number]], ndvi: 0.82, color: '#15803d', label: '高密山林区' },
      { bounds: [[30.245, 120.110], [30.255, 120.122]] as [[number, number], [number, number]], ndvi: 0.76, color: '#22c55e', label: '北高峰林相良好' },
      { bounds: [[30.225, 120.110], [30.235, 120.122]] as [[number, number], [number, number]], ndvi: 0.88, color: '#14532d', label: '古树群与茶园' },
      { bounds: [[30.225, 120.122], [30.235, 120.135]] as [[number, number], [number, number]], ndvi: 0.65, color: '#4ade80', label: '茶园与灌木带' },
      { bounds: [[30.245, 120.155], [30.255, 120.168]] as [[number, number], [number, number]], ndvi: 0.22, color: '#facc15', label: '湖滨城建密集区' },
      { bounds: [[30.235, 120.155], [30.245, 120.168]] as [[number, number], [number, number]], ndvi: 0.18, color: '#f97316', label: '低植被硬质下垫面' },
      { bounds: [[30.255, 120.125], [30.265, 120.140]] as [[number, number], [number, number]], ndvi: 0.58, color: '#84cc16', label: '栖霞岭植被覆盖' },
    ];

    ndviCells.forEach((cell) => {
      const rect = L.rectangle(cell.bounds, {
        color: cell.color,
        fillColor: cell.color,
        fillOpacity: 0.65,
        weight: 1,
      });
      rect.on('click', () => {
        setSelectedFeature({
          name: cell.label,
          category: '遥感植被指数 (NDVI)',
          ndviValue: cell.ndvi,
          sensor: 'Sentinel-2 L2A (10m 分辨率)',
          description: `基于红光与近红外波段差值比值法反演计算：(B8 - B4) / (B8 + B4)，当前栅格均值 ${cell.ndvi}。`,
        });
      });
      rect.addTo(ndviGroup);
    });

    // 3. Risk Monitoring Points
    const pointsData = [
      { coords: [30.241, 120.115] as [number, number], name: '龙井地质边坡位移监测点 #1', risk: '轻微扰动', elev: 165 },
      { coords: [30.248, 120.118] as [number, number], name: '灵隐茶园水土冲刷监测断面 #2', risk: '正常受控', elev: 110 },
      { coords: [30.232, 120.142] as [number, number], name: '南山路排渍汇水节点 #3', risk: '汛期预警', elev: 22 },
      { coords: [30.256, 120.134] as [number, number], name: '孤山历史文化遗产地表沉降点 #4', risk: '稳定微变', elev: 35 },
    ];

    pointsData.forEach((pt) => {
      const circleMarker = L.circleMarker(pt.coords, {
        radius: 7,
        color: '#ffffff',
        fillColor: pt.risk === '汛期预警' ? '#ef4444' : '#0d9488',
        fillOpacity: 0.9,
        weight: 2,
      });
      circleMarker.on('click', () => {
        setSelectedFeature({
          name: pt.name,
          category: '空间离散监测点',
          elevationM: pt.elev,
          riskLevel: pt.risk,
          description: '多源传感器与无人机倾斜摄影匹配控制点，包含经纬度高精度坐标与高程。',
        });
      });
      circleMarker.addTo(monitoringGroup);
    });

    // Add all to map initially
    waterGroup.addTo(map);
    ndviGroup.addTo(map);
    monitoringGroup.addTo(map);

    overlayLayersRef.current = {
      water: waterGroup,
      ndvi: ndviGroup,
      monitoring: monitoringGroup,
    };

    map.on('mousemove', (e) => {
      setCursorCoords({
        lat: Number(e.latlng.lat.toFixed(5)),
        lng: Number(e.latlng.lng.toFixed(5)),
      });
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (focusPreset && mapInstanceRef.current) {
      mapInstanceRef.current.setView(focusPreset.center, focusPreset.zoom, { animate: true });
      setSelectedFeature(focusPreset.feature);
    }
  }, [focusPreset]);

  // Update Basemap
  const handleBasemapChange = (type: 'carto' | 'satellite' | 'dark') => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    Object.values(baseLayersRef.current).forEach((layer) => map.removeLayer(layer));
    baseLayersRef.current[type]?.addTo(map);
    setActiveBase(type);
  };

  // Toggle Overlays
  const toggleOverlay = (key: 'water' | 'ndvi' | 'monitoring', show: boolean) => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const layer = overlayLayersRef.current[key];
    if (!layer) return;
    if (show) {
      if (!map.hasLayer(layer)) map.addLayer(layer);
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  };

  const handleWaterToggle = (val: boolean) => {
    setShowWater(val);
    toggleOverlay('water', val);
  };

  const handleNdviToggle = (val: boolean) => {
    setShowNdvi(val);
    toggleOverlay('ndvi', val);
  };

  const handleMonitoringToggle = (val: boolean) => {
    setShowMonitoring(val);
    toggleOverlay('monitoring', val);
  };

  // Adjust NDVI opacity
  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setNdviOpacity(val);
    const ndviGroup = overlayLayersRef.current['ndvi'];
    if (ndviGroup) {
      ndviGroup.eachLayer((layer: any) => {
        if (layer.setStyle) {
          layer.setStyle({ fillOpacity: val });
        }
      });
    }
  };

  const handleResetView = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([30.245, 120.135], 13);
    }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-xl bg-slate-900 text-slate-100">
      {/* Map Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-slate-950/90 border-b border-slate-800 backdrop-blur gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-teal-500/20 text-teal-400 font-mono font-bold">
            GIS
          </span>
          <div>
            <span className="font-semibold text-white tracking-wide">可交互地图技术演示沙盒</span>
            <span className="hidden sm:inline-block ml-2 text-slate-400">
              (Leaflet + 真实公开矢量切片 / 模拟遥感指标图层)
            </span>
          </div>
        </div>

        {/* Coords & Reset */}
        <div className="flex items-center gap-3">
          {cursorCoords && (
            <div className="hidden md:flex items-center gap-1.5 font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
              <MapPin className="w-3.5 h-3.5 text-teal-400" />
              <span>N: {cursorCoords.lat}</span>
              <span className="text-slate-600">|</span>
              <span>E: {cursorCoords.lng}</span>
            </div>
          )}
          <button
            onClick={handleResetView}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
            title="复位至全景视野"
          >
            <RefreshCw className="w-3 h-3" />
            <span>复位视角</span>
          </button>
        </div>
      </div>

      {/* Main Map Box */}
      <div className="relative w-full h-[480px] lg:h-[540px]">
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Floating Controls Overlay (Top Right) */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 max-w-[240px] w-full">
          {/* Basemap Switcher */}
          <div className="bg-slate-950/90 backdrop-blur p-2.5 rounded-xl border border-slate-800 shadow-lg">
            <div className="flex items-center gap-1.5 font-medium text-slate-300 text-xs mb-2">
              <Layers className="w-3.5 h-3.5 text-teal-400" />
              <span>底图图层</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => handleBasemapChange('carto')}
                className={`px-2 py-1 text-[11px] rounded transition cursor-pointer ${
                  activeBase === 'carto'
                    ? 'bg-teal-600 text-white font-medium'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                标准矢量
              </button>
              <button
                type="button"
                onClick={() => handleBasemapChange('satellite')}
                className={`px-2 py-1 text-[11px] rounded transition cursor-pointer ${
                  activeBase === 'satellite'
                    ? 'bg-teal-600 text-white font-medium'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                高分影像
              </button>
              <button
                type="button"
                onClick={() => handleBasemapChange('dark')}
                className={`px-2 py-1 text-[11px] rounded transition cursor-pointer ${
                  activeBase === 'dark'
                    ? 'bg-teal-600 text-white font-medium'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                深色极简
              </button>
            </div>
          </div>

          {/* Overlays Toggle */}
          <div className="bg-slate-950/90 backdrop-blur p-2.5 rounded-xl border border-slate-800 shadow-lg space-y-2 text-xs">
            <div className="flex items-center justify-between font-medium text-slate-300">
              <div className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-teal-400" />
                <span>分析专题图层</span>
              </div>
            </div>

            <label className="flex items-center justify-between cursor-pointer hover:text-white">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block"></span>
                水体与缓冲廊道
              </span>
              <input
                type="checkbox"
                checked={showWater}
                onChange={(e) => handleWaterToggle(e.target.checked)}
                className="rounded accent-teal-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer hover:text-white">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"></span>
                植被覆盖度 (NDVI)
              </span>
              <input
                type="checkbox"
                checked={showNdvi}
                onChange={(e) => handleNdviToggle(e.target.checked)}
                className="rounded accent-teal-500"
              />
            </label>

            {showNdvi && (
              <div className="pt-1 border-t border-slate-800/80">
                <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                  <span>NDVI 透明度</span>
                  <span>{Math.round(ndviOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={ndviOpacity}
                  onChange={handleOpacityChange}
                  className="w-full accent-teal-500 cursor-pointer h-1 bg-slate-800 rounded-lg appearance-none"
                />
              </div>
            )}

            <label className="flex items-center justify-between cursor-pointer hover:text-white">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400 inline-block"></span>
                地表形变监测点
              </span>
              <input
                type="checkbox"
                checked={showMonitoring}
                onChange={(e) => handleMonitoringToggle(e.target.checked)}
                className="rounded accent-teal-500"
              />
            </label>
          </div>
        </div>

        {/* Feature Inspector Overlay (Top Left or Bottom Left on mobile) */}
        {selectedFeature ? (
          <div className="absolute top-4 left-4 z-10 max-w-[280px] bg-slate-950/95 backdrop-blur p-3.5 rounded-xl border border-teal-500/40 shadow-2xl text-xs space-y-2 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5 font-semibold text-white">
                <Activity className="w-3.5 h-3.5 text-teal-400" />
                <span>图元属性检查器</span>
              </div>
              <button
                onClick={() => setSelectedFeature(null)}
                className="text-slate-400 hover:text-white px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div>
              <div className="text-slate-400 text-[11px]">{selectedFeature.category}</div>
              <div className="text-white font-medium text-sm mt-0.5">{selectedFeature.name}</div>
            </div>

            <div className="grid grid-cols-2 gap-2 py-1.5 border-y border-slate-800/60 font-mono text-[11px]">
              {selectedFeature.areaKm2 !== undefined && (
                <div>
                  <span className="text-slate-400 block text-[10px]">计算面积</span>
                  <span className="text-teal-300 font-semibold">{selectedFeature.areaKm2} km²</span>
                </div>
              )}
              {selectedFeature.ndviValue !== undefined && (
                <div>
                  <span className="text-slate-400 block text-[10px]">NDVI 指数</span>
                  <span className="text-emerald-400 font-semibold">{selectedFeature.ndviValue}</span>
                </div>
              )}
              {selectedFeature.elevationM !== undefined && (
                <div>
                  <span className="text-slate-400 block text-[10px]">测站高程</span>
                  <span className="text-sky-300 font-semibold">{selectedFeature.elevationM} m</span>
                </div>
              )}
              {selectedFeature.riskLevel && (
                <div>
                  <span className="text-slate-400 block text-[10px]">风险状态</span>
                  <span className="text-amber-400 font-semibold">{selectedFeature.riskLevel}</span>
                </div>
              )}
            </div>

            <p className="text-slate-300 leading-relaxed text-[11px]">{selectedFeature.description}</p>
          </div>
        ) : (
          <div className="absolute bottom-4 left-4 z-10 hidden sm:flex items-center gap-2 bg-slate-950/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] text-slate-400">
            <Info className="w-3.5 h-3.5 text-teal-400 shrink-0" />
            <span>点击地图中的任意矢量面或圆点可实时查看 GIS 属性表与统计指标</span>
          </div>
        )}
      </div>

      {/* Map Footer Bar with Legal & Data Disclaimer */}
      <div className="px-4 py-2 bg-slate-950 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>技术规范：WGS84 (EPSG:4326) / 瓦片投影 Web Mercator (EPSG:3857)</span>
        </div>
        <div className="text-slate-400">
          声明：当前演示全部采用合法公开测绘切片与脱敏 Demo 样例数据，不包含任何商业涉密信息。
        </div>
      </div>
    </div>
  );
};
