import React, { useState, useRef, useCallback } from 'react';
import { ZoomIn, ZoomOut, Printer, RotateCcw } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

interface SlipData {
  id: string;
  number: string;
  dock: string;
  length: number;
  beam: number;
  status: 'Vacant' | 'Occupied' | 'Maintenance' | 'Reserved';
  occupant?: string;
  compliance?: number;
}

interface DockMapSVGProps {
  slips: SlipData[];
  onSlipClick: (slipId: string) => void;
  selectedSlipId?: string;
}

/* ── Constants ─────────────────────────────────────────── */

const STATUS_COLORS: Record<SlipData['status'], { fill: string; stroke: string; strokeDasharray?: string }> = {
  Vacant:      { fill: '#FFFFFF', stroke: '#999999', strokeDasharray: '4 2' },
  Occupied:    { fill: '#D6E8F4', stroke: '#8BAAC4' },
  Maintenance: { fill: '#FFF3CD', stroke: '#D4A904' },
  Reserved:    { fill: '#FFFFFF', stroke: '#00D4FF' },
};

const complianceColor = (score?: number): string => {
  if (score == null || score === 0) return 'transparent';
  if (score >= 90) return '#1B5E20';
  if (score >= 70) return '#856404';
  return '#B71C1C';
};

/* ── Layout geometry ───────────────────────────────────── */

const SVG_WIDTH = 900;
const SVG_HEIGHT = 620;
const WATER_HEIGHT = 60;
const DOCK_FINGER_WIDTH = 20;
const DOCK_FINGER_HEIGHT = 400;
const DOCK_START_Y = WATER_HEIGHT + 30;
const DOCK_SPACING = 280;
const DOCK_X_START = 100;
const SLIP_WIDTH = 90;
const SLIP_HEIGHT = 36;
const SLIP_GAP = 8;
const SLIP_OFFSET_FROM_FINGER = 4;

const DOCKS = ['A', 'B', 'C'] as const;

function getDockX(dockIndex: number): number {
  return DOCK_X_START + dockIndex * DOCK_SPACING;
}

function getSlipPositions(
  dockIndex: number,
  slipIndex: number,
  side: 'left' | 'right'
): { x: number; y: number } {
  const dockX = getDockX(dockIndex);
  const fingerCenterX = dockX + DOCK_FINGER_WIDTH / 2;
  const x =
    side === 'left'
      ? fingerCenterX - DOCK_FINGER_WIDTH / 2 - SLIP_OFFSET_FROM_FINGER - SLIP_WIDTH
      : fingerCenterX + DOCK_FINGER_WIDTH / 2 + SLIP_OFFSET_FROM_FINGER;
  const y = DOCK_START_Y + 40 + slipIndex * (SLIP_HEIGHT + SLIP_GAP);
  return { x, y };
}

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    background: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  toolbar: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    zIndex: 10,
  },
  toolBtn: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    cursor: 'pointer',
    color: '#0A2342',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  legend: {
    position: 'absolute',
    bottom: '12px',
    left: '12px',
    display: 'flex',
    gap: '16px',
    background: 'rgba(255,255,255,0.92)',
    padding: '8px 14px',
    borderRadius: '6px',
    border: '1px solid #E2E8F0',
    fontSize: '12px',
    color: '#2E4A6B',
    zIndex: 10,
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  tooltip: {
    position: 'absolute',
    background: '#0A2342',
    color: '#FFFFFF',
    padding: '10px 14px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: 1.5,
    pointerEvents: 'none',
    zIndex: 20,
    minWidth: '160px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
  },
};

/* ── Component ─────────────────────────────────────────── */

