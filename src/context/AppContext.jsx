import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { repositoryService } from '../services/repositoryService';
import { useAuth } from './AuthContext';

const AppContext = createContext(null);
const ACTIVE_REPO_STORAGE_KEY = 'gitlab_active_repo_id';

export function AppProvider({ children }) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [repositories, setRepositories] = useState([]);
  const [currentRepo, setCurrentRepo] = useState(null);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Fetch connected repositories when authenticated or on manual refresh
  const refreshRepositories = useCallback(async () => {
    try {
      const repos = await repositoryService.getRepositories();
      if (Array.isArray(repos) && repos.length > 0) {
        setRepositories(repos);
        const savedRepoId = localStorage.getItem(ACTIVE_REPO_STORAGE_KEY);
        const found = (savedRepoId ? repos.find(r => r.id === savedRepoId || r.name === savedRepoId) : null) || repos[0];
        setCurrentRepo(found);
        setCurrentBranch(found.defaultBranch || 'main');
      } else {
        setRepositories([]);
        setCurrentRepo(null);
      }
    } catch (err) {
      setRepositories([]);
      setCurrentRepo(null);
    }
  }, []);

  // React to auth state resolution
  useEffect(() => {
    if (!isAuthLoading) {
      if (isAuthenticated) {
        refreshRepositories();
      } else {
        setRepositories([]);
        setCurrentRepo(null);
      }
    }
  }, [isAuthLoading, isAuthenticated, refreshRepositories]);

  // Listen for Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchModalOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsSearchModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const addToast = (message, type = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const selectRepoById = (repoId) => {
    const found = repositories.find(r => r.id === repoId || r.name === repoId) || repositories[0];
    if (found) {
      setCurrentRepo(found);
      setCurrentBranch(found.defaultBranch || 'main');
      localStorage.setItem(ACTIVE_REPO_STORAGE_KEY, found.id || found.name);
      addToast(`Switched repository to ${found.name}`, 'success');
    }
  };

  const selectBranch = (branch) => {
    setCurrentBranch(branch);
    addToast(`Switched branch to ${branch}`, 'info');
  };

  const addConnectedRepository = (newRepo) => {
    setRepositories(prev => {
      const exists = prev.some(r => r.id === newRepo.id || r.name === newRepo.name);
      return exists ? prev.map(r => (r.id === newRepo.id || r.name === newRepo.name ? newRepo : r)) : [newRepo, ...prev];
    });
    setCurrentRepo(newRepo);
    setCurrentBranch(newRepo.defaultBranch || 'main');
    localStorage.setItem(ACTIVE_REPO_STORAGE_KEY, newRepo.id || newRepo.name);
    addToast(`Successfully connected repository ${newRepo.name}`, 'success');
  };

  const toggleAiPanel = () => {
    setIsAiPanelOpen(prev => !prev);
  };

  const triggerAnalyze = async () => {
    if (!currentRepo) {
      addToast('No active repository selected to analyze', 'warning');
      return;
    }
    setIsAnalyzing(true);
    addToast(`Running AST code intelligence scan on ${currentRepo.name}...`, 'info');

    try {
      // Ingest latest commit for current branch (resolves newest commit or returns existing snapshot idempotently)
      let targetSnap = await repositoryService.ingestRepository(currentRepo.id, currentBranch).catch((err) => {
        console.warn('Ingestion attempt error, falling back to existing snapshot:', err);
        return null;
      });

      if (!targetSnap) {
        const snapshots = await repositoryService.getSnapshots(currentRepo.id);
        targetSnap = snapshots?.[0];
      }

      if (targetSnap) {
        const result = await repositoryService.analyzeSnapshot(currentRepo.id, targetSnap.id, true);
        addToast(`Scan complete: ${result.summary?.filesAnalyzed ?? 0} files analyzed, ${result.summary?.smells ?? 0} findings detected`, 'success');
        refreshRepositories();
      } else {
        addToast('No snapshot available to analyze. Please ingest repository first.', 'warning');
      }
    } catch (err) {
      addToast(`Analysis error: ${err.message}`, 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <AppContext.Provider
      value={{
        repositories,
        currentRepo,
        currentBranch,
        isAiPanelOpen,
        isSearchModalOpen,
        isAnalyzing,
        toasts,
        setIsAiPanelOpen,
        setIsSearchModalOpen,
        selectRepoById,
        selectBranch,
        addConnectedRepository,
        refreshRepositories,
        toggleAiPanel,
        triggerAnalyze,
        addToast,
        removeToast
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
