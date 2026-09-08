import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { codeService } from '../../services/codeService';
import {
  Search,
  FileCode,
  Code2,
  X,
  ArrowRight,
  LayoutDashboard,
  FolderGit2,
  PlusCircle,
  Activity,
  ShieldAlert,
  Boxes,
  Network,
  Settings
} from 'lucide-react';

export function GlobalSearchModal() {
  const { isSearchModalOpen, setIsSearchModalOpen, currentRepo } = useApp();
  const [query, setQuery] = useState('');
  const [repoFiles, setRepoFiles] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isSearchModalOpen) {
      setQuery('');
    } else if (currentRepo?.id) {
      codeService.getFileTree(currentRepo.id).then(tree => {
        const flat = [];
        function traverse(nodes) {
          for (const node of nodes || []) {
            if (node.type === 'file') {
              flat.push(node);
            } else if (node.children) {
              traverse(node.children);
            }
          }
        }
        traverse(tree);
        setRepoFiles(flat);
      }).catch(() => setRepoFiles([]));
    } else {
      setRepoFiles([]);
    }
  }, [isSearchModalOpen, currentRepo?.id]);

  if (!isSearchModalOpen) return null;

  const navItems = [
    {
      category: 'Navigation',
      icon: LayoutDashboard,
      title: 'Overview & Dashboard',
      subtitle: 'Executive codebase reliability and architecture summary',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/');
      }
    },
    {
      category: 'Navigation',
      icon: FolderGit2,
      title: 'Connected Repositories',
      subtitle: 'View, select, and switch between connected repositories',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/repositories');
      }
    },
    {
      category: 'Navigation',
      icon: PlusCircle,
      title: 'Connect Repository',
      subtitle: 'Import a new GitHub or GitLab codebase for analysis',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/connect');
      }
    },
    {
      category: 'Navigation',
      icon: Activity,
      title: 'Code Health & Quality',
      subtitle: 'Deterministic AST metrics, maintainability, and code smells',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/code-health');
      }
    },
    {
      category: 'Navigation',
      icon: ShieldAlert,
      title: 'Security & Vulnerabilities',
      subtitle: 'Hardcoded secrets, unsafe patterns, and CWE analysis',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/security');
      }
    },
    {
      category: 'Navigation',
      icon: Boxes,
      title: 'Dependencies & SBOM',
      subtitle: 'Manifest packages, ecosystems, and direct/transitive dependencies',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/dependencies');
      }
    },
    {
      category: 'Navigation',
      icon: Network,
      title: 'Code Graph',
      subtitle: 'Interactive module and file dependency architecture visualizer',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/code-graph');
      }
    },
    {
      category: 'Navigation',
      icon: Code2,
      title: 'Code Explorer',
      subtitle: 'File tree, syntax tree inspector, and line diagnostics',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/code');
      }
    },
    {
      category: 'Navigation',
      icon: Settings,
      title: 'Settings',
      subtitle: 'Platform preferences, credentials, and configuration',
      action: () => {
        setIsSearchModalOpen(false);
        navigate('/settings');
      }
    }
  ];

  const fileItems = repoFiles.map(file => ({
    category: 'Files',
    icon: FileCode,
    title: file.path,
    subtitle: `${file.language || 'Code'} • ${file.size || ''}${file.issuesCount ? ` • ${file.issuesCount} issue(s)` : ''}`,
    action: () => {
      setIsSearchModalOpen(false);
      navigate('/code');
    }
  }));

  const allItems = [...navItems, ...fileItems];

  const filteredItems = query
    ? allItems.filter(
        item =>
          item.title.toLowerCase().includes(query.toLowerCase()) ||
          item.subtitle.toLowerCase().includes(query.toLowerCase()) ||
          item.category.toLowerCase().includes(query.toLowerCase())
      )
    : allItems;

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
            placeholder="Search navigation destinations, files..."
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
              No matching destinations or files found for &quot;{query}&quot;
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
          <span>{currentRepo ? `${currentRepo.name} (${repoFiles.length} files)` : 'No repository selected'}</span>
        </div>
      </div>
    </div>
  );
}
