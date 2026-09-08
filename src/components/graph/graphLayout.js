/**
 * graphLayout.js
 * Comprehensive layout algorithms and edge routing for the Architecture & Code Graph.
 * Provides:
 *  - formatNodeDisplay: extracts clean filename, folder context, and full path
 *  - layoutLayered: architectural swimlanes with sub-column wrapping and collision-free grid
 *  - layoutForce: organic force-directed layout with rigid card bounding-box collision avoidance
 *  - layoutRadial: multi-tier concentric rings with dynamic circumference scaling
 *  - calculateEdgePath: cubic bezier curve routing with card perimeter anchors and opposing cycle arcs
 *  - calculateGraphBounds: computes graph bounding box for auto-fit and viewport responsiveness
 */

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 48;

/**
 * Standard architectural layer hierarchy order
 */
export const ARCHITECTURAL_LAYERS = [
  'Application Root',
  'API Gateway',
  'Authentication',
  'Core Business',
  'Data Storage',
  'External Service'
];

/**
 * Formats a raw file path or package label into a sensible display title and subtitle.
 * Extracts the actual filename for the primary label and directory/scope for subtitle.
 *
 * Example:
 *  'backend/src/services/intelligence/parsers/javascriptParser.js'
 *   -> primary: 'javascriptParser.js'
 *   -> secondary: 'parsers/ • Core Business'
 *  'node:url'
 *   -> primary: 'node:url'
 *   -> secondary: 'core module'
 */
export function formatNodeDisplay(rawLabel, layer = '') {
  if (!rawLabel || typeof rawLabel !== 'string') {
    return { primary: 'Unknown', secondary: layer || '', fullPath: '' };
  }

  const clean = rawLabel.trim();

  // Node built-in module (e.g. node:url, node:fs, node:path)
  if (clean.startsWith('node:')) {
    return {
      primary: clean,
      secondary: 'core module',
      fullPath: clean
    };
  }

  // External package or standard import without path (e.g. 'express', '@babel/parser')
  if (!clean.includes('/') && !clean.includes('\\')) {
    return {
      primary: clean,
      secondary: layer || 'External Package',
      fullPath: clean
    };
  }

  // File path with directories
  const normalized = clean.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || clean;
  const parentFolder = parts.length > 1 ? parts[parts.length - 2] : '';

  const secondary = parentFolder
    ? `${parentFolder}/`
    : (layer || '');

  return {
    primary: fileName,
    secondary,
    fullPath: clean
  };
}

/**
 * Layered Architecture Layout (Swimlanes / Hierarchical Flow)
 * Groups nodes by architectural layer in logical left-to-right columns.
 * If a layer contains many nodes, it wraps into multiple sub-columns to prevent
 * excessive vertical height while guaranteeing zero overlap.
 */
export function layoutLayered(nodes, edges, options = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const cardWidth = options.cardWidth || NODE_WIDTH;
  const cardHeight = options.cardHeight || NODE_HEIGHT;
  const interLayerGap = options.interLayerGap || 56;
  const subColGap = options.subColGap || 24;
  const rowGap = options.rowGap || 18;

  // Group nodes by architectural layer
  const layerGroups = new Map();
  for (const layer of ARCHITECTURAL_LAYERS) {
    layerGroups.set(layer, []);
  }

  for (const node of nodes) {
    const layer = node.layer || 'Core Business';
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, []);
    }
    layerGroups.get(layer).push(node);
  }

  let currentX = 50;
  let maxColumnHeight = 0;
  const columnsMeta = [];

  // 1. Calculate dimensions and sub-column distributions
  for (const [layerName, groupNodes] of layerGroups.entries()) {
    if (groupNodes.length === 0) continue;

    const count = groupNodes.length;
    // Calculate balanced sub-column wrapping:
    // e.g. 1-4 nodes -> 1 column
    // 5-10 nodes -> 2 columns
    // 11-20 nodes -> 2 to 3 columns
    // 21+ nodes -> 3 to 4 columns
    const maxRowsPerCol = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(count * 2.2))));
    const numSubCols = Math.ceil(count / maxRowsPerCol);
    const actualRows = Math.min(count, maxRowsPerCol);

    const layerWidth = numSubCols * cardWidth + (numSubCols - 1) * subColGap;
    const layerHeight = actualRows * (cardHeight + rowGap) - rowGap;

    if (layerHeight > maxColumnHeight) {
      maxColumnHeight = layerHeight;
    }

    columnsMeta.push({
      layerName,
      nodes: groupNodes,
      numSubCols,
      maxRowsPerCol,
      startX: currentX,
      width: layerWidth,
      height: layerHeight
    });

    currentX += layerWidth + interLayerGap;
  }

  // 2. Assign coordinates with vertical centering
  const centerY = Math.max(260, maxColumnHeight / 2 + 50);
  const positionedNodes = [];

  for (const col of columnsMeta) {
    const startY = Math.max(50, centerY - col.height / 2);

    col.nodes.forEach((node, idx) => {
      const subColIdx = Math.floor(idx / col.maxRowsPerCol);
      const rowIdx = idx % col.maxRowsPerCol;

      const x = col.startX + subColIdx * (cardWidth + subColGap);
      const y = startY + rowIdx * (cardHeight + rowGap);

      positionedNodes.push({
        ...node,
        x: Math.round(x),
        y: Math.round(y),
        width: cardWidth,
        height: cardHeight
      });
    });
  }

  return positionedNodes;
}

