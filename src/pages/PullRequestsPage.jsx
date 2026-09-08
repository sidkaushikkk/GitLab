import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  GitPullRequest,
  GitBranch,
  Search,
  Filter,
  RefreshCw,
  Plus,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  ChevronLeft,
  ChevronRight,
  X,
  Send,
  SlidersHorizontal,
  ExternalLink
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { pullRequestService } from "../services/pullRequestService";
import { RiskBadge } from "../components/common/RiskBadge";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/common/EmptyState";

/**
 * Renders the quality gate indicator badge
 */
export function QualityGateBadge({ gate, size = "md" }) {
  if (!gate) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-850 text-zinc-400 border border-zinc-750">
        <Clock size={11} />
        PENDING
      </span>
    );
  }

  const normalized = gate.toUpperCase();
  const config = {
    APPROVED: {
      color: "bg-emerald-950/70 text-emerald-300 border-emerald-800/70",
      icon: CheckCircle2,
      label: "APPROVED"
    },
    WARNING: {
      color: "bg-amber-950/70 text-amber-300 border-amber-800/70",
      icon: AlertTriangle,
      label: "WARNING"
    },
    CHANGES_REQUESTED: {
      color: "bg-orange-950/70 text-orange-300 border-orange-800/70",
      icon: ShieldAlert,
      label: "CHANGES REQ"
    },
    BLOCKED: {
      color: "bg-rose-950/70 text-rose-300 border-rose-800/70",
      icon: ShieldAlert,
      label: "BLOCKED"
    }
  };

  const item = config[normalized] || {
    color: "bg-zinc-850 text-zinc-300 border-zinc-750",
    icon: ShieldCheck,
    label: normalized
  };
  const Icon = item.icon;

  const sizeClass = size === "sm" ? "px-1.5 py-0.2 text-[10px]" : "px-2 py-0.5 text-xs";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded border font-mono font-semibold tracking-wider ${sizeClass} ${item.color}`}>
      <Icon size={size === "sm" ? 11 : 13} className="shrink-0" />
      <span>{item.label}</span>
    </span>
  );
}

export function PullRequestsPage({ headless = false, repoId = null }) {
  const { currentRepo, repositories, selectRepoById, addToast } = useApp();
  const navigate = useNavigate();

  // Determine active repository (prop or context)
  const activeRepo = useMemo(() => {
    if (repoId) {
      return repositories.find(r => r.id === repoId) || { id: repoId, name: "Repository" };
    }
    return currentRepo;
  }, [repoId, currentRepo, repositories]);

  const [pullRequests, setPullRequests] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, perPage: 15, totalCount: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters and sorting
  const [statusFilter, setStatusFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [sortBy, setSortBy] = useState("updated_at");
  const [sortOrder, setSortOrder] = useState("desc");
  const [searchQuery, setSearchQuery] = useState("");

  // Manual analysis / simulation modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalForm, setModalForm] = useState({
    prNumber: "",
    title: "",
    sourceBranch: "",
    targetBranch: "main",
    diffText: ""
  });

  // Fetch pull requests
  const loadPullRequests = useCallback(async () => {
    if (!activeRepo?.id) {
      setPullRequests([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await pullRequestService.getPullRequests(activeRepo.id, {
        page: pagination.page,
        perPage: pagination.perPage,
        status: statusFilter,
        risk: riskFilter,
        sortBy,
        sortOrder,
        search: searchQuery
      });

      setPullRequests(result.pullRequests || []);
      if (result.pagination) {
        setPagination(prev => ({
          ...prev,
          totalCount: result.pagination.totalCount ?? result.pullRequests.length,
          totalPages: result.pagination.totalPages ?? 1
        }));
      }
    } catch (err) {
      setError(err.message || "Failed to load pull requests.");
      setPullRequests([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeRepo?.id, pagination.page, pagination.perPage, statusFilter, riskFilter, sortBy, sortOrder, searchQuery]);

  useEffect(() => {
    loadPullRequests();
  }, [loadPullRequests]);

  // Aggregate stats from current pull request data
  const stats = useMemo(() => {
    const total = pagination.totalCount || pullRequests.length;
    const openCount = pullRequests.filter(p => p.status === "open").length;
    const highRiskCount = pullRequests.filter(p => p.riskCategory === "HIGH" || p.riskCategory === "CRITICAL").length;
    const blockedCount = pullRequests.filter(p => p.qualityGate === "BLOCKED" || p.qualityGate === "CHANGES_REQUESTED").length;
    return { total, openCount, highRiskCount, blockedCount };
  }, [pullRequests, pagination.totalCount]);

  // Handle Manual PR Analysis Submission
  const handleSubmitSimulation = async (e) => {
    e.preventDefault();
    if (!activeRepo?.id) {
      addToast("Please select a repository first.", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        prNumber: modalForm.prNumber ? parseInt(modalForm.prNumber, 10) : undefined,
        title: modalForm.title.trim() || "Manual Pull Request Analysis",
        sourceBranch: modalForm.sourceBranch.trim() || "feature/update",
        targetBranch: modalForm.targetBranch.trim() || "main",
        diffText: modalForm.diffText.trim()
      };

      const res = await pullRequestService.analyzePullRequest(activeRepo.id, payload);
      addToast(`Analysis completed for PR #${res.pullRequest.prNumber}! Risk: ${res.analysis?.riskCategory || "COMPLETED"}`, "success");
      setIsModalOpen(false);
      setModalForm({ prNumber: "", title: "", sourceBranch: "", targetBranch: "main", diffText: "" });
      loadPullRequests();

      // Navigate to the PR detail page
      if (res.pullRequest?.id) {
        navigate(`/pulls/${res.pullRequest.id}?repoId=${activeRepo.id}`);
      }
    } catch (err) {
      addToast(err.message || "Failed to run PR analysis.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // If no repository is connected in app
  if (!activeRepo?.id && repositories.length === 0) {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        {!headless && (
          <div className="pb-4 border-b border-zinc-800">
            <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
              <GitPullRequest size={20} className="text-cyan-400" />
              Pull Request Intelligence
            </h1>
          </div>
        )}
        <EmptyState
          icon={GitPullRequest}
          title="No Connected Repositories"
          description="Connect a GitHub or GitLab repository to enable automated PR risk scoring, diff impact analysis, and quality gates."
          actionLabel="Connect Repository"
          onAction={() => navigate("/connect")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      {!headless && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
                <GitPullRequest size={20} className="text-cyan-400" />
                Pull Request Intelligence
              </h1>
              {activeRepo && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-850 text-cyan-300 border border-zinc-750">
                  {activeRepo.name}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              Deterministic risk assessment, quality gates, AST blast radius mapping, and automated code review findings.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {repositories.length > 1 && !repoId && (
              <select
                value={activeRepo?.id || ""}
                onChange={(e) => selectRepoById(e.target.value)}
                className="bg-zinc-900 border border-zinc-750 text-zinc-200 rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-cyan-500"
              >
                {repositories.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold font-mono text-xs transition-colors shadow-sm"
            >
              <Plus size={14} />
              <span>Analyze PR</span>
            </button>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Total PRs</div>
          <div className="text-2xl font-bold font-mono text-zinc-100 mt-1">{stats.total}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5 font-sans">Tracked in repository</div>
        </div>

        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
          <div className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider">Open PRs</div>
          <div className="text-2xl font-bold font-mono text-cyan-300 mt-1">{stats.openCount}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5 font-sans">Awaiting merge/close</div>
        </div>

        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
          <div className="text-[11px] font-mono text-orange-400 uppercase tracking-wider">High Risk</div>
          <div className="text-2xl font-bold font-mono text-orange-300 mt-1">{stats.highRiskCount}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5 font-sans">High / Critical risk category</div>
        </div>

        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
          <div className="text-[11px] font-mono text-rose-400 uppercase tracking-wider">Gate Flagged</div>
          <div className="text-2xl font-bold font-mono text-rose-300 mt-1">{stats.blockedCount}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5 font-sans">Blocked or changes requested</div>
        </div>
      </div>

      {/* Control Bar: Search, Filters, Refresh */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/80">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search PR title, author, or branch..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-zinc-950/70 border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <div className="flex items-center gap-1.5 bg-zinc-950/60 border border-zinc-800 rounded-md px-2 py-1 text-xs">
            <span className="text-[11px] font-mono text-zinc-500">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              className="bg-transparent text-zinc-300 font-mono text-xs focus:outline-none"
            >
              <option value="all" className="bg-zinc-900">All</option>
              <option value="open" className="bg-zinc-900">Open</option>
              <option value="merged" className="bg-zinc-900">Merged</option>
              <option value="closed" className="bg-zinc-900">Closed</option>
            </select>
          </div>

          {/* Risk filter */}
          <div className="flex items-center gap-1.5 bg-zinc-950/60 border border-zinc-800 rounded-md px-2 py-1 text-xs">
            <span className="text-[11px] font-mono text-zinc-500">Risk:</span>
            <select
              value={riskFilter}
              onChange={(e) => {
                setRiskFilter(e.target.value);
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              className="bg-transparent text-zinc-300 font-mono text-xs focus:outline-none"
            >
              <option value="all" className="bg-zinc-900">All Levels</option>
              <option value="LOW" className="bg-zinc-900">Low</option>
              <option value="MEDIUM" className="bg-zinc-900">Medium</option>
              <option value="HIGH" className="bg-zinc-900">High</option>
              <option value="CRITICAL" className="bg-zinc-900">Critical</option>
            </select>
          </div>

          {/* Sort field */}
          <div className="flex items-center gap-1.5 bg-zinc-950/60 border border-zinc-800 rounded-md px-2 py-1 text-xs">
            <span className="text-[11px] font-mono text-zinc-500">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent text-zinc-300 font-mono text-xs focus:outline-none"
            >
              <option value="updated_at" className="bg-zinc-900">Updated</option>
              <option value="created_at" className="bg-zinc-900">Created</option>
              <option value="pr_number" className="bg-zinc-900">PR #</option>
              <option value="risk_score" className="bg-zinc-900">Risk Score</option>
            </select>
            <button
              onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
              title={`Toggle sort order (Current: ${sortOrder.toUpperCase()})`}
              className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 px-1"
            >
              {sortOrder.toUpperCase()}
            </button>
          </div>

          {/* Refresh */}
          <button
            onClick={loadPullRequests}
            disabled={isLoading}
            className="p-1.5 rounded-md bg-zinc-950/60 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Main PR List */}
      {isLoading ? (
        <LoadingSkeleton rows={5} height="h-20" />
      ) : error ? (
        <ErrorState title="Failed to Load Pull Requests" error={error} onRetry={loadPullRequests} />
      ) : pullRequests.length === 0 ? (
        <EmptyState
          icon={GitPullRequest}
          title="No Pull Requests Found"
          description={
            searchQuery || statusFilter !== "all" || riskFilter !== "all"
              ? "No pull requests match the current filters. Try resetting search criteria."
              : "No pull requests have been registered for this repository yet. Use the 'Analyze PR' button to submit an analysis, or configure GitHub/GitLab webhooks."
          }
          actionLabel={searchQuery || statusFilter !== "all" || riskFilter !== "all" ? "Reset Filters" : "Analyze First PR"}
          onAction={() => {
            if (searchQuery || statusFilter !== "all" || riskFilter !== "all") {
              setSearchQuery("");
              setStatusFilter("all");
              setRiskFilter("all");
            } else {
              setIsModalOpen(true);
            }
          }}
        />
      ) : (
        <div className="space-y-3">
          {pullRequests.map((pr) => {
            const hasAnalysis = pr.riskScore !== null || pr.qualityGate !== null;

            return (
              <div
                key={pr.id}
                className="group relative rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900/90 hover:border-zinc-700 transition-all p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Left: PR Information */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-cyan-400">
                      #{pr.prNumber}
                    </span>

                    <Link
                      to={`/pulls/${pr.id}?repoId=${activeRepo.id}`}
                      className="text-sm font-semibold text-zinc-100 hover:text-cyan-300 transition-colors truncate max-w-lg"
                    >
                      {pr.title}
                    </Link>

                    {/* PR Status badge */}
                    <span
                      className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded border ${
                        pr.status === "merged"
                          ? "bg-purple-950/60 text-purple-300 border-purple-800/60"
                          : pr.status === "closed"
                          ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                          : "bg-emerald-950/60 text-emerald-300 border-emerald-800/60"
                      }`}
                    >
                      {pr.status}
                    </span>
                  </div>

                  {/* Branches & Author */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 font-mono">
                    <span className="text-zinc-300 font-sans">by {pr.author}</span>
                    <span className="text-zinc-600">•</span>
                    <div className="inline-flex items-center gap-1.5 bg-zinc-950/80 px-2 py-0.5 rounded border border-zinc-850 text-[11px]">
                      <GitBranch size={11} className="text-zinc-500" />
                      <span className="text-zinc-300 truncate max-w-[140px]">{pr.sourceBranch}</span>
                      <ArrowRight size={10} className="text-zinc-600" />
                      <span className="text-zinc-400 truncate max-w-[140px]">{pr.targetBranch}</span>
                    </div>

                    {pr.updatedAt && (
                      <>
                        <span className="text-zinc-600">•</span>
                        <span className="text-zinc-500 text-[11px] font-sans">
                          Updated {new Date(pr.updatedAt).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Analysis Summary Snippet */}
                  {pr.analysisSummary && (
                    <p className="text-xs text-zinc-400 font-sans line-clamp-1 mt-1">
                      {pr.analysisSummary}
                    </p>
                  )}
                </div>

                {/* Right: Risk Engine Signals & Actions */}
                <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                  {hasAnalysis ? (
                    <div className="flex items-center gap-2.5">
                      {/* Quality Gate Badge */}
                      <QualityGateBadge gate={pr.qualityGate} size="md" />

                      {/* Risk Category & Score */}
                      {pr.riskCategory && (
                        <RiskBadge level={pr.riskCategory} size="md" />
                      )}

                      {typeof pr.riskScore === "number" && (
                        <div className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 font-mono text-xs font-semibold text-zinc-200">
                          {pr.riskScore}
                          <span className="text-[10px] text-zinc-500 font-normal">/100</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs font-mono text-zinc-500 italic">
                      Analysis pending
                    </span>
                  )}

                  <Link
                    to={`/pulls/${pr.id}?repoId=${activeRepo.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-xs font-mono transition-colors group-hover:border-zinc-600 border border-zinc-750"
                  >
                    <span>Inspect</span>
                    <ArrowRight size={13} className="text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            );
          })}

          {/* Pagination Footer */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-zinc-800/80 text-xs font-mono text-zinc-400">
              <div>
                Showing page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} pull requests)
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={pagination.page <= 1 || isLoading}
                  className="p-1.5 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Previous page"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-2 py-1 bg-zinc-950 border border-zinc-850 rounded text-zinc-200">
                  {pagination.page}
                </span>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.min(pagination.totalPages, prev.page + 1) }))}
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                  className="p-1.5 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual PR Analysis Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-xl rounded-xl border border-zinc-750 bg-zinc-950 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-850">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-cyan-950/80 border border-cyan-800/50 text-cyan-400">
                  <GitPullRequest size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-mono text-zinc-100">
                    Analyze Pull Request
                  </h3>
                  <p className="text-xs text-zinc-400 font-sans">
                    Execute deterministic risk scoring and AST blast radius inspection.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 p-1"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmitSimulation} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-zinc-400 mb-1">
                    PR Number (Optional)
                  </label>
                  <input
                    type="number"
                    placeholder="Auto-incremented if empty"
                    value={modalForm.prNumber}
                    onChange={(e) => setModalForm({ ...modalForm, prNumber: e.target.value })}
                    className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-zinc-400 mb-1">
                    PR Title
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Refactor payment gateway"
                    value={modalForm.title}
                    onChange={(e) => setModalForm({ ...modalForm, title: e.target.value })}
                    className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-zinc-400 mb-1">
                    Source Branch
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="feature/branch-name"
                    value={modalForm.sourceBranch}
                    onChange={(e) => setModalForm({ ...modalForm, sourceBranch: e.target.value })}
                    className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-zinc-400 mb-1">
                    Target Branch
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="main"
                    value={modalForm.targetBranch}
                    onChange={(e) => setModalForm({ ...modalForm, targetBranch: e.target.value })}
                    className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-mono text-zinc-400">
                    Unified Diff Text (Optional)
                  </label>
                  <span className="text-[10px] text-zinc-500 font-sans">
                    Standard unified git diff patch
                  </span>
                </div>
                <textarea
                  rows={6}
                  placeholder={`diff --git a/src/index.js b/src/index.js\n--- a/src/index.js\n+++ b/src/index.js\n@@ -10,4 +10,6 @@\n export function calculate() {\n+  const threshold = 100;\n+  return threshold * 2;\n }`}
                  value={modalForm.diffText}
                  onChange={(e) => setModalForm({ ...modalForm, diffText: e.target.value })}
                  className="w-full p-2.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px] leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-850">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-850 text-zinc-300 font-mono text-xs border border-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold font-mono text-xs transition-colors shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Analyzing...</span>
                    </>
                  ) : (
                    <>
                      <Send size={13} />
                      <span>Run Analysis</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

