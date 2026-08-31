import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { repositoryService } from '../services/repositoryService';
import { useApp } from '../context/AppContext';
import {
  FolderGit2,
  GitBranch,
  RefreshCw,
  Code2,
  ShieldCheck,
  Zap,
  Boxes,
  Network,
  GitPullRequest,
  Activity,
  Layers,
  Clock,
  ArrowRight
} from 'lucide-react';
import { Tabs } from '../components/common/Tabs';
import { OverviewPage } from './OverviewPage';
import { CodeExplorerPage } from './CodeExplorerPage';
import { SecurityPage } from './SecurityPage';
import { DependenciesPage } from './DependenciesPage';
import { ApiReliabilityPage } from './ApiReliabilityPage';
import { PullRequestsPage } from './PullRequestsPage';
import { CodeGraphPage } from './CodeGraphPage';

export function RepositoryDetailPage() {
  const { id } = useParams();
  const { selectRepoById, currentRepo, currentBranch, isAnalyzing, triggerAnalyze } = useApp();
  const [activeTab, setActiveTab] = useState('overview');
  const [repo, setRepo] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      if (id) {
        const data = await repositoryService.getRepositoryById(id);
        setRepo(data);
        selectRepoById(data.id);
      }
    }
    load();
  }, [id]);

  if (!repo) return null;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Layers },
    { id: 'code', label: 'Code', icon: Code2 },
    { id: 'security', label: 'Security', icon: ShieldCheck, count: repo.riskSummary.critical + repo.riskSummary.high },
    { id: 'dependencies', label: 'Dependencies', icon: Boxes, count: repo.metrics.dependenciesCount },
    { id: 'apis', label: 'APIs', icon: Zap, count: repo.metrics.apisDetectedCount },
    { id: 'pulls', label: 'Pull Requests', icon: GitPullRequest, count: repo.openPrsCount },
    { id: 'architecture', label: 'Architecture', icon: Network }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Repo Detail Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold font-mono text-zinc-100">{repo.name}</h1>
            <span className="text-xs font-mono text-zinc-400">
              {repo.organization}/{repo.name}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 flex items-center gap-1">
              <GitBranch size={12} />
              {currentBranch}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Last analyzed {repo.lastAnalyzed} - Primary language: {repo.primaryLanguage}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={triggerAnalyze}
            disabled={isAnalyzing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold font-mono text-xs transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={13} className={isAnalyzing ? 'animate-spin' : ''} />
            <span>{isAnalyzing ? 'Scanning...' : 'Analyze Again'}</span>
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-850 hover:bg-zinc-800 text-zinc-200 font-mono text-xs border border-zinc-750 transition-colors"
          >
            <Code2 size={13} />
            <span>Open Repository</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab Contents */}
      <div className="mt-4">
        {activeTab === 'overview' && <OverviewPage headless />}
        {activeTab === 'code' && <CodeExplorerPage headless />}
        {activeTab === 'security' && <SecurityPage headless />}
        {activeTab === 'dependencies' && <DependenciesPage headless />}
        {activeTab === 'apis' && <ApiReliabilityPage headless />}
        {activeTab === 'pulls' && <PullRequestsPage headless />}
        {activeTab === 'architecture' && <CodeGraphPage headless />}
      </div>
    </div>
  );
}
