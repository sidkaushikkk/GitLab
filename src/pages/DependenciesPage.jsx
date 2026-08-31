import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { dependencyService } from '../services/dependencyService';
import {
  Boxes,
  Search,
  Filter,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  ExternalLink,
  PackageCheck,
  FileText
} from 'lucide-react';
import { RiskBadge } from '../components/common/RiskBadge';
import { DataTable } from '../components/common/DataTable';
import { SearchBar } from '../components/common/SearchBar';

export function DependenciesPage({ headless = false }) {
  const { currentRepo } = useApp();
  const [dependencies, setDependencies] = useState([]);
  const [healthOverview, setHealthOverview] = useState(null);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [onlyVulnerable, setOnlyVulnerable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [deps, health] = await Promise.all([
        dependencyService.getDependencies({
          search,
          risk: riskFilter,
          onlyVulnerable
        }),
        dependencyService.getHealthOverview()
      ]);
      setDependencies(deps);
      setHealthOverview(health);
      setIsLoading(false);
    }
    load();
  }, [search, riskFilter, onlyVulnerable, currentRepo.id]);

  const columns = [
    {
      header: 'Package Name',
      key: 'name',
      render: (val, row) => (
        <div>
          <div className="flex items-center gap-1.5 font-bold text-zinc-100">
            <Boxes size={13} className="text-cyan-400 shrink-0" />
            <span>{val}</span>
            {row.direct && (
              <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 uppercase font-mono">
                Direct
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400 font-sans">{row.category}</div>
        </div>
      )
    },
    {
      header: 'Installed Version',
      key: 'version',
      render: (val) => <span className="text-zinc-300 font-mono">{val}</span>
    },
    {
      header: 'Latest Version',
      key: 'latest',
      render: (val, row) => (
        <span className={val !== row.version ? 'text-amber-400 font-mono' : 'text-emerald-400 font-mono'}>
          {val}
        </span>
      )
    },
    {
      header: 'Risk Level',
      key: 'risk',
      render: (val) => <RiskBadge level={val} size="sm" />
    },
    {
      header: 'Vulnerability / Advisory',
      key: 'vulnerability',
      render: (val, row) => (
        <div className="font-sans">
          <span className={row.vulnerabilitySeverity !== 'LOW' ? 'text-rose-300 font-semibold' : 'text-zinc-400'}>
            {val}
          </span>
          {row.upgradeRecommendation && (
            <div className="text-[10px] text-cyan-400 font-mono mt-0.5">
              {row.upgradeRecommendation}
            </div>
          )}
        </div>
      )
    },
    {
      header: 'Usages',
      key: 'usageCount',
      render: (val) => <span className="text-zinc-300 font-mono">{val} files</span>
    },
    {
      header: 'License',
      key: 'license',
      render: (val) => <span className="text-zinc-400 font-mono text-[11px]">{val}</span>
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header — hidden when embedded inside RepositoryDetailPage */}
      {!headless && (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <Boxes size={20} className="text-cyan-400" />
            Dependency Intelligence
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Package risk scoring, CVE security advisories, outdated version diffs, and license compliance audits.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            Total Packages: <strong className="text-cyan-400">{healthOverview?.total || 92}</strong>
          </span>
        </div>
      </div>
      )}

      {/* Dependency Health Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
          <span className="text-zinc-500 text-[10px] uppercase block">Total Packages</span>
          <span className="text-2xl font-bold text-zinc-100 mt-0.5 block">{healthOverview?.total || 92}</span>
          <span className="text-[10px] text-zinc-400 block mt-1">34 Direct / 58 Transitive</span>
        </div>
        <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/40">
          <span className="text-amber-400 text-[10px] uppercase font-semibold block">Outdated Packages</span>
          <span className="text-2xl font-bold text-amber-300 mt-0.5 block">{healthOverview?.outdated || 14}</span>
          <span className="text-[10px] text-zinc-400 block mt-1">New minor/major releases</span>
        </div>
        <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-900/40">
          <span className="text-rose-400 text-[10px] uppercase font-semibold block">Vulnerable Packages</span>
          <span className="text-2xl font-bold text-rose-300 mt-0.5 block">{healthOverview?.vulnerable || 3}</span>
          <span className="text-[10px] text-zinc-400 block mt-1">Open CVE advisories</span>
        </div>
        <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-900/40">
          <span className="text-emerald-400 text-[10px] uppercase font-semibold block">License Compliance</span>
          <span className="text-lg font-bold text-emerald-300 mt-0.5 block">100% Permissive</span>
          <span className="text-[10px] text-zinc-400 block mt-1">MIT / Apache 2.0 / BSD</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search packages by name, CVE, or category..."
            className="w-full sm:w-80"
          />

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <label className="flex items-center gap-1.5 text-xs font-mono text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyVulnerable}
                onChange={(e) => setOnlyVulnerable(e.target.checked)}
                className="rounded bg-zinc-900 border-zinc-700 text-cyan-500 focus:ring-0"
              />
              <span>Only Vulnerable ({healthOverview?.vulnerable || 3})</span>
            </label>

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

        {/* Dependency Table */}
        <DataTable
          columns={columns}
          data={dependencies}
          emptyMessage="No matching dependencies found"
        />
      </div>
    </div>
  );
}