/**
 * Organic Force-Directed Layout with Rigid Bounding-Box Collision Avoidance
 * Physics-based spring-electrical simulation where connected modules cluster together
 * while non-overlapping card collision resolution prevents any card overlaps.
 */
export function layoutForce(nodes, edges, options = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const cardWidth = options.cardWidth || NODE_WIDTH;
  const cardHeight = options.cardHeight || NODE_HEIGHT;
  const N = nodes.length;

  // Initial seed coordinates using a golden-ratio spiral for uniform density
  const cx = 550;
  const cy = 350;
  const posNodes = nodes.map((node, i) => {
    const r = Math.sqrt(i + 1) * 115 + 70;
    const theta = i * 2.3999632; // golden angle in radians
    return {
      ...node,
      x: cx + r * Math.cos(theta),
      y: cy + r * Math.sin(theta) * 0.72,
      vx: 0,
      vy: 0,
      width: cardWidth,
      height: cardHeight
    };
  });

  const nodeMap = new Map();
  posNodes.forEach(n => nodeMap.set(n.id, n));

  const iterations = 85;
  const kRepulse = 42000;
  const kAttract = 0.045;
  const targetDist = 190;
  const kGravity = 0.022;

  // Rigid collision minimum margins
  const minDx = cardWidth + 24;
  const minDy = cardHeight + 18;

  for (let iter = 0; iter < iterations; iter++) {
    const temp = Math.pow(1 - iter / iterations, 1.2);

    // 1. Coulomb Repulsion between all node pairs
    for (let i = 0; i < N; i++) {
      const n1 = posNodes[i];
      for (let j = i + 1; j < N; j++) {
        const n2 = posNodes[j];
        let dx = n2.x - n1.x;
        let dy = n2.y - n1.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distSq = 1;
        }
        const dist = Math.sqrt(distSq);

        const f = (kRepulse / (distSq + 600)) * temp;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;

        n1.vx -= fx;
        n1.vy -= fy;
        n2.vx += fx;
        n2.vy += fy;
      }
    }

    // 2. Spring Attraction along active relationships
    if (Array.isArray(edges)) {
      for (const edge of edges) {
        const src = nodeMap.get(edge.from);
        const tgt = nodeMap.get(edge.to);
        if (!src || !tgt) continue;

        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (dist - targetDist) * kAttract * temp;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;

        src.vx += fx;
        src.vy += fy;
        tgt.vx -= fx;
        tgt.vy -= fy;
      }
    }

    // 3. Center Gravity
    for (const n of posNodes) {
      n.vx += (cx - n.x) * kGravity * temp;
      n.vy += (cy - n.y) * kGravity * temp;
    }

    // 4. Rigid Card Bounding-Box Collision Resolution
    for (let i = 0; i < N; i++) {
      const n1 = posNodes[i];
      for (let j = i + 1; j < N; j++) {
        const n2 = posNodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (absX < minDx && absY < minDy) {
          const overlapX = minDx - absX;
          const overlapY = minDy - absY;

          if (overlapX / minDx < overlapY / minDy) {
            const shift = (overlapX / 2) * Math.sign(dx || 1);
            n1.vx -= shift;
            n2.vx += shift;
          } else {
            const shift = (overlapY / 2) * Math.sign(dy || 1);
            n1.vy -= shift;
            n2.vy += shift;
          }
        }
      }
    }

    // 5. Apply velocity and damping
    for (const n of posNodes) {
      n.x += Math.max(-28, Math.min(28, n.vx));
      n.y += Math.max(-22, Math.min(22, n.vy));
      n.vx *= 0.45;
      n.vy *= 0.45;
    }
  }

  // Normalize so top-left margin is at (50, 50)
  const minX = Math.min(...posNodes.map(n => n.x));
  const minY = Math.min(...posNodes.map(n => n.y));
  const shiftX = 50 - minX;
  const shiftY = 50 - minY;

  return posNodes.map(n => ({
    ...n,
    x: Math.round(n.x + shiftX),
    y: Math.round(n.y + shiftY)
  }));
}