export default function DockMapSVG({ slips, onSlipClick, selectedSlipId }: DockMapSVGProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<{
    slip: SlipData;
    x: number;
    y: number;
  } | null>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  /* ── Zoom ─── */
  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  /* ── Pan ─── */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    },
    [isPanning, panStart]
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  /* ── Print ─── */
  const handlePrint = () => {
    const svgEl = svgContainerRef.current?.querySelector('svg');
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(SVG_WIDTH));
    clone.setAttribute('height', String(SVG_HEIGHT));
    clone.removeAttribute('style');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<!DOCTYPE html><html><head><title>Dock Map</title><style>body{margin:20px;display:flex;justify-content:center;}svg{max-width:100%;height:auto;}</style></head><body>${clone.outerHTML}</body></html>`
    );
    w.document.close();
    w.print();
  };

  /* ── Tooltip helpers ─── */
  const showTooltip = (slip: SlipData, e: React.MouseEvent) => {
    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      slip,
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 10,
    });
  };
  const hideTooltip = () => setTooltip(null);

  /* ── Distribute slips to docks ─── */
  const slipsByDock: Record<string, SlipData[]> = {};
  DOCKS.forEach((d) => {
    slipsByDock[d] = slips.filter((sl) => sl.dock === d);
  });

  return (
    <div style={s.wrapper} ref={svgContainerRef}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <button style={s.toolBtn} onClick={handleZoomIn} title="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button style={s.toolBtn} onClick={handleZoomOut} title="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button style={s.toolBtn} onClick={handleReset} title="Reset view">
          <RotateCcw size={16} />
        </button>
        <button style={s.toolBtn} onClick={handlePrint} title="Print dock map">
          <Printer size={16} />
        </button>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            ...s.tooltip,
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '4px', fontSize: '13px' }}>
            Slip {tooltip.slip.number}
          </div>
          <div>Status: {tooltip.slip.status}</div>
          <div>
            Size: {tooltip.slip.length}' L × {tooltip.slip.beam}' Bm
          </div>
          {tooltip.slip.occupant && <div>Occupant: {tooltip.slip.occupant}</div>}
          {tooltip.slip.compliance != null && tooltip.slip.compliance > 0 && (
            <div>Compliance: {tooltip.slip.compliance}%</div>
          )}
        </div>
      )}

      {/* SVG Canvas */}
      <div
        style={{
          overflow: 'hidden',
          cursor: isPanning ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          width="100%"
          height="620"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: '0 0',
          }}
        >
          {/* Water area */}
          <rect x={0} y={0} width={SVG_WIDTH} height={WATER_HEIGHT} fill="#DCEEFB" />
          <text
            x={SVG_WIDTH / 2}
            y={WATER_HEIGHT / 2 + 5}
            textAnchor="middle"
            fill="#5A8CB5"
            fontSize="14"
            fontWeight="600"
            fontFamily="sans-serif"
          >
            ~ ~ ~  WATERWAY  ~ ~ ~
          </text>
          {/* wave lines */}
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M 0 ${18 + i * 18} Q 50 ${8 + i * 18} 100 ${18 + i * 18} T 200 ${18 + i * 18} T 400 ${18 + i * 18} T 600 ${18 + i * 18} T 800 ${18 + i * 18} T 900 ${18 + i * 18}`}
              fill="none"
              stroke="#B0D4F1"
              strokeWidth="1"
              opacity={0.5}
            />
          ))}

          {/* Scale indicator */}
          <g transform={`translate(${SVG_WIDTH - 140}, ${SVG_HEIGHT - 30})`}>
            <line x1={0} y1={0} x2={100} y2={0} stroke="#0A2342" strokeWidth={2} />
            <line x1={0} y1={-4} x2={0} y2={4} stroke="#0A2342" strokeWidth={2} />
            <line x1={100} y1={-4} x2={100} y2={4} stroke="#0A2342" strokeWidth={2} />
            <text x={50} y={-8} textAnchor="middle" fill="#0A2342" fontSize="10" fontFamily="sans-serif">
              ~100 ft
            </text>
          </g>

          {/* Dock fingers and slips */}
          {DOCKS.map((dock, di) => {
            const dockX = getDockX(di);
            const dockSlips = slipsByDock[dock] || [];
            const leftSlips = dockSlips.filter((_, i) => i % 2 === 0);
            const rightSlips = dockSlips.filter((_, i) => i % 2 === 1);

            const maxSlips = Math.max(leftSlips.length, rightSlips.length);
            const fingerH = Math.max(
              DOCK_FINGER_HEIGHT,
              40 + maxSlips * (SLIP_HEIGHT + SLIP_GAP) + 20
            );

            return (
              <g key={dock}>
                {/* Dock label */}
                <text
                  x={dockX + DOCK_FINGER_WIDTH / 2}
                  y={DOCK_START_Y - 8}
                  textAnchor="middle"
                  fill="#0A2342"
                  fontSize="15"
                  fontWeight="700"
                  fontFamily="sans-serif"
                >
                  Dock {dock}
                </text>

                {/* Finger (the walkway) */}
                <rect
                  x={dockX}
                  y={DOCK_START_Y}
                  width={DOCK_FINGER_WIDTH}
                  height={fingerH}
                  fill="#8B7355"
                  rx={3}
                />
                {/* Finger wood-grain lines */}
                {Array.from({ length: Math.floor(fingerH / 20) }).map((_, li) => (
                  <line
                    key={li}
                    x1={dockX}
                    y1={DOCK_START_Y + li * 20}
                    x2={dockX + DOCK_FINGER_WIDTH}
                    y2={DOCK_START_Y + li * 20}
                    stroke="#7A6548"
                    strokeWidth={0.5}
                  />
                ))}

                {/* Connection to shore */}
                <rect
                  x={dockX - 5}
                  y={WATER_HEIGHT}
                  width={DOCK_FINGER_WIDTH + 10}
                  height={30}
                  fill="#8B7355"
                  rx={2}
                />

                {/* Left-side slips */}
                {leftSlips.map((slip, si) => {
                  const pos = getSlipPositions(di, si, 'left');
                  const sc = STATUS_COLORS[slip.status];
                  const isSelected = selectedSlipId === slip.id;

                  return (
                    <g
                      key={slip.id}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSlipClick(slip.id);
                      }}
                      onMouseEnter={(e) => showTooltip(slip, e)}
                      onMouseMove={(e) => showTooltip(slip, e)}
                      onMouseLeave={hideTooltip}
                    >
                      <rect
                        x={pos.x}
                        y={pos.y}
                        width={SLIP_WIDTH}
                        height={SLIP_HEIGHT}
                        fill={sc.fill}
                        stroke={isSelected ? '#00D4FF' : sc.stroke}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        strokeDasharray={sc.strokeDasharray || 'none'}
                        rx={3}
                      />
                      {/* Slip number */}
                      <text
                        x={pos.x + SLIP_WIDTH / 2}
                        y={pos.y + 15}
                        textAnchor="middle"
                        fill="#0A2342"
                        fontSize="11"
                        fontWeight="700"
                        fontFamily="sans-serif"
                      >
                        {slip.number}
                      </text>
                      {/* Dimensions */}
                      <text
                        x={pos.x + SLIP_WIDTH / 2}
                        y={pos.y + 28}
                        textAnchor="middle"
                        fill="#64748B"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {slip.length}' × {slip.beam}'
                      </text>
                      {/* Compliance dot */}
                      {slip.compliance != null && slip.compliance > 0 && (
                        <circle
                          cx={pos.x + SLIP_WIDTH - 8}
                          cy={pos.y + 8}
                          r={4}
                          fill={complianceColor(slip.compliance)}
                        />
                      )}
                      {/* QR indicator */}
                      <rect
                        x={pos.x + 3}
                        y={pos.y + 3}
                        width={7}
                        height={7}
                        fill="none"
                        stroke="#0A2342"
                        strokeWidth={0.8}
                        rx={1}
                        opacity={0.4}
                      />
                      <rect
                        x={pos.x + 5}
                        y={pos.y + 5}
                        width={3}
                        height={3}
                        fill="#0A2342"
                        opacity={0.4}
                        rx={0.5}
                      />
                    </g>
                  );
                })}

                {/* Right-side slips */}
                {rightSlips.map((slip, si) => {
                  const pos = getSlipPositions(di, si, 'right');
                  const sc = STATUS_COLORS[slip.status];
                  const isSelected = selectedSlipId === slip.id;

                  return (
                    <g
                      key={slip.id}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSlipClick(slip.id);
                      }}
                      onMouseEnter={(e) => showTooltip(slip, e)}
                      onMouseMove={(e) => showTooltip(slip, e)}
                      onMouseLeave={hideTooltip}
                    >
                      <rect
                        x={pos.x}
                        y={pos.y}
                        width={SLIP_WIDTH}
                        height={SLIP_HEIGHT}
                        fill={sc.fill}
                        stroke={isSelected ? '#00D4FF' : sc.stroke}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        strokeDasharray={sc.strokeDasharray || 'none'}
                        rx={3}
                      />
                      <text
                        x={pos.x + SLIP_WIDTH / 2}
                        y={pos.y + 15}
                        textAnchor="middle"
                        fill="#0A2342"
                        fontSize="11"
                        fontWeight="700"
                        fontFamily="sans-serif"
                      >
                        {slip.number}
                      </text>
                      <text
                        x={pos.x + SLIP_WIDTH / 2}
                        y={pos.y + 28}
                        textAnchor="middle"
                        fill="#64748B"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {slip.length}' × {slip.beam}'
                      </text>
                      {slip.compliance != null && slip.compliance > 0 && (
                        <circle
                          cx={pos.x + SLIP_WIDTH - 8}
                          cy={pos.y + 8}
                          r={4}
                          fill={complianceColor(slip.compliance)}
                        />
                      )}
                      {/* QR indicator */}
                      <rect
                        x={pos.x + 3}
                        y={pos.y + 3}
                        width={7}
                        height={7}
                        fill="none"
                        stroke="#0A2342"
                        strokeWidth={0.8}
                        rx={1}
                        opacity={0.4}
                      />
                      <rect
                        x={pos.x + 5}
                        y={pos.y + 5}
                        width={3}
                        height={3}
                        fill="#0A2342"
                        opacity={0.4}
                        rx={0.5}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={s.legend}>
        <div style={s.legendItem}>
          <svg width="16" height="16">
            <rect
              x={1}
              y={1}
              width={14}
              height={14}
              fill="#FFFFFF"
              stroke="#999"
              strokeWidth={1}
              strokeDasharray="3 1"
              rx={2}
            />
          </svg>
          Vacant
        </div>
        <div style={s.legendItem}>
          <svg width="16" height="16">
            <rect x={1} y={1} width={14} height={14} fill="#D6E8F4" stroke="#8BAAC4" strokeWidth={1} rx={2} />
          </svg>
          Occupied
        </div>
        <div style={s.legendItem}>
          <svg width="16" height="16">
            <rect x={1} y={1} width={14} height={14} fill="#FFF3CD" stroke="#D4A904" strokeWidth={1} rx={2} />
          </svg>
          Maintenance
        </div>
        <div style={s.legendItem}>
          <svg width="16" height="16">
            <rect x={1} y={1} width={14} height={14} fill="#FFFFFF" stroke="#00D4FF" strokeWidth={2} rx={2} />
          </svg>
          Reserved
        </div>
        <div style={{ ...s.legendItem, marginLeft: '8px' }}>
          <svg width="36" height="16">
            <circle cx={6} cy={8} r={4} fill="#1B5E20" />
            <circle cx={18} cy={8} r={4} fill="#856404" />
            <circle cx={30} cy={8} r={4} fill="#B71C1C" />
          </svg>
          Compliance
        </div>
      </div>
    </div>
  );
}
