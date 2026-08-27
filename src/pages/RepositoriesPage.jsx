import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { repositoryService } from '../services/repositoryService';
import {
  FolderGit2,
  PlusCircle,
  Search,
  Filter,
  CheckCircle2,
  ShieldAlert,
  Activity,
  ArrowRight,
  GitBranch,
  Star,
  ExternalLink
} from 'lucide-react';
import { SearchBar } from '../components/common/SearchBar';
import { HealthScoreGauge } from '../components/common/MetricCard';
import { RiskBadge } from '../components/common/RiskBadge';
import { Link, useNavigate } from 'react-router-dom';

export function RepositoriesPage() {
  const { selectRepoById, currentRepo } = useApp();
  const [repositories, setRepositories] = useState([]);
  const [search, setSearch] = useState('');
  const [languageFilter, setLanguageFilter] = useState('All');
  const [sortBy, setSortBy] = useState('health');
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadRepos() {
      setIsLoading(true);
      const data = await repositoryService.getRepositories({
        search,
        language: languageFilter,
        sortBy
      });
      setRepositories(data);
      setIsLoading(false);
    }
    loadRepos();
  }, [search, languageFilter, sortBy]);

  const languages = ['All', 'TypeScript', 'Go', 'Rust'];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <FolderGit2 size={20} className="text-cyan-400" />
            Your Repositories
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Connected GitHub repositories under continuous engineering intelligence analysis.
          </p>
        </div>

        <Link
          to="/connect"
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-md bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold font-mono text-xs transition-colors shadow-sm"
        >
          <PlusCircle size={15} />
          <span>Connect Repository</span>
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search repositories by name or description..."
          className="w-full sm:w-80"
        />

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {/* Language filter */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-mono text-zinc-400">Language:</span>
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2.5 py-1.5 focus:outline-none font-mono"
            >
              {languages.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-mono text-zinc-400">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2.5 py-1.5 focus:outline-none font-mono"
            >
              <option value="health">Health Score</option>
              <option value="security">Security Score</option>
              <option value="name">Repository Name</option>
            </select>
          </div>
        </div>
      </div>

      {/* Repositories List Grid / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {repositories.map((repo) => {
          const isCurrent = repo.id === currentRepo.id;

          return (
            <div
              key={repo.id}
              className={`p-5 rounded-xl border transition-all flex flex-col justify-between ${
                isCurrent
                  ? 'bg-zinc-900/90 border-cyan-700/80 shadow-lg ring-1 ring-cyan-900/40'
                  : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/80'
              }`}
            >
              <div>
                {/* Card Top: Org + Visibility + Active Pill */}
                <div className="flex items-center justify-between text-xs font-mono mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400">{repo.organization}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                      {repo.visibility}
                    </span>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      Active Selection
                    </span>
                  )}
                </div>

                {/* Repo Name & Desc */}
                <Link
                  to={`/repository/${repo.id}`}
                  className="text-base font-bold font-mono text-zinc-100 hover:text-cyan-300 transition-colors block truncate"
                >
                  {repo.name}
                </Link>
                <p className="text-xs text-zinc-400 mt-1 font-sans line-clamp-2 leading-relaxed">
                  {repo.description}
                </p>

                {/* Scores Grid */}
                <div className="grid grid-cols-3 gap-2 my-4 p-3 rounded-lg bg-zinc-950 border border-zinc-850 font-mono text-center">
                  <div>
                    <span className="text-[10px] text-zinc-400 block uppercase">Health</span>
                    <span className="text-base font-bold text-cyan-400">{repo.metrics.healthScore}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block uppercase">Security</span>
                    <span className="text-base font-bold text-emerald-400">{repo.metrics.securityScore}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block uppercase">Quality</span>
                    <span className="text-base font-bold text-amber-400">{repo.metrics.codeQualityScore}</span>
                  </div>
                </div>
              </div>

              {/* Card Footer: Metadata + Actions */}
              <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-3 text-zinc-400">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    {repo.primaryLanguage}
                  </span>
                  <span className="text-zinc-400">Analyzed {repo.lastAnalyzed}</span>
                </div>

                <div className="flex items-center gap-2">
                  {!isCurrent && (
                    <button
                      onClick={() => selectRepoById(repo.id)}
                      className="px-2.5 py-1 text-xs text-zinc-300 hover:text-cyan-300 hover:bg-zinc-800 rounded transition-colors"
                    >
                      Set Active
                    </button>
                  )}
                  <Link
                    to={`/repository/${repo.id}`}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-750 text-zinc-100 rounded transition-colors"
                  >
                    <span>Overview</span>
                    <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