/**
 * Concentric Multi-Tier Radial Layout
 * Groups layers into concentric rings with dynamically scaled radii to ensure
 * cards along each ring never overlap.
 */
export function layoutRadial(nodes, edges, options = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const cardWidth = options.cardWidth || NODE_WIDTH;
  const cardHeight = options.cardHeight || NODE_HEIGHT;

  const tier1 = []; // Core entrypoints & API gateways
  const tier2 = []; // Services, business logic, auth
  const tier3 = []; // Data storage & external modules

  for (const n of nodes) {
    const l = n.layer || '';
    if (l === 'Application Root' || l === 'API Gateway') {
      tier1.push(n);
    } else if (l === 'Authentication' || l === 'Core Business') {
      tier2.push(n);
    } else {
      tier3.push(n);
    }
  }

  const arcPitch = Math.hypot(cardWidth, cardHeight) + 40;
  const r1 = Math.max(180, (tier1.length * arcPitch) / (2 * Math.PI));
  const r2 = Math.max(r1 + 200, (tier2.length * arcPitch) / (2 * Math.PI));
  const r3 = Math.max(r2 + 200, (tier3.length * arcPitch) / (2 * Math.PI));

  const cx = Math.max(500, r3 + 80);
  const cy = Math.max(400, r3 + 80);

  const positionedNodes = [];

  const layoutRing = (ringNodes, radius, startAngle = -Math.PI / 2) => {
    const count = ringNodes.length;
    if (count === 0) return;
    if (count === 1) {
      positionedNodes.push({
        ...ringNodes[0],
        x: Math.round(cx - cardWidth / 2),
        y: Math.round(cy - radius - cardHeight / 2),
        width: cardWidth,
        height: cardHeight
      });
      return;
    }

    ringNodes.forEach((node, i) => {
      const angle = startAngle + (i / count) * 2 * Math.PI;
      const x = cx + radius * Math.cos(angle) - cardWidth / 2;
      const y = cy + radius * Math.sin(angle) - cardHeight / 2;
      positionedNodes.push({
        ...node,
        x: Math.round(x),
        y: Math.round(y),
        width: cardWidth,
        height: cardHeight
      });
    });
  };

  layoutRing(tier1, tier1.length > 0 ? r1 : 0);
  layoutRing(tier2, r2, -Math.PI / 3);
  layoutRing(tier3, r3, -Math.PI / 4);

  // Collision relaxation pass to guarantee zero overlaps in radial mode
  const minDx = cardWidth + 18;
  const minDy = cardHeight + 14;
  for (let pass = 0; pass < 25; pass++) {
    for (let i = 0; i < positionedNodes.length; i++) {
      const n1 = positionedNodes[i];
      for (let j = i + 1; j < positionedNodes.length; j++) {
        const n2 = positionedNodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx < minDx && ady < minDy) {
          const overlapX = minDx - adx;
          const overlapY = minDy - ady;
          if (overlapX < overlapY) {
            const shift = (overlapX / 2 + 1) * Math.sign(dx || 1);
            n1.x -= shift;
            n2.x += shift;
          } else {
            const shift = (overlapY / 2 + 1) * Math.sign(dy || 1);
            n1.y -= shift;
            n2.y += shift;
          }
        }
      }
    }
  }

  // Normalize so top-left margin is at (50, 50)
  const minX = Math.min(...positionedNodes.map(n => n.x));
  const minY = Math.min(...positionedNodes.map(n => n.y));
  const shiftX = 50 - minX;
  const shiftY = 50 - minY;

  return positionedNodes.map(n => ({
    ...n,
    x: Math.round(n.x + shiftX),
    y: Math.round(n.y + shiftY)
  }));
}

