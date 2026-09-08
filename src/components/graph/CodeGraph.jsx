import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  Layers,
  Database,
  Globe,
  Server,
  FileCode,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  X,
  GitFork,
  Activity,
  CircleDot
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RiskBadge } from '../common/RiskBadge';
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  ARCHITECTURAL_LAYERS,
  formatNodeDisplay,
  layoutLayered,
  layoutForce,
  layoutRadial,
  calculateEdgePath,
  calculateGraphBounds
} from './graphLayout';

export function CodeGraph({ graphData }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [layoutMode, setLayoutMode] = useState('layered'); // 'layered' | 'force' | 'radial'
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedLayer, setSelectedLayer] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCyclesOnly, setShowCyclesOnly] = useState(false);
  const navigate = useNavigate();

  const containerRef = useRef(null);

  if (!graphData) return null;

  const rawNodes = graphData.nodes || [];
  const rawEdges = graphData.edges || [];

  // Detect circular dependency loops (reciprocal edges A->B and B->A)
  const circularEdges = useMemo(() => {
    const set = new Set();
    rawEdges.forEach(e1 => {
      if (rawEdges.some(e2 => e2.from === e1.to && e2.to === e1.from)) {
        set.add(`${e1.from}->${e1.to}`);
      }
    });
    return set;
  }, [rawEdges]);

  // Set of all node IDs participating in a circular dependency
  const cycleNodeIds = useMemo(() => {
    const set = new Set();
    circularEdges.forEach(key => {
      const [from, to] = key.split('->');
      set.add(from);
      set.add(to);
    });
    return set;
  }, [circularEdges]);

  const layers = [
    'ALL',
    'Application Root',
    'API Gateway',
    'Authentication',
    'Core Business',
    'Data Storage',
    'External Service'
  ];

  // 1. Filter nodes based on layer, search query, and cycle-only toggle
  const filteredNodes = useMemo(() => {
    return rawNodes.filter(n => {
      if (showCyclesOnly && !cycleNodeIds.has(n.id)) return false;
      const matchLayer = selectedLayer === 'ALL' || n.layer === selectedLayer;
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        (n.label && n.label.toLowerCase().includes(q)) ||
        (n.id && n.id.toLowerCase().includes(q)) ||
        (n.layer && n.layer.toLowerCase().includes(q));
      return matchLayer && matchSearch;
    });
  }, [rawNodes, selectedLayer, searchQuery, showCyclesOnly, cycleNodeIds]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);

  // 2. Filter edges to only connect visible nodes
  const filteredEdges = useMemo(() => {
    return rawEdges.filter(edge =>
      filteredNodeIds.has(edge.from) && filteredNodeIds.has(edge.to)
    );
  }, [rawEdges, filteredNodeIds]);

  // 3. Compute non-overlapping layout positions
  const positionedNodes = useMemo(() => {
    if (filteredNodes.length === 0) return [];
    if (layoutMode === 'force') {
      return layoutForce(filteredNodes, filteredEdges);
    }
    if (layoutMode === 'radial') {
      return layoutRadial(filteredNodes, filteredEdges);
    }
    return layoutLayered(filteredNodes, filteredEdges);
  }, [filteredNodes, filteredEdges, layoutMode]);

  const nodePositionMap = useMemo(() => {
    const map = new Map();
    positionedNodes.forEach(n => map.set(n.id, n));
    return map;
  }, [positionedNodes]);

  // 4. Determine connections when a node is selected
  const { outgoingIds, incomingIds, connectedNodeIds, connectedEdgeKeys } = useMemo(() => {
    if (!selectedNode) {
      return {
        outgoingIds: new Set(),
        incomingIds: new Set(),
        connectedNodeIds: new Set(),
        connectedEdgeKeys: new Set()
      };
    }
    const outSet = new Set();
    const inSet = new Set();
    const edgeKeys = new Set();

    filteredEdges.forEach(e => {
      if (e.from === selectedNode.id) {
        outSet.add(e.to);
        edgeKeys.add(`${e.from}->${e.to}`);
      }
      if (e.to === selectedNode.id) {
        inSet.add(e.from);
        edgeKeys.add(`${e.from}->${e.to}`);
      }
    });

    const connNodes = new Set([selectedNode.id, ...outSet, ...inSet]);
    return {
      outgoingIds: outSet,
      incomingIds: inSet,
      connectedNodeIds: connNodes,
      connectedEdgeKeys: edgeKeys
    };
  }, [selectedNode, filteredEdges]);

  // 5. Viewport auto-fitting
  const fitToView = useCallback(() => {
    if (!containerRef.current || positionedNodes.length === 0) {
      setZoomLevel(1);
      setPanOffset({ x: 40, y: 40 });
      return;
    }

    const bounds = calculateGraphBounds(positionedNodes, 50);
    const containerW = containerRef.current.clientWidth || 900;
    const containerH = containerRef.current.clientHeight || 600;

    const scaleX = (containerW - 80) / bounds.width;
    const scaleY = (containerH - 80) / bounds.height;
    // Scale between 0.35 and 1.05
    const fitScale = Math.max(0.35, Math.min(scaleX, scaleY, 1.0));

    const panX = Math.round((containerW - bounds.width * fitScale) / 2 - bounds.minX * fitScale);
    const panY = Math.round((containerH - bounds.height * fitScale) / 2 - bounds.minY * fitScale);

    setZoomLevel(fitScale);
    setPanOffset({ x: panX, y: panY });
  }, [positionedNodes]);

  // Auto-fit on layout mode switch or major filter change
  useEffect(() => {
    const timer = setTimeout(() => {
      fitToView();
    }, 40);
    return () => clearTimeout(timer);
  }, [layoutMode, selectedLayer, showCyclesOnly, fitToView]);

  // Pan interaction
  const handleMouseDown = (e) => {
    if (e.target.closest('.interactive-node') || e.target.closest('.graph-controls')) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Mouse wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoomLevel(prev => Math.min(2.5, Math.max(0.25, Number((prev * zoomFactor).toFixed(2)))));
  };

  const getNodeIcon = (type) => {
    switch (type) {
      case 'database':
        return Database;
      case 'external':
        return Globe;
      case 'controller':
        return Server;
      case 'service':
        return Server;
      default:
        return FileCode;
    }
  };

  const getAccentColor = (type) => {
    switch (type) {
      case 'service':
        return '#06b6d4'; // Cyan
      case 'database':
        return '#a855f7'; // Purple
      case 'external':
        return '#10b981'; // Emerald
      case 'controller':
        return '#38bdf8'; // Sky blue
      case 'entrypoint':
        return '#ec4899'; // Pink
      default:
        return '#64748b'; // Slate
    }
  };

  return (
    <div className="relative w-full h-[660px] rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden select-none flex flex-col">
      {/* Top Filter, Layout Switcher & Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 bg-zinc-900/90 border-b border-zinc-800 z-10 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search input */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search module / file..."
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 placeholder-zinc-500 text-xs rounded-md pl-7 pr-3 py-1.5 focus:outline-none focus:border-cyan-500 font-mono w-40 sm:w-52"
            />
          </div>

          {/* Layer Filter Dropdown */}
          <div className="flex items-center gap-1">
            <Layers size={13} className="text-zinc-500 ml-1" />
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

          {/* Cycle Quick Filter Pill */}
          {cycleNodeIds.size > 0 && (
            <button
              onClick={() => setShowCyclesOnly(prev => !prev)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono flex items-center gap-1.5 transition-colors border ${
                showCyclesOnly
                  ? 'bg-rose-950 text-rose-200 border-rose-700'
                  : 'bg-zinc-950 text-rose-400 border-rose-900/60 hover:bg-rose-950/40'
              }`}
              title="Filter strictly to circular dependency modules"
            >
              <AlertTriangle size={12} className="text-rose-400" />
              <span>Cycles ({cycleNodeIds.size})</span>
            </button>
          )}
        </div>

        {/* Layout Mode Switcher & Zoom Controls */}
        <div className="graph-controls flex items-center gap-2">
          {/* Layout Mode Selector */}
          <div className="flex items-center rounded-md bg-zinc-950 p-0.5 border border-zinc-800 text-[11px] font-mono">
            <button
              onClick={() => setLayoutMode('layered')}
              className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                layoutMode === 'layered'
                  ? 'bg-cyan-950 text-cyan-300 font-semibold border border-cyan-800/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Architectural Layered Flow (Left to Right Swimlanes)"
            >
              <GitFork size={12} />
              <span className="hidden sm:inline">Flow</span>
            </button>
            <button
              onClick={() => setLayoutMode('force')}
              className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                layoutMode === 'force'
                  ? 'bg-cyan-950 text-cyan-300 font-semibold border border-cyan-800/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Force-Directed Clustering (Collision-Free Physics)"
            >
              <Activity size={12} />
              <span className="hidden sm:inline">Clusters</span>
            </button>
            <button
              onClick={() => setLayoutMode('radial')}
              className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                layoutMode === 'radial'
                  ? 'bg-cyan-950 text-cyan-300 font-semibold border border-cyan-800/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Concentric Multi-Tier Rings"
            >
              <CircleDot size={12} />
              <span className="hidden sm:inline">Rings</span>
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800">
            <button
              onClick={() => setZoomLevel(prev => Math.min(prev + 0.15, 2.5))}
              className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 rounded"
              title="Zoom In"
            >
              <ZoomIn size={13} />
            </button>
            <span className="text-[10.5px] font-mono text-zinc-400 px-1 min-w-[34px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel(prev => Math.max(prev - 0.15, 0.25))}
              className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 rounded"
              title="Zoom Out"
            >
              <ZoomOut size={13} />
            </button>
            <div className="w-px h-3.5 bg-zinc-800 mx-0.5" />
            <button
              onClick={fitToView}
              className="p-1 text-zinc-400 hover:text-cyan-300 hover:bg-zinc-850 rounded"
              title="Fit to Screen"
            >
              <Maximize2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Interactive SVG Canvas Area */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp();
          setHoveredNode(null);
        }}
        onWheel={handleWheel}
        className={`flex-1 relative overflow-hidden bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px] ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <svg
          className="w-full h-full"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
            transformOrigin: '0 0',
            transition: isDragging ? 'none' : 'transform 0.12s ease-out'
          }}
          onClick={(e) => {
            if (!e.target.closest('.interactive-node')) {
              setSelectedNode(null);
            }
          }}
        >
          <defs>
            {/* Standard Edge Arrow */}
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#52525b" />
            </marker>

            {/* Selected Connected Arrow */}
            <marker
              id="arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#06b6d4" />
            </marker>

            {/* Circular Dependency Cycle Arrow */}
            <marker
              id="arrow-cycle"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f43f5e" />
            </marker>

            {/* Node Active Glow Filter */}
            <filter id="node-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#06b6d4" floodOpacity="0.4" />
            </filter>
            <filter id="cycle-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#f43f5e" floodOpacity="0.5" />
            </filter>
          </defs>

          {/* Layer Boundary Watermarks (Layered Mode Only) */}
          {layoutMode === 'layered' && (
            <g className="layer-watermarks pointer-events-none opacity-20">
              {ARCHITECTURAL_LAYERS.map((layerName, idx) => {
                const layerNodes = positionedNodes.filter(n => (n.layer || 'Core Business') === layerName);
                if (layerNodes.length === 0) return null;
                const minX = Math.min(...layerNodes.map(n => n.x));
                const maxX = Math.max(...layerNodes.map(n => n.x + (n.width || NODE_WIDTH)));
                return (
                  <g key={layerName}>
                    <line
                      x1={minX - 16}
                      y1={10}
                      x2={minX - 16}
                      y2={1200}
                      stroke="#3f3f46"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={minX + 4}
                      y={30}
                      fill="#71717a"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="600"
                    >
                      {layerName.toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* Edges Layer */}
          <g className="edges-layer">
            {filteredEdges.map((edge, idx) => {
              const fromNode = nodePositionMap.get(edge.from);
              const toNode = nodePositionMap.get(edge.to);
              if (!fromNode || !toNode) return null;

              const edgeKey = `${edge.from}->${edge.to}`;
              const isCycle = circularEdges.has(edgeKey) || edge.isCycle;
              const isConnected = connectedEdgeKeys.has(edgeKey);
              const isDimmed = selectedNode && !isConnected;

              // If reciprocal, determine if this direction is considered reversed
              const isReciprocal = circularEdges.has(edgeKey);
              const isReciprocalReversed = isReciprocal && edge.from > edge.to;

              const pathD = calculateEdgePath(fromNode, toNode, isCycle, isReciprocalReversed);

              return (
                <g key={idx} className="edge-group">
                  {/* Invisible thicker hit-box path for easier hover */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    className="cursor-pointer"
                  />

                  {/* Visible rendered path */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={
                      isConnected
                        ? '#06b6d4'
                        : isCycle
                        ? '#f43f5e'
                        : '#3f3f46'
                    }
                    strokeWidth={
                      isConnected
                        ? 2.5
                        : isCycle
                        ? 2.0
                        : 1.2
                    }
                    strokeDasharray={
                      isCycle
                        ? '6 4'
                        : (edge.label || '').includes('reverses')
                        ? '4 3'
                        : 'none'
                    }
                    markerEnd={
                      isConnected
                        ? 'url(#arrow-active)'
                        : isCycle
                        ? 'url(#arrow-cycle)'
                        : 'url(#arrow-default)'
                    }
                    opacity={isDimmed ? 0.12 : isConnected ? 1.0 : isCycle ? 0.95 : 0.75}
                    className="transition-all duration-150"
                  />
                </g>
              );
            })}
          </g>

          {/* Nodes Layer */}
          <g className="nodes-layer">
            {positionedNodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;
              const isDependency = outgoingIds.has(node.id);
              const isCaller = incomingIds.has(node.id);
              const isConnected = isSelected || isDependency || isCaller;
              const isDimmed = selectedNode && !isConnected;
              const isCycleNode = cycleNodeIds.has(node.id);

              const accentColor = getAccentColor(node.type);
              const display = formatNodeDisplay(node.label || node.id, node.layer);

              const cardW = node.width || NODE_WIDTH;
              const cardH = node.height || NODE_HEIGHT;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNode(node);
                  }}
                  onMouseEnter={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) {
                      setTooltipPos({
                        x: e.clientX - rect.left + 15,
                        y: e.clientY - rect.top + 15
                      });
                    }
                    setHoveredNode(node);
                  }}
                  onMouseLeave={() => setHoveredNode(null)}
                  opacity={isDimmed ? 0.2 : 1.0}
                  className="interactive-node cursor-pointer group transition-opacity duration-150"
                  filter={isSelected ? 'url(#node-glow)' : isCycleNode && showCyclesOnly ? 'url(#cycle-glow)' : undefined}
                >
                  {/* Card Background Rectangle */}
                  <rect
                    width={cardW}
                    height={cardH}
                    rx={7}
                    fill="#090d16"
                    stroke={
                      isSelected
                        ? '#06b6d4'
                        : isDependency
                        ? '#06b6d4'
                        : isCaller
                        ? '#10b981'
                        : isCycleNode
                        ? '#f43f5e'
                        : node.risk === 'CRITICAL'
                        ? '#be123c'
                        : node.risk === 'HIGH'
                        ? '#c2410c'
                        : '#27272a'
                    }
                    strokeWidth={isSelected ? 2 : isDependency || isCaller ? 1.7 : 1}
                    className="transition-colors duration-150 group-hover:stroke-cyan-400/80"
                  />

                  {/* Left Accent Stripe */}
                  <rect
                    x={0}
                    y={0}
                    width={4}
                    height={cardH}
                    rx={2}
                    fill={accentColor}
                  />

                  {/* Relationship Indicator Badges when a node is selected */}
                  {selectedNode && (isDependency || isCaller) && (
                    <g transform={`translate(${cardW - 38}, 4)`}>
                      <rect
                        width={34}
                        height={12}
                        rx={3}
                        fill={isDependency ? '#083344' : '#064e3b'}
                        stroke={isDependency ? '#06b6d4' : '#10b981'}
                        strokeWidth={0.5}
                      />
                      <text
                        x={17}
                        y={9}
                        textAnchor="middle"
                        fill={isDependency ? '#67e8f9' : '#6ee7b7'}
                        fontSize="8"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="600"
                      >
                        {isDependency ? 'DEP' : 'CALL'}
                      </text>
                    </g>
                  )}

                  {/* Node Primary Label (Clean Filename or Module) */}
                  <text
                    x={12}
                    y={20}
                    fill="#f4f4f5"
                    fontSize="10.5"
                    fontWeight="600"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {display.primary.length > 18
                      ? display.primary.slice(0, 16) + '...'
                      : display.primary}
                  </text>

                  {/* Node Secondary Subtitle (Folder / Context) */}
                  <text
                    x={12}
                    y={36}
                    fill="#71717a"
                    fontSize="9"
                    fontFamily="sans-serif"
                  >
                    {display.secondary.length > 22
                      ? display.secondary.slice(0, 20) + '...'
                      : display.secondary}
                  </text>

                  {/* Risk Status Indicator Dot */}
                  {!selectedNode && (
                    <circle
                      cx={cardW - 12}
                      cy={cardH / 2}
                      r={3.5}
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
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Floating Hover Tooltip */}
        {hoveredNode && !isDragging && (
          <div
            style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}
            className="pointer-events-none absolute z-30 max-w-xs p-2.5 rounded-lg bg-zinc-900/95 border border-zinc-700 shadow-2xl backdrop-blur-sm text-xs font-mono animate-in fade-in duration-100"
          >
            <div className="flex items-center gap-1.5 pb-1 border-b border-zinc-800">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getAccentColor(hoveredNode.type) }}
              />
              <span className="font-bold text-zinc-100 truncate">
                {formatNodeDisplay(hoveredNode.label || hoveredNode.id).primary}
              </span>
            </div>
            <div className="text-[10px] text-zinc-400 break-all mt-1">
              {hoveredNode.id}
            </div>
            <div className="flex items-center justify-between text-[10px] text-zinc-300 mt-1.5 pt-1 border-t border-zinc-800/60">
              <span>{hoveredNode.layer}</span>
              <span className="text-zinc-500 uppercase">{hoveredNode.type}</span>
            </div>
            {cycleNodeIds.has(hoveredNode.id) && (
              <div className="mt-1.5 text-[10px] text-rose-400 flex items-center gap-1">
                <AlertTriangle size={11} />
                <span>Circular dependency cycle</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Node Inspector Slide-in Drawer */}
      {selectedNode && (
        <div className="absolute right-0 top-12 bottom-0 w-80 bg-zinc-900/95 border-l border-zinc-800 p-4 shadow-2xl overflow-y-auto backdrop-blur-sm animate-in slide-in-from-right duration-150 z-20">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Node Details</span>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-zinc-500 hover:text-zinc-200 p-1"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-3 space-y-3.5 text-xs">
            <div>
              <div className="text-sm font-mono font-bold text-zinc-100 break-all">
                {formatNodeDisplay(selectedNode.label || selectedNode.id).primary}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 break-all mt-0.5">
                {selectedNode.id}
              </div>
              <div className="text-zinc-500 text-[11px] mt-0.5">{selectedNode.layer}</div>
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

            {/* Circular Dependency Warning Banner */}
            {cycleNodeIds.has(selectedNode.id) && (
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 flex items-start gap-2">
                <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block font-mono text-[11px]">Circular Dependency Detected</span>
                  <span className="text-[11px] text-zinc-300 leading-tight block mt-0.5">
                    This module participates in a mutual import cycle. Refactor to break tight coupling.
                  </span>
                </div>
              </div>
            )}

            <div>
              <span className="text-zinc-400 font-semibold block mb-1">Description</span>
              <p className="text-zinc-300 leading-relaxed bg-zinc-950/60 p-2.5 rounded border border-zinc-800 text-[11.5px]">
                {selectedNode.description}
              </p>
            </div>

            {/* Connected Outward Dependencies */}
            <div>
              <span className="text-zinc-400 font-semibold flex items-center gap-1 mb-1.5">
                <ArrowUpRight size={13} className="text-cyan-400" />
                Dependencies (Outward: {outgoingIds.size})
              </span>
              <div className="space-y-1 font-mono text-[11px] max-h-36 overflow-y-auto">
                {outgoingIds.size === 0 ? (
                  <span className="text-zinc-500 italic">No outward dependencies</span>
                ) : (
                  Array.from(outgoingIds).map((targetId) => {
                    const isCycle = circularEdges.has(`${selectedNode.id}->${targetId}`);
                    const targetNode = rawNodes.find(n => n.id === targetId);
                    return (
                      <div
                        key={targetId}
                        onClick={() => targetNode && setSelectedNode(targetNode)}
                        className="p-1.5 rounded bg-zinc-950 border border-zinc-800 hover:border-cyan-700/60 cursor-pointer flex items-center justify-between"
                      >
                        <span className="text-zinc-300 truncate">
                          {formatNodeDisplay(targetNode?.label || targetId).primary}
                        </span>
                        <span className={`text-[10px] ${isCycle ? 'text-rose-400 font-semibold' : 'text-zinc-500'}`}>
                          {isCycle ? 'CYCLE ⚠' : 'imports'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Connected Inward Callers */}
            <div>
              <span className="text-zinc-400 font-semibold flex items-center gap-1 mb-1.5">
                <ArrowDownLeft size={13} className="text-emerald-400" />
                Callers / Fan-In ({incomingIds.size})
              </span>
              <div className="space-y-1 font-mono text-[11px] max-h-36 overflow-y-auto">
                {incomingIds.size === 0 ? (
                  <span className="text-zinc-500 italic">No inward callers</span>
                ) : (
                  Array.from(incomingIds).map((callerId) => {
                    const isCycle = circularEdges.has(`${callerId}->${selectedNode.id}`);
                    const callerNode = rawNodes.find(n => n.id === callerId);
                    return (
                      <div
                        key={callerId}
                        onClick={() => callerNode && setSelectedNode(callerNode)}
                        className="p-1.5 rounded bg-zinc-950 border border-zinc-800 hover:border-emerald-700/60 cursor-pointer flex items-center justify-between"
                      >
                        <span className="text-zinc-300 truncate">
                          {formatNodeDisplay(callerNode?.label || callerId).primary}
                        </span>
                        <span className={`text-[10px] ${isCycle ? 'text-rose-400 font-semibold' : 'text-zinc-500'}`}>
                          {isCycle ? 'CYCLE ⚠' : 'caller'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Navigate to Code Viewer Button */}
            <button
              onClick={() => navigate(`/code?file=${encodeURIComponent(selectedNode.id)}`, { state: { file: selectedNode.id } })}
              className="w-full mt-2 py-2 px-3 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-800/80 text-cyan-300 font-mono text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>Inspect Source Code</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
