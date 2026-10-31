import React, { useState } from 'react';
import { Compass, Menu, X, ShieldCheck, Search, FileText, LayoutDashboard } from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onTabChange }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { id: 'home', label: '首页' },
    { id: 'services', label: '服务范围' },
    { id: 'cases', label: '案例演示' },
    { id: 'inquiry', label: '提交需求' },
    { id: 'lookup', label: '工单查询' },
    { id: 'privacy', label: '服务边界' },
    { id: 'admin', label: '管理后台' },
  ];

  const handleSelect = (id: string) => {
    onTabChange(id);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800 text-slate-100 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand / Logo */}
        <button
          onClick={() => handleSelect('home')}
          className="flex items-center gap-2.5 text-left group cursor-pointer focus:outline-none"
        >
          <div className="w-9 h-9 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 group-hover:border-teal-400 group-hover:bg-teal-500/20 transition">
            <Compass className="w-5 h-5 text-teal-400 animate-pulse" />
          </div>
          <div>
            <div className="font-bold text-base tracking-tight text-white flex items-center gap-1.5">
              <span>GeoSpatial Studio</span>
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800/60">
                PRO
              </span>
            </div>
            <div className="text-[11px] text-slate-400 -mt-0.5 tracking-wide">
              地理空间技术服务 · GIS定制开发
            </div>
          </div>
        </button>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  isActive
                    ? 'bg-teal-600/90 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* CTA Button & Mobile Trigger */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => handleSelect('inquiry')}
            className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-xs transition cursor-pointer shadow-sm hover:shadow-teal-500/20"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>发起需求询价</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 focus:outline-none"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-900 border-b border-slate-800 px-4 pt-2 pb-4 space-y-1 animate-fadeIn">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition flex items-center justify-between ${
                  isActive
                    ? 'bg-teal-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span>{item.label}</span>
                {item.id === 'inquiry' && (
                  <span className="text-[10px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded">
                    49元起
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
