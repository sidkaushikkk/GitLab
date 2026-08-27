import React, { useState, useEffect } from 'react';
import { codeGraphService } from '../services/codeGraphService';
import { useApp } from '../context/AppContext';
import { Network, Info, Layers, RefreshCw } from 'lucide-react';
import { CodeGraph } from '../components/graph/CodeGraph';

export function CodeGraphPage() {
  const { currentRepo } = useApp();
  const [graphData, setGraphData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const data = await codeGraphService.getGraphData();
      setGraphData(data);
      setIsLoading(false);
    }
    load();
  }, [currentRepo.id]);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <Network size={20} className="text-cyan-400" />
            Architecture & Code Graph
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Interactive topology map of modules, services, controllers, database pools, and external API gateways.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800">
            Nodes: <strong className="text-zinc-200">{graphData?.nodes.length || 10}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800">
            Edges: <strong className="text-cyan-400">{graphData?.edges.length || 14}</strong>
          </span>
        </div>
      </div>

      {/* Interactive Canvas */}
      {graphData && <CodeGraph graphData={graphData} />}

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
