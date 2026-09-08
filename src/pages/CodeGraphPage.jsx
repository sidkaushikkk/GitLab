import React, { useState, useEffect } from "react";
import { codeGraphService } from "../services/codeGraphService";
import { useApp } from "../context/AppContext";
import { Network, AlertTriangle, FolderGit2 } from "lucide-react";
import { CodeGraph } from "../components/graph/CodeGraph";
import { EmptyState } from "../components/common/EmptyState";
import { useNavigate } from "react-router-dom";

export function CodeGraphPage({ headless = false, repoId = null }) {
  const { currentRepo } = useApp();
  const targetRepoId = repoId || currentRepo?.id;
  const [graphData, setGraphData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      if (!targetRepoId) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      const data = await codeGraphService.getGraphData(targetRepoId);
      setGraphData(data);
      setIsLoading(false);
    }
    load();
  }, [targetRepoId]);

  if (!currentRepo && !targetRepoId) {
    return (
      <div className="py-12">
        <EmptyState
          icon={FolderGit2}
          title="No repository selected"
          description="Select or connect a repository to view architectural code graphs and dependency topologies."
          actionLabel="Connect Repository"
          onAction={() => navigate("/connect")}
        />
      </div>
    );
  }

  const nodesCount = graphData?.nodes?.length || 0;
  const edgesCount = graphData?.edges?.length || 0;

  // Compute circular dependency edges count
  const cycleCount = (graphData?.edges || []).filter(e1 =>
    (graphData?.edges || []).some(e2 => e2.from === e1.to && e2.to === e1.from)
  ).length / 2;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header — hidden when embedded inside RepositoryDetailPage */}
      {!headless && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
                <Network size={20} className="text-cyan-400" />
                Architecture & Code Graph
              </h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 hidden sm:flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                AST Graph Topology
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              Interactive topology map of modules, services, controllers, database pools, and external API gateways.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
            <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800">
              Modules: <strong className="text-zinc-200">{nodesCount}</strong>
            </span>
            <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800">
              Imports: <strong className="text-cyan-400">{edgesCount}</strong>
            </span>
            {cycleCount > 0 && (
              <span className="px-2.5 py-1 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-rose-400" />
                Cycles: <strong className="text-rose-200">{cycleCount}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Interactive Canvas or Empty State */}
      {nodesCount > 0 ? (
        <CodeGraph graphData={graphData} />
      ) : (
        <div className="p-12 text-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50">
          <Network size={32} className="mx-auto text-zinc-600 mb-3" />
          <h4 className="text-sm font-bold font-mono text-zinc-200 mb-1">
            No architecture graph data available
          </h4>
          <p className="text-xs text-zinc-400 max-w-md mx-auto font-sans leading-relaxed">
            Run an analysis scan on this repository snapshot to extract internal module imports and render the dependency graph.
          </p>
        </div>
      )}

      {/* Legend & Instructions */}
      <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-zinc-400">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-zinc-300 font-semibold">Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-cyan-400" /> Services
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-purple-400" /> Databases
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-emerald-400" /> External APIs
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-slate-400" /> Controllers
          </span>
        </div>

        <div className="text-[11px] text-zinc-500 font-sans">
          Click on any node to inspect blast radius and highlight dependencies.
        </div>
      </div>
    </div>
  );
}
