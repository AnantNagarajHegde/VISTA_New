import { useRef, useEffect, useState, useCallback } from 'react';
import type { FlowData, FlowAccount, FlowEdge } from '../api';

interface MoneyFlowGraphProps {
  data: FlowData | null;
  isLoading: boolean;
}

interface GraphNode {
  id: string;
  label: string;
  type: 'primary' | 'counterparty';
  transactionCount: number;
  totalDebit: number;
  totalCredit: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  amount: number;
  count: number;
  width: number;
}

interface Particle {
  edgeIdx: number;
  t: number;
  speed: number;
}

function formatAmount(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)}Cr`;
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)}L`;
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(1)}K`;
  return `₹${amount.toFixed(0)}`;
}

function truncateLabel(label: string, maxLen: number = 16): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 1) + '…';
}

export default function MoneyFlowGraph({ data, isLoading }: MoneyFlowGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const nodeMapRef = useRef<Record<string, GraphNode>>({});
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ nodeIdx: number; offsetX: number; offsetY: number } | null>(null);
  const hoverRef = useRef<number>(-1);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  // Simulation temperature: starts at 1.0, decays toward 0 so nodes stabilize
  const temperatureRef = useRef(1.0);
  const settledRef = useRef(false);

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    account: GraphNode;
  } | null>(null);

  // Build graph data from API response
  const buildGraph = useCallback((flowData: FlowData) => {
    const accounts = flowData.accounts;
    const edges = flowData.edges;
    if (accounts.length === 0) return;

    // Reset simulation state
    temperatureRef.current = 1.0;
    settledRef.current = false;

    // Compute volume range for node sizing
    const volumes = accounts.map(a => a.total_debit + a.total_credit);
    const maxVol = Math.max(...volumes, 1);

    const canvas = canvasRef.current;
    const cw = canvas?.width || 900;
    const ch = canvas?.height || 600;
    const cx = cw / 2;
    const cy = ch / 2;

    // Separate primary and counterparty for layout
    const primaryAccounts = accounts.filter(a => a.type === 'primary');
    const counterpartyAccounts = accounts.filter(a => a.type !== 'primary');

    const nodes: GraphNode[] = [];
    const nodeMap: Record<string, GraphNode> = {};

    // Place primary accounts in an inner ring
    const innerRadius = Math.min(cw, ch) * 0.15;
    primaryAccounts.forEach((a, i) => {
      const angle = (2 * Math.PI * i) / Math.max(primaryAccounts.length, 1);
      const vol = (a.total_debit + a.total_credit) / maxVol;
      const r = 22 + vol * 22;
      const node: GraphNode = {
        id: a.id,
        label: a.label,
        type: a.type,
        transactionCount: a.transaction_count,
        totalDebit: a.total_debit,
        totalCredit: a.total_credit,
        x: cx + Math.cos(angle) * innerRadius,
        y: cy + Math.sin(angle) * innerRadius,
        vx: 0, vy: 0,
        radius: r,
        pinned: false,
      };
      nodes.push(node);
      nodeMap[node.id] = node;
    });

    // Place counterparties in an outer ring
    const outerRadius = Math.min(cw, ch) * 0.35;
    counterpartyAccounts.forEach((a, i) => {
      const angle = (2 * Math.PI * i) / Math.max(counterpartyAccounts.length, 1);
      const vol = (a.total_debit + a.total_credit) / maxVol;
      const r = 14 + vol * 18;
      const node: GraphNode = {
        id: a.id,
        label: a.label,
        type: a.type,
        transactionCount: a.transaction_count,
        totalDebit: a.total_debit,
        totalCredit: a.total_credit,
        x: cx + Math.cos(angle) * outerRadius,
        y: cy + Math.sin(angle) * outerRadius,
        vx: 0, vy: 0,
        radius: r,
        pinned: false,
      };
      nodes.push(node);
      nodeMap[node.id] = node;
    });

    // Compute edge widths
    const maxAmt = Math.max(...edges.map(e => e.amount), 1);
    const graphEdges: GraphEdge[] = edges.map((e: FlowEdge) => ({
      source: e.source,
      target: e.target,
      amount: e.amount,
      count: e.count,
      width: 1 + (e.amount / maxAmt) * 4,
    }));

    // Create limited particles — max ~40 total, only on top edges by amount
    const sortedEdgeIndices = graphEdges
      .map((e, i) => ({ amt: e.amount, i }))
      .sort((a, b) => b.amt - a.amt)
      .slice(0, 30);
    const particles: Particle[] = [];
    for (const { i: idx } of sortedEdgeIndices) {
      particles.push({
        edgeIdx: idx,
        t: Math.random(),
        speed: 0.002 + Math.random() * 0.003,
      });
    }

    nodesRef.current = nodes;
    edgesRef.current = graphEdges;
    particlesRef.current = particles;
    nodeMapRef.current = nodeMap;
  }, []);

  // Force simulation tick — with temperature cooling
  const simulateTick = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (nodes.length === 0) return;

    let temp = temperatureRef.current;

    // If already settled, only advance particles (cheap)
    if (temp < 0.01) {
      settledRef.current = true;
      for (const p of particlesRef.current) {
        p.t += p.speed;
        if (p.t > 1) p.t -= 1;
      }
      return;
    }

    // Cool down temperature each tick
    temp *= 0.97;
    temperatureRef.current = temp;

    const canvas = canvasRef.current;
    const cw = canvas?.width || 900;
    const ch = canvas?.height || 600;
    const cx = cw / 2;
    const cy = ch / 2;

    // Build node index once
    const nodeIndex: Record<string, number> = {};
    nodes.forEach((n, i) => { nodeIndex[n.id] = i; });

    // Repulsion between nodes (scaled by temperature)
    const repulsionStrength = 8000 * temp;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq) || 1;
        // Skip very distant pairs for performance
        if (dist > 500) continue;
        const force = repulsionStrength / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!nodes[i].pinned) { nodes[i].vx -= fx; nodes[i].vy -= fy; }
        if (!nodes[j].pinned) { nodes[j].vx += fx; nodes[j].vy += fy; }
      }
    }

    // Attraction along edges (spring, scaled by temperature)
    const springStrength = 0.008 * temp;
    const idealLength = 160;
    for (const edge of edges) {
      const si = nodeIndex[edge.source];
      const ti = nodeIndex[edge.target];
      if (si === undefined || ti === undefined) continue;
      const dx = nodes[ti].x - nodes[si].x;
      const dy = nodes[ti].y - nodes[si].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - idealLength;
      const force = displacement * springStrength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!nodes[si].pinned) { nodes[si].vx += fx; nodes[si].vy += fy; }
      if (!nodes[ti].pinned) { nodes[ti].vx -= fx; nodes[ti].vy -= fy; }
    }

    // Center gravity (light, scaled by temp)
    const gravityStrength = 0.015 * temp;
    for (const node of nodes) {
      if (node.pinned) continue;
      node.vx += (cx - node.x) * gravityStrength;
      node.vy += (cy - node.y) * gravityStrength;
    }

    // Apply velocities with heavy damping
    const damping = 0.6;
    for (const node of nodes) {
      if (node.pinned) continue;
      node.vx *= damping;
      node.vy *= damping;
      // Clamp velocity so nodes don't fly
      const maxV = 8 * temp;
      node.vx = Math.max(-maxV, Math.min(maxV, node.vx));
      node.vy = Math.max(-maxV, Math.min(maxV, node.vy));
      node.x += node.vx;
      node.y += node.vy;
      // Keep in bounds
      node.x = Math.max(node.radius + 10, Math.min(cw - node.radius - 10, node.x));
      node.y = Math.max(node.radius + 10, Math.min(ch - node.radius - 10, node.y));
    }

    // Update node map positions
    const nodeMap = nodeMapRef.current;
    for (const node of nodes) {
      nodeMap[node.id] = node;
    }

    // Advance particles
    for (const p of particlesRef.current) {
      p.t += p.speed;
      if (p.t > 1) p.t -= 1;
    }
  }, []);

  // Draw the graph
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const particles = particlesRef.current;
    const nodeMap = nodeMapRef.current;
    const pan = panRef.current;
    const zoom = zoomRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // --- Draw edges (batched by style for performance) ---
    ctx.strokeStyle = 'rgba(139, 139, 158, 0.22)';
    ctx.fillStyle = 'rgba(139, 139, 158, 0.35)';

    for (const edge of edges) {
      const src = nodeMap[edge.source];
      const tgt = nodeMap[edge.target];
      if (!src || !tgt) continue;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      const x1 = src.x + nx * (src.radius + 2);
      const y1 = src.y + ny * (src.radius + 2);
      const x2 = tgt.x - nx * (tgt.radius + 2);
      const y2 = tgt.y - ny * (tgt.radius + 2);

      // Line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = edge.width;
      ctx.stroke();

      // Arrowhead
      const arrowLen = 8 + edge.width;
      const arrowAngle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - arrowLen * Math.cos(arrowAngle - 0.3),
        y2 - arrowLen * Math.sin(arrowAngle - 0.3)
      );
      ctx.lineTo(
        x2 - arrowLen * Math.cos(arrowAngle + 0.3),
        y2 - arrowLen * Math.sin(arrowAngle + 0.3)
      );
      ctx.closePath();
      ctx.fill();
    }

    // --- Edge labels: only when zoomed enough (avoid clutter) ---
    if (zoom > 0.6) {
      ctx.font = '500 9px Inter, sans-serif';
      ctx.fillStyle = 'rgba(139, 139, 158, 0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (const edge of edges) {
        const src = nodeMap[edge.source];
        const tgt = nodeMap[edge.target];
        if (!src || !tgt) continue;
        const midX = (src.x + tgt.x) / 2;
        const midY = (src.y + tgt.y) / 2;
        ctx.fillText(formatAmount(edge.amount), midX, midY - 3);
      }
    }

    // --- Draw particles ---
    ctx.fillStyle = 'rgba(6, 182, 212, 0.85)';
    for (const p of particles) {
      const edge = edges[p.edgeIdx];
      if (!edge) continue;
      const src = nodeMap[edge.source];
      const tgt = nodeMap[edge.target];
      if (!src || !tgt) continue;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx2 = dx / dist;
      const ny2 = dy / dist;
      const x1 = src.x + nx2 * src.radius;
      const y1 = src.y + ny2 * src.radius;
      const x2 = tgt.x - nx2 * tgt.radius;
      const y2 = tgt.y - ny2 * tgt.radius;

      const px = x1 + (x2 - x1) * p.t;
      const py = y1 + (y2 - y1) * p.t;

      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Draw nodes (no per-frame gradient creation — use flat fills) ---
    const hoverIdx = hoverRef.current;
    for (let idx = 0; idx < nodes.length; idx++) {
      const node = nodes[idx];
      const isHover = idx === hoverIdx;
      const isPrimary = node.type === 'primary';

      // Subtle outer glow only on hover
      if (isHover) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 12, 0, Math.PI * 2);
        ctx.fillStyle = isPrimary
          ? 'rgba(6, 182, 212, 0.12)'
          : 'rgba(168, 85, 247, 0.12)';
        ctx.fill();
      }

      // Node body (flat fill — much cheaper than gradient)
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = isPrimary
        ? 'rgba(6, 172, 202, 0.85)'
        : 'rgba(148, 75, 227, 0.80)';
      ctx.fill();

      // Border
      ctx.strokeStyle = isHover
        ? 'rgba(255,255,255,0.6)'
        : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = isHover ? 2.5 : 1;
      ctx.stroke();

      // Label
      const fontSize = Math.max(8, Math.min(12, node.radius * 0.48));
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateLabel(node.label), node.x, node.y);
    }

    ctx.restore();
  }, []);

  // Animation loop
  useEffect(() => {
    if (!data || data.accounts.length === 0) return;

    buildGraph(data);
    panRef.current = { x: 0, y: 0 };
    zoomRef.current = 1;

    let running = true;
    const loop = () => {
      if (!running) return;
      simulateTick();
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [data, buildGraph, simulateTick, draw]);

  // Resize canvas
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // --- Mouse interactions ---
  const getNodeAtPos = useCallback((mx: number, my: number): number => {
    const nodes = nodesRef.current;
    const pan = panRef.current;
    const zoom = zoomRef.current;
    const tx = (mx - pan.x) / zoom;
    const ty = (my - pan.y) / zoom;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const dx = tx - nodes[i].x;
      const dy = ty - nodes[i].y;
      if (dx * dx + dy * dy <= nodes[i].radius * nodes[i].radius) return i;
    }
    return -1;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = getNodeAtPos(mx, my);
    if (idx >= 0) {
      const node = nodesRef.current[idx];
      const pan = panRef.current;
      const zoom = zoomRef.current;
      dragRef.current = {
        nodeIdx: idx,
        offsetX: (mx - pan.x) / zoom - node.x,
        offsetY: (my - pan.y) / zoom - node.y,
      };
      node.pinned = true;
      // Reheat slightly so the graph adjusts around the dragged node
      if (temperatureRef.current < 0.15) {
        temperatureRef.current = 0.15;
        settledRef.current = false;
      }
    } else {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
    }
  }, [getNodeAtPos]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragRef.current) {
      const { nodeIdx, offsetX, offsetY } = dragRef.current;
      const pan = panRef.current;
      const zoom = zoomRef.current;
      nodesRef.current[nodeIdx].x = (mx - pan.x) / zoom - offsetX;
      nodesRef.current[nodeIdx].y = (my - pan.y) / zoom - offsetY;
      return;
    }

    if (isPanningRef.current) {
      panRef.current = {
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
      };
      return;
    }

    // Hover detection
    const idx = getNodeAtPos(mx, my);
    hoverRef.current = idx;
    if (idx >= 0) {
      const node = nodesRef.current[idx];
      setTooltip({ x: e.clientX, y: e.clientY, account: node });
      if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    } else {
      setTooltip(null);
      if (canvasRef.current) canvasRef.current.style.cursor = 'default';
    }
  }, [getNodeAtPos]);

  const handleMouseUp = useCallback(() => {
    if (dragRef.current) {
      nodesRef.current[dragRef.current.nodeIdx].pinned = false;
      dragRef.current = null;
    }
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.max(0.3, Math.min(3, zoomRef.current * delta));

    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      panRef.current = {
        x: mx - (mx - panRef.current.x) * (newZoom / zoomRef.current),
        y: my - (my - panRef.current.y) * (newZoom / zoomRef.current),
      };
    }

    zoomRef.current = newZoom;
  }, []);

  // --- Rendering ---
  if (isLoading) {
    return (
      <div className="flow-graph-container">
        <div className="flow-loading">
          <div className="spinner" />
          <div className="loading-text">Building money flow graph…</div>
        </div>
      </div>
    );
  }

  if (!data || data.accounts.length === 0) {
    return (
      <div className="flow-graph-container">
        <div className="empty-state">
          <div className="empty-icon">🔗</div>
          <div className="empty-text">No flow data available</div>
          <div className="empty-subtext">
            Load a case with transactions that contain counterparty information to see the money flow graph.
          </div>
        </div>
      </div>
    );
  }

  const totalAccounts = data.total_accounts ?? data.accounts.length;
  const totalEdges = data.total_edges ?? data.edges.length;

  return (
    <div className="flow-graph-section">
      <div className="flow-graph-header">
        <div>
          <span className="flow-graph-title">Money Flow Network</span>
          <span className="flow-graph-subtitle">
            showing top {data.accounts.length} of {totalAccounts.toLocaleString()} accounts · {data.edges.length} of {totalEdges.toLocaleString()} connections
          </span>
        </div>
        <div className="flow-legend">
          <span className="flow-legend-item">
            <span className="flow-legend-dot flow-legend-primary" />
            Primary Account
          </span>
          <span className="flow-legend-item">
            <span className="flow-legend-dot flow-legend-counterparty" />
            Counterparty
          </span>
          <span className="flow-legend-item flow-legend-hint">
            scroll to zoom · drag nodes · drag canvas to pan
          </span>
        </div>
      </div>
      <div className="flow-graph-container" ref={containerRef}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
        {tooltip && (
          <div
            className="flow-tooltip"
            style={{
              left: tooltip.x + 16,
              top: tooltip.y - 10,
            }}
          >
            <div className="flow-tooltip-header">
              <span className={`flow-tooltip-type ${tooltip.account.type}`}>
                {tooltip.account.type}
              </span>
              <span className="flow-tooltip-label">{tooltip.account.label}</span>
            </div>
            <div className="flow-tooltip-stats">
              <div className="flow-tooltip-row">
                <span>Transactions</span>
                <span>{tooltip.account.transactionCount.toLocaleString()}</span>
              </div>
              <div className="flow-tooltip-row">
                <span>Total Outflow</span>
                <span className="amount-debit">{formatAmount(tooltip.account.totalDebit)}</span>
              </div>
              <div className="flow-tooltip-row">
                <span>Total Inflow</span>
                <span className="amount-credit">{formatAmount(tooltip.account.totalCredit)}</span>
              </div>
              <div className="flow-tooltip-row">
                <span>Net Flow</span>
                <span style={{ color: tooltip.account.totalCredit - tooltip.account.totalDebit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {formatAmount(Math.abs(tooltip.account.totalCredit - tooltip.account.totalDebit))}
                  {tooltip.account.totalCredit - tooltip.account.totalDebit >= 0 ? ' in' : ' out'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
