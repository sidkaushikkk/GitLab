import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { analysisService } from '../services/analysisService';
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
  CheckCircle2
} from 'lucide-react';
import { MetricCard } from '../components/common/MetricCard';
import { DataTable } from '../components/common/DataTable';
import { RiskBadge } from '../components/common/RiskBadge';
import { SearchBar } from '../components/common/SearchBar';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line
} from 'recharts';
import { useNavigate } from 'react-router-dom';

export function CodeHealthPage() {
  const { currentRepo } = useApp();
  const [complexityData, setComplexityData] = useState([]);
  const [healthFiles, setHealthFiles] = useState([]);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [sortColumn, setSortColumn] = useState('complexity');
  const [sortDirection, setSortDirection] = useState('desc');
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      const [complexity, files] = await Promise.all([
        analysisService.getComplexityDistribution(),
        analysisService.getCodeHealthFiles({
          search,
          risk: riskFilter,
          sortBy: sortColumn
        })
      ]);
      setComplexityData(complexity);
      setHealthFiles(files);
      setIsLoading(false);
    }
    loadData();
  }, [search, riskFilter, sortColumn, currentRepo.id]);

  const metrics = currentRepo.metrics;

  const debtTrendData = [
    { week: 'W1', debtHours: 42, maintainability: 68 },
    { week: 'W2', debtHours: 38, maintainability: 71 },
    { week: 'W3', debtHours: 35, maintainability: 74 },
    { week: 'W4', debtHours: 31, maintainability: 76 }
  ];

  const columns = [
    {
      header: 'Source File',
      key: 'file',
      render: (val) => (
        <div className="flex items-center gap-2">
          <FileCode size={13} className="text-cyan-400 shrink-0" />
          <span className="font-semibold text-zinc-100 truncate">{val}</span>
        </div>
      )
    },
    {
      header: 'Complexity',
      key: 'complexity',
      sortable: true,
      render: (val) => (
        <span className={`font-bold ${val > 20 ? 'text-rose-400' : val > 10 ? 'text-amber-400' : 'text-emerald-400'}`}>
          {val}
        </span>
      )
    },
    {
      header: 'Maintainability',
      key: 'maintainability',
      sortable: true,
      render: (val) => (
        <span className="text-zinc-200">
          {val} / 100
        </span>
      )
    },
    {
      header: 'Duplication',
      key: 'duplication',
      render: (val) => <span className="text-zinc-400">{val}</span>
    },
    {
      header: 'Coverage',
      key: 'testCoverage',
      render: (val) => <span className="text-emerald-400">{val}</span>
    },
    {
      header: 'Issues',
      key: 'issues',
      sortable: true,
      render: (val) => (
        <span className={val > 0 ? 'text-rose-300 font-semibold' : 'text-zinc-500'}>
          {val}
        </span>
      )
    },
    {
      header: 'Risk Level',
      key: 'risk',
      render: (val) => <RiskBadge level={val} size="sm" />
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <Activity size={20} className="text-cyan-400" />
            Code Health & Technical Debt
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Cyclomatic complexity distributions, maintainability index, duplication metrics, and refactoring priorities.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            Overall Health: <strong className="text-cyan-400">{metrics.healthScore}/100</strong>
          </span>
        </div>
      </div>

      {/* Code Health Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Complexity</span>
          <span className="text-xl font-bold text-rose-400 mt-0.5 block">{metrics.complexityScore}</span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Max Cyclomatic: 34</span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Maintainability</span>
          <span className="text-xl font-bold text-cyan-300 mt-0.5 block">{metrics.codeQualityScore} / 100</span>
          <span className="text-[10px] text-emerald-400 mt-1 block">+2.4 pts this sprint</span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Duplication</span>
          <span className="text-xl font-bold text-amber-400 mt-0.5 block">{metrics.duplicatedLines}%</span>
          <span className="text-[10px] text-zinc-400 mt-1 block">1,370 duplicate LOC</span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Code Smells</span>
          <span className="text-xl font-bold text-zinc-200 mt-0.5 block">18</span>
          <span className="text-[10px] text-zinc-400 mt-1 block">4 high priority</span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Technical Debt</span>
          <span className="text-xl font-bold text-zinc-200 mt-0.5 block">{metrics.technicalDebt}</span>
          <span className="text-[10px] text-zinc-400 mt-1 block">~31 hrs estimated</span>
        </div>
        <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 font-mono">
          <span className="text-zinc-500 text-[10px] uppercase block">Test Coverage</span>
          <span className="text-xl font-bold text-emerald-400 mt-0.5 block">{metrics.testCoverage}%</span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Jest & Vitest suites</span>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Complexity Distribution BarChart */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
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

          <div className="h-56 w-full font-mono text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={complexityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                <Bar dataKey="files" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Technical Debt Trajectory */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
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

          <div className="h-56 w-full font-mono text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={debtTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="week" stroke="#71717a" tickLine={false} />
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
                <Line type="monotone" dataKey="debtHours" name="Debt (Hours)" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="maintainability" name="Maintainability Index" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* File Level Health Table */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-100 font-mono">
            File-by-File Health Index ({healthFiles.length} files)
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

        <DataTable
          columns={columns}
          data={healthFiles}
          onRowClick={() => navigate('/code')}
          onSort={(key) => setSortColumn(key)}
        />
      </div>
    </div>
  );
}