/**
 * Calculates a smooth Cubic Bezier path between two cards with perimeter anchors.
 * For reciprocal circular cycles (A -> B and B -> A), curves in opposite directions
 * so both edges and arrowheads are clearly visible side-by-side.
 */
export function calculateEdgePath(fromNode, toNode, isCycle = false, isReciprocalReversed = false) {
  if (!fromNode || !toNode) return '';

  const w1 = fromNode.width || NODE_WIDTH;
  const h1 = fromNode.height || NODE_HEIGHT;
  const w2 = toNode.width || NODE_WIDTH;
  const h2 = toNode.height || NODE_HEIGHT;

  const c1x = fromNode.x + w1 / 2;
  const c1y = fromNode.y + h1 / 2;
  const c2x = toNode.x + w2 / 2;
  const c2y = toNode.y + h2 / 2;

  const dx = c2x - c1x;
  const dy = c2y - c1y;

  let startX, startY, endX, endY;

  // Determine anchor boundaries based on relative position
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Primarily horizontal flow
    if (dx >= 0) {
      // From right edge to left edge
      startX = fromNode.x + w1;
      startY = fromNode.y + h1 / 2;
      endX = toNode.x;
      endY = toNode.y + h2 / 2;
    } else {
      // From left edge to right edge
      startX = fromNode.x;
      startY = fromNode.y + h1 / 2;
      endX = toNode.x + w2;
      endY = toNode.y + h2 / 2;
    }
  } else {
    // Primarily vertical flow
    if (dy >= 0) {
      // From bottom to top
      startX = fromNode.x + w1 / 2;
      startY = fromNode.y + h1;
      endX = toNode.x + w2 / 2;
      endY = toNode.y;
    } else {
      // From top to bottom
      startX = fromNode.x + w1 / 2;
      startY = fromNode.y;
      endX = toNode.x + w2 / 2;
      endY = toNode.y + h2;
    }
  }

  // Reciprocal cycle offset curve
  if (isCycle) {
    const dist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2) || 1;
    // Perpendicular normal vector
    const nx = -(endY - startY) / dist;
    const ny = (endX - startX) / dist;

    // Bow outward by ~32px; if reversed reciprocal, bow in opposite direction
    const arcHeight = isReciprocalReversed ? -34 : 34;

    const midX = (startX + endX) / 2 + nx * arcHeight;
    const midY = (startY + endY) / 2 + ny * arcHeight;

    return `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
  }

  // Smooth Cubic Bezier for standard edges
  const distanceX = Math.abs(endX - startX);
  const curvature = Math.max(30, Math.min(120, distanceX * 0.45));

  const cp1x = dx >= 0 ? startX + curvature : startX - curvature;
  const cp1y = startY;
  const cp2x = dx >= 0 ? endX - curvature : endX + curvature;
  const cp2y = endY;

  return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
}

/**
 * Calculates graph bounding box [minX, minY, maxX, maxY, width, height]
 * across all positioned nodes for viewport auto-fitting.
 */
export function calculateGraphBounds(nodes, padding = 60) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    const w = n.width || NODE_WIDTH;
    const h = n.height || NODE_HEIGHT;
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + w > maxX) maxX = n.x + w;
    if (n.y + h > maxY) maxY = n.y + h;
  }

  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(400, maxX - minX),
    height: Math.max(300, maxY - minY)
  };
}
