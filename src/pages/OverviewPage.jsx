import React, { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { analysisService } from "../services/analysisService";
import {
  Activity,
  ShieldCheck,
  Code2,
  Clock,
  Zap,
  RefreshCw,
  GitBranch,
  ExternalLink,
  ShieldAlert,
  AlertTriangle,
  FileCode,
  ArrowRight,
  TrendingUp,
  Layers,
  PlusCircle,
  FolderGit2
} from "lucide-react";
import { MetricCard } from "../components/common/MetricCard";
import { RiskBadge } from "../components/common/RiskBadge";
import { WillBeIntegratedSoon } from "../components/common/WillBeIntegratedSoon";
import { EmptyState } from "../components/common/EmptyState";
import { Link, useNavigate } from "react-router-dom";

export function OverviewPage({ headless = false, repoId = null }) {
  const { currentRepo, currentBranch, isAnalyzing, triggerAnalyze } = useApp();
  const targetRepoId = repoId || currentRepo?.id;
  const [hotspots, setHotspots] = useState([]);
  const [realMetrics, setRealMetrics] = useState(null);
  const [analysisSummary, setAnalysisSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadData() {
      if (!targetRepoId) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const [hotspotData, summaryData, metricsData] = await Promise.all([
          analysisService.getRiskHotspots(targetRepoId),
          analysisService.getAnalysisSummary(targetRepoId),
          analysisService.getCodeMetrics(targetRepoId)
        ]);
        setHotspots(hotspotData || []);
        setAnalysisSummary(summaryData || null);
        setRealMetrics(metricsData || null);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [targetRepoId]);

  if (!currentRepo && !targetRepoId) {
    return (
      <div className="py-12">
        <EmptyState
          icon={FolderGit2}
          title="No repository selected"
          description="Connect or select a repository to view deterministic code reliability and architecture metrics."
          actionLabel="Connect Repository"
          onAction={() => navigate("/connect")}
        />
      </div>
    );
  }

  const stats = realMetrics?.stats || {};
  const totalFiles = stats.totalFiles !== undefined ? stats.totalFiles : (isLoading ? "..." : 0);
  const linesOfCode = stats.totalLines !== undefined ? stats.totalLines : (isLoading ? "..." : 0);
  const functionsCount = stats.totalFunctions !== undefined ? stats.totalFunctions : (isLoading ? "..." : 0);
  const avgComplexity = stats.avgComplexity !== undefined ? stats.avgComplexity : (isLoading ? "..." : "1.0");
  const maxComplexity = stats.maxComplexity !== undefined ? stats.maxComplexity : (isLoading ? "..." : 1);
  const debtScore = stats.totalDebtScore !== undefined ? `${stats.totalDebtScore} pts` : (isLoading ? "..." : "0 pts");
  const smells = analysisSummary?.codeSmells || [];
  const codeSmellsCount = analysisSummary?.summary?.smells ?? smells.length;

  const criticalSmells = smells.filter(s => (s.severity || "").toUpperCase() === "CRITICAL").length;
  const highSmells = smells.filter(s => (s.severity || "").toUpperCase() === "HIGH").length;
  const mediumSmells = smells.filter(s => (s.severity || "").toUpperCase() === "MEDIUM").length;
  const lowSmells = smells.filter(s => (s.severity || "").toUpperCase() === "LOW").length;

  const hasAnalysis = analysisSummary !== null || realMetrics !== null;
  const healthScore = hasAnalysis
    ? Math.max(10, Math.min(100, Math.round(100 - (Number(avgComplexity) || 1) * 2.5 - codeSmellsCount * 2)))
    : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Bar — hidden when embedded inside RepositoryDetailPage */}
      {!headless && currentRepo && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold font-mono text-zinc-100">{currentRepo.name}</h1>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-850 text-zinc-300 border border-zinc-750">
                {currentRepo.organization}
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 flex items-center gap-1">
                <GitBranch size={12} />
                {currentBranch}
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 hidden sm:flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                AST Deterministic Engine
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              {currentRepo.description || "Connected repository"} - {currentRepo.lastAnalyzed}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={triggerAnalyze}
              disabled={isAnalyzing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold font-mono text-xs transition-colors shadow-sm disabled:opacity-50"
            >
              <RefreshCw size={13} className={isAnalyzing ? "animate-spin" : ""} />
              <span>{isAnalyzing ? "Running Scan..." : "Analyze Again"}</span>
            </button>
            <button
              onClick={() => navigate("/code")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-850 hover:bg-zinc-800 text-zinc-200 font-mono text-xs border border-zinc-750 transition-colors"
            >
              <Code2 size={13} />
              <span>Explore Code</span>
            </button>
          </div>
        </div>
      )}

      {/* High-Level Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <MetricCard
          title="Repository Health"
          value={healthScore !== null ? `${healthScore} / 100` : "Not analyzed"}
          subtitle="Deterministic Maintainability"
          status={healthScore !== null && healthScore > 75 ? "cyan" : "amber"}
          icon={Activity}
          onClick={() => navigate("/code-health")}
        />
        <MetricCard
          title="Security & Smells"
          value={`${codeSmellsCount} findings`}
          subtitle={`${criticalSmells} critical / ${highSmells} high`}
          status={codeSmellsCount > 5 ? "amber" : "emerald"}
          icon={ShieldCheck}
          onClick={() => navigate("/security")}
        />
        <MetricCard
          title="Complexity"
          value={`Avg: ${avgComplexity}`}
          subtitle={`Max complexity: ${maxComplexity}`}
          status={Number(avgComplexity) > 10 ? "rose" : Number(avgComplexity) > 5 ? "amber" : "emerald"}
          icon={Code2}
          onClick={() => navigate("/code-health")}
        />
        <MetricCard
          title="Technical Debt"
          value={debtScore}
          subtitle="Calculated Debt Score"
          status="neutral"
          icon={Clock}
          onClick={() => navigate("/code-health")}
        />
        {/* API Reliability: Unimplemented feature */}
        <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-zinc-400">API Reliability</span>
            <div className="p-1 rounded bg-zinc-800 text-cyan-400">
              <Zap size={13} />
            </div>
          </div>
          <div className="text-xs font-mono text-cyan-400 font-semibold mb-1">
            Will be integrated soon
          </div>
          <div className="text-[11px] text-zinc-500 font-sans">
            Continuous endpoint APM & latency tracking
          </div>
        </div>
      </div>

      {/* Health Over Time Chart + Risk Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Line Chart: Health Over Time -> Will be integrated soon */}
        <div className="lg:col-span-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <TrendingUp size={16} className="text-cyan-400" />
                Health Over Time
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Historical composite health, quality, security, and reliability trajectory.
              </p>
            </div>
          </div>

          <WillBeIntegratedSoon
            title="Historical trajectory tracking will be integrated soon"
            description="Continuous time-series tracking across snapshots and commits is planned. Deterministic snapshot health is displayed above."
            className="my-auto py-12"
          />
        </div>

        {/* Risk Overview Breakdown */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <ShieldAlert size={16} className="text-rose-400" />
              Risk Overview
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Active engineering issues classified by severity level.
            </p>

            <div className="grid grid-cols-2 gap-2.5 mt-4">
              <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/40">
                <span className="text-[10px] font-mono uppercase text-rose-400 block font-semibold">Critical</span>
                <span className="text-2xl font-bold font-mono text-rose-300">{criticalSmells}</span>
                <span className="text-[10px] text-zinc-400 block mt-1">Requires immediate remediation</span>
              </div>
              <div className="p-3 rounded-lg bg-orange-950/30 border border-orange-900/40">
                <span className="text-[10px] font-mono uppercase text-orange-400 block font-semibold">High</span>
                <span className="text-2xl font-bold font-mono text-orange-300">{highSmells}</span>
                <span className="text-[10px] text-zinc-400 block mt-1">High complexity & debt</span>
              </div>
              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-900/40">
                <span className="text-[10px] font-mono uppercase text-amber-400 block font-semibold">Medium</span>
                <span className="text-2xl font-bold font-mono text-amber-300">{mediumSmells}</span>
                <span className="text-[10px] text-zinc-400 block mt-1">Nesting & coupling</span>
              </div>
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-900/40">
                <span className="text-[10px] font-mono uppercase text-emerald-400 block font-semibold">Low</span>
                <span className="text-2xl font-bold font-mono text-emerald-300">{lowSmells}</span>
                <span className="text-[10px] text-zinc-400 block mt-1">Informational suggestions</span>
              </div>
            </div>
          </div>

          <Link
            to="/security"
            className="mt-3 flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-cyan-400 hover:border-zinc-700 transition-colors"
          >
            <span>Inspect All Security Findings</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* Codebase Summary Strip */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
        <h3 className="text-sm font-semibold text-zinc-100 mb-3 flex items-center gap-2">
          <Layers size={16} className="text-cyan-400" />
          Codebase Summary
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 font-mono text-xs divide-y sm:divide-y-0 sm:divide-x divide-zinc-800">
          <div className="pt-2 sm:pt-0 sm:px-3 first:pl-0">
            <span className="text-zinc-500 text-[10px] block uppercase">Total Files</span>
            <span className="text-lg font-bold text-zinc-200">{totalFiles}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Lines of Code</span>
            <span className="text-lg font-bold text-zinc-200">{typeof linesOfCode === "number" ? linesOfCode.toLocaleString() : linesOfCode}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Primary Language</span>
            <span className="text-lg font-bold text-cyan-300">{currentRepo?.primaryLanguage || "Unknown"}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Functions</span>
            <span className="text-lg font-bold text-zinc-200">{functionsCount}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Symbols</span>
            <span className="text-lg font-bold text-zinc-200">{analysisSummary?.summary?.symbols ?? 0}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Relationships</span>
            <span className="text-lg font-bold text-cyan-300">{analysisSummary?.summary?.relationships ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Risk Hotspots + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Risk Hotspots */}
        <div className="lg:col-span-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <AlertTriangle size={16} className="text-orange-400" />
                Risk Hotspots
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Highest risk modules by cyclomatic complexity, code smells, and call fan-out.
              </p>
            </div>
            <Link to="/code-health" className="text-xs font-mono text-cyan-400 hover:underline">
              View All Files
            </Link>
          </div>

          {hotspots.length > 0 ? (
            <div className="space-y-2.5">
              {hotspots.map((item) => (
                <div
                  key={item.id}
                  onClick={() => navigate("/code", { state: { file: item.file } })}
                  className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FileCode size={14} className="text-cyan-400 shrink-0" />
                        <span className="font-mono text-xs font-semibold text-zinc-200 group-hover:text-cyan-300 transition-colors truncate">
                          {item.file}
                        </span>
                        <RiskBadge level={item.riskLevel} size="sm" />
                      </div>
                      <p className="text-xs text-zinc-400 mt-1 font-sans leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mt-2.5 pt-2 border-t border-zinc-850/80 text-[11px] font-mono text-zinc-400">
                    <span>{item.complexity}</span>
                    <span>-</span>
                    <span>{item.issuesCount} findings</span>
                    <span>-</span>
                    <span className="text-zinc-400">{item.category}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center border border-dashed border-zinc-800 rounded-lg text-xs font-mono text-zinc-400">
              {hasAnalysis ? "No high-complexity hotspots detected in current analysis run." : "No analysis run yet. Click Analyze Again to run deterministic scan."}
            </div>
          )}
        </div>

        {/* Recent Activity Feed -> Will be integrated soon */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 mb-3 flex items-center gap-2">
              <Clock size={16} className="text-cyan-400" />
              Recent Activity
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5 mb-4">
              Real-time commit events and automated pipeline audit logs.
            </p>

            <WillBeIntegratedSoon
              title="Activity feed will be integrated soon"
              description="Continuous webhook integration for commit pushes, PR review runs, and deployment alerts will appear here."
              className="py-10"
            />
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-800/80 text-xs font-mono text-zinc-500 text-center">
            Continuous event streaming planned
          </div>
        </div>
      </div>
    </div>
  );
}
