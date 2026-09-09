import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useApp } from "../context/AppContext";
import { apiReliabilityService } from "../services/apiReliabilityService";
import { repositoryService } from "../services/repositoryService";
import {
  Zap,
  Activity,
  Server,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
  FileCode,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
  Database,
  ExternalLink,
  Layers,
  Clock,
  ChevronRight,
  Code
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

export function ApiReliabilityPage({ headless = false, repoId = null }) {
  const { currentRepo, isAnalyzing } = useApp();
  const targetRepoId = repoId || currentRepo?.id;

  const [activeTab, setActiveTab] = useState("inventory"); // "inventory" | "findings" | "history"
  const [overviewData, setOverviewData] = useState(null);
  const [endpoints, setEndpoints] = useState([]);
  const [findings, setFindings] = useState([]);
  const [historyData, setHistoryData] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("ALL");
  const [selectedAuthFilter, setSelectedAuthFilter] = useState("ALL");
  const [selectedCompleteness, setSelectedCompleteness] = useState("ALL");

  // Snapshot compare state
  const [baseSnapshotId, setBaseSnapshotId] = useState("");
  const [targetSnapshotId, setTargetSnapshotId] = useState("");
  const [comparison, setComparison] = useState(null);
  const [isComparing, setIsComparing] = useState(false);

  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!targetRepoId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [ov, hist, snaps] = await Promise.all([
        apiReliabilityService.getOverview(targetRepoId).catch(() => null),
        apiReliabilityService.getHistory(targetRepoId).catch(() => null),
        repositoryService.getSnapshots(targetRepoId).catch(() => [])
      ]);

      if (ov) {
        setOverviewData(ov);
        setEndpoints(ov.endpoints || []);
        setFindings(ov.findings || []);
      }

      if (hist) {
        setHistoryData(hist);
      }

      const snapList = Array.isArray(snaps) ? snaps : (snaps?.snapshots || []);
      const completed = snapList.filter(s => s.status === 'completed');
      setSnapshots(completed);

      if (completed.length >= 2) {
        setBaseSnapshotId(completed[1].id);
        setTargetSnapshotId(completed[0].id);
      } else {
        setBaseSnapshotId("");
        setTargetSnapshotId("");
        setComparison(null);
      }
    } catch (err) {
      console.warn("Failed to load API reliability data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [targetRepoId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh when an analysis run finishes
  const prevAnalyzingRef = React.useRef(isAnalyzing);
  useEffect(() => {
    if (prevAnalyzingRef.current && !isAnalyzing) {
      loadData();
    }
    prevAnalyzingRef.current = isAnalyzing;
  }, [isAnalyzing, loadData]);

  // Run differential comparison when selections change
  useEffect(() => {
    async function runCompare() {
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
        const diff = await apiReliabilityService.compareSnapshots(targetRepoId, baseSnapshotId, targetSnapshotId);
        if (diff && !diff.isBaseline && diff.deltas) {
          setComparison(diff);
        } else {
          setComparison(null);
        }
      } catch (err) {
        console.warn("Failed to run snapshot comparison:", err);
        setComparison(null);
      } finally {
        setIsComparing(false);
      }
    }
    runCompare();
  }, [targetRepoId, baseSnapshotId, targetSnapshotId]);

  // Filter endpoints
  const filteredEndpoints = useMemo(() => {
    return endpoints.filter(ep => {
      const matchesSearch = !searchQuery ||
        ep.route_path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ep.handler_name && ep.handler_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (ep.source_file && ep.source_file.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesMethod = selectedMethod === "ALL" || ep.method === selectedMethod;

      const matchesAuth =
        selectedAuthFilter === "ALL" ||
        (selectedAuthFilter === "AUTH" && ep.is_authenticated) ||
        (selectedAuthFilter === "NO_AUTH" && !ep.is_authenticated);

      const matchesCompleteness =
        selectedCompleteness === "ALL" || ep.contract_completeness === selectedCompleteness;

      return matchesSearch && matchesMethod && matchesAuth && matchesCompleteness;
    });
  }, [endpoints, searchQuery, selectedMethod, selectedAuthFilter, selectedCompleteness]);

  if (isLoading) {
    return (
      <div className="p-12 text-center font-mono text-xs text-zinc-400">
        <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-cyan-400" />
        Discovering and analyzing repository API endpoints...
      </div>
    );
  }

  const summary = overviewData?.summary;
  const reliabilityScore = summary ? Number(summary.reliability_score || 100).toFixed(1) : "100.0";
  const authPercentage = summary?.total_endpoints > 0
    ? Math.round((summary.authenticated_count / summary.total_endpoints) * 100)
    : 100;
  const completePercentage = summary?.total_endpoints > 0
    ? Math.round((summary.complete_contract_count / summary.total_endpoints) * 100)
    : 100;

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      {!headless && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
              <Zap size={20} className="text-cyan-400" />
              API Reliability & Endpoint Contract Intelligence
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              Deterministic AST route discovery, endpoint contract completeness, static reliability rules, and longitudinal drift.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              onClick={loadData}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono">
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <span className="text-[11px] text-zinc-500 uppercase block">Total Endpoints</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold text-zinc-100">{summary?.total_endpoints ?? 0}</span>
            <span className="text-[11px] text-zinc-400">discovered</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <span className="text-[11px] text-zinc-500 uppercase block">API Reliability Score</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-2xl font-bold ${
              Number(reliabilityScore) >= 85 ? "text-emerald-400" :
              Number(reliabilityScore) >= 70 ? "text-amber-400" : "text-rose-400"
            }`}>
              {reliabilityScore}
            </span>
            <span className="text-[11px] text-zinc-500">/100</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <span className="text-[11px] text-zinc-500 uppercase block">Auth Coverage</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-2xl font-bold ${authPercentage >= 80 ? "text-cyan-400" : "text-amber-400"}`}>
              {authPercentage}%
            </span>
            <span className="text-[11px] text-zinc-400">({summary?.authenticated_count ?? 0}/{summary?.total_endpoints ?? 0})</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <span className="text-[11px] text-zinc-500 uppercase block">Complete Contracts</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold text-emerald-400">{completePercentage}%</span>
            <span className="text-[11px] text-zinc-400">({summary?.complete_contract_count ?? 0})</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <span className="text-[11px] text-zinc-500 uppercase block">Reliability Findings</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-2xl font-bold ${(summary?.total_findings ?? 0) > 0 ? "text-rose-400" : "text-emerald-400"}`}>
              {summary?.total_findings ?? 0}
            </span>
            <span className="text-[11px] text-zinc-400">issues</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800 text-xs font-mono">
        <button
          onClick={() => setActiveTab("inventory")}
          className={`px-4 py-2.5 border-b-2 font-medium transition-colors flex items-center gap-2 ${
            activeTab === "inventory"
              ? "border-cyan-400 text-cyan-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Server size={14} />
          <span>Endpoint Inventory ({endpoints.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("findings")}
          className={`px-4 py-2.5 border-b-2 font-medium transition-colors flex items-center gap-2 ${
            activeTab === "findings"
              ? "border-cyan-400 text-cyan-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <AlertTriangle size={14} />
          <span>Reliability Findings ({findings.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-2.5 border-b-2 font-medium transition-colors flex items-center gap-2 ${
            activeTab === "history"
              ? "border-cyan-400 text-cyan-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <TrendingUp size={14} />
          <span>Snapshot History & Compare</span>
        </button>
      </div>

      {/* TAB 1: ENDPOINT INVENTORY */}
      {activeTab === "inventory" && (
        <div className="space-y-4">
          {/* Filters and Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between font-mono text-xs">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search endpoints by path, handler, file..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-1.5 text-zinc-200 placeholder-zinc-500 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Method filter */}
              <select
                value={selectedMethod}
                onChange={e => setSelectedMethod(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-300 outline-none"
              >
                <option value="ALL">All Methods</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="PATCH">PATCH</option>
              </select>

              {/* Auth filter */}
              <select
                value={selectedAuthFilter}
                onChange={e => setSelectedAuthFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-300 outline-none"
              >
                <option value="ALL">All Auth States</option>
                <option value="AUTH">Authenticated Only</option>
                <option value="NO_AUTH">Unauthenticated / Public</option>
              </select>

              {/* Completeness filter */}
              <select
                value={selectedCompleteness}
                onChange={e => setSelectedCompleteness(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-300 outline-none"
              >
                <option value="ALL">All Contract States</option>
                <option value="COMPLETE">Complete</option>
                <option value="PARTIAL">Partial</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>
          </div>

          {/* Endpoints Table */}
          {filteredEndpoints.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 font-mono">
              <Server size={32} className="mx-auto text-zinc-600 mb-2" />
              <h3 className="text-sm font-bold text-zinc-300">No Matching Endpoints Found</h3>
              <p className="text-xs text-zinc-500 mt-1">
                {endpoints.length === 0
                  ? "No HTTP endpoints discovered in this repository snapshot."
                  : "Try adjusting your search query or filter options."}
              </p>
            </div>
          ) : (
            <div className="border border-zinc-800 rounded-xl overflow-hidden font-mono text-xs">
              <table className="w-full text-left">
                <thead className="bg-zinc-950 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
                  <tr>
                    <th className="p-3">Method</th>
                    <th className="p-3">Route Path</th>
                    <th className="p-3">Handler</th>
                    <th className="p-3">Auth</th>
                    <th className="p-3">Contract</th>
                    <th className="p-3">Dependencies</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredEndpoints.map((ep, idx) => (
                    <tr
                      key={idx}
                      onClick={() => setSelectedEndpoint(ep)}
                      className="hover:bg-zinc-900/60 cursor-pointer transition-colors"
                    >
                      <td className="p-3">
                        <MethodBadge method={ep.method} />
                      </td>
                      <td className="p-3 text-zinc-200 font-semibold flex items-center gap-1.5">
                        <span>{ep.route_path}</span>
                      </td>
                      <td className="p-3 text-zinc-400">
                        {ep.handler_name || "anonymous"}
                      </td>
                      <td className="p-3">
                        {ep.is_authenticated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
                            <Lock size={10} /> Authenticated
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-800">
                            <Unlock size={10} /> Public
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <ContractBadge status={ep.contract_completeness} />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                          {ep.database_dependent && (
                            <span className="flex items-center gap-1 text-cyan-400" title="Database dependency">
                              <Database size={11} /> DB
                            </span>
                          )}
                          {ep.external_dependent && (
                            <span className="flex items-center gap-1 text-amber-400" title="External API dependency">
                              <ExternalLink size={11} /> Ext
                            </span>
                          )}
                          {!ep.database_dependent && !ep.external_dependent && (
                            <span className="text-zinc-600">—</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <span className="text-cyan-400 hover:underline flex items-center justify-end gap-1 text-[11px]">
                          Details <ChevronRight size={13} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RELIABILITY FINDINGS */}
      {activeTab === "findings" && (
        <div className="space-y-3 font-mono">
          {findings.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-dashed border-emerald-900/30 bg-emerald-950/10 font-mono">
              <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
              <h3 className="text-sm font-bold text-emerald-300">No Static Reliability Issues Detected</h3>
              <p className="text-xs text-zinc-400 mt-1">
                All discovered endpoints satisfy deterministic authentication, error-path, and contract integrity rules.
              </p>
            </div>
          ) : (
            findings.map((finding, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-2 text-xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="font-bold text-zinc-200">{finding.rule_id}</span>
                    <span className="text-zinc-500">•</span>
                    <MethodBadge method={finding.method} />
                    <span className="text-cyan-300 font-semibold">{finding.route_path}</span>
                  </div>
                  <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                    <FileCode size={12} /> {finding.source_file}:{finding.source_line}
                  </span>
                </div>

                <div className="text-zinc-300 pt-1">
                  <strong className="text-zinc-400">Explanation: </strong> {finding.explanation}
                </div>

                <div className="p-2.5 rounded bg-zinc-950/80 border border-zinc-800/80 text-[11px] text-zinc-400 font-mono">
                  <span className="text-zinc-500 block uppercase text-[10px] mb-1">Evidence</span>
                  {finding.evidence}
                </div>

                <div className="text-emerald-400/90 text-[11px] pt-0.5">
                  <strong className="text-zinc-400">Remediation: </strong> {finding.remediation}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: LONGITUDINAL TRAJECTORY & COMPARE */}
      {activeTab === "history" && (
        <div className="space-y-6 font-mono text-xs">
          {/* History Trajectory Chart */}
          {historyData && historyData.timeline && historyData.timeline.length >= 2 && (
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <TrendingUp size={16} className="text-cyan-400" />
                  API Endpoint & Reliability Score Trajectory
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Multi-snapshot tracking of endpoint count, reliability score, and authentication coverage.
                </p>
              </div>

              <div className="h-56 w-full text-xs">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={historyData.timeline.map(t => ({
                      commit: t.commitSha ? t.commitSha.substring(0, 7) : "snap",
                      Score: t.metrics?.reliabilityScore ?? 100,
                      Endpoints: t.metrics?.totalEndpoints ?? 0,
                      Authenticated: t.metrics?.authenticatedCount ?? 0,
                      Findings: t.metrics?.totalFindings ?? 0
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
                        fontSize: "11px"
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="Score" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Endpoints" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Authenticated" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Findings" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Differential Snapshot Comparison Tool */}
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/70 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <Layers size={16} className="text-cyan-400" />
                  Differential API Contract Comparison
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Compare endpoint inventories, contract modifications, and reliability findings across snapshots.
                </p>
              </div>

              {/* Dropdown Selectors */}
              <div className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 bg-zinc-950 px-2.5 py-1.5 rounded-md border border-zinc-800">
                  <span className="text-zinc-500 text-[10px] uppercase">Base:</span>
                  <select
                    value={baseSnapshotId}
                    onChange={e => setBaseSnapshotId(e.target.value)}
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
                        {s.commit_sha ? s.commit_sha.substring(0, 7) : s.id.substring(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>

                <ArrowRight size={14} className="text-zinc-500" />

                <div className="flex items-center gap-1.5 bg-zinc-950 px-2.5 py-1.5 rounded-md border border-zinc-800">
                  <span className="text-zinc-500 text-[10px] uppercase">Target:</span>
                  <select
                    value={targetSnapshotId}
                    onChange={e => setTargetSnapshotId(e.target.value)}
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
                        {s.commit_sha ? s.commit_sha.substring(0, 7) : s.id.substring(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Differential Results */}
            {snapshots.length < 2 ? (
              <div className="p-4 rounded-lg bg-zinc-950/60 border border-dashed border-zinc-800 text-center">
                <p className="text-xs text-zinc-400">
                  Differential API comparison requires at least two analyzed snapshots. Ingest another commit to compare contract drift against this baseline.
                </p>
              </div>
            ) : (!baseSnapshotId || !targetSnapshotId || baseSnapshotId === targetSnapshotId) ? (
              <div className="p-4 rounded-lg bg-zinc-950/60 border border-zinc-800 text-center">
                <p className="text-xs text-zinc-400">
                  Select two distinct snapshots above to calculate endpoint inventory and contract deltas.
                </p>
              </div>
            ) : isComparing ? (
              <div className="p-4 rounded-lg bg-zinc-950/60 border border-zinc-800 text-center">
                <p className="text-xs text-cyan-400 flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" />
                  Comparing endpoint inventories...
                </p>
              </div>
            ) : comparison?.deltas ? (
              <div className="space-y-4 pt-2">
                {/* Deltas Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded bg-zinc-950/80 border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase block">Endpoint Delta</span>
                    <span className="text-lg font-bold text-cyan-400">
                      {comparison.deltas.endpoints.delta >= 0 ? `+${comparison.deltas.endpoints.delta}` : comparison.deltas.endpoints.delta}
                    </span>
                    <span className="text-[10px] text-zinc-500 block">
                      (+{comparison.deltas.endpoints.addedCount} / -{comparison.deltas.endpoints.removedCount})
                    </span>
                  </div>

                  <div className="p-3 rounded bg-zinc-950/80 border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase block">Modified Contracts</span>
                    <span className="text-lg font-bold text-amber-400">
                      {comparison.deltas.endpoints.modifiedCount}
                    </span>
                    <span className="text-[10px] text-zinc-500 block">endpoints drift</span>
                  </div>

                  <div className="p-3 rounded bg-zinc-950/80 border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase block">Reliability Score Delta</span>
                    <span className={`text-lg font-bold ${
                      comparison.deltas.score.delta > 0 ? "text-emerald-400" :
                      comparison.deltas.score.delta < 0 ? "text-rose-400" : "text-zinc-400"
                    }`}>
                      {comparison.deltas.score.delta >= 0 ? `+${comparison.deltas.score.delta}` : comparison.deltas.score.delta}
                    </span>
                    <span className="text-[10px] text-zinc-500 block">points</span>
                  </div>

                  <div className="p-3 rounded bg-zinc-950/80 border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase block">Findings Trajectory</span>
                    <span className="text-lg font-bold text-zinc-200">
                      +{comparison.deltas.findings.newFindingsCount} / -{comparison.deltas.findings.resolvedFindingsCount}
                    </span>
                    <span className="text-[10px] text-zinc-500 block">introduced / resolved</span>
                  </div>
                </div>

                {/* Modified Endpoints List */}
                {comparison.deltas.endpoints.modified.length > 0 && (
                  <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-900/40 space-y-2">
                    <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle size={14} /> Modified Endpoint Contracts ({comparison.deltas.endpoints.modified.length})
                    </span>
                    <div className="space-y-1.5">
                      {comparison.deltas.endpoints.modified.map((mod, idx) => (
                        <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between text-xs py-1 border-b border-amber-900/20">
                          <div className="flex items-center gap-2">
                            <MethodBadge method={mod.method} />
                            <span className="text-zinc-200 font-semibold">{mod.routePath}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-amber-300">
                            {mod.changes.map((c, cIdx) => (
                              <span key={cIdx} className="px-1.5 py-0.5 rounded bg-amber-900/40">{c}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ENDPOINT DETAIL MODAL / DRAWER */}
      {selectedEndpoint && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-zinc-950 border-l border-zinc-800 h-full overflow-y-auto p-6 space-y-6 font-mono text-xs animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <MethodBadge method={selectedEndpoint.method} />
                <h3 className="text-sm font-bold text-zinc-100">{selectedEndpoint.route_path}</h3>
              </div>
              <button
                onClick={() => setSelectedEndpoint(null)}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              >
                <X size={16} />
              </button>
            </div>

            {/* Source and Location */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-zinc-500 uppercase block">Source Declaration</span>
              <div className="p-2.5 rounded bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-300">{selectedEndpoint.source_file}:{selectedEndpoint.source_line}</span>
                <span className="text-[11px] text-cyan-400">Router: {selectedEndpoint.router_name || "app"}</span>
              </div>
            </div>

            {/* Security & Middleware */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-zinc-500 uppercase block">Authentication & Middleware</span>
              <div className="p-3 rounded bg-zinc-900/80 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Auth Guard:</span>
                  <span className={selectedEndpoint.is_authenticated ? "text-emerald-400" : "text-zinc-500"}>
                    {selectedEndpoint.is_authenticated ? "Protected (Authenticated)" : "None (Public)"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Authorization / Role Check:</span>
                  <span className={selectedEndpoint.has_authorization ? "text-emerald-400" : "text-amber-400"}>
                    {selectedEndpoint.has_authorization ? "Identified" : "Not Identified"}
                  </span>
                </div>
                {selectedEndpoint.middleware_chain?.length > 0 && (
                  <div className="pt-2 border-t border-zinc-800/60">
                    <span className="text-[10px] text-zinc-500 block mb-1">Middleware Chain:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedEndpoint.middleware_chain.map((mw, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px]">
                          {mw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Parameters & Request Contract */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-zinc-500 uppercase block">Request Contract</span>
              <div className="p-3 rounded bg-zinc-900/80 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Contract Completeness:</span>
                  <ContractBadge status={selectedEndpoint.contract_completeness} />
                </div>

                {selectedEndpoint.parameters?.length > 0 ? (
                  <div className="pt-2 border-t border-zinc-800/60">
                    <span className="text-[10px] text-zinc-500 block mb-1">Parameters ({selectedEndpoint.parameters.length}):</span>
                    <div className="space-y-1">
                      {selectedEndpoint.parameters.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] py-0.5">
                          <span className="text-zinc-200">{p.name} <span className="text-zinc-500">({p.in})</span></span>
                          <span className="text-zinc-400">{p.type || "string"} {p.required ? "• required" : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-zinc-500 text-[11px] pt-1">No request parameters detected.</div>
                )}

                {selectedEndpoint.request_body?.fields?.length > 0 && (
                  <div className="pt-2 border-t border-zinc-800/60">
                    <span className="text-[10px] text-zinc-500 block mb-1">Request Body Fields:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedEndpoint.request_body.fields.map((f, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-zinc-800 text-cyan-300 text-[10px]">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Response Status Codes */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-zinc-500 uppercase block">Response Status Codes</span>
              <div className="p-3 rounded bg-zinc-900/80 border border-zinc-800 flex items-center gap-2">
                {selectedEndpoint.response_status_codes?.length > 0 ? (
                  selectedEndpoint.response_status_codes.map((code, i) => (
                    <span
                      key={i}
                      className={`px-2.5 py-1 rounded text-xs font-bold ${
                        code >= 200 && code < 300 ? "bg-emerald-950/50 text-emerald-400 border border-emerald-800/40" :
                        code >= 400 && code < 500 ? "bg-amber-950/50 text-amber-400 border border-amber-800/40" :
                        "bg-rose-950/50 text-rose-400 border border-rose-800/40"
                      }`}
                    >
                      {code}
                    </span>
                  ))
                ) : (
                  <span className="text-zinc-500">No static status codes extracted.</span>
                )}
              </div>
            </div>

            {/* Downstream Call Chain */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-zinc-500 uppercase block">Downstream Call Chain</span>
              <div className="p-3 rounded bg-zinc-900/80 border border-zinc-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Dependency Depth:</span>
                  <span className="text-cyan-400 font-bold">{selectedEndpoint.dependency_depth || 1}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Database Calls:</span>
                  <span className={selectedEndpoint.database_dependent ? "text-cyan-400" : "text-zinc-500"}>
                    {selectedEndpoint.database_dependent ? "Yes" : "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">External Network / SDKs:</span>
                  <span className={selectedEndpoint.external_dependent ? "text-amber-400" : "text-zinc-500"}>
                    {selectedEndpoint.external_dependent ? "Yes" : "None"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MethodBadge({ method }) {
  const m = (method || "GET").toUpperCase();
  const colors = {
    GET: "bg-cyan-950/50 text-cyan-400 border-cyan-800/50",
    POST: "bg-emerald-950/50 text-emerald-400 border-emerald-800/50",
    PUT: "bg-amber-950/50 text-amber-400 border-amber-800/50",
    DELETE: "bg-rose-950/50 text-rose-400 border-rose-800/50",
    PATCH: "bg-purple-950/50 text-purple-400 border-purple-800/50",
    ALL: "bg-zinc-800 text-zinc-300 border-zinc-700"
  };
  const cls = colors[m] || "bg-zinc-800 text-zinc-400 border-zinc-700";

  return (
    <span className={`inline-block font-mono text-[10px] font-bold px-2 py-0.5 rounded border ${cls}`}>
      {m}
    </span>
  );
}

function ContractBadge({ status }) {
  const s = (status || "PARTIAL").toUpperCase();
  if (s === "COMPLETE") {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
        COMPLETE
      </span>
    );
  }
  if (s === "PARTIAL") {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/40 text-amber-400 border border-amber-800/40">
        PARTIAL
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800">
      UNKNOWN
    </span>
  );
}

function SeverityBadge({ severity }) {
  const sev = (severity || "LOW").toUpperCase();
  const colors = {
    HIGH: "bg-rose-950/60 text-rose-400 border-rose-800/60",
    MEDIUM: "bg-amber-950/60 text-amber-400 border-amber-800/60",
    LOW: "bg-blue-950/60 text-blue-400 border-blue-800/60",
    INFO: "bg-zinc-900 text-zinc-400 border-zinc-800"
  };
  const cls = colors[sev] || colors.INFO;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${cls}`}>
      {sev}
    </span>
  );
}
