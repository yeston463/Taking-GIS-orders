import React from 'react';
import { Compass, ShieldCheck, Mail, MessageSquare, ExternalLink, Database, Code2 } from 'lucide-react';

interface FooterProps {
  onTabChange: (tab: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onTabChange }) => {
  return (
    <footer className="bg-slate-950 border-t border-slate-800 text-slate-400 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Col 1: Studio Brand */}
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <Compass className="w-4 h-4 text-teal-400" />
              <span>GeoSpatial Studio</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              专注个人技术深耕与工程级 GIS 交付。提供透明可溯的地理空间技术定制，杜绝虚假宣传、黑盒转包与模板糊弄。
            </p>
            <div className="flex items-center gap-2 text-teal-400 text-[11px]">
              <ShieldCheck className="w-4 h-4" />
              <span>严格合规 · 测绘脱敏 · 源码交付</span>
            </div>
          </div>

          {/* Col 2: Services Quick Links */}
          <div className="space-y-2.5">
            <h4 className="text-white font-semibold text-xs tracking-wider">核心业务服务</h4>
            <ul className="space-y-1.5 text-[11px]">
              <li>
                <button
                  onClick={() => onTabChange('services')}
                  className="hover:text-teal-400 transition cursor-pointer"
                >
                  QGIS / ArcGIS 专题地图制作（49元起）
                </button>
              </li>
              <li>
                <button
                  onClick={() => onTabChange('services')}
                  className="hover:text-teal-400 transition cursor-pointer"
                >
                  GIS 空间数据批处理与清洗（99元起）
                </button>
              </li>
              <li>
                <button
                  onClick={() => onTabChange('services')}
                  className="hover:text-teal-400 transition cursor-pointer"
                >
                  Python / PyQGIS / GDAL 脚本开发（99元起）
                </button>
              </li>
              <li>
                <button
                  onClick={() => onTabChange('services')}
                  className="hover:text-teal-400 transition cursor-pointer"
                >
                  WebGIS 轻量可视化系统定制（99元起）
                </button>
              </li>
              <li>
                <button
                  onClick={() => onTabChange('services')}
                  className="hover:text-teal-400 transition cursor-pointer"
                >
                  遥感影像 NDVI 与植被时序分析（199元起）
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Principles & Boundaries */}
          <div className="space-y-2.5">
            <h4 className="text-white font-semibold text-xs tracking-wider">服务边界与承诺</h4>
            <ul className="space-y-1.5 text-[11px] text-slate-400">
              <li className="flex items-start gap-1.5">
                <span className="text-teal-400 font-bold">•</span>
                <span>标价均为参考起价，最终人工精准核算，不作自动成交承诺。</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-teal-400 font-bold">•</span>
                <span>坚决谢绝任何涉密测绘数据与非法地图边界制作。</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-teal-400 font-bold">•</span>
                <span>绝不捏造客户、不借用未经授权成果图片充当商业宣传。</span>
              </li>
              <li>
                <button
                  onClick={() => onTabChange('privacy')}
                  className="text-teal-400 hover:underline transition cursor-pointer inline-flex items-center gap-1"
                >
                  <span>阅读详细服务协议与隐私条款</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </li>
            </ul>
          </div>

          {/* Col 4: Contact & Order Tracking */}
          <div className="space-y-2.5">
            <h4 className="text-white font-semibold text-xs tracking-wider">联系与工单服务</h4>
            <div className="space-y-2 text-[11px]">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-slate-300" />
                <span className="text-slate-300 font-mono">yeston463@gmail.com</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-slate-300" />
                <span>微信对接：需求提交后专属对接通道</span>
              </div>
              <div className="pt-2">
                <button
                  onClick={() => onTabChange('lookup')}
                  className="w-full text-center px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition text-[11px] cursor-pointer"
                >
                  已有工单？快速查询订单进度
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-8 pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-400">
          <div>
            &copy; {new Date().getFullYear()} GeoSpatial Studio. 保留所有权利 · 独立地理空间工程技术工作室
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Powered by Leaflet, OpenStreetMap & QGIS Community</span>
            <button
              onClick={() => onTabChange('admin')}
              className="text-slate-400 hover:text-slate-400 text-[10px] cursor-pointer"
            >
              内部运维入口
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
};
