import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  Search,
  FileCode,
  Zap,
  ShieldAlert,
  GitPullRequest,
  Code2,
  X,
  ArrowRight
} from 'lucide-react';

export function GlobalSearchModal() {
  const { isSearchModalOpen, setIsSearchModalOpen } = useApp();
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!isSearchModalOpen) {
      setQuery('');
    }
  }, [isSearchModalOpen]);

  if (!isSearchModalOpen) return null;

  const searchItems = [
    {
      category: 'Files',
      icon: FileCode,
      title: 'src/auth/AuthService.ts',
      subtitle: 'TypeScript source file - 480 LOC - 3 issues',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/code');
      }
    },
    {
      category: 'Files',
      icon: FileCode,
      title: 'src/api/payment.ts',
      subtitle: 'TypeScript source file - 520 LOC - 2 issues',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/code');
      }
    },
    {
      category: 'Files',
      icon: FileCode,
      title: 'src/database/connection.ts',
      subtitle: 'TypeScript source file - 190 LOC - 1 critical',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/code');
      }
    },
    {
      category: 'Symbols & Functions',
      icon: Code2,
      title: 'AuthService.revokeToken()',
      subtitle: 'Method in src/auth/AuthService.ts (line 18)',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/code');
      }
    },
    {
      category: 'Symbols & Functions',
      icon: Code2,
      title: 'getPoolConfig()',
      subtitle: 'Function in src/database/connection.ts (line 42)',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/code');
      }
    },
    {
      category: 'APIs',
      icon: Zap,
      title: 'POST /api/v1/payments/charge',
      subtitle: 'Stripe charge handler - 61.4% reliability - Critical risk',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/api-reliability');
      }
    },
    {
      category: 'APIs',
      icon: Zap,
      title: 'GET /api/v1/users/profile',
      subtitle: 'Customer profile gateway - 94.8% reliability - Low risk',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/api-reliability');
      }
    },
    {
      category: 'Security Findings',
      icon: ShieldAlert,
      title: 'SEC-1082: Hardcoded secret in database connection',
      subtitle: 'CRITICAL severity - CWE-798 Hard-coded Credentials',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/security');
      }
    },
    {
      category: 'Security Findings',
      icon: ShieldAlert,
      title: 'SEC-1044: SQL injection risk in payment queries',
      subtitle: 'HIGH severity - CWE-89 SQL Injection',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/security');
      }
    },
    {
      category: 'Pull Requests',
      icon: GitPullRequest,
      title: 'PR #142: Refactor authentication service',
      subtitle: 'HIGH risk - 8 files changed - AI review flagged race condition',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/pulls/PR-142');
      }
    }
  ];

  const filteredItems = query
    ? searchItems.filter(
        item =>
          item.title.toLowerCase().includes(query.toLowerCase()) ||
          item.subtitle.toLowerCase().includes(query.toLowerCase()) ||
          item.category.toLowerCase().includes(query.toLowerCase())
      )
    : searchItems;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
        onClick={() => setIsSearchModalOpen(false)}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-xl rounded-xl border border-zinc-750 bg-zinc-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
          <Search size={18} className="text-zinc-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files, symbols, APIs, security findings, PRs..."
            className="w-full bg-transparent text-sm font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-zinc-500 hover:text-zinc-300 p-1"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="hidden sm:inline-block rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-mono text-zinc-400 border border-zinc-700">
            ESC
          </kbd>
        </div>

        {/* Search Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1 divide-y divide-zinc-800/40">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-500 font-sans">
              No matching files or symbols found for &quot;{query}&quot;
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={item.action}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg text-left hover:bg-zinc-800/70 transition-colors group"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-1.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700 shrink-0 mt-0.5">
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-medium text-zinc-100 truncate group-hover:text-cyan-300 transition-colors">
                          {item.title}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                          {item.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 font-sans truncate mt-0.5">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-zinc-600 group-hover:text-cyan-400 transition-colors shrink-0 ml-2" />
                </button>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-950/80 border-t border-zinc-800 text-[11px] text-zinc-500 font-mono">
          <span>Tip: Use keys or click to navigate</span>
          <span>GitLab Index: 284 files</span>
        </div>
      </div>
    </div>
  );
}
