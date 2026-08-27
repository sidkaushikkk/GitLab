import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { repositoryService } from '../services/repositoryService';
import {
  FolderGit2,
  GitBranch,
  CheckCircle2,
  Circle,
  Loader2,
  ShieldCheck,
  Zap,
  Code2,
  Network,
  Boxes,
  Activity,
  Search,
  ArrowRight,
  Terminal,
  Lock,
  Sparkles,
  ChevronRight
} from 'lucide-react';

export function ConnectPage() {
  const { selectRepoById, addToast } = useApp();
  const navigate = useNavigate();

  // Wizard Steps: 1: 'connect_github', 2: 'select_repo', 3: 'configure_analysis', 4: 'analyzing_progress', 5: 'complete'
  const [step, setStep] = useState('connect_github');
  const [isAuthorizingGithub, setIsAuthorizingGithub] = useState(false);
  const [githubRepos, setGithubRepos] = useState([]);
  const [searchRepo, setSearchRepo] = useState('');
  const [selectedRepoName, setSelectedRepoName] = useState('payment-service');
  const [selectedBranch, setSelectedBranch] = useState('main');

  // Analysis Configuration Flags
  const [config, setConfig] = useState({
    codeQuality: true,
    security: true,
    dependencies: true,
    apiReliability: true,
    architecture: true,
    technicalDebt: true
  });

  // Pipeline Stages
  const [pipelineIndex, setPipelineIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(15);
  const [pipelineLogs, setPipelineLogs] = useState([]);

  const pipelineStages = [
    { name: 'Repository connected', log: 'Cloning repository HitachiSystems/payment-service at commit 8f9b2a1...' },
    { name: 'Files indexed', log: 'Discovered 284 source files (42,850 total lines of code)...' },
    { name: 'Dependencies mapped', log: 'Resolved package tree: 92 modules from package-lock.json...' },
    { name: 'AST analysis complete', log: 'Parsed Babel & TypeScript AST trees; mapped 1,420 function nodes...' },
    { name: 'Running security analysis', log: 'Executing Semgrep & CVE security rule engine: 1 critical finding detected...' },
    { name: 'API analysis', log: 'Detecting Express route registrations & Stripe webhook dispatch points...' },
    { name: 'AI codebase indexing', log: 'Vectorizing semantic symbols & architecture graph embeddings...' }
  ];

  useEffect(() => {
    async function fetchRepos() {
      const data = await repositoryService.getAvailableGithubRepos(searchRepo);
      setGithubRepos(data);
    }
    fetchRepos();
  }, [searchRepo]);

  // Handle GitHub Auth Simulation
  const handleConnectGithub = () => {
    setIsAuthorizingGithub(true);
    setTimeout(() => {
      setIsAuthorizingGithub(false);
      setStep('select_repo');
      addToast('GitHub account connected: @alex-chen-hitachi', 'success');
    }, 1200);
  };

  // Start Pipeline Simulation
  const handleStartAnalysis = () => {
    setStep('analyzing_progress');
    setPipelineIndex(0);
    setProgressPercent(10);
    setPipelineLogs(['[00:01] Initializing GitLab Distributed Analysis Worker...']);

    const interval = setInterval(() => {
      setPipelineIndex((prev) => {
        const next = prev + 1;
        if (next < pipelineStages.length) {
          setProgressPercent(Math.round(((next + 1) / pipelineStages.length) * 100));
          setPipelineLogs((logs) => [
            ...logs,
            `[00:0${next + 2}] ${pipelineStages[next].log}`
          ]);
          return next;
        } else {
          clearInterval(interval);
          setProgressPercent(100);
          setPipelineLogs((logs) => [
            ...logs,
            '[00:10] Analysis pipeline finished successfully with 0 fatal errors.',
            '[00:10] Repository health score synthesized: 82/100 (Grade A)'
          ]);
          setTimeout(() => {
            setStep('complete');
          }, 800);
          return prev;
        }
      });
    }, 900);
  };

  const handleFinishAndOpen = () => {
    selectRepoById(selectedRepoName);
    navigate('/');
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 animate-in fade-in duration-200">
      {/* Wizard Progress Stepper Header */}
      <div className="flex items-center justify-between pb-6 mb-8 border-b border-zinc-800 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <span className="text-zinc-200 font-semibold uppercase tracking-wider">
            Repository Onboarding Pipeline
          </span>
        </div>

        <div className="flex items-center gap-2 text-zinc-500">
          <span className={step === 'connect_github' ? 'text-cyan-400 font-bold' : ''}>1. Provider</span>
          <ChevronRight size={12} />
          <span className={step === 'select_repo' ? 'text-cyan-400 font-bold' : ''}>2. Select</span>
          <ChevronRight size={12} />
          <span className={step === 'configure_analysis' ? 'text-cyan-400 font-bold' : ''}>3. Config</span>
          <ChevronRight size={12} />
          <span className={step === 'analyzing_progress' || step === 'complete' ? 'text-cyan-400 font-bold' : ''}>
            4. Analysis
          </span>
        </div>
      </div>

      {/* STEP 1: CONNECT GITHUB */}
      {step === 'connect_github' && (
        <div className="flex flex-col items-center justify-center p-8 sm:p-14 text-center rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-100 mb-6 shadow-inner">
            <FolderGit2 size={30} className="text-cyan-400" />
          </div>

          <h2 className="text-2xl font-bold font-mono text-zinc-100 tracking-tight">
            Connect your repository
          </h2>
          <p className="text-sm text-zinc-400 mt-2 max-w-md leading-relaxed font-sans">
            Analyze your codebase and get actionable engineering insights across quality, security, and architecture.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={handleConnectGithub}
              disabled={isAuthorizingGithub}
              className="flex items-center justify-center gap-3 px-6 py-3 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-mono font-bold text-xs transition-all shadow-lg hover:shadow-cyan-500/10 disabled:opacity-60"
            >
              {isAuthorizingGithub ? (
                <>
                  <Loader2 size={16} className="animate-spin text-zinc-950" />
                  <span>Authorizing GitHub OAuth...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  <span>Connect GitHub</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-zinc-800 flex items-center justify-center gap-6 text-[11px] font-mono text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Lock size={12} className="text-emerald-400" /> Read-only access
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-cyan-400" /> SOC2 Type II Certified
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-cyan-400" /> Zero Code Storage
            </span>
          </div>
        </div>
      )}

      {/* STEP 2: SELECT REPOSITORY */}
      {step === 'select_repo' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold font-mono text-zinc-100">Select a repository</h2>
              <p className="text-xs text-zinc-400 font-sans">
                Choose an organization repository to connect and run deep intelligence analysis.
              </p>
            </div>

            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
              <input
                type="text"
                value={searchRepo}
                onChange={(e) => setSearchRepo(e.target.value)}
                placeholder="Search repositories..."
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-500 text-xs rounded-md pl-8 pr-3 py-2 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          {/* Repo List */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800 overflow-hidden">
            {githubRepos.map((repo) => {
              const isSelected = selectedRepoName === repo.name;
              return (
                <div
                  key={repo.name}
                  onClick={() => setSelectedRepoName(repo.name)}
                  className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${
                    isSelected ? 'bg-cyan-950/40 border-l-2 border-cyan-400' : 'hover:bg-zinc-850/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300">
                      <FolderGit2 size={16} className={isSelected ? 'text-cyan-400' : ''} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="font-bold text-zinc-100">{repo.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                          {repo.visibility}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 font-sans mt-0.5 flex items-center gap-3">
                        <span>{repo.organization}</span>
                        <span>-</span>
                        <span>{repo.primaryLanguage}</span>
                        <span>-</span>
                        <span>{repo.lastUpdated}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-xs">
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      isSelected ? 'border-cyan-400 bg-cyan-950' : 'border-zinc-700'
                    }`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-cyan-400" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
            <button
              onClick={() => setStep('connect_github')}
              className="px-3.5 py-2 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep('configure_analysis')}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-mono font-bold text-xs transition-colors"
            >
              <span>Import Repository</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: CONFIGURE ANALYSIS */}
      {step === 'configure_analysis' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
            <h2 className="text-base font-bold font-mono text-zinc-100">
              Analyzing {selectedRepoName}
            </h2>
            <p className="text-xs text-zinc-400 font-sans mt-0.5">
              Specify branches and select intelligence analyzers to run across your codebase.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 font-mono text-xs">
              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">REPOSITORY</label>
                <input
                  type="text"
                  value={selectedRepoName}
                  disabled
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2 text-zinc-300 opacity-80"
                />
              </div>
              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">DEFAULT BRANCH</label>
                <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-md p-2">
                  <GitBranch size={14} className="text-cyan-400" />
                  <input
                    type="text"
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="w-full bg-transparent text-zinc-200 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Analysis Configuration Checkboxes */}
          <div>
            <h3 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Analysis Configuration
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: 'codeQuality', title: 'Code Quality & Maintainability', desc: 'Cyclomatic complexity, duplications, test coverage gaps', icon: Code2 },
                { key: 'security', title: 'Security & Vulnerabilities', desc: 'CWE rules, hardcoded credentials, injection hazards', icon: ShieldCheck },
                { key: 'dependencies', title: 'Dependency Intelligence', desc: 'Outdated packages, CVE alerts, license compliance', icon: Boxes },
                { key: 'apiReliability', title: 'API Reliability Analysis', desc: 'Endpoint failure rate, p99 latency, error handling', icon: Zap },
                { key: 'architecture', title: 'Architecture & Code Graph', desc: 'Module dependency topologies and blast radius maps', icon: Network },
                { key: 'technicalDebt', title: 'Technical Debt Insights', desc: 'Estimated hours of debt and refactoring hotspots', icon: Activity }
              ].map((item) => {
                const Icon = item.icon;
                const isChecked = config[item.key];

                return (
                  <div
                    key={item.key}
                    onClick={() => setConfig({ ...config, [item.key]: !isChecked })}
                    className={`p-3.5 rounded-lg border cursor-pointer select-none transition-colors flex items-start gap-3 ${
                      isChecked
                        ? 'bg-zinc-900 border-cyan-800/80 text-zinc-100'
                        : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 opacity-60'
                    }`}
                  >
                    <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      isChecked ? 'bg-cyan-500 border-cyan-400 text-zinc-950' : 'border-zinc-700'
                    }`}>
                      {isChecked && <CheckCircle2 size={12} />}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                        <Icon size={14} className={isChecked ? 'text-cyan-400' : 'text-zinc-500'} />
                        <span>{item.title}</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
            <button
              onClick={() => setStep('select_repo')}
              className="px-3.5 py-2 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleStartAnalysis}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-mono font-bold text-xs transition-colors shadow-lg hover:shadow-cyan-500/20"
            >
              <span>Start Analysis</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4 & 5: SERIOUS DEVELOPER ANALYSIS PIPELINE PROGRESS */}
      {(step === 'analyzing_progress' || step === 'complete') && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/80 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold font-mono text-zinc-100 flex items-center gap-2.5">
                  {step === 'complete' ? (
                    <>
                      <CheckCircle2 size={18} className="text-emerald-400" />
                      Analysis Complete
                    </>
                  ) : (
                    <>
                      <Loader2 size={18} className="animate-spin text-cyan-400" />
                      Analyzing repository...
                    </>
                  )}
                </h2>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">
                  {selectedRepoName} ({selectedBranch})
                </p>
              </div>

              <div className="text-right font-mono">
                <span className="text-2xl font-bold text-cyan-400">{progressPercent}%</span>
                <span className="text-xs text-zinc-500 block">Pipeline Status</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden mb-6">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Pipeline Stage Checklist */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 font-mono text-xs">
              {pipelineStages.map((stage, idx) => {
                const isFinished = idx < pipelineIndex || step === 'complete';
                const isCurrent = idx === pipelineIndex && step !== 'complete';
                const isPending = idx > pipelineIndex && step !== 'complete';

                return (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-lg border flex items-center gap-2.5 transition-all ${
                      isFinished
                        ? 'bg-zinc-950 border-emerald-900/40 text-emerald-300'
                        : isCurrent
                        ? 'bg-cyan-950/40 border-cyan-700/80 text-cyan-200'
                        : 'bg-zinc-950/40 border-zinc-850 text-zinc-500'
                    }`}
                  >
                    {isFinished && <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />}
                    {isCurrent && <Loader2 size={15} className="animate-spin text-cyan-400 shrink-0" />}
                    {isPending && <Circle size={15} className="text-zinc-600 shrink-0" />}
                    <span className="font-medium truncate">{stage.name}</span>
                  </div>
                );
              })}
            </div>

            {/* Terminal Live Log Stream */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden font-mono text-xs">
              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400">
                <div className="flex items-center gap-2">
                  <Terminal size={13} className="text-cyan-400" />
                  <span>Pipeline Execution Stream</span>
                </div>
                <span className="text-zinc-500">worker-node-us-east-1a</span>
              </div>
              <div className="p-3.5 h-44 overflow-y-auto space-y-1 text-zinc-300 leading-relaxed font-mono text-[11px]">
                {pipelineLogs.map((log, lIdx) => (
                  <div key={lIdx} className="flex items-start gap-2">
                    <span className="text-cyan-500 shrink-0">&gt;</span>
                    <span className="text-zinc-300">{log}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Complete Action Button */}
            {step === 'complete' && (
              <div className="mt-6 pt-4 border-t border-zinc-800 flex items-center justify-between">
                <div className="text-xs text-zinc-400 font-sans">
                  Repository index is live and ready for engineering queries.
                </div>
                <button
                  onClick={handleFinishAndOpen}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-mono font-bold text-xs transition-colors shadow-lg hover:shadow-emerald-500/20"
                >
                  <span>View Repository</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
