import React, { useState, createContext, useContext, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { X, Download, Printer, Settings2, GripVertical, Plus, Minus, RotateCcw, SlidersHorizontal, Search, ChevronDown, XCircle } from 'lucide-react';

/* ── Report context ──────────────────────────────────────── */
interface ReportCtx { navigate: (to: string) => void; dateFrom: string; dateTo: string; }
const ReportContext = createContext<ReportCtx>({ navigate: () => {}, dateFrom: '2026-03-01', dateTo: '2026-03-25' });
const useReport = () => useContext(ReportContext);

/* ── Styles ─────────────────────────────────────────────── */
const s = {
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10,35,66,0.55)', zIndex: 1200, display: 'flex', justifyContent: 'flex-end' as const },
  panel: { width: '88vw', maxWidth: '1100px', height: '100vh', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column' as const, boxShadow: '-8px 0 40px rgba(0,0,0,0.2)', overflowY: 'auto' as const },
  header: { padding: '20px 28px', backgroundColor: '#0A2342', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  headerTitle: { fontSize: '20px', fontWeight: 700, margin: 0, color: '#FFFFFF' },
  headerSub: { fontSize: '13px', color: '#94A3B8', marginTop: '2px' },
  headerActions: { display: 'flex', gap: '10px', alignItems: 'center' },
  actionBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' },
  closeBtn: { background: 'none', border: 'none', color: '#FFFFFF', cursor: 'pointer', padding: '4px', opacity: 0.8 },
  body: { flex: 1, padding: '28px', overflowY: 'auto' as const },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '28px' },
  kpiCard: { background: '#FFFFFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  kpiLabel: { fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '6px' },
  kpiValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  section: { background: '#FFFFFF', borderRadius: '10px', border: '1px solid #E2E8F0', marginBottom: '24px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  sectionHeader: { padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 16px', backgroundColor: '#F8FAFC', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  thRight: { textAlign: 'right' as const, padding: '10px 16px', backgroundColor: '#F8FAFC', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  td: { padding: '10px 16px', color: '#0A2342', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' as const },
  tdRight: { padding: '10px 16px', color: '#0A2342', borderBottom: '1px solid #F1F5F9', textAlign: 'right' as const, fontFamily: '"JetBrains Mono", monospace', verticalAlign: 'middle' as const },
  tdMuted: { padding: '10px 16px', color: '#64748B', borderBottom: '1px solid #F1F5F9', fontSize: '12px', verticalAlign: 'middle' as const },
  totalRow: { backgroundColor: '#F0F9FF' },
  badge: (color: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700, backgroundColor: color === 'green' ? 'rgba(16,185,129,0.1)' : color === 'red' ? 'rgba(239,68,68,0.1)' : color === 'yellow' ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.15)', color: color === 'green' ? '#059669' : color === 'red' ? '#DC2626' : color === 'yellow' ? '#D97706' : '#475569' }),
  empty: { padding: '48px 24px', textAlign: 'center' as const, color: '#94A3B8', fontSize: '14px' },
  loading: { padding: '48px 24px', textAlign: 'center' as const, color: '#94A3B8', fontSize: '14px' },
};

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtC = (cents: number) => fmt(cents / 100);
const pct = (n: number) => `${n.toFixed(1)}%`;

/* ── Column definition types ─────────────────────────────── */
type CellAlign = 'left' | 'right' | 'muted';

interface ColDef<T = Record<string, unknown>> {
  key: string;
  label: string;
  align?: CellAlign;
  defaultVisible?: boolean;
  render: (row: T) => React.ReactNode;
}

/* ── Filter definition types ─────────────────────────────── */
interface FilterDef<T = Record<string, unknown>> {
  key: string;
  label: string;
  type: 'text' | 'select' | 'range';
  getValue: (row: T) => string | number;
  placeholder?: string;
}

type FilterValues = Record<string, { text?: string; select?: string; min?: string; max?: string }>;

function applyFilters<T>(rows: T[], filters: FilterDef<T>[], values: FilterValues): T[] {
  return rows.filter((row) =>
    filters.every((f) => {
      const v = values[f.key];
      if (!v) return true;
      const cell = f.getValue(row);
      if (f.type === 'text') {
        const q = v.text?.trim().toLowerCase();
        return !q || String(cell).toLowerCase().includes(q);
      }
      if (f.type === 'select') {
        return !v.select || v.select === '__all__' || String(cell) === v.select;
      }
      if (f.type === 'range') {
        const n = Number(cell);
        const min = v.min !== undefined && v.min !== '' ? Number(v.min) : undefined;
        const max = v.max !== undefined && v.max !== '' ? Number(v.max) : undefined;
        if (min !== undefined && n < min) return false;
        if (max !== undefined && n > max) return false;
        return true;
      }
      return true;
    })
  );
}

function countActiveFilters(values: FilterValues): number {
  return Object.values(values).filter((v) => {
    if (!v) return false;
    return (v.text?.trim()) || (v.select && v.select !== '__all__') || v.min || v.max;
  }).length;
}

/* ── Filter bar component ────────────────────────────────── */
interface FilterBarProps<T> {
  filters: FilterDef<T>[];
  values: FilterValues;
  rows: T[];
  onChange: (key: string, patch: FilterValues[string]) => void;
  onClear: () => void;
}

function FilterBar<T>({ filters, values, rows, onChange, onClear }: FilterBarProps<T>) {
  const activeCount = countActiveFilters(values);
  return (
    <div style={{ padding: '12px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FAFBFE', display: 'flex', flexWrap: 'wrap' as const, gap: '10px', alignItems: 'flex-end' }}>
      {filters.map((f) => {
        const v = values[f.key] ?? {};
        if (f.type === 'text') {
          return (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column' as const, gap: '3px', minWidth: '160px' }}>
              <label style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{f.label}</label>
              <div style={{ position: 'relative' as const }}>
                <Search size={12} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' as const }} />
                <input
                  type="text"
                  value={v.text ?? ''}
                  onChange={(e) => onChange(f.key, { ...v, text: e.target.value })}
                  placeholder={f.placeholder ?? `Search ${f.label}…`}
                  style={{ paddingLeft: '26px', paddingRight: '8px', paddingTop: '6px', paddingBottom: '6px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', width: '100%', outline: 'none', backgroundColor: v.text?.trim() ? '#EFF6FF' : '#FFFFFF', borderColor: v.text?.trim() ? '#3B82F6' : '#E2E8F0' }}
                />
              </div>
            </div>
          );
        }
        if (f.type === 'select') {
          const options = Array.from(new Set(rows.map((r) => String(f.getValue(r))))).sort();
          return (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column' as const, gap: '3px', minWidth: '140px' }}>
              <label style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{f.label}</label>
              <div style={{ position: 'relative' as const }}>
                <select
                  value={v.select ?? '__all__'}
                  onChange={(e) => onChange(f.key, { ...v, select: e.target.value })}
                  style={{ appearance: 'none' as const, paddingLeft: '10px', paddingRight: '28px', paddingTop: '6px', paddingBottom: '6px', fontSize: '13px', border: '1px solid', borderColor: (v.select && v.select !== '__all__') ? '#3B82F6' : '#E2E8F0', borderRadius: '6px', width: '100%', outline: 'none', backgroundColor: (v.select && v.select !== '__all__') ? '#EFF6FF' : '#FFFFFF', cursor: 'pointer' }}
                >
                  <option value="__all__">All {f.label}s</option>
                  {options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <ChevronDown size={12} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' as const }} />
              </div>
            </div>
          );
        }
        if (f.type === 'range') {
          const hasValue = v.min || v.max;
          return (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column' as const, gap: '3px' }}>
              <label style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{f.label}</label>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  type="number"
                  value={v.min ?? ''}
                  onChange={(e) => onChange(f.key, { ...v, min: e.target.value })}
                  placeholder="Min"
                  style={{ width: '70px', padding: '6px 8px', fontSize: '13px', border: '1px solid', borderColor: hasValue ? '#3B82F6' : '#E2E8F0', borderRadius: '6px', outline: 'none', backgroundColor: hasValue ? '#EFF6FF' : '#FFFFFF' }}
                />
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>–</span>
                <input
                  type="number"
                  value={v.max ?? ''}
                  onChange={(e) => onChange(f.key, { ...v, max: e.target.value })}
                  placeholder="Max"
                  style={{ width: '70px', padding: '6px 8px', fontSize: '13px', border: '1px solid', borderColor: hasValue ? '#3B82F6' : '#E2E8F0', borderRadius: '6px', outline: 'none', backgroundColor: hasValue ? '#EFF6FF' : '#FFFFFF' }}
                />
              </div>
            </div>
          );
        }
        return null;
      })}
      {activeCount > 0 && (
        <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
          <button
            onClick={onClear}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
          >
            <XCircle size={13} /> Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Column config hook (localStorage) ───────────────────── */
function useColumnConfig(storageKey: string, allCols: ColDef[], defaults: string[]) {
  const stored = localStorage.getItem(`helm:cols:${storageKey}`);
  const initial: string[] = stored ? JSON.parse(stored) : defaults;
  const [activeKeys, setActiveKeys] = useState<string[]>(initial);

  const setAndPersist = useCallback((keys: string[]) => {
    setActiveKeys(keys);
    localStorage.setItem(`helm:cols:${storageKey}`, JSON.stringify(keys));
  }, [storageKey]);

  const reset = useCallback(() => setAndPersist(defaults), [defaults, setAndPersist]);

  const activeCols = activeKeys
    .map((k) => allCols.find((c) => c.key === k))
    .filter(Boolean) as ColDef[];

  const inactiveCols = allCols.filter((c) => !activeKeys.includes(c.key));

  return { activeCols, inactiveCols, activeKeys, setActiveKeys: setAndPersist, reset };
}

/* ── Drag-and-drop column config panel ───────────────────── */
interface ColConfigPanelProps {
  activeCols: ColDef[];
  inactiveCols: ColDef[];
  activeKeys: string[];
  onUpdate: (keys: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}

function ColConfigPanel({ activeCols, inactiveCols, activeKeys, onUpdate, onReset, onClose }: ColConfigPanelProps) {
  const dragIdx = useRef<number | null>(null);
  const [localKeys, setLocalKeys] = useState<string[]>(activeKeys);
  const [over, setOver] = useState<number | null>(null);

  const localActive = localKeys.map((k) => activeCols.concat(inactiveCols as ColDef[]).find((c) => c.key === k)).filter(Boolean) as ColDef[];
  const localInactive = activeCols.concat(inactiveCols as ColDef[]).filter((c) => !localKeys.includes(c.key));

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setOver(idx); };
  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    if (dragIdx.current === null) return;
    const from = dragIdx.current;
    const updated = [...localKeys];
    const [moved] = updated.splice(from, 1);
    updated.splice(toIdx, 0, moved);
    setLocalKeys(updated);
    setOver(null);
    dragIdx.current = null;
  };
  const handleDragEnd = () => { setOver(null); dragIdx.current = null; };

  const removeKey = (key: string) => setLocalKeys((k) => k.filter((x) => x !== key));
  const addKey = (key: string) => setLocalKeys((k) => [...k, key]);

  const apply = () => { onUpdate(localKeys); onClose(); };

  return (
    <div style={{ padding: '0 20px 20px', borderTop: '2px solid #E2E8F0', backgroundColor: '#F8FAFC', animation: 'slideDown 0.15s ease' }}>
      <style>{`@keyframes slideDown { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }`}</style>
      <div style={{ display: 'flex', gap: '16px', paddingTop: '16px' }}>

        {/* Active columns (draggable) */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Active Columns — drag to reorder
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minHeight: '80px' }}>
            {localActive.length === 0 && (
              <div style={{ padding: '16px', border: '2px dashed #E2E8F0', borderRadius: '6px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>
                Add at least one column
              </div>
            )}
            {localActive.map((col, idx) => (
              <div
                key={col.key}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 12px', borderRadius: '6px', cursor: 'grab',
                  backgroundColor: over === idx ? '#EFF6FF' : '#FFFFFF',
                  border: over === idx ? '2px solid #3B82F6' : '1px solid #E2E8F0',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  transition: 'border-color 0.1s, background-color 0.1s',
                }}
              >
                <GripVertical size={14} color="#94A3B8" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: '#0A2342' }}>{col.label}</span>
                <button
                  onClick={() => removeKey(col.key)}
                  title="Remove column"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#94A3B8', display: 'flex', alignItems: 'center' }}
                >
                  <Minus size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', backgroundColor: '#E2E8F0', flexShrink: 0 }} />

        {/* Available (inactive) columns */}
        <div style={{ width: '220px', flexShrink: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Available to Add
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {localInactive.length === 0 && (
              <div style={{ fontSize: '13px', color: '#94A3B8', padding: '8px 0' }}>All columns active</div>
            )}
            {localInactive.map((col) => (
              <div
                key={col.key}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '6px', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0' }}
              >
                <span style={{ flex: 1, fontSize: '13px', color: '#64748B' }}>{col.label}</span>
                <button
                  onClick={() => addKey(col.key)}
                  title="Add column"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#3B82F6', display: 'flex', alignItems: 'center' }}
                >
                  <Plus size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #E2E8F0' }}>
        <button
          onClick={apply}
          style={{ padding: '7px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: 'none', backgroundColor: '#0A2342', color: '#FFFFFF', cursor: 'pointer' }}
        >
          Apply
        </button>
        <button
          onClick={onClose}
          style={{ padding: '7px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#64748B', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={() => { onReset(); onClose(); }}
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '7px 14px', fontSize: '13px', fontWeight: 500, borderRadius: '6px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#94A3B8', cursor: 'pointer' }}
        >
          <RotateCcw size={13} /> Reset to default
        </button>
      </div>
    </div>
  );
}

/* ── Configurable table ──────────────────────────────────── */
interface ConfigurableTableProps<T> {
  storageKey: string;
  title: string;
  subtitle?: string;
  allCols: ColDef<T>[];
  defaultColKeys: string[];
  filterDefs?: FilterDef<T>[];
  rows: T[];
  loading: boolean;
  emptyMsg?: string;
  footerCells?: Record<string, React.ReactNode>;
}

type PanelOpen = 'none' | 'filters' | 'columns';

function ConfigurableTable<T extends object>({
  storageKey, title, subtitle, allCols, defaultColKeys, filterDefs = [], rows, loading, emptyMsg = 'No data for this period.', footerCells,
}: ConfigurableTableProps<T>) {
  const [panel, setPanel] = useState<PanelOpen>('none');
  const [filterValues, setFilterValues] = useState<FilterValues>({});

  const { activeCols, inactiveCols, activeKeys, setActiveKeys, reset } = useColumnConfig(
    storageKey, allCols as ColDef[], defaultColKeys,
  );

  const filteredRows = filterDefs.length > 0
    ? applyFilters(rows, filterDefs as FilterDef<T>[], filterValues)
    : rows;

  const activeFilterCount = countActiveFilters(filterValues);

  const handleFilterChange = useCallback((key: string, patch: FilterValues[string]) => {
    setFilterValues((prev) => ({ ...prev, [key]: patch }));
  }, []);

  const clearFilters = useCallback(() => setFilterValues({}), []);

  const togglePanel = (p: PanelOpen) => setPanel((cur) => cur === p ? 'none' : p);

  const tdStyle = (col: ColDef) =>
    col.align === 'right' ? s.tdRight : col.align === 'muted' ? s.tdMuted : s.td;
  const thStyle = (col: ColDef) =>
    col.align === 'right' ? s.thRight : s.th;

  return (
    <div style={s.section}>
      <div style={s.sectionHeader}>
        <div>
          <h3 style={s.sectionTitle}>{title}</h3>
          {subtitle && <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>{subtitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {filterDefs.length > 0 && (
            <button
              onClick={() => togglePanel('filters')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', fontSize: '12px', fontWeight: 600,
                borderRadius: '6px', border: '1px solid',
                borderColor: panel === 'filters' ? '#0A2342' : activeFilterCount > 0 ? '#3B82F6' : '#E2E8F0',
                backgroundColor: panel === 'filters' ? '#0A2342' : activeFilterCount > 0 ? '#EFF6FF' : '#FFFFFF',
                color: panel === 'filters' ? '#FFFFFF' : activeFilterCount > 0 ? '#2563EB' : '#64748B',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <SlidersHorizontal size={13} />
              Filters
              {activeFilterCount > 0 && (
                <span style={{ backgroundColor: panel === 'filters' ? 'rgba(255,255,255,0.25)' : '#2563EB', color: panel === 'filters' ? '#FFFFFF' : '#FFFFFF', borderRadius: '9999px', fontSize: '10px', fontWeight: 700, padding: '1px 6px', lineHeight: 1.4 }}>
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => togglePanel('columns')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '5px 12px', fontSize: '12px', fontWeight: 600,
              borderRadius: '6px', border: '1px solid #E2E8F0',
              backgroundColor: panel === 'columns' ? '#0A2342' : '#FFFFFF',
              color: panel === 'columns' ? '#FFFFFF' : '#64748B',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            <Settings2 size={13} />
            Columns
          </button>
        </div>
      </div>

      {panel === 'filters' && filterDefs.length > 0 && (
        <FilterBar
          filters={filterDefs as FilterDef<T>[]}
          values={filterValues}
          rows={rows}
          onChange={handleFilterChange}
          onClear={clearFilters}
        />
      )}

      {panel === 'columns' && (
        <ColConfigPanel
          activeCols={activeCols as ColDef[]}
          inactiveCols={inactiveCols as ColDef[]}
          activeKeys={activeKeys}
          onUpdate={setActiveKeys}
          onReset={reset}
          onClose={() => setPanel('none')}
        />
      )}

      {/* Result count when filtering */}
      {activeFilterCount > 0 && !loading && (
        <div style={{ padding: '6px 20px', backgroundColor: '#EFF6FF', borderBottom: '1px solid #DBEAFE', fontSize: '12px', color: '#2563EB', fontWeight: 500 }}>
          Showing {filteredRows.length} of {rows.length} rows
          <button onClick={clearFilters} style={{ marginLeft: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#2563EB', textDecoration: 'underline', fontSize: '12px', padding: 0 }}>
            clear
          </button>
        </div>
      )}

      <table style={s.table}>
        <thead>
          <tr>
            {activeCols.map((col) => (
              <th key={col.key} style={thStyle(col as ColDef)}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={activeCols.length} style={s.loading}>Loading…</td></tr>
          ) : filteredRows.length === 0 ? (
            <tr><td colSpan={activeCols.length} style={s.empty}>
              {activeFilterCount > 0 ? 'No rows match the current filters.' : emptyMsg}
            </td></tr>
          ) : (
            filteredRows.map((row, i) => (
              <tr key={i}>
                {activeCols.map((col) => (
                  <td key={col.key} style={tdStyle(col as ColDef)}>
                    {(col as ColDef<T>).render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
          {!loading && filteredRows.length > 0 && footerCells && (
            <tr style={s.totalRow}>
              {activeCols.map((col, i) => {
                const cell = footerCells[col.key];
                return (
                  <td key={col.key} style={{ ...(tdStyle(col as ColDef)), fontWeight: 700 }}>
                    {i === 0 ? 'Total' : cell ?? null}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Clickable customer cell ─────────────────────────────── */
function CustomerLink({ name, id }: { name: string; id?: string }) {
  const { navigate } = useReport();
  return (
    <span
      style={{ fontWeight: 600, color: '#0066CC', cursor: 'pointer', textDecoration: 'underline' }}
      onClick={() => navigate(id ? `/customers/${id}` : '/customers')}
    >
      {name}
    </span>
  );
}

/* ── Generic report data hook ────────────────────────────── */
function useReportData<T>(endpoint: string) {
  const { dateFrom, dateTo } = useReport();
  const { getToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ startDate: dateFrom, endDate: dateTo });
      const res = await fetch(`/api/reports/${endpoint}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) setData(await res.json());
    } catch { /* handled via empty state */ } finally {
      setLoading(false);
    }
  }, [endpoint, dateFrom, dateTo, getToken]);

  useEffect(() => { load(); }, [load]);
  return { data, loading };
}

/* ── KPI helper ──────────────────────────────────────────── */
function KPIs({ items }: { items: { l: string; v: string }[] }) {
  return (
    <div style={s.kpiRow}>
      {items.map((k) => (
        <div key={k.l} style={s.kpiCard}>
          <div style={s.kpiLabel}>{k.l}</div>
          <div style={s.kpiValue}>{k.v}</div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Report components
   ═══════════════════════════════════════════════════════════ */

/* ── Revenue ─────────────────────────────────────────────── */
interface RevRow { method: string; count: number; totalCents: number; }
interface RevenueData { revenue: { totalCents: number; paymentCount: number }; invoiced: { totalCents: number; invoiceCount: number }; byPaymentMethod: RevRow[]; }

const revCols: ColDef<RevRow>[] = [
  { key: 'method', label: 'Payment Method', render: (r) => r.method },
  { key: 'count', label: 'Transactions', align: 'right', render: (r) => r.count },
  { key: 'totalCents', label: 'Total Collected', align: 'right', render: (r) => fmtC(r.totalCents) },
  { key: 'avgCents', label: 'Avg Transaction', align: 'right', render: (r) => r.count > 0 ? fmtC(r.totalCents / r.count) : '—' },
];

const revFilters: FilterDef<RevRow>[] = [
  { key: 'method', label: 'Payment Method', type: 'select', getValue: (r) => r.method },
  { key: 'totalCents', label: 'Total ($)', type: 'range', getValue: (r) => r.totalCents / 100 },
];

function RevenueSummary() {
  const { data, loading } = useReportData<RevenueData>('revenue');
  const rows = data?.byPaymentMethod ?? [];
  const total = data?.revenue.totalCents ?? 0;
  return (
    <>
      <KPIs items={[
        { l: 'Collected', v: fmtC(total) },
        { l: 'Invoiced', v: fmtC(data?.invoiced.totalCents ?? 0) },
        { l: 'Transactions', v: String(data?.revenue.paymentCount ?? 0) },
        { l: 'Invoices', v: String(data?.invoiced.invoiceCount ?? 0) },
      ]} />
      <ConfigurableTable
        storageKey="revenue"
        title="Revenue by Payment Method"
        allCols={revCols}
        defaultColKeys={['method', 'count', 'totalCents']}
        filterDefs={revFilters}
        rows={rows}
        loading={loading}
        emptyMsg="No payments in this period."
        footerCells={{ count: rows.reduce((s, r) => s + r.count, 0), totalCents: fmtC(total), avgCents: '' }}
      />
    </>
  );
}

/* ── AR Aging ────────────────────────────────────────────── */
interface AgingDetail { invoiceId: string; invoiceNumber: string; customer: { id: string; firstName: string; lastName: string }; dueDate: string; balanceCents: number; daysOverdue: number; bucket: string; }
interface AgingData { buckets: { current: number; days30: number; days60: number; days90: number; days120plus: number }; totalOutstanding: number; invoiceCount: number; details: AgingDetail[]; }

type AgingRow = { id: string; customer: string; invoice: string; current: number; d30: number; d60: number; d90: number; d120: number; total: number; daysOverdue: number; dueDate: string; };

const agingFilters: FilterDef<AgingRow>[] = [
  { key: 'customer', label: 'Customer', type: 'text', getValue: (r) => r.customer },
  { key: 'daysOverdue', label: 'Days Overdue', type: 'range', getValue: (r) => r.daysOverdue },
  { key: 'total', label: 'Balance ($)', type: 'range', getValue: (r) => r.total / 100 },
];

const agingCols: ColDef<AgingRow>[] = [
  { key: 'customer', label: 'Customer', render: (r) => <CustomerLink name={r.customer} id={r.id} /> },
  { key: 'invoice', label: 'Invoice #', align: 'muted', render: (r) => r.invoice },
  { key: 'dueDate', label: 'Due Date', align: 'muted', render: (r) => r.dueDate.slice(0, 10) },
  { key: 'daysOverdue', label: 'Days Overdue', align: 'right', render: (r) => r.daysOverdue > 0 ? <span style={s.badge('red')}>{r.daysOverdue}d</span> : <span style={s.badge('green')}>Current</span> },
  { key: 'current', label: 'Current', align: 'right', render: (r) => r.current > 0 ? fmtC(r.current) : '—' },
  { key: 'd30', label: '1–30 Days', align: 'right', render: (r) => r.d30 > 0 ? fmtC(r.d30) : '—' },
  { key: 'd60', label: '31–60 Days', align: 'right', render: (r) => r.d60 > 0 ? fmtC(r.d60) : '—' },
  { key: 'd90', label: '61–90 Days', align: 'right', render: (r) => r.d90 > 0 ? fmtC(r.d90) : '—' },
  { key: 'd120', label: '90+ Days', align: 'right', render: (r) => r.d120 > 0 ? fmtC(r.d120) : '—' },
  { key: 'total', label: 'Total Balance', align: 'right', render: (r) => <strong>{fmtC(r.total)}</strong> },
];

function ARAgingReport() {
  const { data, loading } = useReportData<AgingData>('ar-aging');
  const b = data?.buckets ?? { current: 0, days30: 0, days60: 0, days90: 0, days120plus: 0 };
  const rows: AgingRow[] = (data?.details ?? []).map((d) => ({
    id: d.customer.id,
    customer: `${d.customer.firstName} ${d.customer.lastName}`,
    invoice: d.invoiceNumber,
    dueDate: d.dueDate,
    current: d.bucket === 'current' ? d.balanceCents : 0,
    d30: d.bucket === 'days30' ? d.balanceCents : 0,
    d60: d.bucket === 'days60' ? d.balanceCents : 0,
    d90: d.bucket === 'days90' ? d.balanceCents : 0,
    d120: d.bucket === 'days120plus' ? d.balanceCents : 0,
    total: d.balanceCents,
    daysOverdue: d.daysOverdue,
  }));
  return (
    <>
      <KPIs items={[
        { l: 'Total Outstanding', v: fmtC(data?.totalOutstanding ?? 0) },
        { l: '30+ Days', v: fmtC(b.days30 + b.days60 + b.days90 + b.days120plus) },
        { l: '90+ Days', v: fmtC(b.days90 + b.days120plus) },
        { l: 'Open Invoices', v: String(data?.invoiceCount ?? 0) },
      ]} />
      <ConfigurableTable
        storageKey="ar-aging"
        title="Accounts Receivable Aging"
        allCols={agingCols}
        defaultColKeys={['customer', 'invoice', 'current', 'd30', 'd60', 'd90', 'd120', 'total']}
        filterDefs={agingFilters}
        rows={rows}
        loading={loading}
        emptyMsg="No outstanding invoices."
        footerCells={{ current: fmtC(b.current), d30: fmtC(b.days30), d60: fmtC(b.days60), d90: fmtC(b.days90), d120: fmtC(b.days120plus), total: fmtC(data?.totalOutstanding ?? 0) }}
      />
    </>
  );
}

/* ── Occupancy ───────────────────────────────────────────── */
interface OccupancyData { summary: { total: number; occupied: number; vacant: number; maintenance: number; reserved: number; occupancyRate: string }; byDock: { dock: string; total: number; occupied: number; rate: string }[]; }
type DockRow = { dock: string; total: number; occupied: number; vacant: number; rate: number; };

const occupancyFilters: FilterDef<DockRow>[] = [
  { key: 'dock', label: 'Dock', type: 'text', getValue: (r) => r.dock },
  { key: 'rate', label: 'Occupancy %', type: 'range', getValue: (r) => r.rate },
];

const occupancyCols: ColDef<DockRow>[] = [
  { key: 'dock', label: 'Dock', render: (r) => r.dock || '(unassigned)' },
  { key: 'total', label: 'Total Slips', align: 'right', render: (r) => r.total },
  { key: 'occupied', label: 'Occupied', align: 'right', render: (r) => r.occupied },
  { key: 'vacant', label: 'Vacant', align: 'right', render: (r) => r.vacant },
  { key: 'rate', label: 'Occupancy Rate', align: 'right', render: (r) => <span style={s.badge(r.rate >= 90 ? 'green' : r.rate >= 70 ? 'yellow' : 'red')}>{pct(r.rate)}</span> },
];

function OccupancyReport() {
  const { data, loading } = useReportData<OccupancyData>('occupancy');
  const sum = data?.summary ?? { total: 0, occupied: 0, vacant: 0, maintenance: 0, reserved: 0, occupancyRate: '0.0' };
  const rows: DockRow[] = (data?.byDock ?? []).map((d) => ({ dock: d.dock, total: d.total, occupied: d.occupied, vacant: d.total - d.occupied, rate: parseFloat(d.rate) }));
  return (
    <>
      <KPIs items={[
        { l: 'Total Slips', v: String(sum.total) },
        { l: 'Occupied', v: String(sum.occupied) },
        { l: 'Vacant', v: String(sum.vacant) },
        { l: 'Maintenance', v: String(sum.maintenance) },
        { l: 'Occupancy Rate', v: pct(parseFloat(sum.occupancyRate)) },
      ]} />
      <ConfigurableTable
        storageKey="occupancy"
        title="Dock Occupancy Summary"
        allCols={occupancyCols}
        defaultColKeys={['dock', 'total', 'occupied', 'vacant', 'rate']}
        filterDefs={occupancyFilters}
        rows={rows}
        loading={loading}
        footerCells={{ total: sum.total, occupied: sum.occupied, vacant: sum.vacant, rate: <span style={s.badge('green')}>{pct(parseFloat(sum.occupancyRate))}</span> }}
      />
    </>
  );
}

/* ── POS Sales ───────────────────────────────────────────── */
interface POSData { transactionCount: number; subtotalCents: number; taxCents: number; tipCents: number; totalCents: number; shiftCount: number; }
type POSRow = { line: string; amountCents: number; };

const posCols: ColDef<POSRow>[] = [
  { key: 'line', label: 'Line Item', render: (r) => r.line },
  { key: 'amountCents', label: 'Amount', align: 'right', render: (r) => fmtC(r.amountCents) },
];

function POSSalesReport() {
  const { data, loading } = useReportData<POSData>('pos-sales');
  const avg = (data?.transactionCount ?? 0) > 0 ? (data!.totalCents / data!.transactionCount) : 0;
  const rows: POSRow[] = data ? [
    { line: 'Subtotal', amountCents: data.subtotalCents },
    { line: 'Tax', amountCents: data.taxCents },
    { line: 'Tips', amountCents: data.tipCents },
  ] : [];
  return (
    <>
      <KPIs items={[
        { l: 'Transactions', v: loading ? '…' : String(data?.transactionCount ?? 0) },
        { l: 'Total Revenue', v: loading ? '…' : fmtC(data?.totalCents ?? 0) },
        { l: 'Avg Transaction', v: loading ? '…' : fmtC(avg) },
        { l: 'Shifts', v: loading ? '…' : String(data?.shiftCount ?? 0) },
      ]} />
      <ConfigurableTable
        storageKey="pos-sales"
        title="POS Revenue Breakdown"
        allCols={posCols}
        defaultColKeys={['line', 'amountCents']}
        rows={rows}
        loading={loading}
        emptyMsg="No POS transactions in this period."
        footerCells={{ amountCents: fmtC(data?.totalCents ?? 0) }}
      />
    </>
  );
}

/* ── Rental Utilization ──────────────────────────────────── */
interface RentalUtilData { totalBookings: number; totalRevenueCents: number; byProduct: { productId: string; name: string; bookings: number; revenueCents: number }[]; }
type RentalRow = { productId: string; name: string; bookings: number; revenueCents: number; avgCents: number; };

const rentalFilters: FilterDef<RentalRow>[] = [
  { key: 'name', label: 'Product', type: 'text', getValue: (r) => r.name },
  { key: 'bookings', label: 'Bookings', type: 'range', getValue: (r) => r.bookings },
  { key: 'revenueCents', label: 'Revenue ($)', type: 'range', getValue: (r) => r.revenueCents / 100 },
];

const rentalCols: ColDef<RentalRow>[] = [
  { key: 'name', label: 'Product', render: (r) => r.name },
  { key: 'bookings', label: 'Bookings', align: 'right', render: (r) => r.bookings },
  { key: 'revenueCents', label: 'Revenue', align: 'right', render: (r) => fmtC(r.revenueCents) },
  { key: 'avgCents', label: 'Avg / Booking', align: 'right', render: (r) => r.bookings > 0 ? fmtC(r.avgCents) : '—' },
];

function RentalUtilReport() {
  const { data, loading } = useReportData<RentalUtilData>('rental-utilization');
  const rows: RentalRow[] = (data?.byProduct ?? []).map((p) => ({ ...p, avgCents: p.bookings > 0 ? p.revenueCents / p.bookings : 0 }));
  return (
    <>
      <KPIs items={[
        { l: 'Total Bookings', v: loading ? '…' : String(data?.totalBookings ?? 0) },
        { l: 'Total Revenue', v: loading ? '…' : fmtC(data?.totalRevenueCents ?? 0) },
        { l: 'Products', v: loading ? '…' : String(rows.length) },
        { l: 'Avg Rev / Product', v: loading || rows.length === 0 ? '—' : fmtC((data?.totalRevenueCents ?? 0) / rows.length) },
      ]} />
      <ConfigurableTable
        storageKey="rental-util"
        title="Rental Asset Utilization"
        allCols={rentalCols}
        defaultColKeys={['name', 'bookings', 'revenueCents', 'avgCents']}
        filterDefs={rentalFilters}
        rows={rows}
        loading={loading}
        footerCells={{ bookings: data?.totalBookings, revenueCents: fmtC(data?.totalRevenueCents ?? 0), avgCents: '' }}
      />
    </>
  );
}

/* ── Inventory ───────────────────────────────────────────── */
interface InvItem { productId: string; name: string; sku: string | null; costCents: number; priceCents: number; qtyOnHand: number; qtyOnOrder: number; reorderQty: number; valueCents: number; needsReorder: boolean; }
interface InventoryData { productCount: number; totalValueCents: number; reorderAlerts: number; items: InvItem[]; }

const invFilters: FilterDef<InvItem>[] = [
  { key: 'name', label: 'Product / SKU', type: 'text', getValue: (r) => `${r.name} ${r.sku ?? ''}` },
  { key: 'needsReorder', label: 'Status', type: 'select', getValue: (r) => r.needsReorder ? 'Reorder' : 'OK' },
  { key: 'qtyOnHand', label: 'In Stock', type: 'range', getValue: (r) => r.qtyOnHand },
];

const invCols: ColDef<InvItem>[] = [
  { key: 'sku', label: 'SKU', align: 'muted', render: (r) => r.sku || '—' },
  { key: 'name', label: 'Product', render: (r) => r.name },
  { key: 'qtyOnHand', label: 'In Stock', align: 'right', render: (r) => r.qtyOnHand },
  { key: 'qtyOnOrder', label: 'On Order', align: 'right', render: (r) => r.qtyOnOrder },
  { key: 'reorderQty', label: 'Reorder Pt', align: 'right', render: (r) => r.reorderQty },
  { key: 'costCents', label: 'Unit Cost', align: 'right', render: (r) => fmtC(r.costCents) },
  { key: 'priceCents', label: 'Retail Price', align: 'right', render: (r) => fmtC(r.priceCents) },
  { key: 'valueCents', label: 'Cost Value', align: 'right', render: (r) => <strong>{fmtC(r.valueCents)}</strong> },
  { key: 'needsReorder', label: 'Status', render: (r) => <span style={s.badge(r.needsReorder ? 'red' : 'green')}>{r.needsReorder ? 'Reorder' : 'OK'}</span> },
];

function InventoryReport() {
  const { data, loading } = useReportData<InventoryData>('inventory');
  const rows = data?.items ?? [];
  const retailTotal = rows.reduce((s, r) => s + r.qtyOnHand * r.priceCents, 0);
  return (
    <>
      <KPIs items={[
        { l: 'Total SKUs', v: loading ? '…' : String(data?.productCount ?? 0) },
        { l: 'Total Cost Value', v: loading ? '…' : fmtC(data?.totalValueCents ?? 0) },
        { l: 'Retail Value', v: loading ? '…' : fmtC(retailTotal) },
        { l: 'Reorder Alerts', v: loading ? '…' : String(data?.reorderAlerts ?? 0) },
      ]} />
      <ConfigurableTable
        storageKey="inventory"
        title="Inventory Valuation"
        allCols={invCols}
        defaultColKeys={['sku', 'name', 'qtyOnHand', 'reorderQty', 'costCents', 'priceCents', 'valueCents', 'needsReorder']}
        filterDefs={invFilters}
        rows={rows}
        loading={loading}
        footerCells={{ valueCents: fmtC(data?.totalValueCents ?? 0) }}
      />
    </>
  );
}

/* ── Dock Walk ───────────────────────────────────────────── */
interface DockWalkData { totalWalks: number; completed: number; completionRate: string; violationsByType: { type: string | null; count: number }[]; totalViolations: number; pumpOuts: number; }
type ViolRow = { type: string; count: number; };

const violFilters: FilterDef<ViolRow>[] = [
  { key: 'type', label: 'Type', type: 'text', getValue: (r) => r.type },
  { key: 'count', label: 'Count', type: 'range', getValue: (r) => r.count },
];

const dockWalkCols: ColDef<ViolRow>[] = [
  { key: 'type', label: 'Violation Type', render: (r) => r.type },
  { key: 'count', label: 'Count', align: 'right', render: (r) => r.count },
];

function DockWalkReport() {
  const { data, loading } = useReportData<DockWalkData>('dock-walk-summary');
  const rows: ViolRow[] = (data?.violationsByType ?? []).map((v) => ({ type: v.type || 'Unspecified', count: v.count }));
  return (
    <>
      <KPIs items={[
        { l: 'Total Walks', v: loading ? '…' : String(data?.totalWalks ?? 0) },
        { l: 'Completed', v: loading ? '…' : String(data?.completed ?? 0) },
        { l: 'Completion Rate', v: loading ? '…' : pct(parseFloat(data?.completionRate ?? '0')) },
        { l: 'Total Violations', v: loading ? '…' : String(data?.totalViolations ?? 0) },
        { l: 'Pump-Outs', v: loading ? '…' : String(data?.pumpOuts ?? 0) },
      ]} />
      <ConfigurableTable
        storageKey="dockwalk"
        title="Violations by Type"
        allCols={dockWalkCols}
        defaultColKeys={['type', 'count']}
        filterDefs={violFilters}
        rows={rows}
        loading={loading}
        emptyMsg="No violations in this period."
        footerCells={{ count: data?.totalViolations }}
      />
    </>
  );
}

function MaintenanceReport() {
  const { data, loading } = useReportData<DockWalkData>('dock-walk-summary');
  const rows: ViolRow[] = (data?.violationsByType ?? []).map((v) => ({ type: v.type || 'General', count: v.count }));
  return (
    <>
      <KPIs items={[
        { l: 'Dock Walks', v: loading ? '…' : String(data?.totalWalks ?? 0) },
        { l: 'Open Violations', v: loading ? '…' : String(data?.totalViolations ?? 0) },
        { l: 'Pump-Outs', v: loading ? '…' : String(data?.pumpOuts ?? 0) },
        { l: 'Completion Rate', v: loading ? '…' : pct(parseFloat(data?.completionRate ?? '0')) },
      ]} />
      <ConfigurableTable
        storageKey="maintenance"
        title="Maintenance Issues by Type"
        allCols={dockWalkCols}
        defaultColKeys={['type', 'count']}
        filterDefs={violFilters}
        rows={rows}
        loading={loading}
        emptyMsg="No maintenance issues in this period."
        footerCells={{ count: data?.totalViolations }}
      />
    </>
  );
}

/* ── Customer Activity ───────────────────────────────────── */
interface CustomerActivityData { total: number; active: number; newInPeriod: number; byStatus: { status: string; count: number }[]; }
type StatusRow = { status: string; count: number; sharePct: number; };

const customerActivityFilters: FilterDef<StatusRow>[] = [
  { key: 'status', label: 'Status', type: 'select', getValue: (r) => r.status },
];

const customerActivityCols: ColDef<StatusRow>[] = [
  { key: 'status', label: 'Status', render: (r) => r.status },
  { key: 'count', label: 'Count', align: 'right', render: (r) => r.count },
  { key: 'sharePct', label: 'Share', align: 'right', render: (r) => pct(r.sharePct) },
];

function CustomerActivityReport() {
  const { data, loading } = useReportData<CustomerActivityData>('customer-activity');
  const total = data?.total ?? 0;
  const rows: StatusRow[] = (data?.byStatus ?? []).map((s_) => ({ status: s_.status, count: s_.count, sharePct: total > 0 ? s_.count / total * 100 : 0 }));
  return (
    <>
      <KPIs items={[
        { l: 'Total Customers', v: loading ? '…' : String(data?.total ?? 0) },
        { l: 'Active', v: loading ? '…' : String(data?.active ?? 0) },
        { l: 'New This Period', v: loading ? '…' : String(data?.newInPeriod ?? 0) },
      ]} />
      <ConfigurableTable
        storageKey="customer-activity"
        title="Customer Activity by Status"
        allCols={customerActivityCols}
        defaultColKeys={['status', 'count', 'sharePct']}
        filterDefs={customerActivityFilters}
        rows={rows}
        loading={loading}
        footerCells={{ count: total, sharePct: '' }}
      />
    </>
  );
}

/* ── Lead Conversion ─────────────────────────────────────── */
interface LeadConversionData { totalLeads: number; won: number; lost: number; conversionRate: string; byStage: { stage: string; count: number }[]; bySource: { source: string; count: number }[]; }
type SourceRow = { source: string; count: number; };
type StageRow = { stage: string; count: number; };

const sourceFilters: FilterDef<SourceRow>[] = [
  { key: 'source', label: 'Source', type: 'text', getValue: (r) => r.source || 'Direct' },
];
const stageFilters: FilterDef<StageRow>[] = [
  { key: 'stage', label: 'Stage', type: 'select', getValue: (r) => r.stage },
];

const sourceCols: ColDef<SourceRow>[] = [
  { key: 'source', label: 'Source', render: (r) => r.source || 'Direct' },
  { key: 'count', label: 'Leads', align: 'right', render: (r) => r.count },
];
const stageCols: ColDef<StageRow>[] = [
  { key: 'stage', label: 'Stage', render: (r) => r.stage },
  { key: 'count', label: 'Count', align: 'right', render: (r) => r.count },
];

function LeadConversionReport() {
  const { data, loading } = useReportData<LeadConversionData>('lead-conversion');
  return (
    <>
      <KPIs items={[
        { l: 'Total Leads', v: loading ? '…' : String(data?.totalLeads ?? 0) },
        { l: 'Won', v: loading ? '…' : String(data?.won ?? 0) },
        { l: 'Lost', v: loading ? '…' : String(data?.lost ?? 0) },
        { l: 'Conversion Rate', v: loading ? '…' : pct(parseFloat(data?.conversionRate ?? '0')) },
      ]} />
      <ConfigurableTable
        storageKey="leads-source"
        title="Leads by Source"
        allCols={sourceCols}
        defaultColKeys={['source', 'count']}
        filterDefs={sourceFilters}
        rows={data?.bySource ?? []}
        loading={loading}
        footerCells={{ count: data?.totalLeads }}
      />
      <ConfigurableTable
        storageKey="leads-stage"
        title="Pipeline by Stage"
        allCols={stageCols}
        defaultColKeys={['stage', 'count']}
        filterDefs={stageFilters}
        rows={data?.byStage ?? []}
        loading={loading}
      />
    </>
  );
}

/* ── Slip Utilization ────────────────────────────────────── */
function SlipUtilizationReport() {
  const { data, loading } = useReportData<OccupancyData>('occupancy');
  const sum = data?.summary ?? { total: 0, occupied: 0, vacant: 0, maintenance: 0, reserved: 0, occupancyRate: '0.0' };
  const rows: DockRow[] = (data?.byDock ?? []).map((d) => ({ dock: d.dock, total: d.total, occupied: d.occupied, vacant: d.total - d.occupied, rate: parseFloat(d.rate) }));
  const avgRate = rows.length > 0 ? rows.reduce((s, r) => s + r.rate, 0) / rows.length : 0;
  return (
    <>
      <KPIs items={[
        { l: 'Avg Utilization', v: loading ? '…' : pct(avgRate) },
        { l: 'Occupied Slips', v: loading ? '…' : String(sum.occupied) },
        { l: 'Vacant Slips', v: loading ? '…' : String(sum.vacant) },
        { l: 'Total Slips', v: loading ? '…' : String(sum.total) },
      ]} />
      <ConfigurableTable
        storageKey="slip-util"
        title="Slip Utilization by Dock"
        allCols={occupancyCols}
        defaultColKeys={['dock', 'total', 'occupied', 'vacant', 'rate']}
        filterDefs={occupancyFilters}
        rows={rows}
        loading={loading}
      />
    </>
  );
}

/* ── Collections ─────────────────────────────────────────── */
interface CollAccount { id: string; status: string; balanceAtHandoffCents: number; recoveredCents: number; customer: { firstName: string; lastName: string } | null; }
interface CollectionsData { accountCount: number; totalHandoffCents: number; totalRecoveredCents: number; recoveryRate: string; accounts: CollAccount[]; }

const collFilters: FilterDef<CollAccount>[] = [
  { key: 'customer', label: 'Customer', type: 'text', getValue: (r) => r.customer ? `${r.customer.firstName} ${r.customer.lastName}` : '' },
  { key: 'status', label: 'Status', type: 'select', getValue: (r) => r.status },
  { key: 'balanceAtHandoffCents', label: 'Balance ($)', type: 'range', getValue: (r) => r.balanceAtHandoffCents / 100 },
];

const collCols: ColDef<CollAccount>[] = [
  { key: 'customer', label: 'Customer', render: (r) => r.customer ? `${r.customer.firstName} ${r.customer.lastName}` : '—' },
  { key: 'status', label: 'Status', render: (r) => <span style={s.badge(r.status === 'RECOVERED' ? 'green' : r.status === 'ACTIVE' ? 'red' : 'yellow')}>{r.status}</span> },
  { key: 'balanceAtHandoffCents', label: 'Balance Handed Off', align: 'right', render: (r) => fmtC(r.balanceAtHandoffCents) },
  { key: 'recoveredCents', label: 'Recovered', align: 'right', render: (r) => fmtC(r.recoveredCents) },
  { key: 'remaining', label: 'Remaining', align: 'right', render: (r) => fmtC(r.balanceAtHandoffCents - r.recoveredCents) },
];

function CollectionsReport() {
  const { data, loading } = useReportData<CollectionsData>('collections');
  return (
    <>
      <KPIs items={[
        { l: 'Accounts', v: loading ? '…' : String(data?.accountCount ?? 0) },
        { l: 'Total Handed Off', v: loading ? '…' : fmtC(data?.totalHandoffCents ?? 0) },
        { l: 'Recovered', v: loading ? '…' : fmtC(data?.totalRecoveredCents ?? 0) },
        { l: 'Recovery Rate', v: loading ? '…' : pct(parseFloat(data?.recoveryRate ?? '0')) },
      ]} />
      <ConfigurableTable
        storageKey="collections"
        title="Collections Accounts"
        allCols={collCols}
        defaultColKeys={['customer', 'status', 'balanceAtHandoffCents', 'recoveredCents', 'remaining']}
        filterDefs={collFilters}
        rows={data?.accounts ?? []}
        loading={loading}
        emptyMsg="No collections accounts."
        footerCells={{ balanceAtHandoffCents: fmtC(data?.totalHandoffCents ?? 0), recoveredCents: fmtC(data?.totalRecoveredCents ?? 0), remaining: fmtC((data?.totalHandoffCents ?? 0) - (data?.totalRecoveredCents ?? 0)) }}
      />
    </>
  );
}

/* ── Deferred Revenue ────────────────────────────────────── */
interface DeferredSchedule { id: string; startDate: string; endDate: string; totalCents: number; recognizedCents: number; }
interface DeferredData { scheduleCount: number; totalDeferredCents: number; totalRecognizedCents: number; remainingCents: number; schedules: DeferredSchedule[]; }

const deferredFilters: FilterDef<DeferredSchedule>[] = [
  { key: 'totalCents', label: 'Total ($)', type: 'range', getValue: (r) => r.totalCents / 100 },
  { key: 'recognizedCents', label: 'Recognized ($)', type: 'range', getValue: (r) => r.recognizedCents / 100 },
];

const deferredCols: ColDef<DeferredSchedule>[] = [
  { key: 'period', label: 'Period', render: (r) => `${r.startDate?.slice(0, 10)} → ${r.endDate?.slice(0, 10)}` },
  { key: 'totalCents', label: 'Total', align: 'right', render: (r) => fmtC(r.totalCents) },
  { key: 'recognizedCents', label: 'Recognized', align: 'right', render: (r) => fmtC(r.recognizedCents) },
  { key: 'deferred', label: 'Deferred', align: 'right', render: (r) => fmtC(r.totalCents - r.recognizedCents) },
  { key: 'pctRecognized', label: '% Recognized', align: 'right', render: (r) => r.totalCents > 0 ? pct(r.recognizedCents / r.totalCents * 100) : '—' },
];

function DeferredRevenueReport() {
  const { data, loading } = useReportData<DeferredData>('deferred-revenue');
  return (
    <>
      <KPIs items={[
        { l: 'Contracts', v: loading ? '…' : String(data?.scheduleCount ?? 0) },
        { l: 'Total Deferred', v: loading ? '…' : fmtC(data?.totalDeferredCents ?? 0) },
        { l: 'Recognized', v: loading ? '…' : fmtC(data?.totalRecognizedCents ?? 0) },
        { l: 'Remaining', v: loading ? '…' : fmtC(data?.remainingCents ?? 0) },
      ]} />
      <ConfigurableTable
        storageKey="deferred"
        title="Deferred Revenue Schedules"
        allCols={deferredCols}
        defaultColKeys={['period', 'totalCents', 'recognizedCents', 'deferred']}
        filterDefs={deferredFilters}
        rows={data?.schedules ?? []}
        loading={loading}
        emptyMsg="No deferred revenue schedules."
        footerCells={{ totalCents: fmtC(data?.totalDeferredCents ?? 0), recognizedCents: fmtC(data?.totalRecognizedCents ?? 0), deferred: fmtC(data?.remainingCents ?? 0), pctRecognized: '' }}
      />
    </>
  );
}

/* ── GL Summary ──────────────────────────────────────────── */
interface GlAccount { accountNumber: string; name: string; type: string; debitsCents: number; creditsCents: number; netCents: number; }
interface GlData { accounts: GlAccount[]; }

const glFilters: FilterDef<GlAccount>[] = [
  { key: 'name', label: 'Account', type: 'text', getValue: (r) => `${r.accountNumber} ${r.name}` },
  { key: 'type', label: 'Type', type: 'select', getValue: (r) => r.type },
  { key: 'netCents', label: 'Net ($)', type: 'range', getValue: (r) => r.netCents / 100 },
];

const glCols: ColDef<GlAccount>[] = [
  { key: 'accountNumber', label: 'Account #', align: 'muted', render: (r) => r.accountNumber },
  { key: 'name', label: 'Account Name', render: (r) => r.name },
  { key: 'type', label: 'Type', align: 'muted', render: (r) => r.type },
  { key: 'debitsCents', label: 'Debit', align: 'right', render: (r) => r.debitsCents > 0 ? fmtC(r.debitsCents) : '—' },
  { key: 'creditsCents', label: 'Credit', align: 'right', render: (r) => r.creditsCents > 0 ? fmtC(r.creditsCents) : '—' },
  { key: 'netCents', label: 'Net', align: 'right', render: (r) => <strong style={{ color: r.netCents >= 0 ? '#059669' : '#DC2626' }}>{fmtC(Math.abs(r.netCents))}</strong> },
];

function GLSummaryReport() {
  const { data, loading } = useReportData<GlData>('gl-summary');
  const accounts = data?.accounts ?? [];
  const totalDebits = accounts.reduce((s, a) => s + a.debitsCents, 0);
  const totalCredits = accounts.reduce((s, a) => s + a.creditsCents, 0);
  const netRevenue = accounts.filter((a) => a.type === 'REVENUE').reduce((s, a) => s + a.creditsCents, 0);
  const totalExpenses = accounts.filter((a) => a.type === 'EXPENSE').reduce((s, a) => s + a.debitsCents, 0);
  return (
    <>
      <KPIs items={[
        { l: 'Total Debits', v: loading ? '…' : fmtC(totalDebits) },
        { l: 'Total Credits', v: loading ? '…' : fmtC(totalCredits) },
        { l: 'Net Revenue', v: loading ? '…' : fmtC(netRevenue) },
        { l: 'Total Expenses', v: loading ? '…' : fmtC(totalExpenses) },
      ]} />
      <ConfigurableTable
        storageKey="gl-summary"
        title="General Ledger Summary"
        allCols={glCols}
        defaultColKeys={['accountNumber', 'name', 'type', 'debitsCents', 'creditsCents', 'netCents']}
        filterDefs={glFilters}
        rows={accounts}
        loading={loading}
        emptyMsg="No GL entries for this period."
        footerCells={{ debitsCents: fmtC(totalDebits), creditsCents: fmtC(totalCredits), netCents: fmtC(Math.abs(totalCredits - totalDebits)) }}
      />
    </>
  );
}

/* ── Waitlist ────────────────────────────────────────────── */
interface WaitlistData { totalEntries: number; bySlipType: { slipType: string | null; count: number }[]; byStatus: { status: string; count: number }[]; }
type SlipTypeRow = { slipType: string; count: number; };

const slipTypeFilters: FilterDef<SlipTypeRow>[] = [
  { key: 'slipType', label: 'Slip Type', type: 'text', getValue: (r) => r.slipType },
];
const waitStatusFilters: FilterDef<StatusRow>[] = [
  { key: 'status', label: 'Status', type: 'select', getValue: (r) => r.status },
];

const slipTypeCols: ColDef<SlipTypeRow>[] = [
  { key: 'slipType', label: 'Slip Type', render: (r) => r.slipType },
  { key: 'count', label: 'Count', align: 'right', render: (r) => r.count },
];
const waitStatusCols: ColDef<StatusRow>[] = [
  { key: 'status', label: 'Status', render: (r) => r.status },
  { key: 'count', label: 'Count', align: 'right', render: (r) => r.count },
  { key: 'sharePct', label: 'Share', align: 'right', render: (r) => pct(r.sharePct) },
];

function WaitlistReport() {
  const { data, loading } = useReportData<WaitlistData>('waitlist');
  const total = data?.totalEntries ?? 0;
  const slipRows: SlipTypeRow[] = (data?.bySlipType ?? []).map((r) => ({ slipType: r.slipType || 'Any', count: r.count }));
  const statusRows: StatusRow[] = (data?.byStatus ?? []).map((r) => ({ status: r.status, count: r.count, sharePct: total > 0 ? r.count / total * 100 : 0 }));
  return (
    <>
      <KPIs items={[
        { l: 'On Waitlist', v: loading ? '…' : String(total) },
        { l: 'Active', v: loading ? '…' : String(data?.byStatus?.find((s_) => s_.status === 'ACTIVE')?.count ?? 0) },
        { l: 'Offered', v: loading ? '…' : String(data?.byStatus?.find((s_) => s_.status === 'OFFERED')?.count ?? 0) },
        { l: 'Slip Types', v: loading ? '…' : String(slipRows.length) },
      ]} />
      <ConfigurableTable
        storageKey="waitlist-slip"
        title="Waitlist by Slip Type"
        allCols={slipTypeCols}
        defaultColKeys={['slipType', 'count']}
        filterDefs={slipTypeFilters}
        rows={slipRows}
        loading={loading}
        emptyMsg="Waitlist is empty."
        footerCells={{ count: total }}
      />
      <ConfigurableTable
        storageKey="waitlist-status"
        title="Waitlist by Status"
        allCols={waitStatusCols}
        defaultColKeys={['status', 'count', 'sharePct']}
        filterDefs={waitStatusFilters}
        rows={statusRows}
        loading={loading}
        emptyMsg="Waitlist is empty."
        footerCells={{ count: total, sharePct: '' }}
      />
    </>
  );
}

/* ── Autopay Card Expirations ────────────────────────────── */
type AutopayBucket = 'Expired' | '0-30 days' | '31-60 days' | '61-90 days' | '>90 days' | 'No card on file' | 'Stripe error';
interface AutopayRow {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  cardBrand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  daysUntilExpiry: number | null;
  bucket: AutopayBucket;
  status: string;
}
interface AutopayData {
  summary: { expired: number; days30: number; days60: number; days90: number; over90: number; noCard: number; stripeError: number; total: number; };
  rows: AutopayRow[];
  stripeConfigured: boolean;
}

const autopayFilters: FilterDef<AutopayRow>[] = [
  { key: 'customerName', label: 'Customer', type: 'text', getValue: (r) => r.customerName },
  { key: 'bucket', label: 'Status', type: 'select', getValue: (r) => r.bucket },
  { key: 'location', label: 'Location', type: 'select', getValue: (r) => r.location ?? '—' },
  { key: 'cardBrand', label: 'Card Brand', type: 'select', getValue: (r) => r.cardBrand ?? '—' },
];

function bucketTone(b: AutopayBucket): 'red' | 'yellow' | 'green' {
  if (b === 'Expired' || b === 'No card on file' || b === 'Stripe error' || b === '0-30 days') return 'red';
  if (b === '31-60 days' || b === '61-90 days') return 'yellow';
  return 'green';
}

const autopayCols: ColDef<AutopayRow>[] = [
  { key: 'customerName', label: 'Customer', render: (r) => <CustomerLink name={r.customerName} id={r.customerId} /> },
  { key: 'email', label: 'Email', render: (r) => r.email ?? '—' },
  { key: 'phone', label: 'Phone', render: (r) => r.phone ?? '—' },
  { key: 'location', label: 'Location', render: (r) => r.location ?? '—' },
  { key: 'card', label: 'Card', render: (r) => {
      if (!r.cardBrand && !r.last4) return '—';
      const brand = r.cardBrand ? r.cardBrand.charAt(0).toUpperCase() + r.cardBrand.slice(1) : 'Card';
      return r.last4 ? `${brand} ····${r.last4}` : brand;
    } },
  { key: 'expiry', label: 'Expires', align: 'right', render: (r) => r.expMonth && r.expYear ? `${String(r.expMonth).padStart(2, '0')}/${r.expYear}` : '—' },
  { key: 'daysUntilExpiry', label: 'Days Until Expiry', align: 'right', render: (r) => r.daysUntilExpiry === null ? '—' : r.daysUntilExpiry },
  { key: 'bucket', label: 'Status', render: (r) => <span style={s.badge(bucketTone(r.bucket))}>{r.bucket}</span> },
];

function AutopayCardExpirationsReport() {
  const { data, loading } = useReportData<AutopayData>('autopay-card-expirations');
  const [showAll, setShowAll] = useState(false);
  const sum = data?.summary ?? { expired: 0, days30: 0, days60: 0, days90: 0, over90: 0, noCard: 0, stripeError: 0, total: 0 };
  const allRows = data?.rows ?? [];
  const flagged = allRows.filter((r) => r.bucket !== '>90 days');
  const rows = showAll ? allRows : flagged;
  const stripeWarning = data && data.stripeConfigured === false;
  return (
    <>
      <KPIs items={[
        { l: 'Expired', v: loading ? '…' : String(sum.expired) },
        { l: '0–30 Days', v: loading ? '…' : String(sum.days30) },
        { l: '31–60 Days', v: loading ? '…' : String(sum.days60) },
        { l: '61–90 Days', v: loading ? '…' : String(sum.days90) },
        { l: 'No Card', v: loading ? '…' : String(sum.noCard) },
      ]} />
      {stripeWarning && (
        <div style={{ padding: '12px 16px', marginBottom: '16px', borderRadius: '8px', background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E', fontSize: '13px' }}>
          Stripe is not configured for this tenant — no autopay data is available.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <button
          onClick={() => setShowAll((v) => !v)}
          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#0A2342', cursor: 'pointer' }}
        >
          {showAll ? 'Show flagged only (≤ 90 days)' : 'Show all autopay customers'}
        </button>
        {!showAll && sum.over90 > 0 && (
          <span style={{ fontSize: '12px', color: '#94A3B8' }}>
            Hiding {sum.over90} card{sum.over90 === 1 ? '' : 's'} expiring in &gt; 90 days
          </span>
        )}
        {sum.stripeError > 0 && (
          <span style={{ fontSize: '12px', color: '#DC2626' }}>
            {sum.stripeError} customer{sum.stripeError === 1 ? '' : 's'} could not be reached in Stripe
          </span>
        )}
      </div>
      <ConfigurableTable
        storageKey="autopay-card-expirations"
        title="Autopay Customers"
        allCols={autopayCols}
        defaultColKeys={['customerName', 'email', 'phone', 'location', 'card', 'expiry', 'daysUntilExpiry', 'bucket']}
        filterDefs={autopayFilters}
        rows={rows}
        loading={loading}
      />
    </>
  );
}

/* ── Report metadata ────────────────────────────────────── */
const reportMeta: Record<string, { title: string; subtitle: string; component: () => JSX.Element }> = {
  revenue: { title: 'Revenue Summary', subtitle: 'Payment collections & invoicing', component: RevenueSummary },
  aging: { title: 'Accounts Receivable Aging', subtitle: 'Open invoices by age', component: ARAgingReport },
  collections: { title: 'Collections Report', subtitle: 'Collections accounts', component: CollectionsReport },
  deferred: { title: 'Deferred Revenue', subtitle: 'Prepaid revenue schedules', component: DeferredRevenueReport },
  gl: { title: 'GL Summary', subtitle: 'General ledger activity', component: GLSummaryReport },
  occupancy: { title: 'Occupancy Report', subtitle: 'Current slip occupancy', component: OccupancyReport },
  utilization: { title: 'Slip Utilization', subtitle: 'Dock-by-dock occupancy rates', component: SlipUtilizationReport },
  dockwalk: { title: 'Dock Walk Summary', subtitle: 'Inspection activity & violations', component: DockWalkReport },
  maintenance: { title: 'Maintenance Log', subtitle: 'Issues from dock walk inspections', component: MaintenanceReport },
  customer_activity: { title: 'Customer Activity', subtitle: 'Customer status breakdown', component: CustomerActivityReport },
  leads: { title: 'Lead Conversion', subtitle: 'Pipeline & source analytics', component: LeadConversionReport },
  waitlist: { title: 'Waitlist Analytics', subtitle: 'Waitlist queue by type & status', component: WaitlistReport },
  autopay_card_expirations: { title: 'Autopay Card Expirations', subtitle: 'Default cards expiring in the next 30/60/90 days', component: AutopayCardExpirationsReport },
  rental_util: { title: 'Rental Utilization', subtitle: 'Booking & revenue by product', component: RentalUtilReport },
  pos_sales: { title: 'POS Sales Summary', subtitle: 'Point-of-sale transactions', component: POSSalesReport },
  inventory: { title: 'Inventory Valuation', subtitle: 'Tracked product stock & value', component: InventoryReport },
};

/* ── Main viewer ────────────────────────────────────────── */
interface ReportViewerProps { reportId: string; onClose: () => void; }

export default function ReportViewer({ reportId, onClose }: ReportViewerProps) {
  const navigate = useNavigate();
  const meta = reportMeta[reportId];
  const [dateFrom, setDateFrom] = useState('2026-03-01');
  const [dateTo, setDateTo] = useState('2026-03-25');
  if (!meta) return null;
  const ReportContent = meta.component;
  return (
    <ReportContext.Provider value={{ navigate: (to) => { onClose(); navigate(to); }, dateFrom, dateTo }}>
      <div style={s.overlay} onClick={onClose}>
        <div style={s.panel} className="helm-detail-panel" onClick={(e) => e.stopPropagation()}>
          <div style={s.header}>
            <div>
              <h2 style={s.headerTitle}>{meta.title}</h2>
              <div style={s.headerSub}>
                {meta.subtitle} · Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
            <div style={s.headerActions}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#FFFFFF' }}>
                <input
                  type="date" value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' }}
                />
                <span style={{ opacity: 0.6 }}>→</span>
                <input
                  type="date" value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' }}
                />
              </div>
              <button style={s.actionBtn}><Printer size={14} /> Print</button>
              <button style={s.actionBtn}><Download size={14} /> Export CSV</button>
              <button style={s.closeBtn} onClick={onClose}><X size={22} /></button>
            </div>
          </div>
          <div style={s.body}>
            <ReportContent />
          </div>
        </div>
      </div>
    </ReportContext.Provider>
  );
}
