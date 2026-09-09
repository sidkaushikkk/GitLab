import React, { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { historyService } from "../services/historyService";
import { repositoryService } from "../services/repositoryService";
import {
  Clock,
  GitCommit,
  GitBranch,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Copy,
  Boxes,
  FileCode,
  Activity,
  Layers,
  RefreshCw,
  Minus
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from "recharts";

function formatSnapshotDate(rawDate) {
  if (!rawDate) return "Unknown date";
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatSnapshotShortDate(rawDate) {
  if (!rawDate) return "Unknown date";
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getSnapshotOptionLabel(s) {
  if (!s) return "Unknown snapshot";
  const sha = s.commitSha || s.commit_sha;
  const shortSha = sha ? sha.substring(0, 7) : (s.id ? s.id.substring(0, 8) : "snapshot");
  const rawDate = s.commitTimestamp || s.commit_timestamp || s.createdAt || s.created_at || s.timestamp;
  return `${shortSha} (${formatSnapshotDate(rawDate)})`;
}

export function HistoryComparePage({ headless = false, repoId = null }) {
  const { currentRepo, isAnalyzing } = useApp();
  const targetRepoId = repoId || currentRepo?.id;

  const [historyData, setHistoryData] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [baseSnapshotId, setBaseSnapshotId] = useState("");
  const [targetSnapshotId, setTargetSnapshotId] = useState("");
  const [comparison, setComparison] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isComparing, setIsComparing] = useState(false);

  const loadHistory = React.useCallback(async () => {
    if (!targetRepoId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [hist, snaps] = await Promise.all([
        historyService.getRepositoryHistory(targetRepoId).catch(() => null),
        repositoryService.getSnapshots(targetRepoId).catch(() => [])
      ]);

      if (hist) {
        setHistoryData(hist);
      }

      const snapList = Array.isArray(snaps) ? snaps : (snaps?.snapshots || []);
      const completed = snapList.filter(s => s.status === 'completed');
      setSnapshots(completed);

      // Only auto-select when at least TWO distinct snapshots exist
      if (completed.length >= 2) {
        setBaseSnapshotId(completed[1].id);
        setTargetSnapshotId(completed[0].id);
      } else {
        setBaseSnapshotId("");
        setTargetSnapshotId("");
        setComparison(null);
      }
    } catch (err) {
      console.warn("Failed to load history data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [targetRepoId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Automatically refresh history when an analysis run completes
  const prevAnalyzingRef = React.useRef(isAnalyzing);
  useEffect(() => {
    if (prevAnalyzingRef.current && !isAnalyzing) {
      loadHistory();
    }
    prevAnalyzingRef.current = isAnalyzing;
  }, [isAnalyzing, loadHistory]);

  // Run comparison when snapshots selection changes
  useEffect(() => {
    async function runComparison() {
      // Must have TWO distinct snapshots to run differential comparison
      if (
        !targetRepoId ||
        !baseSnapshotId ||
        !targetSnapshotId ||
        baseSnapshotId === 'none' ||
        targetSnapshotId === 'none' ||
        baseSnapshotId === targetSnapshotId
      ) {
        setComparison(null);
        return;
      }
      setIsComparing(true);
      try {
        const diff = await historyService.compareSnapshots(
          targetRepoId,
          baseSnapshotId,
          targetSnapshotId
        );
        // Only set comparison if it has valid deltas and is not baseline
        if (diff && !diff.isBaseline && diff.deltas) {
          setComparison(diff);
        } else {
          setComparison(null);
        }
      } catch (err) {
        console.warn("Failed to run comparison:", err);
        setComparison(null);
      } finally {
        setIsComparing(false);
      }
    }

    runComparison();
  }, [targetRepoId, baseSnapshotId, targetSnapshotId]);

  const handleBaseChange = (newBaseId) => {
    setBaseSnapshotId(newBaseId);
    if (newBaseId && newBaseId === targetSnapshotId) {
      setTargetSnapshotId("");
      setComparison(null);
    }
  };

  const handleTargetChange = (newTargetId) => {
    setTargetSnapshotId(newTargetId);
    if (newTargetId && newTargetId === baseSnapshotId) {
      setBaseSnapshotId("");
      setComparison(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center font-mono text-xs text-zinc-400">
        <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-cyan-400" />
        Loading longitudinal engineering intelligence...
      </div>
    );
  }

  const timeline = historyData?.timeline || [];
  const state = historyData?.state || 'NO_SNAPSHOTS';

  // Format Recharts data safely with normalized date helper
  const chartData = timeline.map(point => ({
    timestamp: formatSnapshotShortDate(point.timestamp),
    commit: point.commitSha ? point.commitSha.substring(0, 7) : "snap",
    Maintainability: point.metrics?.maintainability ?? 100,
    Complexity: point.metrics?.avgComplexity ?? 0,
    Duplication: Number(((point.metrics?.duplicationRatio ?? 0) * 100).toFixed(1)),
    SecurityScore: point.metrics?.securityScore ?? 100,
    Vulnerabilities: point.metrics?.totalVulnerabilities ?? 0,
    Smells: point.metrics?.totalSmells ?? 0
  }));

  const deltas = comparison?.deltas || null;

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div>
          <h2 className="text-base font-bold font-mono text-zinc-100 flex items-center gap-2">
            <Clock size={18} className="text-cyan-400" />
            Longitudinal Engineering Intelligence
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Deterministic multi-snapshot trajectories, code quality drift, and dependency evolution.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            Recorded Snapshots: <strong className="text-cyan-400">{timeline.length}</strong>
          </span>
          <button
            onClick={loadHistory}
            disabled={isLoading}
            className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors disabled:opacity-50"
            title="Refresh history"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* STATE 1: NO SNAPSHOTS */}
      {state === 'NO_SNAPSHOTS' && (
        <div className="p-12 text-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 font-mono">
          <Clock size={32} className="mx-auto text-zinc-600 mb-2" />
          <h3 className="text-sm font-bold text-zinc-300">No Snapshots Available</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            Ingest and analyze repository snapshots to unlock historical engineering trends.
          </p>
        </div>
      )}

      {/* STATE 2: BASELINE (ONLY 1 SNAPSHOT) */}
      {state === 'BASELINE' && (
        <div className="p-6 rounded-xl border border-dashed border-cyan-800/40 bg-cyan-950/10 font-mono">
          <div className="flex items-center gap-2.5 text-cyan-400 font-semibold text-sm mb-2">
            <Activity size={18} />
            <span>Engineering Baseline Established</span>
          </div>
          <p className="text-xs text-zinc-400 mb-4 max-w-xl">
            {historyData.message || "Historical comparison requires at least two analyzed snapshots. Current snapshot represents your engineering baseline."}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <span className="text-[10px] text-zinc-500 block uppercase">Maintainability</span>
              <span className="text-lg font-bold text-cyan-300 mt-0.5 block">{timeline[0]?.metrics?.maintainability || 100}/100</span>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <span className="text-[10px] text-zinc-500 block uppercase">Average Complexity</span>
              <span className="text-lg font-bold text-rose-400 mt-0.5 block">{timeline[0]?.metrics?.avgComplexity || 0}</span>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <span className="text-[10px] text-zinc-500 block uppercase">Code Duplication</span>
              <span className="text-lg font-bold text-amber-400 mt-0.5 block">{(timeline[0]?.metrics?.duplicationRatio * 100).toFixed(1)}%</span>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <span className="text-[10px] text-zinc-500 block uppercase">Security Posture</span>
              <span className="text-lg font-bold text-emerald-400 mt-0.5 block">{timeline[0]?.metrics?.securityScore || 100}/100</span>
            </div>
          </div>
        </div>
      )}

      {/* STATE 3: TRAJECTORY CHARTS (>= 2 SNAPSHOTS) */}
      {state === 'TRAJECTORY_AVAILABLE' && chartData.length >= 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart 1: Maintainability & Security Posture */}
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 font-mono flex flex-col justify-between">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <TrendingUp size={16} className="text-cyan-400" />
                Health & Reliability Trajectory
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Maintainability score (0-100) vs Security Posture across commits.
              </p>
            </div>

            <div className="h-56 w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="commit" stroke="#71717a" tickLine={false} />
                  <YAxis stroke="#71717a" domain={[0, 100]} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      borderColor: "#27272a",
                      borderRadius: "8px",
                      fontSize: "11px",
                      fontFamily: "JetBrains Mono, monospace"
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="Maintainability" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="SecurityScore" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Complexity & Duplication Ratio */}
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 font-mono flex flex-col justify-between">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Copy size={16} className="text-amber-400" />
                Technical Debt & Duplication Trajectory
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Average AST control-flow complexity vs Code duplication %.
              </p>
            </div>

            <div className="h-56 w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="commit" stroke="#71717a" tickLine={false} />
                  <YAxis stroke="#71717a" tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      borderColor: "#27272a",
                      borderRadius: "8px",
                      fontSize: "11px",
                      fontFamily: "JetBrains Mono, monospace"
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="Complexity" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Duplication" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Comparison Selector Tool */}
      <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/70 font-mono space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <GitCommit size={16} className="text-cyan-400" />
              Differential Snapshot Comparison
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Select two snapshots to compute deterministic code metric deltas and file drift.
            </p>
          </div>

          {/* Selectors */}
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 bg-zinc-950 px-2.5 py-1.5 rounded-md border border-zinc-800">
              <span className="text-zinc-500 text-[10px] uppercase">Base:</span>
              <select
                value={baseSnapshotId}
                onChange={e => handleBaseChange(e.target.value)}
                disabled={snapshots.length < 2}
                className="bg-transparent text-zinc-200 outline-none cursor-pointer disabled:cursor-not-allowed disabled:text-zinc-500"
              >
                <option value="" className="bg-zinc-900 text-zinc-400">Select base snapshot...</option>
                {snapshots.map(s => (
                  <option
                    key={s.id}
                    value={s.id}
                    disabled={s.id === targetSnapshotId}
                    className="bg-zinc-900 text-zinc-200 disabled:text-zinc-600"
                  >
                    {getSnapshotOptionLabel(s)}
                  </option>
                ))}
              </select>
            </div>

            <ArrowRight size={14} className="text-zinc-500" />

            <div className="flex items-center gap-1.5 bg-zinc-950 px-2.5 py-1.5 rounded-md border border-zinc-800">
              <span className="text-zinc-500 text-[10px] uppercase">Target:</span>
              <select
                value={targetSnapshotId}
                onChange={e => handleTargetChange(e.target.value)}
                disabled={snapshots.length < 2}
                className="bg-transparent text-zinc-200 outline-none cursor-pointer disabled:cursor-not-allowed disabled:text-zinc-500"
              >
                <option value="" className="bg-zinc-900 text-zinc-400">Select target snapshot...</option>
                {snapshots.map(s => (
                  <option
                    key={s.id}
                    value={s.id}
                    disabled={s.id === baseSnapshotId}
                    className="bg-zinc-900 text-zinc-200 disabled:text-zinc-600"
                  >
                    {getSnapshotOptionLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Informational states when comparison cannot be run */}
        {snapshots.length < 2 ? (
          <div className="p-4 rounded-lg bg-zinc-950/60 border border-dashed border-zinc-800 text-center">
            <p className="text-xs text-zinc-400">
              Differential comparison requires at least two distinct snapshots. Ingest or analyze another commit to compare changes against the baseline.
            </p>
          </div>
        ) : (!baseSnapshotId || !targetSnapshotId || baseSnapshotId === targetSnapshotId) ? (
          <div className="p-4 rounded-lg bg-zinc-950/60 border border-zinc-800 text-center">
            <p className="text-xs text-zinc-400">
              Select two distinct snapshots above to calculate deterministic code metric deltas and file drift.
            </p>
          </div>
        ) : isComparing ? (
          <div className="p-4 rounded-lg bg-zinc-950/60 border border-zinc-800 text-center">
            <p className="text-xs text-cyan-400 flex items-center justify-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              Computing deterministic snapshot differential...
            </p>
          </div>
        ) : deltas && deltas.metrics ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 pt-2">
            <DeltaCard
              label="LOC Delta"
              delta={deltas.metrics.totalLines.absoluteDelta}
              pct={deltas.metrics.totalLines.percentageDelta}
              neutral
            />
            <DeltaCard
              label="Complexity"
              delta={deltas.metrics.avgComplexity.absoluteDelta}
              pct={deltas.metrics.avgComplexity.percentageDelta}
              invertColor
            />
            <DeltaCard
              label="Code Smells"
              delta={deltas.metrics.totalSmells.absoluteDelta}
              pct={deltas.metrics.totalSmells.percentageDelta}
              invertColor
            />
            <DeltaCard
              label="Duplication"
              delta={(deltas.metrics.duplicationRatio.absoluteDelta * 100).toFixed(1) + "%"}
              pct={deltas.metrics.duplicationRatio.percentageDelta}
              invertColor
            />
            <DeltaCard
              label="Security Score"
              delta={deltas.metrics.securityScore.absoluteDelta}
              pct={deltas.metrics.securityScore.percentageDelta}
            />
            <DeltaCard
              label="Vulnerabilities"
              delta={deltas.metrics.totalVulnerabilities.absoluteDelta}
              pct={deltas.metrics.totalVulnerabilities.percentageDelta}
              invertColor
            />
          </div>
        ) : null}

        {/* Quality Regressions Section */}
        {deltas?.files?.qualityRegressions?.length > 0 && (
          <div className="p-3.5 rounded-lg bg-rose-950/20 border border-rose-900/50 space-y-2">
            <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs">
              <AlertTriangle size={15} />
              <span>Quality Regressions Detected ({deltas.files.qualityRegressions.length} files)</span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {deltas.files.qualityRegressions.map((reg, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between text-xs py-1 border-b border-rose-900/30">
                  <span className="text-zinc-200">{reg.filePath}</span>
                  <div className="flex items-center gap-2 text-[11px] text-rose-300">
                    {reg.regressionFactors.map((rf, rIdx) => (
                      <span key={rIdx} className="px-1.5 py-0.5 rounded bg-rose-900/40">
                        {rf}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* File Changes Breakdown */}
        {deltas?.files?.summary && (
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              File-Level Changes ({deltas.files.summary.modifiedCount} modified, +{deltas.files.summary.addedCount} added, -{deltas.files.summary.removedCount} removed)
            </h4>

            <div className="border border-zinc-800 rounded-lg overflow-hidden max-h-60 overflow-y-auto text-xs">
              <table className="w-full text-left">
                <thead className="bg-zinc-950 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
                  <tr>
                    <th className="p-2.5">File</th>
                    <th className="p-2.5">Change</th>
                    <th className="p-2.5 text-right">Lines</th>
                    <th className="p-2.5 text-right">Complexity</th>
                    <th className="p-2.5 text-right">Smells</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-mono">
                  {deltas.files.modified.slice(0, 15).map((f, i) => (
                    <tr key={`mod-${i}`} className="hover:bg-zinc-850/40">
                      <td className="p-2.5 text-zinc-200">{f.filePath}</td>
                      <td className="p-2.5 text-cyan-400 font-semibold text-[10px]">MODIFIED</td>
                      <td className="p-2.5 text-right text-zinc-300">
                        {f.currentLines} <span className="text-[10px] text-zinc-500">({f.linesDelta >= 0 ? `+${f.linesDelta}` : f.linesDelta})</span>
                      </td>
                      <td className="p-2.5 text-right">
                        <span className={f.complexityDelta > 0 ? "text-rose-400" : f.complexityDelta < 0 ? "text-emerald-400" : "text-zinc-400"}>
                          {f.currentComplexity} ({f.complexityDelta >= 0 ? `+${f.complexityDelta}` : f.complexityDelta})
                        </span>
                      </td>
                      <td className="p-2.5 text-right text-zinc-400">
                        {f.currentSmells} ({f.smellsDelta >= 0 ? `+${f.smellsDelta}` : f.smellsDelta})
                      </td>
                    </tr>
                  ))}
                  {deltas.files.added.slice(0, 10).map((f, i) => (
                    <tr key={`add-${i}`} className="hover:bg-zinc-850/40 bg-emerald-950/10">
                      <td className="p-2.5 text-zinc-200">{f.filePath}</td>
                      <td className="p-2.5 text-emerald-400 font-semibold text-[10px]">ADDED</td>
                      <td className="p-2.5 text-right text-emerald-300">+{f.lines}</td>
                      <td className="p-2.5 text-right text-zinc-400">{f.complexity}</td>
                      <td className="p-2.5 text-right text-zinc-400">{f.smells}</td>
                    </tr>
                  ))}
                  {deltas.files.removed.slice(0, 10).map((f, i) => (
                    <tr key={`rem-${i}`} className="hover:bg-zinc-850/40 bg-rose-950/10">
                      <td className="p-2.5 text-zinc-200 line-through text-zinc-500">{f.filePath}</td>
                      <td className="p-2.5 text-rose-400 font-semibold text-[10px]">REMOVED</td>
                      <td className="p-2.5 text-right text-rose-400">-{f.lines}</td>
                      <td className="p-2.5 text-right text-zinc-500">—</td>
                      <td className="p-2.5 text-right text-zinc-500">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeltaCard({ label, delta, pct, invertColor = false, neutral = false }) {
  const numDelta = typeof delta === 'number' ? delta : parseFloat(delta);
  const isZero = numDelta === 0 || isNaN(numDelta);
  const isPos = numDelta > 0;

  let color = "text-zinc-400";
  if (!isZero && !neutral) {
    if (invertColor) {
      color = isPos ? "text-rose-400" : "text-emerald-400";
    } else {
      color = isPos ? "text-emerald-400" : "text-rose-400";
    }
  }

  return (
    <div className="p-2.5 rounded bg-zinc-950/80 border border-zinc-800 font-mono">
      <span className="text-[10px] text-zinc-500 uppercase block">{label}</span>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className={`text-base font-bold ${color}`}>
          {typeof delta === 'number' ? (delta > 0 ? `+${delta}` : delta) : delta}
        </span>
        {pct !== undefined && pct !== 0 && (
          <span className="text-[10px] text-zinc-500">
            ({pct > 0 ? `+${pct}` : pct}%)
          </span>
        )}
      </div>
    </div>
  );
}
