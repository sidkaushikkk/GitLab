import React, { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { analysisService } from "../services/analysisService";
import { historyService } from "../services/historyService";
import {
  Activity,
  Code2,
  FileCode,
  AlertTriangle,
  Clock,
  Zap,
  TrendingUp,
  BarChart3,
  Search,
  Filter,
  CheckCircle2,
  ArrowRight,
  FolderGit2,
  Copy
} from "lucide-react";
import { MetricCard } from "../components/common/MetricCard";
import { DataTable } from "../components/common/DataTable";
import { RiskBadge } from "../components/common/RiskBadge";
import { SearchBar } from "../components/common/SearchBar";
import { WillBeIntegratedSoon } from "../components/common/WillBeIntegratedSoon";
import { EmptyState } from "../components/common/EmptyState";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from "recharts";
import { useNavigate } from "react-router-dom";

export function CodeHealthPage() {
  const { currentRepo } = useApp();
  const [complexityData, setComplexityData] = useState(null);
  const [healthFiles, setHealthFiles] = useState([]);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("ALL");
  const [filterPreset, setFilterPreset] = useState("ALL");
  const [sortColumn, setSortColumn] = useState("complexity");
  const [sortDirection, setSortDirection] = useState("desc");
  const [duplicationData, setDuplicationData] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [showClones, setShowClones] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadData() {
      if (!currentRepo?.id) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const [complexity, files, dup, hist] = await Promise.all([
          analysisService.getComplexityDistribution(currentRepo?.id),
          analysisService.getCodeHealthFiles({
            search,
            risk: riskFilter,
            sortBy: sortColumn,
            repoId: currentRepo?.id
          }),
          historyService.getSnapshotDuplication(currentRepo?.id).catch(() => null),
          historyService.getRepositoryHistory(currentRepo?.id).catch(() => null)
        ]);
        setComplexityData(complexity);
        setHealthFiles(files || []);
        setDuplicationData(dup);
        setHistoryData(hist);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [search, riskFilter, sortColumn, currentRepo?.id]);

  if (!currentRepo) {
    return (
      <div className="py-12">
        <EmptyState
          icon={FolderGit2}
          title="No repository selected"
          description="Select or connect a repository to view code health and complexity metrics."
          actionLabel="Connect Repository"
          onAction={() => navigate("/connect")}
        />
      </div>
    );
  }

  const totalFiles = healthFiles.length;
  const avgComplexity = totalFiles > 0
    ? (healthFiles.reduce((acc, f) => acc + (f.complexity || 0), 0) / totalFiles).toFixed(1)
    : (isLoading ? "..." : "1.0");
  const avgMaintainability = totalFiles > 0
    ? Math.round(healthFiles.reduce((acc, f) => acc + (f.maintainability || 0), 0) / totalFiles)
    : (isLoading ? "..." : "100");
  const totalSmells = healthFiles.reduce((acc, f) => acc + (f.issues || 0), 0);
  const totalDebt = healthFiles.reduce((acc, f) => acc + (f.debtScore || 0), 0);
  const testGuardedCount = healthFiles.filter(f => f.testCoverage === "Guarded").length;

  const columns = [
    {
      header: "Source File",
      key: "file",
      render: (val, row) => (
        <div className="flex items-center gap-2">
          <FileCode size={13} className="text-cyan-400 shrink-0" />
          <span className="font-semibold text-zinc-100 truncate">{val}</span>
          <span className="text-[10px] text-zinc-500 font-mono">({row.lines || "—"} LOC)</span>
        </div>
      )
    },
    {
      header: "Complexity",
      key: "complexity",
      sortable: true,
      render: (val) => (
        <span className={`font-bold font-mono ${val > 20 ? "text-rose-400" : val > 10 ? "text-amber-400" : "text-emerald-400"}`}>
          {val}
        </span>
      )
    },
    {
      header: "Max Nesting",
      key: "nesting",
      sortable: true,
      render: (val) => (
        <span className={`font-mono text-xs ${val >= 4 ? "text-rose-400 font-bold" : val >= 3 ? "text-amber-400" : "text-zinc-300"}`}>
          Depth {val ?? 1}
        </span>
      )
    },
    {
      header: "Debt Score",
      key: "debtScore",
      sortable: true,
      render: (val) => (
        <span className={`font-mono px-2 py-0.5 rounded text-xs ${
          val > 40 ? "bg-rose-950/60 text-rose-300 border border-rose-800/60 font-bold" :
          val > 20 ? "bg-amber-950/60 text-amber-300 border border-amber-800/60" :
          "bg-zinc-800 text-zinc-300"
        }`}>
          {val ?? 0} pts
        </span>
      )
    },
    {
      header: "Maintainability",
      key: "maintainability",
      sortable: true,
      render: (val) => (
        <span className="text-zinc-200 font-mono">
          {val} / 100
        </span>
      )
    },
    {
      header: "Code Smells",
      key: "issues",
      sortable: true,
      render: (val) => (
        <span className={val > 0 ? "text-rose-300 font-semibold font-mono" : "text-zinc-500 font-mono"}>
          {val} {val === 1 ? "smell" : "smells"}
        </span>
      )
    },
    {
      header: "Duplication",
      key: "duplicatedLines",
      sortable: true,
      render: (val, row) => (
        <span className={val > 0 ? "text-amber-400 font-mono text-xs font-semibold" : "text-zinc-500 font-mono text-xs"}>
          {val > 0 ? `${row.duplicationPercentage}% (${val}L)` : "0%"}
        </span>
      )
    },
    {
      header: "Test Status",
      key: "testCoverage",
      render: (val) => (
        <span className={`text-xs font-mono ${val === "Guarded" ? "text-emerald-400" : "text-zinc-400"}`}>
          {val}
        </span>
      )
    },
    {
      header: "ML Defect Risk",
      key: "mlRiskScore",
      sortable: true,
      render: (val, row) => (
        row.mlRiskScore !== null && row.mlRiskScore !== undefined ? (
          <div className="flex flex-col">
            <span className={`font-mono font-bold text-xs ${
              val >= 70 ? "text-rose-400" :
              val >= 50 ? "text-amber-400" :
              val >= 30 ? "text-yellow-400" :
              "text-emerald-400"
            }`}>
              {val}% Risk
            </span>
            {row.mlTopFactors?.[0] && (
              <span className="text-[10px] text-zinc-400 truncate max-w-[130px]" title={row.mlTopFactors.map(f => `${f.factor} (${f.impact})`).join(', ')}>
                {row.mlTopFactors[0].factor}
              </span>
            )}
          </div>
        ) : (
          <span className="text-zinc-500 font-mono text-xs">—</span>
        )
      )
    },
    {
      header: "Risk Level",
      key: "risk",
      render: (val) => <RiskBadge level={val} size="sm" />
    },
    {
      header: "Action",
      key: "file",
      align: "right",
      render: (val, row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate("/code", { state: { file: row.file } });
          }}
          className="text-cyan-400 hover:text-cyan-300 text-xs font-mono inline-flex items-center gap-1"
        >
          Inspect <ArrowRight size={12} />
        </button>
      )
    }
  ];

  const displayedFiles = healthFiles.filter(f => {
    if (filterPreset === "HIGH_COMPLEXITY") return f.complexity > 10;
    if (filterPreset === "DEEP_NESTING") return (f.nesting || 0) > 3;
    if (filterPreset === "LARGE_FILES") return (f.lines || 0) > 100;
    if (filterPreset === "SMELLS") return (f.issues || 0) > 0;
    if (filterPreset === "DUPLICATED") return (f.duplicatedLines || 0) > 0;
    if (filterPreset === "UNTESTED") return f.testCoverage === "No Tests" || !f.testCoverage || f.testCoverage === "0%";
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
              <Activity size={20} className="text-cyan-400" />
              Code Health & Technical Debt
            </h1>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Deterministic Hotspots
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Cyclomatic complexity distributions, maintainability index, nesting depth, and refactoring priority ranking.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            Overall Maintainability: <strong className="text-cyan-400">{avgMaintainability}/100</strong>
          </span>
        </div>
      </div>

      {/* Code Health Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Complexity</span>
          <span className="text-xl font-bold text-rose-400 mt-0.5 block">{avgComplexity} Avg</span>
          <span className="text-[10px] text-zinc-400 mt-1 block">AST Control-Flow</span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Maintainability</span>
          <span className="text-xl font-bold text-cyan-300 mt-0.5 block">{avgMaintainability} / 100</span>
          <span className="text-[10px] text-emerald-400 mt-1 block">Deterministic Index</span>
        </div>
        {/* Code Duplication Metric Card */}
        <div
          onClick={() => setShowClones(!showClones)}
          className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono flex flex-col justify-between cursor-pointer hover:border-zinc-700 transition-colors"
          title="Click to toggle duplicate clone clusters breakdown"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 text-[10px] uppercase block">Duplication</span>
              {duplicationData?.summary?.cloneGroupCount > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                  {duplicationData.summary.cloneGroupCount} clones
                </span>
              )}
            </div>
            <span className={`text-xl font-bold mt-0.5 block ${
              (duplicationData?.summary?.duplicationRatio || 0) < 0.05
                ? "text-emerald-400"
                : (duplicationData?.summary?.duplicationRatio || 0) < 0.10
                ? "text-amber-400"
                : "text-rose-400"
            }`}>
              {duplicationData?.summary?.duplicationPercentage ?? 0}%
            </span>
          </div>
          <span className="text-[10px] text-zinc-400 mt-1 block">
            {duplicationData?.summary?.duplicatedLines || 0} duplicated lines
          </span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Code Smells</span>
          <span className="text-xl font-bold text-zinc-200 mt-0.5 block">{totalSmells}</span>
          <span className="text-[10px] text-zinc-400 mt-1 block">AST antipatterns</span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Technical Debt</span>
          <span className="text-xl font-bold text-zinc-200 mt-0.5 block">{totalDebt} pts</span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Formula C*2+N*3+S*5</span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Test Guard</span>
          <span className="text-xl font-bold text-emerald-400 mt-0.5 block">
            {totalFiles > 0 ? `${Math.round((testGuardedCount / totalFiles) * 100)}%` : "—"}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Companion coverage</span>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Complexity Distribution BarChart */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <BarChart3 size={16} className="text-cyan-400" />
                Complexity Distribution
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Number of files mapped to cyclomatic complexity bands.
              </p>
            </div>
          </div>

          {complexityData && complexityData.length > 0 ? (
            <div className="h-56 w-full font-mono text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={complexityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="range" stroke="#71717a" tickLine={false} />
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
                  <Bar dataKey="files" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex items-center justify-center border border-dashed border-zinc-800 rounded-lg text-xs font-mono text-zinc-400">
              No complexity data yet. Run an analysis scan to populate distribution.
            </div>
          )}
        </div>

        {/* Technical Debt Trajectory -> Will be integrated soon */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-400" />
                Technical Debt Trend
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Estimated refactoring hours vs maintainability index over past sprints.
              </p>
            </div>
          </div>

          {historyData && historyData.state === 'TRAJECTORY_AVAILABLE' && historyData.timeline.length >= 2 ? (
            <div className="h-56 w-full font-mono text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={historyData.timeline.map(pt => ({
                    commit: pt.commitSha ? pt.commitSha.substring(0, 7) : 'snap',
                    Complexity: pt.metrics.avgComplexity,
                    Duplication: Number((pt.metrics.duplicationRatio * 100).toFixed(1)),
                    Smells: pt.metrics.totalSmells
                  }))}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
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
                  <Line type="monotone" dataKey="Smells" stroke="#06b6d4" strokeWidth={1.5} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : historyData && (historyData.state === 'BASELINE' || historyData.timeline.length === 1) ? (
            <div className="h-56 flex flex-col justify-center border border-dashed border-zinc-800 rounded-lg p-4 bg-zinc-950/40 font-mono text-xs">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
                <Activity size={15} />
                <span>Baseline Snapshot Recorded</span>
              </div>
              <p className="text-zinc-400 text-[11px] mb-3 leading-relaxed">
                Historical comparison requires at least two analyzed snapshots. Current snapshot represents your engineering baseline.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded bg-zinc-900 border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase block">Maintainability</span>
                  <span className="text-sm font-bold text-cyan-300 mt-0.5 block">{historyData.timeline[0]?.metrics?.maintainability || 100}</span>
                </div>
                <div className="p-2 rounded bg-zinc-900 border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase block">Complexity</span>
                  <span className="text-sm font-bold text-rose-400 mt-0.5 block">{historyData.timeline[0]?.metrics?.avgComplexity || 0}</span>
                </div>
                <div className="p-2 rounded bg-zinc-900 border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase block">Smells</span>
                  <span className="text-sm font-bold text-amber-400 mt-0.5 block">{historyData.timeline[0]?.metrics?.totalSmells || 0}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-56 flex items-center justify-center border border-dashed border-zinc-800 rounded-lg text-xs font-mono text-zinc-400">
              No historical snapshots recorded yet. Run analysis to track debt trends.
            </div>
          )}
        </div>
      </div>

      {/* Duplication Clone Findings Drawer / Section */}
      {(showClones || (duplicationData?.clones?.length > 0)) && (
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 font-mono space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Copy size={16} className="text-amber-400" />
              Code Duplication Clusters ({duplicationData?.clones?.length || 0})
            </h3>
            <span className="text-xs text-zinc-400 font-normal">
              {duplicationData?.summary?.duplicatedLines || 0} duplicated lines detected across snapshot
            </span>
          </div>

          {duplicationData?.clones?.length > 0 ? (
            <div className="border border-zinc-800 rounded-lg overflow-hidden text-xs max-h-60 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-zinc-950 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
                  <tr>
                    <th className="p-2.5">Signature Hash</th>
                    <th className="p-2.5">Type</th>
                    <th className="p-2.5">Size</th>
                    <th className="p-2.5">Scope</th>
                    <th className="p-2.5">Instances & Locations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-mono">
                  {duplicationData.clones.slice(0, 10).map((clone, idx) => (
                    <tr key={idx} className="hover:bg-zinc-850/40">
                      <td className="p-2.5 text-cyan-300 font-semibold">{clone.cloneHash.substring(0, 12)}...</td>
                      <td className="p-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          clone.cloneType === 'TYPE_1'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}>
                          {clone.cloneType}
                        </span>
                      </td>
                      <td className="p-2.5 text-zinc-300">
                        {clone.lineCount} lines <span className="text-[10px] text-zinc-500">({clone.tokenCount} tokens)</span>
                      </td>
                      <td className="p-2.5 text-zinc-400">
                        {clone.isIntraFile ? 'Intra-file' : 'Inter-file'}
                      </td>
                      <td className="p-2.5 text-zinc-300">
                        <div className="flex flex-col gap-0.5">
                          {clone.instances.map((inst, iIdx) => (
                            <span key={iIdx} className="text-[11px] text-zinc-400">
                              {inst.filePath}:L{inst.startLine}-{inst.endLine}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-400 text-center">
              No code duplication detected in this snapshot. Duplication ratio is 0.0%.
            </div>
          )}
        </div>
      )}

      {/* File Level Health Table */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-100 font-mono flex items-center gap-2">
            <span>File-by-File Health Index</span>
            <span className="text-xs text-zinc-400 font-normal">({displayedFiles.length} of {healthFiles.length} files)</span>
          </h3>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Filter files..."
              className="w-full sm:w-64"
            />
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2.5 py-1.5 focus:outline-none font-mono"
            >
              <option value="ALL">All Risks</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
        </div>

        {/* Hotspot Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
          <span className="text-[11px] text-zinc-400 mr-1 flex items-center gap-1">
            <Filter size={12} /> Hotspots:
          </span>
          {[
            { id: "ALL", label: "All Files", count: healthFiles.length },
            { id: "HIGH_COMPLEXITY", label: "High Complexity (>10)", count: healthFiles.filter(f => f.complexity > 10).length },
            { id: "DEEP_NESTING", label: "Deeply Nested (>3)", count: healthFiles.filter(f => (f.nesting || 0) > 3).length },
            { id: "LARGE_FILES", label: "Large Files (>100 LOC)", count: healthFiles.filter(f => (f.lines || 0) > 100).length },
            { id: "SMELLS", label: "Code Smells", count: healthFiles.filter(f => (f.issues || 0) > 0).length },
            { id: "DUPLICATED", label: "Duplicated", count: healthFiles.filter(f => (f.duplicatedLines || 0) > 0).length },
            { id: "UNTESTED", label: "Untested Files", count: healthFiles.filter(f => f.testCoverage === "No Tests" || !f.testCoverage || f.testCoverage === "0%").length }
          ].map(preset => (
            <button
              key={preset.id}
              onClick={() => setFilterPreset(preset.id)}
              className={`px-2.5 py-1 rounded-md transition-colors border flex items-center gap-1.5 ${
                filterPreset === preset.id
                  ? "bg-cyan-950/80 border-cyan-700 text-cyan-300 font-semibold shadow-sm"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              <span>{preset.label}</span>
              <span className={`text-[10px] px-1 py-0.2 rounded ${
                filterPreset === preset.id ? "bg-cyan-800/80 text-cyan-200" : "bg-zinc-800 text-zinc-500"
              }`}>
                {preset.count}
              </span>
            </button>
          ))}
        </div>

        <DataTable
          columns={columns}
          data={displayedFiles}
          onRowClick={(row) => navigate("/code", { state: { file: row.file } })}
          onSort={(key) => setSortColumn(key)}
          emptyMessage="No matching source files analyzed for this repository snapshot."
        />
      </div>
    </div>
  );
}
