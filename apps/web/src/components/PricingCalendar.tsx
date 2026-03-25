import React, { useState, useMemo, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Copy, Info, Edit3, X, Check,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

interface PricingCalendarProps {
  products: Array<{ id: string; name: string; basePriceCents: number }>;
  onOverrideChange?: (productId: string, date: string, priceCents: number) => void;
}

type RuleKind = 'base' | 'seasonal' | 'weekend' | 'override' | 'surge';

interface DayPrice {
  date: string;          // YYYY-MM-DD
  priceCents: number;
  rule: RuleKind;
  breakdown: { name: string; applied: boolean; adjustment: string; runningCents: number }[];
}

/* ── Mock pricing engine ───────────────────────────────── */

const OVERRIDES: Record<string, Record<string, number>> = {
  // productId -> date -> priceCents
  pontoon:  { '2026-07-04': 15000, '2026-05-25': 13500, '2026-12-31': 12000 },
  jetski:   { '2026-07-04': 11000, '2026-08-15': 10500, '2026-09-07': 9800 },
  kayak:    { '2026-07-04': 5500,  '2026-06-19': 4800 },
};

const SURGE_DATES = new Set([
  '2026-07-03', '2026-07-04', '2026-07-05',
  '2026-05-23', '2026-05-24', '2026-05-25',
  '2026-08-29', '2026-08-30', '2026-09-06', '2026-09-07',
]);

function computeDay(productId: string, baseCents: number, dateStr: string): DayPrice {
  const d = new Date(dateStr + 'T12:00:00');
  const month = d.getMonth(); // 0-indexed
  const dow = d.getDay();     // 0=Sun, 6=Sat
  const breakdown: DayPrice['breakdown'] = [];
  let running = baseCents;
  let topRule: RuleKind = 'base';

  breakdown.push({ name: 'Base Rate', applied: true, adjustment: '$' + (baseCents / 100).toFixed(2), runningCents: running });

  // check override first
  const ovr = OVERRIDES[productId]?.[dateStr];
  if (ovr !== undefined) {
    breakdown.push({ name: 'Calendar Override', applied: true, adjustment: '$' + (ovr / 100).toFixed(2), runningCents: ovr });
    return { date: dateStr, priceCents: ovr, rule: 'override', breakdown };
  }
  breakdown.push({ name: 'Calendar Override', applied: false, adjustment: 'N/A', runningCents: running });

  // seasonal: June-Aug +25%
  const isSummer = month >= 5 && month <= 7;
  if (isSummer) {
    const adj = Math.round(running * 0.25);
    running += adj;
    topRule = 'seasonal';
    breakdown.push({ name: 'Summer Season +25%', applied: true, adjustment: '+$' + (adj / 100).toFixed(2), runningCents: running });
  } else {
    breakdown.push({ name: 'Summer Season +25%', applied: false, adjustment: 'N/A', runningCents: running });
  }

  // weekend: Sat/Sun +15%
  const isWeekend = dow === 0 || dow === 6;
  if (isWeekend) {
    const adj = Math.round(running * 0.15);
    running += adj;
    topRule = 'weekend';
    breakdown.push({ name: 'Weekend Surcharge +15%', applied: true, adjustment: '+$' + (adj / 100).toFixed(2), runningCents: running });
  } else {
    breakdown.push({ name: 'Weekend Surcharge +15%', applied: false, adjustment: 'N/A', runningCents: running });
  }

  // demand surge +10%
  if (SURGE_DATES.has(dateStr)) {
    const adj = Math.round(running * 0.10);
    running += adj;
    topRule = 'surge';
    breakdown.push({ name: 'Demand Surge +10%', applied: true, adjustment: '+$' + (adj / 100).toFixed(2), runningCents: running });
  } else {
    breakdown.push({ name: 'Demand Surge +10%', applied: false, adjustment: 'N/A', runningCents: running });
  }

  return { date: dateStr, priceCents: running, rule: topRule, breakdown };
}

/* ── Color map ─────────────────────────────────────────── */

const RULE_COLORS: Record<RuleKind, { bg: string; border: string; label: string }> = {
  base:     { bg: '#FFFFFF',  border: '#E2E8F0', label: 'Base Rate' },
  seasonal: { bg: '#DEF7EC',  border: '#6EE7B7', label: 'Seasonal Discount' },
  weekend:  { bg: '#FEF3C7',  border: '#FCD34D', label: 'Weekend Surcharge' },
  override: { bg: '#D6E8F4',  border: '#0A2342', label: 'Calendar Override' },
  surge:    { bg: '#FEE2E2',  border: '#F87171', label: 'Demand Surge' },
};

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  wrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' },
  navRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  navBtn: { background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', color: '#0A2342' },
  monthLabel: { fontSize: '20px', fontWeight: 700, color: '#0A2342', minWidth: '200px', textAlign: 'center' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', background: '#E2E8F0', borderRadius: '8px', overflow: 'hidden' },
  dayHeader: { padding: '8px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', background: '#F8FAFC', textAlign: 'center' as const },
  dayCell: { minHeight: '80px', padding: '6px 8px', cursor: 'pointer', position: 'relative' as const, transition: 'box-shadow 0.15s', display: 'flex', flexDirection: 'column' as const },
  dayNum: { fontSize: '13px', fontWeight: 600, marginBottom: '2px' },
  dayPrice: { fontFamily: '"JetBrains Mono", monospace', fontSize: '14px', fontWeight: 700, color: '#0A2342' },
  ruleTag: { fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginTop: 'auto', borderRadius: '3px', padding: '1px 4px', alignSelf: 'flex-start' },
  overrideIndicator: { width: '6px', height: '6px', borderRadius: '50%', background: '#0A2342', position: 'absolute' as const, top: '6px', right: '6px' },
  tooltip: { position: 'absolute' as const, zIndex: 50, background: '#0A2342', color: '#FFFFFF', borderRadius: '8px', padding: '12px 16px', fontSize: '12px', width: '240px', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', left: '50%', transform: 'translateX(-50%)', bottom: '100%', marginBottom: '4px', pointerEvents: 'none' as const },
  tooltipRow: { display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  legend: { display: 'flex', gap: '16px', flexWrap: 'wrap' as const, marginTop: '16px' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748B' },
  legendDot: { width: '12px', height: '12px', borderRadius: '3px', border: '1px solid' },
  copyBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: '#0A2342', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer' },
  selRange: { boxShadow: 'inset 0 0 0 2px #00D4FF' },
  editOverlay: { position: 'fixed' as const, inset: 0, background: 'rgba(10,35,66,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  editModal: { background: '#FFFFFF', borderRadius: '8px', padding: '24px', width: '340px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
  editTitle: { fontSize: '16px', fontWeight: 700, color: '#0A2342', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  editInput: { width: '100%', padding: '8px 12px', fontSize: '16px', fontFamily: '"JetBrains Mono", monospace', border: '1px solid #CCC', borderRadius: '4px', boxSizing: 'border-box' as const },
  editBtnRow: { display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' },
  editBtn: { padding: '6px 16px', fontSize: '14px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer' },
};

/* ── Component ─────────────────────────────────────────── */

export default function PricingCalendar({ products, onOverrideChange }: PricingCalendarProps) {
  const [selectedProduct, setSelectedProduct] = useState(products[0]?.id ?? '');
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(2); // March = 2 (0-indexed)
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [localOverrides, setLocalOverrides] = useState<Record<string, Record<string, number>>>({ ...OVERRIDES });
  const [copyWeekStart, setCopyWeekStart] = useState<string | null>(null);

  const product = products.find((p) => p.id === selectedProduct) ?? products[0];

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const startDow = firstOfMonth.getDay();
    const totalDays = lastOfMonth.getDate();

    const days: (DayPrice | null)[] = [];
    // leading blanks
    for (let i = 0; i < startDow; i++) days.push(null);
    // actual days
    for (let d = 1; d <= totalDays; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      // Use local overrides merged into engine
      const merged = { ...OVERRIDES };
      Object.entries(localOverrides).forEach(([pid, ov]) => {
        merged[pid] = { ...(merged[pid] || {}), ...ov };
      });
      const dp = computeDayWithOverrides(product.id, product.basePriceCents, ds, merged);
      days.push(dp);
    }
    return days;
  }, [year, month, product, localOverrides]);

  function computeDayWithOverrides(productId: string, baseCents: number, dateStr: string, overrides: Record<string, Record<string, number>>): DayPrice {
    const d = new Date(dateStr + 'T12:00:00');
    const mo = d.getMonth();
    const dow = d.getDay();
    const breakdown: DayPrice['breakdown'] = [];
    let running = baseCents;
    let topRule: RuleKind = 'base';

    breakdown.push({ name: 'Base Rate', applied: true, adjustment: '$' + (baseCents / 100).toFixed(2), runningCents: running });

    const ovr = overrides[productId]?.[dateStr];
    if (ovr !== undefined) {
      breakdown.push({ name: 'Calendar Override', applied: true, adjustment: '$' + (ovr / 100).toFixed(2), runningCents: ovr });
      return { date: dateStr, priceCents: ovr, rule: 'override', breakdown };
    }
    breakdown.push({ name: 'Calendar Override', applied: false, adjustment: 'N/A', runningCents: running });

    const isSummer = mo >= 5 && mo <= 7;
    if (isSummer) {
      const adj = Math.round(running * 0.25);
      running += adj;
      topRule = 'seasonal';
      breakdown.push({ name: 'Summer Season +25%', applied: true, adjustment: '+$' + (adj / 100).toFixed(2), runningCents: running });
    } else {
      breakdown.push({ name: 'Summer Season +25%', applied: false, adjustment: 'N/A', runningCents: running });
    }

    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend) {
      const adj = Math.round(running * 0.15);
      running += adj;
      topRule = 'weekend';
      breakdown.push({ name: 'Weekend Surcharge +15%', applied: true, adjustment: '+$' + (adj / 100).toFixed(2), runningCents: running });
    } else {
      breakdown.push({ name: 'Weekend Surcharge +15%', applied: false, adjustment: 'N/A', runningCents: running });
    }

    if (SURGE_DATES.has(dateStr)) {
      const adj = Math.round(running * 0.10);
      running += adj;
      topRule = 'surge';
      breakdown.push({ name: 'Demand Surge +10%', applied: true, adjustment: '+$' + (adj / 100).toFixed(2), runningCents: running });
    } else {
      breakdown.push({ name: 'Demand Surge +10%', applied: false, adjustment: 'N/A', runningCents: running });
    }

    return { date: dateStr, priceCents: running, rule: topRule, breakdown };
  }

  const isInRange = useCallback((dateStr: string) => {
    if (!rangeStart || !rangeEnd) return false;
    return dateStr >= rangeStart && dateStr <= rangeEnd;
  }, [rangeStart, rangeEnd]);

  function handleDayClick(dateStr: string, shiftKey: boolean) {
    if (shiftKey && rangeStart) {
      const end = dateStr > rangeStart ? dateStr : rangeStart;
      const start = dateStr < rangeStart ? dateStr : rangeStart;
      setRangeStart(start);
      setRangeEnd(end);
    } else {
      setRangeStart(dateStr);
      setRangeEnd(null);
      // open inline edit
      setEditDate(dateStr);
      const dp = calendarDays.find((d) => d?.date === dateStr);
      setEditValue(dp ? (dp.priceCents / 100).toFixed(2) : '');
    }
  }

  function handleBulkEdit() {
    if (!rangeStart || !rangeEnd) return;
    setEditDate(rangeStart + '~' + rangeEnd);
    setEditValue('');
  }

  function saveOverride() {
    if (!editDate || !editValue) return;
    const cents = Math.round(parseFloat(editValue) * 100);
    if (isNaN(cents) || cents <= 0) return;

    if (editDate.includes('~')) {
      // bulk
      const [start, end] = editDate.split('~');
      const cur = new Date(start + 'T12:00:00');
      const endD = new Date(end + 'T12:00:00');
      const newOvr = { ...(localOverrides[product.id] || {}) };
      while (cur <= endD) {
        const ds = cur.toISOString().slice(0, 10);
        newOvr[ds] = cents;
        onOverrideChange?.(product.id, ds, cents);
        cur.setDate(cur.getDate() + 1);
      }
      setLocalOverrides((prev) => ({ ...prev, [product.id]: newOvr }));
    } else {
      setLocalOverrides((prev) => ({
        ...prev,
        [product.id]: { ...(prev[product.id] || {}), [editDate]: cents },
      }));
      onOverrideChange?.(product.id, editDate, cents);
    }
    setEditDate(null);
  }

  function handleCopyWeek() {
    if (!copyWeekStart) return;
    // find week start (Sunday)
    const ws = new Date(copyWeekStart + 'T12:00:00');
    const wsDow = ws.getDay();
    ws.setDate(ws.getDate() - wsDow);
    // copy 7 days of prices to the following week
    const newOvr = { ...(localOverrides[product.id] || {}) };
    for (let i = 0; i < 7; i++) {
      const srcDate = new Date(ws);
      srcDate.setDate(srcDate.getDate() + i);
      const dstDate = new Date(srcDate);
      dstDate.setDate(dstDate.getDate() + 7);
      const srcStr = srcDate.toISOString().slice(0, 10);
      const dstStr = dstDate.toISOString().slice(0, 10);
      const dp = calendarDays.find((dd) => dd?.date === srcStr);
      if (dp) {
        newOvr[dstStr] = dp.priceCents;
      }
    }
    setLocalOverrides((prev) => ({ ...prev, [product.id]: newOvr }));
    setCopyWeekStart(null);
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  }

  const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.header}>
        <select style={s.select} value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div style={s.navRow}>
          <button style={s.navBtn} onClick={prevMonth}><ChevronLeft size={18} /></button>
          <span style={s.monthLabel}>{monthName} {year}</span>
          <button style={s.navBtn} onClick={nextMonth}><ChevronRight size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {rangeStart && rangeEnd && (
            <button style={s.copyBtn} onClick={handleBulkEdit}>
              <Edit3 size={14} /> Bulk Set Prices
            </button>
          )}
          <button
            style={{ ...s.copyBtn, background: copyWeekStart ? '#00D4FF' : '#F8FAFC', color: copyWeekStart ? '#FFFFFF' : '#0A2342' }}
            onClick={() => {
              if (copyWeekStart) handleCopyWeek();
              else if (rangeStart) setCopyWeekStart(rangeStart);
            }}
          >
            <Copy size={14} /> {copyWeekStart ? 'Paste to Next Week' : 'Copy Week'}
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div style={s.grid}>
        {DAYS_OF_WEEK.map((d) => (
          <div key={d} style={s.dayHeader}>{d}</div>
        ))}
        {calendarDays.map((dp, idx) => {
          if (!dp) {
            return <div key={'blank-' + idx} style={{ background: '#F8FAFC', minHeight: '80px' }} />;
          }
          const rc = RULE_COLORS[dp.rule];
          const isHover = hoverDate === dp.date;
          const inRange = isInRange(dp.date);
          const dayNum = parseInt(dp.date.split('-')[2], 10);
          const isToday = dp.date === '2026-03-25';

          return (
            <div
              key={dp.date}
              style={{
                ...s.dayCell,
                background: rc.bg,
                borderLeft: `3px solid ${rc.border}`,
                ...(inRange ? s.selRange : {}),
                ...(isHover ? { boxShadow: '0 2px 8px rgba(0,0,0,0.15)' } : {}),
              }}
              onMouseEnter={() => setHoverDate(dp.date)}
              onMouseLeave={() => setHoverDate(null)}
              onClick={(e) => handleDayClick(dp.date, e.shiftKey)}
            >
              <div style={{ ...s.dayNum, color: isToday ? '#00D4FF' : '#0A2342' }}>
                {isToday ? (
                  <span style={{ background: '#00D4FF', color: '#FFFFFF', borderRadius: '50%', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>
                    {dayNum}
                  </span>
                ) : dayNum}
              </div>
              <div style={s.dayPrice}>${(dp.priceCents / 100).toFixed(0)}</div>
              <div style={{ ...s.ruleTag, background: rc.border + '33', color: rc.border === '#E2E8F0' ? '#64748B' : rc.border }}>
                {dp.rule === 'base' ? 'base' : dp.rule === 'seasonal' ? 'season' : dp.rule === 'weekend' ? 'wknd' : dp.rule === 'override' ? 'override' : 'surge'}
              </div>
              {dp.rule === 'override' && <div style={s.overrideIndicator} />}

              {/* Tooltip */}
              {isHover && (
                <div style={s.tooltip}>
                  <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '13px' }}>
                    {dp.date} &mdash; {product.name}
                  </div>
                  {dp.breakdown.map((b, i) => (
                    <div key={i} style={{ ...s.tooltipRow, opacity: b.applied ? 1 : 0.45 }}>
                      <span>{b.applied ? '>' : '-'} {b.name}</span>
                      <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{b.adjustment}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: '8px', fontWeight: 700, fontSize: '14px', fontFamily: '"JetBrains Mono", monospace', textAlign: 'right' as const }}>
                    Final: ${(dp.priceCents / 100).toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={s.legend}>
        {Object.entries(RULE_COLORS).map(([key, val]) => (
          <div key={key} style={s.legendItem}>
            <div style={{ ...s.legendDot, background: val.bg, borderColor: val.border }} />
            {val.label}
          </div>
        ))}
        <div style={s.legendItem}>
          <Info size={12} /> Hover for rule breakdown
        </div>
        <div style={s.legendItem}>
          <Edit3 size={12} /> Click to override / Shift+click for range
        </div>
      </div>

      {/* Edit Override Modal */}
      {editDate && (
        <div style={s.editOverlay} onClick={() => setEditDate(null)}>
          <div style={s.editModal} onClick={(e) => e.stopPropagation()}>
            <div style={s.editTitle}>
              <span>Set Price Override{editDate.includes('~') ? ' (Range)' : ''}</span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setEditDate(null)}>
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px' }}>
              {editDate.includes('~')
                ? `${editDate.split('~')[0]} to ${editDate.split('~')[1]}`
                : editDate
              }
              &nbsp;&mdash;&nbsp;{product.name}
            </div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', display: 'block', marginBottom: '4px' }}>
              Override Price ($)
            </label>
            <input
              style={s.editInput}
              type="number"
              step="0.01"
              min="0"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') saveOverride(); }}
            />
            <div style={s.editBtnRow}>
              <button
                style={{ ...s.editBtn, background: '#F3F4F6', color: '#64748B' }}
                onClick={() => setEditDate(null)}
              >
                Cancel
              </button>
              <button
                style={{ ...s.editBtn, background: '#0A2342', color: '#FFFFFF' }}
                onClick={saveOverride}
              >
                <Check size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                Save Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
