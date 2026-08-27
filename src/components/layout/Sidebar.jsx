import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  LayoutDashboard,
  FolderGit2,
  GitPullRequest,
  Activity,
  ShieldAlert,
  Zap,
  Boxes,
  Network,
  Code2,
  Sparkles,
  Settings,
  ChevronLeft,
  ChevronRight,
  Database,
  PlusCircle
} from 'lucide-react';

export function Sidebar({ isMobileOpen, onMobileClose }) {
  const { currentRepo } = useApp();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navItems = [
    { label: 'Overview', to: '/', icon: LayoutDashboard },
    { label: 'Repositories', to: '/repositories', icon: FolderGit2 },
    { label: 'Pull Requests', to: '/pulls', icon: GitPullRequest, badge: currentRepo.openPrsCount },
    { label: 'Code Health', to: '/code-health', icon: Activity },
    { label: 'Security', to: '/security', icon: ShieldAlert, alertBadge: currentRepo.riskSummary.critical > 0 },
    { label: 'API Reliability', to: '/api-reliability', icon: Zap },
    { label: 'Dependencies', to: '/dependencies', icon: Boxes },
    { label: 'Code Graph', to: '/code-graph', icon: Network },
    { label: 'Code Explorer', to: '/code', icon: Code2 },
    { label: 'AI Assistant', to: '/ai', icon: Sparkles },
    { label: 'Settings', to: '/settings', icon: Settings }
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-zinc-950 border-r border-zinc-800/80">
      {/* Brand Header */}
      <div>
        <div className="flex h-14 items-center justify-between px-3.5 border-b border-zinc-800/80">
          <NavLink to="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 flex items-center justify-center shrink-0">
              <Code2 size={16} className="text-cyan-400" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold tracking-tight text-zinc-100 font-mono">GitLab</span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/40">
                    INTEL
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 font-sans tracking-wide">Engineering Platform</span>
              </div>
            )}
          </NavLink>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
            aria-label="Collapse sidebar"
          >
            {isCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        {/* Navigation items */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onMobileClose}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all group ${
                    isActive
                      ? 'bg-zinc-850 text-cyan-300 border border-zinc-750 shadow-sm font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
                  }`
                }
                title={isCollapsed ? item.label : undefined}
              >
                <Icon size={16} className="shrink-0 text-zinc-400 group-hover:text-zinc-200 transition-colors" />
                {!isCollapsed && (
                  <span className="flex-1 truncate tracking-tight">{item.label}</span>
                )}
                {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                    {item.badge}
                  </span>
                )}
                {!isCollapsed && item.alertBadge && (
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Bottom Area: Active Repository Badge + Profile */}
      <div className="p-2 border-t border-zinc-850 space-y-2">
        {/* Active Repo Quick Card */}
        {!isCollapsed && (
          <div className="p-2.5 rounded-md bg-zinc-900/60 border border-zinc-800 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase font-mono text-zinc-500 tracking-wider">Active Analysis</span>
              <span className="text-[10px] font-mono text-emerald-400 font-semibold">{currentRepo.metrics.healthScore}/100</span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-zinc-200 font-medium truncate">
              <Database size={13} className="text-zinc-500 shrink-0" />
              <span className="truncate">{currentRepo.name}</span>
            </div>
          </div>
        )}

        {/* Quick Connect CTA */}
        <NavLink
          to="/connect"
          onClick={onMobileClose}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-cyan-900/50 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-950/60 text-xs font-mono transition-colors ${
            isCollapsed ? 'justify-center' : ''
          }`}
          title="Connect GitHub Repository"
        >
          <PlusCircle size={14} className="shrink-0 text-cyan-400" />
          {!isCollapsed && <span>Connect Repository</span>}
        </NavLink>

        {/* User profile item */}
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md bg-zinc-900/30 border border-zinc-850/60">
          <img
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces"
            alt="User avatar"
            className="w-6 h-6 rounded-full border border-zinc-700 object-cover shrink-0"
          />
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-zinc-200 truncate">Alex Chen</div>
              <div className="text-[10px] text-zinc-500 font-mono truncate">Staff Platform Engineer</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-all duration-200 ${
          isCollapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className="fixed top-0 bottom-0 z-20 h-full transition-all duration-200" style={{ width: isCollapsed ? '4rem' : '14rem' }}>
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
            onClick={onMobileClose}
          />
          <div className="fixed inset-y-0 left-0 w-64 shadow-2xl animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
