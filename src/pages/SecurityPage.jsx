import React, { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { securityService } from "../services/securityService";
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  Filter,
  FileCode,
  AlertTriangle,
  TrendingUp,
  ArrowRight,
  Clock,
  ExternalLink,
  FolderGit2,
  RefreshCw,
  CheckCircle2
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";
import { SeverityBadge } from "../components/common/RiskBadge";
import { FindingDrawer } from "../components/security/FindingDrawer";
import { SearchBar } from "../components/common/SearchBar";
import { DataTable } from "../components/common/DataTable";
import { EmptyState } from "../components/common/EmptyState";
import { useNavigate } from "react-router-dom";

export function SecurityPage({ headless = false, repoId = null }) {
  const { currentRepo } = useApp();
  const targetRepoId = repoId || currentRepo?.id;
  const [findings, setFindings] = useState([]);
  const [overview, setOverview] = useState(null);
  const [trajectory, setTrajectory] = useState([]);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [scopeFilter, setScopeFilter] = useState("ALL");
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const navigate = useNavigate();

  const loadData = async () => {
    if (!targetRepoId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [findingsList, overviewData, scoreHistory] = await Promise.all([
        securityService.getFindings({
          search,
          severity: severityFilter,
          status: statusFilter,
          scope: scopeFilter,
          repoId: targetRepoId
        }),
        securityService.getOverview(targetRepoId),
        securityService.getScoreHistory(targetRepoId)
      ]);
      setFindings(findingsList || []);
      setOverview(overviewData || null);
      setTrajectory(scoreHistory || []);
    } catch (err) {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search, severityFilter, statusFilter, scopeFilter, targetRepoId]);

  const handleTriggerScan = async () => {
    if (!targetRepoId || isScanning) return;
    setIsScanning(true);
    try {
      await fetch(`/api/repositories/${targetRepoId}/security/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bypassCache: false })
      });
      await loadData();
    } catch (e) {
      // Non-fatal
    } finally {
      setIsScanning(false);
    }
  };

  if (!currentRepo && !targetRepoId) {
    return (
      <div className="py-12">
        <EmptyState
          icon={FolderGit2}
          title="No repository selected"
          description="Select or connect a repository to view security vulnerabilities and code smell findings."
          actionLabel="Connect Repository"
          onAction={() => navigate("/connect")}
        />
      </div>
    );
  }

  // Count severities
  const critical = overview?.posture?.severityBreakdown?.critical ?? findings.filter(f => (f.severity || "").toUpperCase() === "CRITICAL").length;
  const high = overview?.posture?.severityBreakdown?.high ?? findings.filter(f => (f.severity || "").toUpperCase() === "HIGH").length;
  const medium = overview?.posture?.severityBreakdown?.medium ?? findings.filter(f => (f.severity || "").toUpperCase() === "MEDIUM").length;
  const low = overview?.posture?.severityBreakdown?.low ?? findings.filter(f => (f.severity || "").toUpperCase() === "LOW").length;

  const securityScore = overview?.posture?.score ?? (findings.length === 0 ? 100 : Math.max(0, 100 - (critical * 20) - (high * 10) - (medium * 5) - (low * 2)));

  // Format trajectory data for Recharts
  const chartPoints = (trajectory || []).map((t, idx) => ({
    label: t.commitSha ? t.commitSha.slice(0, 7) : `Snap #${idx + 1}`,
    score: t.securityScore,
    vulnerabilities: t.totalVulnerabilities,
    critical: t.criticalCount,
    high: t.highCount,
    date: t.date ? new Date(t.date).toLocaleDateString() : ''
  }));

  const columns = [
    {
      header: "Severity",
      key: "severity",
      render: (val, row) => (
        <div className="flex items-center gap-1.5">
          <SeverityBadge severity={val} size="sm" />
          {row.cvssScore ? (
            <span className="text-[10px] font-mono text-zinc-400">({row.cvssScore})</span>
          ) : null}
        </div>
      )
    },
    {
      header: "Advisory / Package",
      key: "title",
      render: (val, row) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100">{val}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-cyan-300 font-mono border border-zinc-700/60">
              {row.id}
            </span>
          </div>
          <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
            {row.category}
          </div>
        </div>
      )
    },
    {
      header: "Source Location",
      key: "file",
      render: (val, row) => (
        <div className="flex items-center gap-1.5 text-zinc-300 font-mono">
          <FileCode size={13} className="text-cyan-400 shrink-0" />
          <span className="truncate">{val}</span>
          {row.depth ? <span className="text-zinc-500 font-normal">:Depth {row.depth}</span> : null}
        </div>
      )
    },
    {
      header: "Status",
      key: "status",
      render: (val) => (
        <span
          className={`text-[11px] font-mono px-2 py-0.5 rounded ${
            val === "Open"
              ? "bg-rose-950/60 text-rose-300 border border-rose-800/60 font-semibold"
              : val === "In Review"
              ? "bg-amber-950/60 text-amber-300 border border-amber-800/60"
              : "bg-emerald-950/60 text-emerald-300 border border-emerald-800/60"
          }`}
        >
          {val}
        </span>
      )
    },
    {
      header: "Action",
      key: "id",
      align: "right",
      render: (val, row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedFinding(row);
          }}
          className="text-cyan-400 hover:text-cyan-300 text-xs font-mono inline-flex items-center gap-1"
        >
          Inspect <ArrowRight size={12} />
        </button>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header — hidden when embedded inside RepositoryDetailPage */}
      {!headless && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
              <ShieldAlert size={20} className="text-rose-400" />
              Live CVE & Dependency Security Intelligence
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              Authoritative OSV vulnerability intelligence, CVSS v3.1 scoring, direct vs. transitive exposure, and longitudinal remediation velocity.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              onClick={handleTriggerScan}
              disabled={isScanning}
              className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={12} className={isScanning ? "animate-spin text-cyan-400" : ""} />
              <span>{isScanning ? "Scanning..." : "Rescan Snapshot"}</span>
            </button>
            <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
              Security Score: <strong className={securityScore > 75 ? "text-emerald-400" : "text-amber-400"}>{securityScore}/100</strong>
            </span>
          </div>
        </div>
      )}

      {/* Severity Counters & Trend Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Severity Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-900/40 font-mono">
            <span className="text-[10px] uppercase text-rose-400 font-semibold block">Critical</span>
            <span className="text-2xl font-bold text-rose-300">{critical}</span>
            <span className="text-[10px] text-zinc-400 block mt-1">CVSS &ge; 9.0 (Immediate SLA)</span>
          </div>
          <div className="p-3.5 rounded-xl bg-orange-950/30 border border-orange-900/40 font-mono">
            <span className="text-[10px] uppercase text-orange-400 font-semibold block">High</span>
            <span className="text-2xl font-bold text-orange-300">{high}</span>
            <span className="text-[10px] text-zinc-400 block mt-1">CVSS 7.0&ndash;8.9 (Elevated)</span>
          </div>
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-900/40 font-mono">
            <span className="text-[10px] uppercase text-amber-400 font-semibold block">Medium</span>
            <span className="text-2xl font-bold text-amber-300">{medium}</span>
            <span className="text-[10px] text-zinc-400 block mt-1">CVSS 4.0&ndash;6.9 (Moderate)</span>
          </div>
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-900/40 font-mono">
            <span className="text-[10px] uppercase text-emerald-400 font-semibold block">Low</span>
            <span className="text-2xl font-bold text-emerald-300">{low}</span>
            <span className="text-[10px] text-zinc-400 block mt-1">CVSS &lt; 4.0 (Informational)</span>
          </div>
        </div>

        {/* Security Trajectory Visualization */}
        <div className="lg:col-span-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-400" />
                Security Trajectory Over Time
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Vulnerability remediation velocity and security compliance score across snapshots.
              </p>
            </div>
            {overview?.scan?.scanDurationMs && (
              <span className="text-[10px] font-mono text-zinc-500">
                Scan latency: {overview.scan.scanDurationMs}ms
              </span>
            )}
          </div>

          {chartPoints.length > 1 ? (
            <div className="h-44 w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartPoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="secScoreGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="#71717a" fontSize={10} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "0.5rem", fontSize: "11px" }}
                    formatter={(value, name) => [value, name === 'score' ? 'Security Score' : 'Vulnerabilities']}
                  />
                  <Area type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#secScoreGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 my-auto flex flex-col justify-center items-center text-center space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-mono text-sm font-semibold">
                <ShieldCheck size={18} />
                Snapshot Baseline: Security Score {securityScore}/100
              </div>
              <p className="text-xs text-zinc-400 max-w-md">
                Current snapshot evaluated with {findings.length} active vulnerabilities ({critical} Critical, {high} High, {medium} Medium, {low} Low). Subsequent commits will plot continuous remediation trajectory and velocity here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Findings Filters and Search */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search findings by CVE ID, package name, or title..."
            className="w-full sm:w-80"
          />

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-mono text-zinc-400">Severity:</span>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2.5 py-1.5 focus:outline-none font-mono"
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[11px] font-mono text-zinc-400">Scope:</span>
              <select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2.5 py-1.5 focus:outline-none font-mono"
              >
                <option value="ALL">All Scopes</option>
                <option value="direct">Direct Only</option>
                <option value="transitive">Transitive Only</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[11px] font-mono text-zinc-400">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2.5 py-1.5 focus:outline-none font-mono"
              >
                <option value="ALL">All Status</option>
                <option value="Open">Open</option>
                <option value="In Review">In Review</option>
                <option value="Resolved">Resolved</option>
              </select>
            </div>
          </div>
        </div>

        {/* Findings Data Table */}
        <DataTable
          columns={columns}
          data={findings}
          onRowClick={(row) => setSelectedFinding(row)}
          emptyMessage="No security vulnerabilities detected for this repository snapshot."
        />
      </div>

      {/* Slide-over Finding Drawer */}
      <FindingDrawer
        finding={selectedFinding}
        onClose={() => setSelectedFinding(null)}
        onNavigateToFile={() => navigate("/code")}
      />
    </div>
  );
}
