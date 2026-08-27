import React, { createContext, useContext, useState, useEffect } from 'react';
import { mockRepositories } from '../data/repositoriesData';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [repositories, setRepositories] = useState(mockRepositories);
  const [currentRepo, setCurrentRepo] = useState(mockRepositories[0]);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [toasts, setToasts] = useState([]);

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
    const found = repositories.find(r => r.id === repoId) || repositories[0];
    setCurrentRepo(found);
    setCurrentBranch(found.defaultBranch || 'main');
    addToast(`Switched repository to ${found.name}`, 'success');
  };

  const selectBranch = (branch) => {
    setCurrentBranch(branch);
    addToast(`Switched branch to ${branch}`, 'info');
  };

  const toggleAiPanel = () => {
    setIsAiPanelOpen(prev => !prev);
  };

  const triggerAnalyze = () => {
    setIsAnalyzing(true);
    addToast(`Started full analysis on ${currentRepo.name} (${currentBranch})`, 'info');
    setTimeout(() => {
      setIsAnalyzing(false);
      addToast(`Analysis complete: Health score updated to ${currentRepo.metrics.healthScore}/100`, 'success');
    }, 3000);
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
