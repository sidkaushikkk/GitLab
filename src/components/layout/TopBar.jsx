import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import {
  GitBranch,
  Search,
  Bell,
  Sparkles,
  RefreshCw,
  ChevronDown,
  Menu,
  Check,
  ShieldAlert,
  GitPullRequest,
  LogOut,
  LogIn,
  User
} from 'lucide-react';
import { Link } from 'react-router-dom';

export function TopBar({ onMobileMenuToggle }) {
  const {
    currentRepo,
    currentBranch,
    selectBranch,
    repositories,
    selectRepoById,
    setIsSearchModalOpen,
    isAiPanelOpen,
    toggleAiPanel,
    isAnalyzing,
    triggerAnalyze
  } = useApp();

  const { user, isAuthenticated, loginWithGithub, logout } = useAuth();

  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);

  const notifications = [
    {
      id: 1,
      title: 'Critical security alert in payment-service',
      desc: 'Hardcoded secret detected in database/connection.ts',
      time: '12m ago',
      icon: ShieldAlert,
      color: 'text-rose-400',
      link: '/security'
    },
    {
      id: 2,
      title: 'PR #142 Risk Analysis ready',
      desc: 'Race condition flagged in session.ts',
      time: '24m ago',
      icon: GitPullRequest,
      color: 'text-amber-400',
      link: '/pulls/PR-142'
    }
  ];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-4 backdrop-blur-md">
      {/* Left section: mobile hamburger + Repo & Branch selectors */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850"
          aria-label="Toggle navigation"
        >
          <Menu size={18} />
        </button>

        {/* Current Repository Selector */}
        <div className="relative">
          <button
            onClick={() => {
              setIsRepoDropdownOpen(!isRepoDropdownOpen);
              setIsBranchDropdownOpen(false);
              setIsNotificationsOpen(false);
            }}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-mono font-medium text-zinc-200 hover:border-zinc-700 hover:bg-zinc-850 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span className="max-w-[140px] truncate sm:max-w-[200px]">{currentRepo?.name ?? 'No repository'}</span>
            <ChevronDown size={13} className="text-zinc-500" />
          </button>

          {isRepoDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-64 rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2.5 py-1.5 text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
                Select Repository
              </div>
              <div className="space-y-0.5 max-h-56 overflow-y-auto">
                {repositories.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => {
                      selectRepoById(repo.id);
                      setIsRepoDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-left font-mono transition-colors ${
                      repo.id === currentRepo?.id
                        ? 'bg-cyan-950/60 text-cyan-300 font-semibold'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                    }`}
                  >
                    <div className="truncate">
                      <div className="truncate">{repo.name}</div>
                      <div className="text-[10px] text-zinc-500">{repo.primaryLanguage}</div>
                    </div>
                    {repo.id === currentRepo?.id && <Check size={14} className="text-cyan-400 shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="mt-1 border-t border-zinc-800 pt-1">
                <Link
                  to="/connect"
                  onClick={() => setIsRepoDropdownOpen(false)}
                  className="flex items-center justify-center w-full px-2.5 py-1.5 text-xs text-cyan-400 hover:bg-zinc-800 rounded-md font-mono transition-colors"
                >
                  + Connect Repository
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Branch Selector */}
        <div className="relative hidden sm:block">
          <button
            onClick={() => {
              setIsBranchDropdownOpen(!isBranchDropdownOpen);
              setIsRepoDropdownOpen(false);
              setIsNotificationsOpen(false);
            }}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
          >
            <GitBranch size={13} className="text-zinc-500" />
            <span className="max-w-[100px] truncate">{currentBranch}</span>
            <ChevronDown size={12} className="text-zinc-500" />
          </button>

          {isBranchDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-48 rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                Branches
              </div>
              <div className="space-y-0.5">
                {(currentRepo?.branches || ['main']).map((branch) => (
                  <button
                    key={branch}
                    onClick={() => {
                      selectBranch(branch);
                      setIsBranchDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs font-mono text-left ${
                      branch === currentBranch
                        ? 'bg-zinc-800 text-zinc-100 font-semibold'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <span className="truncate">{branch}</span>
                    {branch === currentBranch && <Check size={12} className="text-cyan-400 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Middle & Right section: Search bar trigger, Quick Analyze, Notifications, AI Toggle, User Avatar */}
      <div className="flex items-center gap-2.5">
        {/* Quick Search Button */}
        <button
          onClick={() => setIsSearchModalOpen(true)}
          className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
        >
          <Search size={13} />
          <span className="hidden md:inline font-sans">Search codebase...</span>
          <kbd className="hidden md:inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 border border-zinc-750">
            Cmd+K
          </kbd>
        </button>

        {/* Analyze Again Button */}
        <button
          onClick={triggerAnalyze}
          disabled={isAnalyzing}
          className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-850 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={isAnalyzing ? 'animate-spin text-cyan-400' : 'text-zinc-400'} />
          <span>{isAnalyzing ? 'Analyzing...' : 'Analyze'}</span>
        </button>

        {/* Notifications Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setIsNotificationsOpen(!isNotificationsOpen);
              setIsRepoDropdownOpen(false);
              setIsBranchDropdownOpen(false);
            }}
            className="relative p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 transition-colors"
            aria-label="Notifications"
          >
            <Bell size={16} />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-zinc-950" />
          </button>

          {isNotificationsOpen && (
            <div className="absolute right-0 mt-1.5 w-72 sm:w-80 rounded-lg border border-zinc-800 bg-zinc-900 p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between pb-2 mb-1 border-b border-zinc-800 px-2">
                <span className="text-xs font-semibold text-zinc-200">Notifications</span>
                <span className="text-[10px] font-mono text-zinc-500">2 unread</span>
              </div>
              <div className="space-y-1">
                {notifications.map((n) => {
                  const Icon = n.icon;
                  return (
                    <Link
                      key={n.id}
                      to={n.link}
                      onClick={() => setIsNotificationsOpen(false)}
                      className="flex items-start gap-2.5 p-2 rounded-md hover:bg-zinc-850 transition-colors text-left"
                    >
                      <Icon size={16} className={`${n.color} shrink-0 mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-zinc-200 truncate">{n.title}</div>
                        <div className="text-[11px] text-zinc-400 truncate">{n.desc}</div>
                        <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{n.time}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* AI Assistant Persistent Panel Toggle */}
        <button
          onClick={toggleAiPanel}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors border ${
            isAiPanelOpen
              ? 'bg-cyan-950 text-cyan-300 border-cyan-700 shadow-sm'
              : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-zinc-100'
          }`}
          aria-label="Toggle AI Assistant"
        >
          <Sparkles size={13} className={isAiPanelOpen ? 'text-cyan-400' : 'text-zinc-400'} />
          <span className="hidden md:inline font-mono">AI Assistant</span>
        </button>

        {/* User Profile Menu */}
        <div className="relative pl-1 border-l border-zinc-800">
          {isAuthenticated && user ? (
            <>
              <button
                onClick={() => {
                  setIsProfileDropdownOpen(!isProfileDropdownOpen);
                  setIsRepoDropdownOpen(false);
                  setIsBranchDropdownOpen(false);
                  setIsNotificationsOpen(false);
                }}
                className="flex items-center gap-2 p-0.5 rounded-full hover:ring-2 hover:ring-cyan-500/50 transition-all"
                aria-label="User Profile"
              >
                <img
                  src={user.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces'}
                  alt={user.name || user.login}
                  className="w-7 h-7 rounded-full border border-zinc-700 object-cover"
                />
              </button>

              {isProfileDropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-56 rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100 font-mono text-xs">
                  <div className="px-2 py-1.5 border-b border-zinc-800">
                    <div className="font-semibold text-zinc-100 truncate">{user.name || user.login}</div>
                    <div className="text-[11px] text-zinc-500 truncate">@{user.login}</div>
                    {user.email && <div className="text-[10px] text-zinc-500 truncate">{user.email}</div>}
                  </div>
                  <div className="mt-1">
                    <button
                      onClick={() => {
                        logout();
                        setIsProfileDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-zinc-300 hover:bg-rose-950/40 hover:text-rose-300 transition-colors text-left"
                    >
                      <LogOut size={13} className="text-rose-400" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              onClick={loginWithGithub}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-850 text-cyan-300 border border-zinc-800 hover:border-cyan-800 text-xs font-mono transition-colors"
            >
              <LogIn size={13} />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
