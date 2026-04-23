import React, { useState, useMemo } from 'react';
import {
  Play, Columns, CalendarRange, ChevronDown, ChevronUp, RotateCcw,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

interface SimProduct {
  id: string;
  name: string;
  basePriceCents: number;
}

type DurationType = 'hourly' | 'half-day' | 'full-day' | 'multi-day';

interface SimInput {
  productId: string;
  date: string;
  duration: DurationType;
  multiDays: number;
  promoCode: string;
  leadDays: number;
}

interface RuleStep {
  num: number;
  name: string;
  applied: boolean;
  description: string;
  adjustmentCents: number;
  runningTotalCents: number;
}

interface SimResult {
  input: SimInput;
  steps: RuleStep[];
  finalCents: number;
}

/* ── Mock promo codes ──────────────────────────────────── */

const PROMOS: Record<string, { discountPct: number; label: string }> = {
  WELCOME20: { discountPct: 20, label: '-20% WELCOME20' },
  SUMMER50:  { discountPct: 10, label: '-10% SUMMER50' },   // % in simulator
  LOYALTY15: { discountPct: 15, label: '-15% LOYALTY15' },
};

/* ── Duration multipliers ──────────────────────────────── */

const DURATION_MULT: Record<DurationType, number> = {
  'hourly': 1,
  'half-day': 3.5,
  'full-day': 6,
  'multi-day': 6,
};

/* ── Simulation engine ─────────────────────────────────── */

function simulate(products: SimProduct[], input: SimInput): SimResult {
  const product = products.find((p) => p.id === input.productId) ?? products[0];
  const baseCents = product.basePriceCents;
  const mult = input.duration === 'multi-day' ? DURATION_MULT['multi-day'] * input.multiDays : DURATION_MULT[input.duration];
  let running = Math.round(baseCents * mult);
  const steps: RuleStep[] = [];
  let stepNum = 1;

  // 1. Base Rate
  steps.push({ num: stepNum++, name: 'Base Rate', applied: true, description: `$${(baseCents / 100).toFixed(2)}/hr x ${mult.toFixed(1)} = $${(running / 100).toFixed(2)}`, adjustmentCents: 0, runningTotalCents: running });

  // 2. Calendar Override (only July 4)
  const isOverride = input.date === '2026-07-04';
  if (isOverride) {
    const overridePrice = Math.round(running * 1.4);
    const adj = overridePrice - running;
    running = overridePrice;
    steps.push({ num: stepNum++, name: 'Calendar Override', applied: true, description: `Manual override: +40% for July 4th`, adjustmentCents: adj, runningTotalCents: running });
  } else {
    steps.push({ num: stepNum++, name: 'Calendar Override', applied: false, description: 'No override set for this date', adjustmentCents: 0, runningTotalCents: running });
  }

  // 3. Seasonal Range
  const d = new Date(input.date + 'T12:00:00');
  const mo = d.getMonth();
  const isSummer = mo >= 4 && mo <= 8; // May-Sep (Memorial Day - Labor Day)
  if (isSummer) {
    const adj = Math.round(running * 0.25);
    running += adj;
    steps.push({ num: stepNum++, name: 'Seasonal Range', applied: true, description: '+25% (Memorial Day - Labor Day)', adjustmentCents: adj, runningTotalCents: running });
  } else {
    steps.push({ num: stepNum++, name: 'Seasonal Range', applied: false, description: 'Outside peak season', adjustmentCents: 0, runningTotalCents: running });
  }

  // 4. Peak Day (weekend)
  const dow = d.getDay();
  const isWeekend = dow === 0 || dow === 6;
  if (isWeekend) {
    const adj = Math.round(running * 0.15);
    running += adj;
    steps.push({ num: stepNum++, name: 'Peak Day', applied: true, description: `+15% (${dow === 6 ? 'Saturday' : 'Sunday'})`, adjustmentCents: adj, runningTotalCents: running });
  } else {
    steps.push({ num: stepNum++, name: 'Peak Day', applied: false, description: 'Weekday - no surcharge', adjustmentCents: 0, runningTotalCents: running });
  }

  // 5. Demand Surge (simulate based on date hash for consistency)
  const dateHash = input.date.split('-').reduce((a, b) => a + parseInt(b), 0);
  const fleetAvail = 20 + (dateHash % 60); // 20-79%
  const isSurge = fleetAvail < 50;
  if (isSurge) {
    const pct = fleetAvail < 30 ? 15 : 10;
    const adj = Math.round(running * pct / 100);
    running += adj;
    steps.push({ num: stepNum++, name: 'Demand Surge', applied: true, description: `+${pct}% (fleet at ${fleetAvail}% availability)`, adjustmentCents: adj, runningTotalCents: running });
  } else {
    steps.push({ num: stepNum++, name: 'Demand Surge', applied: false, description: `Fleet at ${fleetAvail}% availability - no surge`, adjustmentCents: 0, runningTotalCents: running });
  }

  // 6. Lead Time Discount
  if (input.leadDays >= 14) {
    const adj = Math.round(running * -0.10);
    running += adj;
    steps.push({ num: stepNum++, name: 'Lead Time', applied: true, description: `-10% (booked ${input.leadDays} days ahead)`, adjustmentCents: adj, runningTotalCents: running });
  } else {
    steps.push({ num: stepNum++, name: 'Lead Time', applied: false, description: `Booked ${input.leadDays} days ahead (need 14+)`, adjustmentCents: 0, runningTotalCents: running });
  }

  // 7. Multi-Day Discount
  if (input.duration === 'multi-day' && input.multiDays >= 3) {
    const pct = input.multiDays >= 5 ? 20 : 15;
    const adj = Math.round(running * -pct / 100);
    running += adj;
    steps.push({ num: stepNum++, name: 'Multi-Day Discount', applied: true, description: `-${pct}% (${input.multiDays}-day booking)`, adjustmentCents: adj, runningTotalCents: running });
  } else {
    steps.push({ num: stepNum++, name: 'Multi-Day Discount', applied: false, description: input.duration === 'multi-day' ? `${input.multiDays}-day (need 3+)` : 'Not a multi-day booking', adjustmentCents: 0, runningTotalCents: running });
  }

  // 8. Floor / Ceiling
  const floor = Math.round(baseCents * mult * 0.6);
  const ceiling = Math.round(baseCents * mult * 2.5);
  if (running < floor) {
    const adj = floor - running;
    running = floor;
    steps.push({ num: stepNum++, name: 'Floor / Ceiling', applied: true, description: `Adjusted to floor: $${(floor / 100).toFixed(2)}`, adjustmentCents: adj, runningTotalCents: running });
  } else if (running > ceiling) {
    const adj = ceiling - running;
    running = ceiling;
    steps.push({ num: stepNum++, name: 'Floor / Ceiling', applied: true, description: `Adjusted to ceiling: $${(ceiling / 100).toFixed(2)}`, adjustmentCents: adj, runningTotalCents: running });
  } else {
    steps.push({ num: stepNum++, name: 'Floor / Ceiling', applied: false, description: `Within bounds ($${(floor / 100).toFixed(0)} - $${(ceiling / 100).toFixed(0)})`, adjustmentCents: 0, runningTotalCents: running });
  }

  // 9. Algorithmic Suggestion
  const algoSuggest = Math.round(running * (0.95 + (dateHash % 10) / 100));
  const algoApproved = dateHash % 3 !== 0;
  steps.push({ num: stepNum++, name: 'Algorithmic Suggestion', applied: algoApproved, description: algoApproved ? `$${(algoSuggest / 100).toFixed(2)} suggested (staff approved)` : `$${(algoSuggest / 100).toFixed(2)} suggested (pending review)`, adjustmentCents: 0, runningTotalCents: running });

  // 10. Promo Code
  const promo = PROMOS[input.promoCode.toUpperCase()];
  if (promo) {
    const adj = Math.round(running * -promo.discountPct / 100);
    running += adj;
    steps.push({ num: stepNum++, name: 'Promo Code', applied: true, description: promo.label, adjustmentCents: adj, runningTotalCents: running });
  } else if (input.promoCode) {
    steps.push({ num: stepNum++, name: 'Promo Code', applied: false, description: `"${input.promoCode}" - invalid code`, adjustmentCents: 0, runningTotalCents: running });
  } else {
    steps.push({ num: stepNum++, name: 'Promo Code', applied: false, description: 'No promo code entered', adjustmentCents: 0, runningTotalCents: running });
  }

  return { input, steps, finalCents: running };
}

/* ── Styles ────────────────────────────────────────────── */

const cs: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', gap: '24px', flexWrap: 'wrap' },
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px', flex: '1 1 340px', minWidth: '340px' },
  cardTitle: { fontSize: '16px', fontWeight: 700, color: '#0A2342', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  label: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const, width: '100%', fontFamily: '"JetBrains Mono", monospace' },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer', width: '100%', boxSizing: 'border-box' as const },
  simBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 24px', fontSize: '15px', fontWeight: 700, color: '#FFFFFF', background: 'linear-gradient(135deg, #0A2342, #1a3a5c)', border: 'none', borderRadius: '6px', cursor: 'pointer', width: '100%', marginTop: '8px' },
  step: { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 0', borderBottom: '1px solid #F1F5F9' },
  stepNum: { width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 },
  stepApplied: { background: '#DEF7EC', color: '#03543F' },
  stepSkipped: { background: '#F3F4F6', color: '#94A3B8' },
  stepName: { fontSize: '14px', fontWeight: 600, color: '#0A2342' },
  stepDesc: { fontSize: '12px', color: '#64748B', marginTop: '2px' },
  stepAdj: { fontFamily: '"JetBrains Mono", monospace', fontSize: '13px', fontWeight: 600, marginLeft: 'auto', textAlign: 'right' as const, flexShrink: 0 },
  finalRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', marginTop: '8px', borderTop: '2px solid #0A2342' },
  finalLabel: { fontSize: '16px', fontWeight: 800, color: '#0A2342' },
  finalPrice: { fontSize: '28px', fontWeight: 800, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  modeBar: { display: 'flex', gap: '8px', marginBottom: '20px' },
  modeBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: '1px solid #E2E8F0', cursor: 'pointer' },
  batchTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px', marginTop: '16px' },
  batchTh: { textAlign: 'left' as const, padding: '8px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', borderBottom: '2px solid #E2E8F0' },
  batchTd: { padding: '8px 12px', borderBottom: '1px solid #F1F5F9', fontFamily: '"JetBrains Mono", monospace', fontSize: '13px' },
  resetBtn: { display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#64748B', background: 'none', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', marginLeft: 'auto' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
};

/* ── Component ─────────────────────────────────────────── */

const DEFAULT_PRODUCTS: SimProduct[] = [
  { id: 'pontoon', name: 'Bay Cruiser 24 (Pontoon)', basePriceCents: 8500 },
  { id: 'jetski',  name: 'Wave Runner Pro (Jet Ski)', basePriceCents: 6500 },
  { id: 'kayak',   name: 'Harbor Explorer (Kayak)',   basePriceCents: 2500 },
];

type ViewMode = 'single' | 'compare' | 'batch';

export default function PriceSimulator() {
  // Mode
  const [mode, setMode] = useState<ViewMode>('single');

  // Input A
  const [productA, setProductA] = useState('pontoon');
  const [dateA, setDateA] = useState('2026-07-18');
  const [durationA, setDurationA] = useState<DurationType>('full-day');
  const [multiDaysA, setMultiDaysA] = useState(3);
  const [promoA, setPromoA] = useState('');
  const [leadDaysA, setLeadDaysA] = useState(7);

  // Input B (comparison)
  const [productB, setProductB] = useState('pontoon');
  const [dateB, setDateB] = useState('2026-07-25');
  const [durationB, setDurationB] = useState<DurationType>('full-day');
  const [multiDaysB, setMultiDaysB] = useState(1);
  const [promoB, setPromoB] = useState('WELCOME20');
  const [leadDaysB, setLeadDaysB] = useState(21);

  // Batch
  const [batchStart, setBatchStart] = useState('2026-07-01');
  const [batchEnd, setBatchEnd] = useState('2026-07-07');
  const [batchProduct, setBatchProduct] = useState('pontoon');
  const [batchDuration, setBatchDuration] = useState<DurationType>('full-day');

  // Results
  const [resultA, setResultA] = useState<SimResult | null>(null);
  const [resultB, setResultB] = useState<SimResult | null>(null);
  const [batchResults, setBatchResults] = useState<SimResult[]>([]);
  const [showSteps, setShowSteps] = useState(true);

  function runSim() {
    const inputA: SimInput = { productId: productA, date: dateA, duration: durationA, multiDays: multiDaysA, promoCode: promoA, leadDays: leadDaysA };
    setResultA(simulate(DEFAULT_PRODUCTS, inputA));
    if (mode === 'compare') {
      const inputB: SimInput = { productId: productB, date: dateB, duration: durationB, multiDays: multiDaysB, promoCode: promoB, leadDays: leadDaysB };
      setResultB(simulate(DEFAULT_PRODUCTS, inputB));
    }
  }

  function runBatch() {
    const results: SimResult[] = [];
    const cur = new Date(batchStart + 'T12:00:00');
    const end = new Date(batchEnd + 'T12:00:00');
    while (cur <= end) {
      const ds = cur.toISOString().slice(0, 10);
      results.push(simulate(DEFAULT_PRODUCTS, { productId: batchProduct, date: ds, duration: batchDuration, multiDays: 1, promoCode: '', leadDays: 7 }));
      cur.setDate(cur.getDate() + 1);
    }
    setBatchResults(results);
  }

  function resetInputs() {
    setProductA('pontoon'); setDateA('2026-07-18'); setDurationA('full-day'); setMultiDaysA(3); setPromoA(''); setLeadDaysA(7);
    setResultA(null); setResultB(null); setBatchResults([]);
  }

  function renderSteps(result: SimResult, label?: string) {
    return (
      <div>
        {label && <div style={{ fontSize: '13px', fontWeight: 700, color: '#00D4FF', marginBottom: '8px', textTransform: 'uppercase' as React.CSSProperties['textTransform'], letterSpacing: '0.05em' }}>{label}</div>}
        {showSteps && result.steps.map((step) => (
          <div key={step.num} style={{ ...cs.step, opacity: step.applied ? 1 : 0.55 }}>
            <div style={{ ...cs.stepNum, ...(step.applied ? cs.stepApplied : cs.stepSkipped) }}>
              {step.num}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ ...cs.stepName, color: step.applied ? '#0A2342' : '#94A3B8' }}>{step.name}</div>
              <div style={cs.stepDesc}>{step.description}</div>
            </div>
            <div style={{ ...cs.stepAdj, color: step.adjustmentCents > 0 ? '#DC2626' : step.adjustmentCents < 0 ? '#059669' : '#94A3B8' }}>
              {step.applied && step.adjustmentCents !== 0
                ? `${step.adjustmentCents > 0 ? '+' : ''}$${(step.adjustmentCents / 100).toFixed(2)}`
                : step.applied ? '--' : 'skipped'
              }
              <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 400 }}>
                ${(step.runningTotalCents / 100).toFixed(2)}
              </div>
            </div>
          </div>
        ))}
        <div style={cs.finalRow}>
          <div style={cs.finalLabel}>Final Price</div>
          <div style={cs.finalPrice}>${(result.finalCents / 100).toFixed(2)}</div>
        </div>
      </div>
    );
  }

  function renderInputPanel(
    prefix: string,
    product: string, setProduct: (v: string) => void,
    date: string, setDate: (v: string) => void,
    duration: DurationType, setDuration: (v: DurationType) => void,
    multiDays: number, setMultiDays: (v: number) => void,
    promo: string, setPromo: (v: string) => void,
    leadDays: number, setLeadDays: (v: number) => void,
  ) {
    return (
      <>
        <div style={cs.field}>
          <label style={cs.label}>Product</label>
          <select style={cs.select} value={product} onChange={(e) => setProduct(e.target.value)}>
            {DEFAULT_PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={cs.twoCol}>
          <div style={cs.field}>
            <label style={cs.label}>Date</label>
            <input style={cs.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div style={cs.field}>
            <label style={cs.label}>Duration</label>
            <select style={cs.select} value={duration} onChange={(e) => setDuration(e.target.value as DurationType)}>
              <option value="hourly">Hourly (1 hr)</option>
              <option value="half-day">Half-Day (3.5 hrs)</option>
              <option value="full-day">Full-Day (6 hrs)</option>
              <option value="multi-day">Multi-Day</option>
            </select>
          </div>
        </div>
        {duration === 'multi-day' && (
          <div style={cs.field}>
            <label style={cs.label}>Number of Days</label>
            <input style={cs.input} type="number" min={2} max={14} value={multiDays} onChange={(e) => setMultiDays(parseInt(e.target.value) || 1)} />
          </div>
        )}
        <div style={cs.twoCol}>
          <div style={cs.field}>
            <label style={cs.label}>Lead Time (days ahead)</label>
            <input style={cs.input} type="number" min={0} max={90} value={leadDays} onChange={(e) => setLeadDays(parseInt(e.target.value) || 0)} />
          </div>
          <div style={cs.field}>
            <label style={cs.label}>Promo Code</label>
            <input style={{ ...cs.input, textTransform: 'uppercase' as const }} placeholder="e.g. WELCOME20" value={promo} onChange={(e) => setPromo(e.target.value)} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div>
      {/* Mode bar */}
      <div style={cs.modeBar}>
        <button style={{ ...cs.modeBtn, background: mode === 'single' ? '#0A2342' : '#FFFFFF', color: mode === 'single' ? '#FFFFFF' : '#0A2342' }} onClick={() => { setMode('single'); setResultB(null); }}>
          <Play size={14} /> Single Simulation
        </button>
        <button style={{ ...cs.modeBtn, background: mode === 'compare' ? '#0A2342' : '#FFFFFF', color: mode === 'compare' ? '#FFFFFF' : '#0A2342' }} onClick={() => setMode('compare')}>
          <Columns size={14} /> Compare Side-by-Side
        </button>
        <button style={{ ...cs.modeBtn, background: mode === 'batch' ? '#0A2342' : '#FFFFFF', color: mode === 'batch' ? '#FFFFFF' : '#0A2342' }} onClick={() => setMode('batch')}>
          <CalendarRange size={14} /> Batch Simulation
        </button>
        <button style={cs.resetBtn} onClick={resetInputs}>
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      {/* Single / Compare mode */}
      {(mode === 'single' || mode === 'compare') && (
        <div style={cs.wrap}>
          {/* Input Panel A */}
          <div style={cs.card}>
            <div style={cs.cardTitle}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00D4FF' }} />
              Input{mode === 'compare' ? ' A' : ' Parameters'}
            </div>
            {renderInputPanel('a', productA, setProductA, dateA, setDateA, durationA, setDurationA, multiDaysA, setMultiDaysA, promoA, setPromoA, leadDaysA, setLeadDaysA)}
            {mode === 'single' && (
              <button style={cs.simBtn} onClick={runSim}>
                <Play size={16} /> Simulate Price
              </button>
            )}
          </div>

          {/* Input Panel B (compare) */}
          {mode === 'compare' && (
            <div style={cs.card}>
              <div style={cs.cardTitle}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }} />
                Input B
              </div>
              {renderInputPanel('b', productB, setProductB, dateB, setDateB, durationB, setDurationB, multiDaysB, setMultiDaysB, promoB, setPromoB, leadDaysB, setLeadDaysB)}
            </div>
          )}

          {mode === 'compare' && (
            <div style={{ flexBasis: '100%' }}>
              <button style={{ ...cs.simBtn, maxWidth: '300px', margin: '0 auto' }} onClick={runSim}>
                <Play size={16} /> Simulate Both
              </button>
            </div>
          )}

          {/* Results */}
          {resultA && (
            <div style={{ ...cs.card, flex: mode === 'compare' ? '1 1 340px' : '1 1 100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={cs.cardTitle}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00D4FF' }} />
                  Rule Trace{mode === 'compare' ? ' A' : ''}
                </div>
                <button
                  style={{ ...cs.resetBtn, marginLeft: 0 }}
                  onClick={() => setShowSteps(!showSteps)}
                >
                  {showSteps ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {showSteps ? 'Collapse' : 'Expand'}
                </button>
              </div>
              {renderSteps(resultA)}
            </div>
          )}

          {resultB && mode === 'compare' && (
            <div style={{ ...cs.card, flex: '1 1 340px' }}>
              <div style={cs.cardTitle}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }} />
                Rule Trace B
              </div>
              {renderSteps(resultB)}
            </div>
          )}

          {/* Comparison summary */}
          {resultA && resultB && mode === 'compare' && (
            <div style={{ ...cs.card, flexBasis: '100%', background: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '40px' }}>
                <div style={{ textAlign: 'center' as const }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#00D4FF', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '4px' }}>Scenario A</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#0A2342' }}>${(resultA.finalCents / 100).toFixed(2)}</div>
                </div>
                <div style={{ fontSize: '24px', color: '#94A3B8', fontWeight: 300 }}>vs</div>
                <div style={{ textAlign: 'center' as const }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#F59E0B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '4px' }}>Scenario B</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#0A2342' }}>${(resultB.finalCents / 100).toFixed(2)}</div>
                </div>
                <div style={{ textAlign: 'center' as const }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '4px' }}>Difference</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: resultA.finalCents > resultB.finalCents ? '#DC2626' : '#059669' }}>
                    {resultA.finalCents > resultB.finalCents ? '+' : '-'}${(Math.abs(resultA.finalCents - resultB.finalCents) / 100).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Batch mode */}
      {mode === 'batch' && (
        <div style={cs.wrap}>
          <div style={{ ...cs.card, flex: '0 0 340px' }}>
            <div style={cs.cardTitle}>
              <CalendarRange size={16} /> Batch Parameters
            </div>
            <div style={cs.field}>
              <label style={cs.label}>Product</label>
              <select style={cs.select} value={batchProduct} onChange={(e) => setBatchProduct(e.target.value)}>
                {DEFAULT_PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={cs.twoCol}>
              <div style={cs.field}>
                <label style={cs.label}>Start Date</label>
                <input style={cs.input} type="date" value={batchStart} onChange={(e) => setBatchStart(e.target.value)} />
              </div>
              <div style={cs.field}>
                <label style={cs.label}>End Date</label>
                <input style={cs.input} type="date" value={batchEnd} onChange={(e) => setBatchEnd(e.target.value)} />
              </div>
            </div>
            <div style={cs.field}>
              <label style={cs.label}>Duration Type</label>
              <select style={cs.select} value={batchDuration} onChange={(e) => setBatchDuration(e.target.value as DurationType)}>
                <option value="hourly">Hourly</option>
                <option value="half-day">Half-Day</option>
                <option value="full-day">Full-Day</option>
              </select>
            </div>
            <button style={cs.simBtn} onClick={runBatch}>
              <Play size={16} /> Run Batch Simulation
            </button>
          </div>

          <div style={{ ...cs.card, flex: '1 1 500px' }}>
            <div style={cs.cardTitle}>Batch Results</div>
            {batchResults.length === 0 ? (
              <div style={{ textAlign: 'center' as const, padding: '40px', color: '#94A3B8', fontSize: '14px' }}>
                Configure parameters and click "Run Batch Simulation" to see daily prices.
              </div>
            ) : (
              <>
                <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px' }}>
                  {batchResults.length} days &mdash; Avg: ${(batchResults.reduce((s, r) => s + r.finalCents, 0) / batchResults.length / 100).toFixed(2)} &mdash;
                  Min: ${(Math.min(...batchResults.map((r) => r.finalCents)) / 100).toFixed(2)} &mdash;
                  Max: ${(Math.max(...batchResults.map((r) => r.finalCents)) / 100).toFixed(2)}
                </div>
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <table style={cs.batchTable}>
                    <thead>
                      <tr>
                        <th style={cs.batchTh}>Date</th>
                        <th style={cs.batchTh}>Day</th>
                        <th style={cs.batchTh}>Base</th>
                        <th style={cs.batchTh}>Rules Applied</th>
                        <th style={cs.batchTh}>Final Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchResults.map((r) => {
                        const d = new Date(r.input.date + 'T12:00:00');
                        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                        const appliedRules = r.steps.filter((s) => s.applied && s.num > 1).map((s) => s.name);
                        const baseStep = r.steps[0];
                        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                        return (
                          <tr key={r.input.date} style={{ background: isWeekend ? '#FEF9E7' : '#FFFFFF' }}>
                            <td style={cs.batchTd}>{r.input.date}</td>
                            <td style={{ ...cs.batchTd, fontFamily: 'inherit', fontWeight: isWeekend ? 700 : 400 }}>{dayName}</td>
                            <td style={cs.batchTd}>${(baseStep.runningTotalCents / 100).toFixed(2)}</td>
                            <td style={{ ...cs.batchTd, fontFamily: 'inherit', fontSize: '11px' }}>
                              {appliedRules.length > 0
                                ? appliedRules.map((name, i) => (
                                    <span key={i} style={{ display: 'inline-block', background: '#DEF7EC', color: '#03543F', padding: '1px 6px', borderRadius: '3px', marginRight: '4px', marginBottom: '2px', fontSize: '10px', fontWeight: 600 }}>
                                      {name}
                                    </span>
                                  ))
                                : <span style={{ color: '#94A3B8' }}>Base only</span>
                              }
                            </td>
                            <td style={{ ...cs.batchTd, fontWeight: 700, color: '#0A2342' }}>${(r.finalCents / 100).toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
