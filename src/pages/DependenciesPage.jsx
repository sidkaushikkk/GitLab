import React, { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { dependencyService } from "../services/dependencyService";
import {
  Boxes,
  Search,
  Filter,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  FileText,
  FolderGit2
} from "lucide-react";
import { DataTable } from "../components/common/DataTable";
import { SearchBar } from "../components/common/SearchBar";
import { WillBeIntegratedSoon, FeatureRoadmapBadge } from "../components/common/WillBeIntegratedSoon";
import { EmptyState } from "../components/common/EmptyState";
import { useNavigate } from "react-router-dom";

export function DependenciesPage({ headless = false, repoId = null }) {
  const { currentRepo } = useApp();
  const targetRepoId = repoId || currentRepo?.id;
  const [dependencies, setDependencies] = useState([]);
  const [healthOverview, setHealthOverview] = useState(null);
  const [search, setSearch] = useState("");
  const [directOnly, setDirectOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      if (!targetRepoId) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      const [deps, health] = await Promise.all([
        dependencyService.getDependencies({
          search,
          repoId: targetRepoId
        }),
        dependencyService.getHealthOverview(targetRepoId)
      ]);
      setDependencies(deps || []);
      setHealthOverview(health || null);
      setIsLoading(false);
    }
    load();
  }, [search, targetRepoId]);

  if (!currentRepo && !targetRepoId) {
    return (
      <div className="py-12">
        <EmptyState
          icon={FolderGit2}
          title="No repository selected"
          description="Select or connect a repository to view extracted manifest dependencies."
          actionLabel="Connect Repository"
          onAction={() => navigate("/connect")}
        />
      </div>
    );
  }

  const displayedDeps = directOnly ? dependencies.filter(d => d.direct) : dependencies;

  const totalPackages = healthOverview?.total ?? dependencies.length;
  const directCount = healthOverview?.directDependencies ?? dependencies.filter(d => d.direct).length;
  const transCount = healthOverview?.transitiveDependencies ?? (totalPackages - directCount);

  const columns = [
    {
      header: "Package Name",
      key: "name",
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
      header: "Installed Version",
      key: "version",
      render: (val) => <span className="text-zinc-300 font-mono">{val}</span>
    },
    {
      header: "Category",
      key: "category",
      render: (val) => <span className="text-xs font-mono text-zinc-300">{val}</span>
    },
    {
      header: "Internal Usages",
      key: "usageCount",
      render: (val) => <span className="text-zinc-300 font-mono text-xs">{val} {val === 1 ? "file" : "files"}</span>
    },
    {
      header: "License",
      key: "license",
      render: (val) => <span className="text-zinc-400 font-mono text-[11px]">{val || "—"}</span>
    },
    {
      header: "Vulnerability Advisory",
      key: "vulnerabilitiesCount",
      render: (val, row) => {
        if (val && val > 0) {
          return (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-rose-950/60 text-rose-300 border border-rose-800/60">
              <AlertTriangle size={12} className="text-rose-400 shrink-0" />
              {val} {val === 1 ? 'Advisory' : 'Advisories'} ({row.maxSeverity})
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900/40">
            <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
            Clean (0 Advisories)
          </span>
        );
      }
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
              Manifest-extracted package tree, internal import usages, direct/transitive relationships, and license specifications.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
              Total Packages: <strong className="text-cyan-400">{totalPackages}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Dependency Health Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
          <span className="text-zinc-500 text-[10px] uppercase block">Total Packages</span>
          <span className="text-2xl font-bold text-zinc-100 mt-0.5 block">{totalPackages}</span>
          <span className="text-[10px] text-zinc-400 block mt-1">{directCount} Direct / {transCount} Dev/Transitive</span>
        </div>
        {/* Outdated -> Will be integrated soon */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col justify-between">
          <div>
            <span className="text-zinc-500 text-[10px] uppercase block">Outdated Packages</span>
            <span className="text-xs font-bold text-cyan-400 mt-1 block">Will be integrated soon</span>
          </div>
          <span className="text-[10px] text-zinc-500 block">Registry version diffs</span>
        </div>
        {/* Vulnerable Packages */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between ${
          (healthOverview?.vulnerable || 0) > 0
            ? "bg-rose-950/20 border-rose-900/40"
            : "bg-zinc-900/60 border-zinc-800"
        }`}>
          <div>
            <span className="text-zinc-500 text-[10px] uppercase block">Vulnerable Packages</span>
            <span className={`text-2xl font-bold mt-0.5 block ${
              (healthOverview?.vulnerable || 0) > 0 ? "text-rose-400" : "text-emerald-400"
            }`}>
              {healthOverview?.vulnerable ?? 0}
            </span>
          </div>
          <span className="text-[10px] text-zinc-400 block mt-1">
            {(healthOverview?.highRisk || 0) > 0 ? `${healthOverview.highRisk} Critical/High` : 'Live OSV/CVE intelligence'}
          </span>
        </div>
        {/* License Compliance */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col justify-between">
          <div>
            <span className="text-zinc-500 text-[10px] uppercase block">License Compliance</span>
            <span className="text-sm font-bold text-zinc-200 mt-1 block truncate">
              {healthOverview?.licenseCompliance || "Will be integrated soon"}
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 block">Manifest SPDX evaluation</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search packages by name or category..."
            className="w-full sm:w-80"
          />

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <label className="flex items-center gap-1.5 text-xs font-mono text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={directOnly}
                onChange={(e) => setDirectOnly(e.target.checked)}
                className="rounded bg-zinc-900 border-zinc-700 text-cyan-500 focus:ring-0"
              />
              <span>Direct Dependencies Only ({directCount})</span>
            </label>
          </div>
        </div>

        {/* Dependency Table */}
        <DataTable
          columns={columns}
          data={displayedDeps}
          emptyMessage="No manifest dependencies extracted for this repository snapshot."
        />
      </div>
    </div>
  );
}
