import React, { useState, useRef } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  Filter,
  Layers,
  Database,
  Globe,
  Server,
  FileCode,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownLeft,
  X
} from 'lucide-react';
import { RiskBadge } from '../common/RiskBadge';

export function CodeGraph({ graphData }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedLayer, setSelectedLayer] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const containerRef = useRef(null);

  if (!graphData) return null;

  const { nodes, edges } = graphData;

  const layers = ['ALL', 'Application Root', 'Authentication', 'API Gateway', 'Core Business', 'Data Storage', 'External Service'];

  const filteredNodes = nodes.filter(n => {
    const matchLayer = selectedLayer === 'ALL' || n.layer === selectedLayer;
    const matchSearch = !searchQuery || n.label.toLowerCase().includes(searchQuery.toLowerCase()) || n.layer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchLayer && matchSearch;
  });

  const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

  const filteredEdges = edges.filter(edge =>
    filteredNodeIds.has(edge.from) && filteredNodeIds.has(edge.to)
  );

  const isEdgeConnected = (edge) => {
    if (!selectedNode) return false;
    return edge.from === selectedNode.id || edge.to === selectedNode.id;
  };

  const getNodeById = (id) => nodes.find(n => n.id === id);

  const getNodeIcon = (type) => {
    switch (type) {
      case 'database':
        return Database;
      case 'external':
        return Globe;
      case 'service':
        return Server;
      case 'controller':
        return Server;
      default:
        return FileCode;
    }
  };

  const handleMouseDown = (e) => {
    if (e.target.closest('.interactive-node') || e.target.closest('.graph-controls')) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const resetView = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <div className="relative w-full h-[620px] rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden select-none flex flex-col">
      {/* Top Filter & Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-zinc-900/80 border-b border-zinc-800 z-10 text-xs">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter graph nodes..."
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 placeholder-zinc-500 text-xs rounded-md pl-7 pr-3 py-1.5 focus:outline-none focus:border-cyan-500 font-mono w-44 sm:w-56"
            />
          </div>

          <div className="hidden md:flex items-center gap-1">
            <Layers size={13} className="text-zinc-500 ml-2" />
            <select
              value={selectedLayer}
              onChange={(e) => setSelectedLayer(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2 py-1.5 focus:outline-none font-mono"
            >
              {layers.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Zoom & Canvas controls */}
        <div className="graph-controls flex items-center gap-1.5 bg-zinc-950 p-1 rounded-md border border-zinc-800">
          <button
            onClick={() => setZoomLevel(prev => Math.min(prev + 0.15, 2))}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 rounded"
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <span className="text-[11px] font-mono text-zinc-500 px-1">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={() => setZoomLevel(prev => Math.max(prev - 0.15, 0.5))}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 rounded"
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <button
            onClick={resetView}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 rounded"
            title="Reset View"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Interactive SVG Canvas Area */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`flex-1 relative overflow-hidden bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:20px_20px] ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <svg
          className="w-full h-full"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
            transformOrigin: '0 0',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
          }}
        >
          <defs>
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 8 5 L 0 9 z" fill="#3f3f46" />
            </marker>
            <marker
              id="arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 8 5 L 0 9 z" fill="#06b6d4" />
            </marker>
          </defs>

          {/* Edges — only rendered between visible (filtered) nodes */}
          {filteredEdges.map((edge, idx) => {
            const fromNode = getNodeById(edge.from);
            const toNode = getNodeById(edge.to);
            if (!fromNode || !toNode) return null;

            const isConnected = isEdgeConnected(edge);
            const isDimmed = selectedNode && !isConnected;

            return (
              <g key={idx}>
                <line
                  x1={fromNode.x + 80}
                  y1={fromNode.y + 24}
                  x2={toNode.x + 80}
                  y2={toNode.y + 24}
                  stroke={isConnected ? '#06b6d4' : '#3f3f46'}
                  strokeWidth={isConnected ? 2.5 : 1.2}
                  strokeDasharray={edge.label.includes('reverses') ? '4 3' : 'none'}
                  markerEnd={isConnected ? 'url(#arrow-active)' : 'url(#arrow-default)'}
                  opacity={isDimmed ? 0.2 : 0.8}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {filteredNodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            const Icon = getNodeIcon(node.type);

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={() => setSelectedNode(node)}
                className="interactive-node cursor-pointer group"
              >
                {/* Node Box */}
                <rect
                  width="170"
                  height="50"
                  rx="8"
                  fill="#090d16"
                  stroke={
                    isSelected
                      ? '#06b6d4'
                      : node.risk === 'CRITICAL'
                      ? '#be123c'
                      : node.risk === 'HIGH'
                      ? '#c2410c'
                      : '#27272a'
                  }
                  strokeWidth={isSelected ? 2 : 1}
                  className="transition-colors"
                />

                {/* Left Type Accent Stripe */}
                <rect
                  x="0"
                  y="0"
                  width="4"
                  height="50"
                  rx="2"
                  fill={
                    node.type === 'service'
                      ? '#06b6d4'
                      : node.type === 'database'
                      ? '#a855f7'
                      : node.type === 'external'
                      ? '#10b981'
                      : '#64748b'
                  }
                />

                {/* Node Label Text */}
                <text
                  x="14"
                  y="22"
                  fill="#f4f4f5"
                  fontSize="11"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {node.label.length > 20 ? node.label.slice(0, 18) + '...' : node.label}
                </text>

                {/* Node Layer / Meta */}
                <text
                  x="14"
                  y="38"
                  fill="#71717a"
                  fontSize="9.5"
                  fontFamily="sans-serif"
                >
                  {node.layer}
                </text>

                {/* Risk Dot */}
                <circle
                  cx="155"
                  cy="25"
                  r="4"
                  fill={
                    node.risk === 'CRITICAL'
                      ? '#f43f5e'
                      : node.risk === 'HIGH'
                      ? '#f97316'
                      : node.risk === 'MEDIUM'
                      ? '#f59e0b'
                      : '#10b981'
                  }
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Node Inspector Slide-in Drawer */}
      {selectedNode && (
        <div className="absolute right-0 top-14 bottom-0 w-80 bg-zinc-900 border-l border-zinc-800 p-4 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-150 z-20">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Node Details</span>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-zinc-500 hover:text-zinc-200 p-1"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-3 space-y-4 text-xs">
            <div>
              <div className="text-sm font-mono font-bold text-zinc-100 break-all">{selectedNode.label}</div>
              <div className="text-zinc-400 mt-0.5">{selectedNode.layer}</div>
            </div>

            <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs">
              <div>
                <span className="text-zinc-500 text-[10px] block">TYPE</span>
                <span className="text-zinc-200 uppercase font-semibold">{selectedNode.type}</span>
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] block">RISK</span>
                <RiskBadge level={selectedNode.risk} size="sm" />
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] block">COMPLEXITY</span>
                <span className="text-zinc-200 font-medium">{selectedNode.complexity}</span>
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] block">LOC</span>
                <span className="text-zinc-200 font-medium">{selectedNode.loc || 'N/A'}</span>
              </div>
            </div>

            <div>
              <span className="text-zinc-400 font-semibold block mb-1">Description</span>
              <p className="text-zinc-300 leading-relaxed bg-zinc-950/60 p-2.5 rounded border border-zinc-800">
                {selectedNode.description}
              </p>
            </div>

            {/* Connected Outward Dependencies */}
            <div>
              <span className="text-zinc-400 font-semibold flex items-center gap-1 mb-1.5">
                <ArrowUpRight size={13} className="text-cyan-400" />
                Dependencies (Outward)
              </span>
              <div className="space-y-1 font-mono text-[11px]">
                {edges.filter(e => e.from === selectedNode.id).length === 0 ? (
                  <span className="text-zinc-500 italic">No outward dependencies</span>
                ) : (
                  edges.filter(e => e.from === selectedNode.id).map((e, idx) => (
                    <div key={idx} className="p-1.5 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                      <span className="text-zinc-300 truncate">{getNodeById(e.to)?.label}</span>
                      <span className="text-[10px] text-zinc-500">{e.label}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Connected Inward Dependents */}
            <div>
              <span className="text-zinc-400 font-semibold flex items-center gap-1 mb-1.5">
                <ArrowDownLeft size={13} className="text-emerald-400" />
                Dependents (Inward)
              </span>
              <div className="space-y-1 font-mono text-[11px]">
                {edges.filter(e => e.to === selectedNode.id).length === 0 ? (
                  <span className="text-zinc-500 italic">No inward callers</span>
                ) : (
                  edges.filter(e => e.to === selectedNode.id).map((e, idx) => (
                    <div key={idx} className="p-1.5 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                      <span className="text-zinc-300 truncate">{getNodeById(e.from)?.label}</span>
                      <span className="text-[10px] text-zinc-500">{e.label}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
