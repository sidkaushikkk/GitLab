import React, { useState, useEffect } from 'react';
import { pullRequestService } from '../services/pullRequestService';
import { useApp } from '../context/AppContext';
import {
  GitPullRequest,
  Search,
  Filter,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  GitCommit,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { SearchBar } from '../components/common/SearchBar';
import { RiskBadge } from '../components/common/RiskBadge';
import { useNavigate } from 'react-router-dom';

export function PullRequestsPage({ headless = false }) {
  const { currentRepo } = useApp();
  const [pullRequests, setPullRequests] = useState([]);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadPRs() {
      setIsLoading(true);
      const data = await pullRequestService.getPullRequests({
        search,
        risk: riskFilter,
        status: statusFilter
      });
      setPullRequests(data);
      setIsLoading(false);
    }
    loadPRs();
  }, [search, riskFilter, statusFilter, currentRepo.id]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header — hidden when embedded inside RepositoryDetailPage */}
      {!headless && (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <GitPullRequest size={20} className="text-cyan-400" />
            Pull Request Intelligence
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            AI risk classification, automated code reviews, diff inspections, and architectural blast radius maps.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            Open PRs: <strong className="text-cyan-300">{pullRequests.filter(p => p.status === 'Open').length}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-rose-950/40 border border-rose-900/40 text-rose-300">
            High Risk: <strong>{pullRequests.filter(p => p.riskLevel === 'HIGH').length}</strong>
          </span>
        </div>
      </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search PRs by title, author, or branch..."
          className="w-full sm:w-80"
        />

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-mono text-zinc-400">Risk:</span>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2 py-1.5 focus:outline-none font-mono"
            >
              <option value="ALL">All Risks</option>
              <option value="HIGH">High Risk</option>
              <option value="MEDIUM">Medium Risk</option>
              <option value="LOW">Low Risk</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[11px] font-mono text-zinc-400">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2 py-1.5 focus:outline-none font-mono"
            >
              <option value="ALL">All Status</option>
              <option value="Open">Open</option>
              <option value="Merged">Merged</option>
            </select>
          </div>
        </div>
      </div>

      {/* Pull Requests List */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800 overflow-hidden">
        {pullRequests.map((pr) => (
          <div
            key={pr.id}
            onClick={() => navigate(`/pulls/${pr.id}`)}
            className="p-4 sm:p-5 hover:bg-zinc-850/60 cursor-pointer transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
          >
            <div className="flex items-start gap-3.5 min-w-0">
              <img
                src={pr.author.avatar}
                alt={pr.author.name}
                className="w-8 h-8 rounded-full border border-zinc-700 object-cover shrink-0 mt-0.5"
              />

              <div className="min-w-0">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-cyan-400 font-bold">#{pr.number}</span>
                  <span className="text-zinc-100 font-semibold truncate group-hover:text-cyan-300 transition-colors">
                    {pr.title}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    pr.status === 'Open' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-purple-950 text-purple-300 border border-purple-800'
                  }`}>
                    {pr.status}
                  </span>
                </div>

                <p className="text-xs text-zinc-400 font-sans mt-1 line-clamp-1">
                  {pr.summary}
                </p>

                <div className="flex flex-wrap items-center gap-3 mt-2 font-mono text-[11px] text-zinc-400">
                  <span>Author: {pr.author.name}</span>
                  <span>-</span>
                  <span>{pr.metrics.filesChanged} files changed</span>
                  <span>-</span>
                  <span className="text-emerald-400">+{pr.metrics.linesAdded}</span>
                  <span className="text-rose-400">-{pr.metrics.linesRemoved}</span>
                  <span>-</span>
                  <span>{pr.metrics.apisAffected} APIs impacted</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-800">
              <div className="flex flex-col items-end">
                <RiskBadge level={pr.riskLevel} size="md" />
                <span className="text-[10px] font-mono text-zinc-500 mt-1">
                  Score: {pr.riskScore}/100
                </span>
              </div>

              <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 group-hover:text-cyan-300 group-hover:bg-zinc-750 transition-colors">
                <ArrowRight size={16} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
