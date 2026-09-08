import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import {
  GitPullRequest,
  GitBranch,
  GitCommit,
  ArrowLeft,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  FileCode,
  FileDiff,
  Activity,
  Layers,
  Network,
  Info,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Code2,
  Sliders,
  AlertCircle
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { pullRequestService } from "../services/pullRequestService";
import { RiskBadge } from "../components/common/RiskBadge";
import { QualityGateBadge } from "./PullRequestsPage";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/common/EmptyState";

/**
 * Visual Quality Gate Banner
 */
function QualityGateBanner({ gate, summary, decisionReasons = [] }) {
  const normalized = (gate || "APPROVED").toUpperCase();

  const configs = {
    APPROVED: {
      bg: "from-emerald-950/40 to-zinc-950 border-emerald-800/60 text-emerald-300",
      icon: CheckCircle2,
      title: "Quality Gate Passed",
      desc: "All deterministic safety checks and heuristic risk thresholds are satisfied."
    },
    WARNING: {
      bg: "from-amber-950/40 to-zinc-950 border-amber-800/60 text-amber-300",
      icon: AlertTriangle,
      title: "Quality Gate Warning",
      desc: "Moderate heuristic risk or elevated complexity detected. Peer inspection recommended."
    },
    CHANGES_REQUESTED: {
      bg: "from-orange-950/40 to-zinc-950 border-orange-800/60 text-orange-300",
      icon: ShieldAlert,
      title: "Quality Gate Changes Requested",
      desc: "High risk signals or newly introduced code smells require resolution."
    },
    BLOCKED: {
      bg: "from-rose-950/40 to-zinc-950 border-rose-800/60 text-rose-300",
      icon: ShieldAlert,
      title: "Quality Gate Blocked",
      desc: "Critical structural regressions or high-severity findings violate quality thresholds."
    }
  };

  const current = configs[normalized] || configs.APPROVED;
  const Icon = current.icon;

  return (
    <div className={`rounded-xl border bg-gradient-to-r p-5 ${current.bg}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2 rounded-lg bg-zinc-950/80 border border-current shrink-0">
            <Icon size={22} className="text-current" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-bold font-mono text-zinc-100 uppercase tracking-wide">
                {current.title}
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-950/80 border border-current">
                {normalized}
              </span>
            </div>
            <p className="text-xs text-zinc-300 mt-1 font-sans">
              {summary || current.desc}
            </p>

            {Array.isArray(decisionReasons) && decisionReasons.length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {decisionReasons.map((reason, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-[11px] font-mono text-zinc-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Visual Risk Gauge Card
 */
function RiskScoreCard({ score, category, breakdown }) {
  const getScoreColor = (val) => {
    if (val < 35) return { stroke: "#10b981", text: "text-emerald-400" };
    if (val < 60) return { stroke: "#f59e0b", text: "text-amber-400" };
    if (val < 85) return { stroke: "#f97316", text: "text-orange-400" };
    return { stroke: "#f43f5e", text: "text-rose-400" };
  };

  const effectiveScore = typeof score === "number" ? Math.round(score) : 0;
  const { stroke, text } = getScoreColor(effectiveScore);

  const radius = 38;
  const strokeWidth = 6;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (effectiveScore / 100) * circumference;

  return (
    <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider">
          PR Risk Assessment
        </span>
        {category && <RiskBadge level={category} size="sm" />}
      </div>

      <div className="flex items-center gap-4 my-2">
        <div className="relative flex items-center justify-center shrink-0">
          <svg width="92" height="92" className="transform -rotate-90">
            <circle
              cx="46"
              cy="46"
              r={radius}
              stroke="#27272a"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            <circle
              cx="46"
              cy="46"
              r={radius}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center text-center">
            <span className={`font-mono font-bold text-xl ${text}`}>
              {effectiveScore}
            </span>
            <span className="text-[9px] font-mono text-zinc-500 uppercase -mt-1">/100</span>
          </div>
        </div>

        <div className="space-y-1 text-xs">
          <div className="font-medium text-zinc-200">
            {effectiveScore < 35
              ? "Low Risk Profile"
              : effectiveScore < 60
              ? "Moderate Risk Profile"
              : effectiveScore < 85
              ? "High Cognitive Load"
              : "Critical Risk Profile"}
          </div>
          <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
            Deterministic multi-signal heuristic calculated across churn, smells, and graph blast radius.
          </p>
        </div>
      </div>

      {breakdown && (
        <div className="mt-3 pt-3 border-t border-zinc-800 grid grid-cols-3 gap-2 text-[10px] font-mono text-zinc-400">
          <div>
            <span className="text-zinc-500 block">Churn:</span>
            <span className="text-zinc-200">+{breakdown.churnContribution || 0} pts</span>
          </div>
          <div>
            <span className="text-zinc-500 block">Smells:</span>
            <span className="text-zinc-200">+{breakdown.codeSmellsContribution || 0} pts</span>
          </div>
          <div>
            <span className="text-zinc-500 block">Blast Radius:</span>
            <span className="text-zinc-200">+{breakdown.blastRadiusContribution || 0} pts</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Unified Diff Patch Viewer with line syntax highlighting
 */
function DiffPatchViewer({ patch }) {
  if (!patch) {
    return (
      <div className="p-4 text-center text-xs font-mono text-zinc-500 bg-zinc-950/60 rounded border border-zinc-850">
        No diff text recorded for this file change.
      </div>
    );
  }

  const lines = patch.split("\n");

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 font-mono text-[11px] overflow-x-auto leading-relaxed max-h-96">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            const isAddition = line.startsWith("+") && !line.startsWith("+++");
            const isDeletion = line.startsWith("-") && !line.startsWith("---");
            const isHunk = line.startsWith("@@");

            let rowClass = "text-zinc-300";
            if (isAddition) rowClass = "bg-emerald-950/30 text-emerald-300";
            if (isDeletion) rowClass = "bg-rose-950/30 text-rose-300";
            if (isHunk) rowClass = "bg-cyan-950/20 text-cyan-400 font-semibold";

            return (
              <tr key={idx} className={`hover:bg-zinc-900/50 ${rowClass}`}>
                <td className="w-10 px-2.5 py-0.5 text-right select-none text-zinc-600 border-r border-zinc-850 text-[10px]">
                  {idx + 1}
                </td>
                <td className="px-3 py-0.5 whitespace-pre">
                  {line}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PullRequestDetailPage() {
  const { id, repoId: paramRepoId } = useParams();
  const [searchParams] = useSearchParams();
  const { currentRepo, repositories, addToast } = useApp();
  const navigate = useNavigate();

  // Determine repository ID
  const activeRepoId = paramRepoId || searchParams.get("repoId") || currentRepo?.id;

  const [prData, setPrData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState("overview"); // 'overview' | 'diffs' | 'blast' | 'findings'
  const [selectedDiffIndex, setSelectedDiffIndex] = useState(0);
  const [copiedSha, setCopiedSha] = useState(null);

  // Fetch PR details
  const loadPrDetails = useCallback(async () => {
    if (!activeRepoId || !id) {
      setError("Repository ID or Pull Request ID missing.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await pullRequestService.getPullRequestById(activeRepoId, id);
      setPrData(data);
    } catch (err) {
      setError(err.message || "Failed to load pull request details.");
    } finally {
      setIsLoading(false);
    }
  }, [activeRepoId, id]);

  useEffect(() => {
    loadPrDetails();
  }, [loadPrDetails]);

  // Handle manual re-analyze
  const handleReanalyze = async () => {
    if (!activeRepoId || !prData?.pullRequest) return;

    setIsReanalyzing(true);
    try {
      const pr = prData.pullRequest;
      await pullRequestService.analyzePullRequest(activeRepoId, {
        prNumber: pr.prNumber,
        title: pr.title,
        sourceBranch: pr.sourceBranch,
        targetBranch: pr.targetBranch,
        sourceCommitSha: pr.sourceCommitSha,
        targetCommitSha: pr.targetCommitSha,
        forceReanalyze: true
      });

      addToast(`Re-analysis triggered for PR #${pr.prNumber}`, "success");
      await loadPrDetails();
    } catch (err) {
      addToast(err.message || "Re-analysis failed.", "error");
    } finally {
      setIsReanalyzing(false);
    }
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedSha(key);
    setTimeout(() => setCopiedSha(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <div className="h-6 w-36 bg-zinc-900 rounded animate-pulse" />
        <LoadingSkeleton rows={6} height="h-28" />
      </div>
    );
  }

  if (error || !prData?.pullRequest) {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <Link
          to="/pulls"
          className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-cyan-300 transition-colors"
        >
          <ArrowLeft size={13} />
          <span>Back to Pull Requests</span>
        </Link>
        <ErrorState
          title="Pull Request Not Found"
          error={error || "Could not retrieve details for the requested pull request."}
          onRetry={loadPrDetails}
        />
      </div>
    );
  }

  const { pullRequest: pr, analysis, diffs } = prData;
  const churn = analysis?.churnMetrics || {};
  const blast = analysis?.blastRadius || {};
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const scoreBreakdown = analysis?.scoreBreakdown || churn?.scoreBreakdown || null;
  const decisionReasons = analysis?.decisionReasons || churn?.decisionReasons || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <Link
            to="/pulls"
            className="p-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-cyan-300 hover:bg-zinc-850 transition-colors"
            title="Back to PR list"
          >
            <ArrowLeft size={15} />
          </Link>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-cyan-400">
                #{pr.prNumber}
              </span>
              <h1 className="text-lg font-bold font-mono text-zinc-100">
                {pr.title}
              </h1>
              <span
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${
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

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 font-mono mt-1">
              <span>by {pr.author}</span>
              <span>•</span>
              <div className="inline-flex items-center gap-1.5 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800 text-[11px]">
                <GitBranch size={11} className="text-zinc-500" />
                <span className="text-zinc-300">{pr.sourceBranch}</span>
                <span className="text-zinc-600">→</span>
                <span className="text-zinc-400">{pr.targetBranch}</span>
              </div>
              {pr.createdAt && (
                <>
                  <span>•</span>
                  <span className="text-zinc-500 font-sans text-[11px]">
                    Opened {new Date(pr.createdAt).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right action: Re-analyze PR */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleReanalyze}
            disabled={isReanalyzing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-850 hover:bg-zinc-800 text-zinc-200 text-xs font-mono border border-zinc-750 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={isReanalyzing ? "animate-spin text-cyan-400" : ""} />
            <span>{isReanalyzing ? "Analyzing..." : "Re-Analyze"}</span>
          </button>
        </div>
      </div>

      {/* Commit SHAs quick reference */}
      <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <GitCommit size={13} className="text-zinc-500" />
            <span className="text-zinc-500">Head SHA:</span>
            <span className="text-zinc-200 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-850">
              {pr.sourceCommitSha?.slice(0, 8) || "head"}
            </span>
            <button
              onClick={() => copyToClipboard(pr.sourceCommitSha, "head")}
              className="p-1 text-zinc-500 hover:text-zinc-300"
              title="Copy commit SHA"
            >
              {copiedSha === "head" ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <GitCommit size={13} className="text-zinc-500" />
            <span className="text-zinc-500">Base SHA:</span>
            <span className="text-zinc-200 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-850">
              {pr.targetCommitSha?.slice(0, 8) || "base"}
            </span>
            <button
              onClick={() => copyToClipboard(pr.targetCommitSha, "base")}
              className="p-1 text-zinc-500 hover:text-zinc-300"
              title="Copy base SHA"
            >
              {copiedSha === "base" ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {analysis?.completedAt && (
          <div className="text-[11px] text-zinc-500 font-sans">
            Engine Analysis completed at {new Date(analysis.completedAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Hero Section: Quality Gate Banner */}
      {analysis && (
        <QualityGateBanner
          gate={analysis.qualityGate}
          summary={analysis.summary}
          decisionReasons={decisionReasons}
        />
      )}

      {/* Grid: Risk Score Card & Churn Metric KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Risk Gauge Card */}
        <RiskScoreCard
          score={analysis?.riskScore}
          category={analysis?.riskCategory}
          breakdown={scoreBreakdown}
        />

        {/* Churn Breakdown */}
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col justify-between">
          <span className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-2 block">
            Diff Churn Statistics
          </span>

          <div className="grid grid-cols-2 gap-3 my-1">
            <div>
              <span className="text-[11px] font-mono text-emerald-400 block">Additions (+)</span>
              <span className="text-2xl font-bold font-mono text-zinc-100">
                +{churn.totalAdditions ?? churn.additions ?? 0}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-rose-400 block">Deletions (-)</span>
              <span className="text-2xl font-bold font-mono text-zinc-100">
                -{churn.totalDeletions ?? churn.deletions ?? 0}
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800 flex items-center justify-between text-xs font-mono">
            <span className="text-zinc-500">Total Churn:</span>
            <span className="text-zinc-200 font-semibold">{churn.totalChurn ?? 0} lines</span>
          </div>
        </div>

        {/* Structural Scope & Downstream Reach */}
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col justify-between">
          <span className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-2 block">
            Downstream Impact Scope
          </span>

          <div className="grid grid-cols-2 gap-3 my-1">
            <div>
              <span className="text-[11px] font-mono text-zinc-400 block">Files Modified</span>
              <span className="text-2xl font-bold font-mono text-zinc-100">
                {churn.changedFileCount ?? diffs.length ?? 0}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-cyan-400 block">Blast Radius</span>
              <span className="text-2xl font-bold font-mono text-cyan-300">
                {blast.affectedFiles?.length ?? 0}
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800 flex items-center justify-between text-xs font-mono">
            <span className="text-zinc-500">Max Blast Depth:</span>
            <span className="text-zinc-200 font-semibold">{blast.maxDepthReached ?? 0} levels</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "overview"
              ? "border-cyan-400 text-cyan-300 font-semibold"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Activity size={13} />
          <span>Review Findings ({findings.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("diffs")}
          className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "diffs"
              ? "border-cyan-400 text-cyan-300 font-semibold"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <FileDiff size={13} />
          <span>Changed Files ({diffs.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("blast")}
          className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "blast"
              ? "border-cyan-400 text-cyan-300 font-semibold"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Network size={13} />
          <span>Blast Radius ({blast.affectedFiles?.length || 0})</span>
        </button>
      </div>

      {/* Tab 1: Deterministic Review Findings */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-semibold text-zinc-300 uppercase tracking-wider">
              Automated Code Review Findings
            </h3>
            <span className="text-[11px] text-zinc-500 font-sans">
              Rule-based empirical findings with non-causal defect propensity observations
            </span>
          </div>

          {findings.length === 0 ? (
            <div className="p-8 text-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40">
              <ShieldCheck size={28} className="mx-auto text-emerald-400 mb-2" />
              <h4 className="text-sm font-semibold text-zinc-200 font-mono">
                No Automated Review Findings
              </h4>
              <p className="text-xs text-zinc-400 mt-1 font-sans max-w-sm mx-auto">
                All static checks passed. No new code smells, excessive complexity deltas, or breaking changes identified.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {findings.map((finding, idx) => {
                const sev = (finding.severity || "info").toLowerCase();
                const sevColor =
                  sev === "critical"
                    ? "bg-rose-950/70 text-rose-300 border-rose-800/70"
                    : sev === "high"
                    ? "bg-orange-950/70 text-orange-300 border-orange-800/70"
                    : sev === "warning" || sev === "medium"
                    ? "bg-amber-950/70 text-amber-300 border-amber-800/70"
                    : "bg-cyan-950/70 text-cyan-300 border-cyan-800/70";

                return (
                  <div
                    key={idx}
                    className="p-4 rounded-lg bg-zinc-900/60 border border-zinc-800 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border uppercase ${sevColor}`}>
                          {finding.severity || "INFO"}
                        </span>
                        <span className="text-xs font-mono font-bold text-zinc-200">
                          {finding.findingType || finding.rule || "Automated Finding"}
                        </span>
                      </div>

                      {finding.filePath && (
                        <div className="text-[11px] font-mono text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-850">
                          {finding.filePath}
                          {finding.line ? `:${finding.line}` : ""}
                          {finding.symbolName ? ` • ${finding.symbolName}` : ""}
                        </div>
                      )}
                    </div>

                    {/* Evidence & Explanation */}
                    <div className="space-y-1.5 text-xs">
                      {finding.evidence && (
                        <div className="p-2 rounded bg-zinc-950/80 border border-zinc-850 font-mono text-[11px] text-zinc-300">
                          <span className="text-zinc-500 select-none block mb-0.5 text-[10px] uppercase">Empirical Evidence:</span>
                          {finding.evidence}
                        </div>
                      )}

                      {finding.explanation && (
                        <p className="text-zinc-300 font-sans leading-relaxed">
                          {finding.explanation}
                        </p>
                      )}
                    </div>

                    {/* Suggested Action */}
                    {finding.suggestedAction && (
                      <div className="pt-2 border-t border-zinc-800/80 flex items-start gap-2 text-xs">
                        <span className="font-mono text-[10px] uppercase px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/50 shrink-0 mt-0.5">
                          Remediation
                        </span>
                        <span className="text-zinc-300 font-sans">{finding.suggestedAction}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Changed Files & Diff Viewer */}
      {activeTab === "diffs" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-semibold text-zinc-300 uppercase tracking-wider">
              Diff Inspector & Changed Files
            </h3>
            <span className="text-[11px] text-zinc-500 font-sans">
              Line-level unified diffs with touched symbols and change types
            </span>
          </div>

          {diffs.length === 0 ? (
            <div className="p-8 text-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40">
              <FileCode size={28} className="mx-auto text-zinc-600 mb-2" />
              <h4 className="text-sm font-semibold text-zinc-300 font-mono">
                No Changed Files Recorded
              </h4>
              <p className="text-xs text-zinc-500 mt-1 font-sans">
                The analysis was executed without an inline diff text or all changes were empty.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* File list column */}
              <div className="lg:col-span-1 space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
                {diffs.map((diff, index) => {
                  const isSelected = selectedDiffIndex === index;
                  const changeType = (diff.changeType || "modified").toLowerCase();

                  return (
                    <button
                      key={diff.id || index}
                      onClick={() => setSelectedDiffIndex(index)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        isSelected
                          ? "bg-zinc-900 border-cyan-500/60 shadow-xs"
                          : "bg-zinc-950/60 border-zinc-800/80 hover:bg-zinc-900/60 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-mono font-semibold text-zinc-200 truncate">
                          {diff.filePath?.split("/").pop()}
                        </span>
                        <span
                          className={`text-[9px] font-mono uppercase px-1.5 py-0.2 rounded border ${
                            changeType === "added"
                              ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/60"
                              : changeType === "deleted"
                              ? "bg-rose-950/60 text-rose-300 border-rose-800/60"
                              : "bg-zinc-800 text-zinc-300 border-zinc-700"
                          }`}
                        >
                          {changeType}
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-zinc-500 truncate mb-1.5">
                        {diff.filePath}
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400">+{diff.additions || 0}</span>
                          <span className="text-rose-400">-{diff.deletions || 0}</span>
                        </div>
                        {Array.isArray(diff.touchedSymbols) && diff.touchedSymbols.length > 0 && (
                          <span className="text-cyan-400">
                            {diff.touchedSymbols.length} symbol(s)
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Diff inspection column */}
              <div className="lg:col-span-2 space-y-3">
                {diffs[selectedDiffIndex] ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono text-xs text-zinc-200 font-semibold truncate">
                        {diffs[selectedDiffIndex].filePath}
                      </div>
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-emerald-400">+{diffs[selectedDiffIndex].additions || 0}</span>
                        <span className="text-rose-400">-{diffs[selectedDiffIndex].deletions || 0}</span>
                      </div>
                    </div>

                    {/* Touched Symbols list */}
                    {Array.isArray(diffs[selectedDiffIndex].touchedSymbols) && diffs[selectedDiffIndex].touchedSymbols.length > 0 && (
                      <div className="p-2.5 rounded bg-zinc-900/40 border border-zinc-800/80">
                        <span className="text-[10px] font-mono text-zinc-500 block uppercase mb-1">
                          Touched AST Symbols:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {diffs[selectedDiffIndex].touchedSymbols.map((sym, sIdx) => (
                            <span
                              key={sIdx}
                              className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-cyan-300"
                            >
                              {typeof sym === "string" ? sym : sym.name || JSON.stringify(sym)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Patch Viewer */}
                    <DiffPatchViewer patch={diffs[selectedDiffIndex].patch} />
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs font-mono text-zinc-500 bg-zinc-950/60 rounded border border-zinc-850">
                    Select a file on the left to inspect its diff patch.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Blast Radius Inspection */}
      {activeTab === "blast" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-semibold text-zinc-300 uppercase tracking-wider">
              Downstream Architectural Blast Radius
            </h3>
            <span className="text-[11px] text-zinc-500 font-sans">
              Graph traversal of callers and importing modules affected by this PR
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-[10px] font-mono text-zinc-500 block uppercase">Seed Files</span>
              <span className="text-xl font-bold font-mono text-zinc-100 mt-1 block">
                {blast.seedNodes?.length || diffs.length || 0}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-[10px] font-mono text-cyan-400 block uppercase">Direct Dependents</span>
              <span className="text-xl font-bold font-mono text-cyan-300 mt-1 block">
                {blast.directlyAffected?.length || 0}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-[10px] font-mono text-orange-400 block uppercase">Transitive Dependents</span>
              <span className="text-xl font-bold font-mono text-orange-300 mt-1 block">
                {blast.transitivelyAffected?.length || 0}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <span className="text-[10px] font-mono text-zinc-500 block uppercase">Max Traversal Depth</span>
              <span className="text-xl font-bold font-mono text-zinc-100 mt-1 block">
                {blast.maxDepthReached || 0}
              </span>
            </div>
          </div>

          {/* Affected downstream files table */}
          {Array.isArray(blast.affectedFiles) && blast.affectedFiles.length > 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
              <div className="p-3 bg-zinc-900 border-b border-zinc-800 font-mono text-xs font-semibold text-zinc-300">
                Downstream Consumer Files ({blast.affectedFiles.length})
              </div>
              <div className="divide-y divide-zinc-800/80 max-h-96 overflow-y-auto">
                {/* Check directly affected entries */}
                {Array.isArray(blast.directlyAffected) && blast.directlyAffected.map((node, i) => (
                  <div key={`dir-${i}`} className="p-3 flex items-center justify-between gap-3 text-xs font-mono hover:bg-zinc-850/50">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                        DIRECT (D1)
                      </span>
                      <span className="text-zinc-200 truncate">{node.filePath}</span>
                    </div>

                    <div className="flex items-center gap-3 text-zinc-500 text-[11px] shrink-0">
                      <span>Depends on: <span className="text-zinc-300">{node.dependedOn?.split("/").pop()}</span></span>
                      <span className="uppercase text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                        {node.relationshipType || "IMPORTS"}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Transitive entries */}
                {Array.isArray(blast.transitivelyAffected) && blast.transitivelyAffected.map((node, i) => (
                  <div key={`trans-${i}`} className="p-3 flex items-center justify-between gap-3 text-xs font-mono hover:bg-zinc-850/50">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700">
                        TRANSITIVE (D{node.depth || 2})
                      </span>
                      <span className="text-zinc-300 truncate">{node.filePath}</span>
                    </div>

                    <div className="flex items-center gap-3 text-zinc-500 text-[11px] shrink-0">
                      <span>Via: <span className="text-zinc-400">{node.dependedOn?.split("/").pop()}</span></span>
                      <span className="uppercase text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                        {node.relationshipType || "IMPORTS"}
                      </span>
                    </div>
                  </div>
                ))}

                {/* If affectedFiles has items but direct/transitive empty */}
                {(!blast.directlyAffected || blast.directlyAffected.length === 0) &&
                  (!blast.transitivelyAffected || blast.transitivelyAffected.length === 0) &&
                  blast.affectedFiles.map((file, i) => (
                    <div key={i} className="p-3 flex items-center justify-between text-xs font-mono text-zinc-300">
                      <span>{file}</span>
                      <span className="text-zinc-500 text-[11px]">Downstream Dependent</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40">
              <Network size={28} className="mx-auto text-zinc-600 mb-2" />
              <h4 className="text-sm font-semibold text-zinc-300 font-mono">
                Zero Downstream Blast Radius
              </h4>
              <p className="text-xs text-zinc-500 mt-1 font-sans max-w-sm mx-auto">
                No external modules import or call the symbols touched by this pull request. The changes are isolated.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

