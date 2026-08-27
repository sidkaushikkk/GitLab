import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { securityService } from '../services/securityService';
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
  ExternalLink
} from 'lucide-react';
import { SeverityBadge } from '../components/common/RiskBadge';
import { FindingDrawer } from '../components/security/FindingDrawer';
import { SearchBar } from '../components/common/SearchBar';
import { DataTable } from '../components/common/DataTable';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { useNavigate } from 'react-router-dom';

export function SecurityPage() {
  const { currentRepo } = useApp();
  const [findings, setFindings] = useState([]);
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [findingsList, scoreHistory] = await Promise.all([
        securityService.getFindings({
          search,
          severity: severityFilter,
          status: statusFilter
        }),
        securityService.getScoreHistory()
      ]);
      setFindings(findingsList);
      setHistory(scoreHistory);
      setIsLoading(false);
    }
    load();
  }, [search, severityFilter, statusFilter, currentRepo.id]);

  const risk = currentRepo.riskSummary;

  const columns = [
    {
      header: 'Severity',
      key: 'severity',
      render: (val) => <SeverityBadge severity={val} size="sm" />
    },
    {
      header: 'Finding Description',
      key: 'title',
      render: (val, row) => (
        <div>
          <div className="font-semibold text-zinc-100">{val}</div>
          <div className="text-[11px] text-zinc-400 font-sans">{row.category}</div>
        </div>
      )
    },
    {
      header: 'File Location',
      key: 'file',
      render: (val, row) => (
        <div className="flex items-center gap-1.5 text-zinc-300">
          <FileCode size={13} className="text-cyan-400 shrink-0" />
          <span className="truncate">{val}</span>
          <span className="text-zinc-500 font-normal">:Line {row.line}</span>
        </div>
      )
    },
    {
      header: 'Status',
      key: 'status',
      render: (val) => (
        <span
          className={`text-[11px] font-mono px-2 py-0.5 rounded ${
            val === 'Open'
              ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60 font-semibold'
              : val === 'In Review'
              ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
              : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
          }`}
        >
          {val}
        </span>
      )
    },
    {
      header: 'Action',
      key: 'id',
      align: 'right',
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <ShieldAlert size={20} className="text-rose-400" />
            Security & Vulnerability Intelligence
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Static Application Security Testing (SAST), secret scanning, injection flaw detection, and automated remediation.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            Security Score: <strong className="text-emerald-400">{currentRepo.metrics.securityScore}/100</strong>
          </span>
        </div>
      </div>

      {/* Severity Counters & Trend Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Severity Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-900/40 font-mono">
            <span className="text-[10px] uppercase text-rose-400 font-semibold block">Critical</span>
            <span className="text-2xl font-bold text-rose-300">{risk.critical}</span>
            <span className="text-[10px] text-zinc-400 block mt-1">Immediate blocker</span>
          </div>
          <div className="p-3.5 rounded-xl bg-orange-950/30 border border-orange-900/40 font-mono">
            <span className="text-[10px] uppercase text-orange-400 font-semibold block">High</span>
            <span className="text-2xl font-bold text-orange-300">{risk.high}</span>
            <span className="text-[10px] text-zinc-400 block mt-1">High blast radius</span>
          </div>
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-900/40 font-mono">
            <span className="text-[10px] uppercase text-amber-400 font-semibold block">Medium</span>
            <span className="text-2xl font-bold text-amber-300">{risk.medium}</span>
            <span className="text-[10px] text-zinc-400 block mt-1">Moderate exploitability</span>
          </div>
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-900/40 font-mono">
            <span className="text-[10px] uppercase text-emerald-400 font-semibold block">Low</span>
            <span className="text-2xl font-bold text-emerald-300">{risk.low}</span>
            <span className="text-[10px] text-zinc-400 block mt-1">Informational findings</span>
          </div>
        </div>

        {/* Security Trend Line Chart */}
        <div className="lg:col-span-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-400" />
                Security Trajectory Over Time
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Vulnerability remediation velocity and security compliance score.
              </p>
            </div>
          </div>

          <div className="h-44 w-full font-mono text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" stroke="#71717a" tickLine={false} />
                <YAxis domain={[75, 100]} stroke="#71717a" tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    borderColor: '#27272a',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono, monospace'
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ fill: '#10b981', r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Findings Filters and Search */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search findings by title, category, or file path..."
            className="w-full sm:w-80"
          />

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
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
          emptyMessage="No matching security findings detected"
        />
      </div>

      {/* Slide-over Finding Drawer */}
      <FindingDrawer
        finding={selectedFinding}
        onClose={() => setSelectedFinding(null)}
        onNavigateToFile={() => navigate('/code')}
      />
    </div>
  );
}
