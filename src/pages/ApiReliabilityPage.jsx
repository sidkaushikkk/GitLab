import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { apiService } from '../services/apiService';
import {
  Zap,
  Activity,
  Search,
  Filter,
  ArrowRight,
  Server,
  Clock,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { RiskBadge } from '../components/common/RiskBadge';
import { DataTable } from '../components/common/DataTable';
import { SearchBar } from '../components/common/SearchBar';
import { EndpointDrawer } from '../components/api/EndpointDrawer';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';

export function ApiReliabilityPage({ headless = false }) {
  const { currentRepo } = useApp();
  const [endpoints, setEndpoints] = useState([]);
  const [summary, setSummary] = useState(null);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [selectedEndpoint, setSelectedEndpoint] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [list, sum] = await Promise.all([
        apiService.getEndpoints({
          search,
          method: methodFilter,
          risk: riskFilter
        }),
        apiService.getSummary()
      ]);
      setEndpoints(list);
      setSummary(sum);
      setIsLoading(false);
    }
    load();
  }, [search, methodFilter, riskFilter, currentRepo.id]);

  const distributionData = [
    { range: '99-100% (Nominal)', count: 22 },
    { range: '95-98% (Healthy)', count: 7 },
    { range: '80-94% (At Risk)', count: 6 },
    { range: '<80% (Critical)', count: 3 }
  ];

  const columns = [
    {
      header: 'Method',
      key: 'method',
      render: (val) => {
        const colors = {
          GET: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80',
          POST: 'bg-blue-950/80 text-blue-300 border-blue-800/80',
          PUT: 'bg-amber-950/80 text-amber-300 border-amber-800/80',
          DELETE: 'bg-rose-950/80 text-rose-300 border-rose-800/80'
        };
        return (
          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${colors[val] || 'bg-zinc-800 text-zinc-300'}`}>
            {val}
          </span>
        );
      }
    },
    {
      header: 'API Endpoint',
      key: 'endpoint',
      render: (val, row) => (
        <div>
          <div className="font-bold text-zinc-100">{val}</div>
          <div className="text-[11px] text-zinc-400 font-sans">{row.description}</div>
        </div>
      )
    },
    {
      header: 'Reliability',
      key: 'reliability',
      render: (val) => (
        <span className={`font-bold ${val >= 90 ? 'text-emerald-400' : val >= 75 ? 'text-amber-400' : 'text-rose-400'}`}>
          {val}%
        </span>
      )
    },
    {
      header: 'P99 Latency',
      key: 'p99Latency',
      render: (val) => <span className="text-cyan-300">{val}</span>
    },
    {
      header: 'Error Handling',
      key: 'errorHandling',
      render: (val) => <span className="text-zinc-300 font-sans">{val}</span>
    },
    {
      header: 'Risk',
      key: 'risk',
      render: (val) => <RiskBadge level={val} size="sm" />
    },
    {
      header: 'Action',
      key: 'id',
      align: 'right',
      render: (val, row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedEndpoint(row);
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
            <Zap size={20} className="text-cyan-400" />
            API Reliability Dashboard
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Continuous endpoint failure prediction, p99 latency regressions, and error propagation analysis.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            Reliability Score: <strong className="text-cyan-400">{summary?.score || 87} / 100</strong>
          </span>
        </div>
      </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Total Endpoints</span>
          <span className="text-2xl font-bold text-zinc-100 mt-0.5 block">{summary?.totalApis || 38}</span>
          <span className="text-[10px] text-zinc-400 block mt-1">Express & REST Gateway</span>
        </div>
        <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-900/40 font-mono">
          <span className="text-emerald-400 text-[10px] uppercase font-semibold block">Healthy APIs</span>
          <span className="text-2xl font-bold text-emerald-300 mt-0.5 block">{summary?.healthyApis || 29}</span>
          <span className="text-[10px] text-zinc-400 block mt-1">&gt;95% reliability</span>
        </div>
        <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/40 font-mono">
          <span className="text-amber-400 text-[10px] uppercase font-semibold block">At Risk APIs</span>
          <span className="text-2xl font-bold text-amber-300 mt-0.5 block">{summary?.atRiskApis || 6}</span>
          <span className="text-[10px] text-zinc-400 block mt-1">High timeout probability</span>
        </div>
        <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-900/40 font-mono">
          <span className="text-rose-400 text-[10px] uppercase font-semibold block">Critical APIs</span>
          <span className="text-2xl font-bold text-rose-300 mt-0.5 block">{summary?.criticalApis || 3}</span>
          <span className="text-[10px] text-zinc-400 block mt-1">Uncaught exceptions</span>
        </div>
      </div>

      {/* Reliability Distribution Chart */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
        <h3 className="text-sm font-semibold text-zinc-100 font-mono mb-3">
          Endpoint Reliability Distribution
        </h3>
        <div className="h-48 w-full font-mono text-xs">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distributionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="range" stroke="#71717a" tickLine={false} />
              <YAxis stroke="#71717a" tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  borderColor: '#27272a',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono, monospace'
                }}
              />
              <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search API endpoints or descriptions..."
            className="w-full sm:w-80"
          />

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-mono text-zinc-400">Method:</span>
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2.5 py-1.5 focus:outline-none font-mono"
              >
                <option value="ALL">All Methods</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[11px] font-mono text-zinc-400">Risk:</span>
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
        </div>

        {/* API Table */}
        <DataTable
          columns={columns}
          data={endpoints}
          onRowClick={(row) => setSelectedEndpoint(row)}
          emptyMessage="No matching API endpoints found"
        />
      </div>

      {/* Endpoint Details Slide-over Drawer */}
      <EndpointDrawer
        endpoint={selectedEndpoint}
        onClose={() => setSelectedEndpoint(null)}
      />
    </div>
  );
}
