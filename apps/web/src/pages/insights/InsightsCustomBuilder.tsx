import { CSSProperties, useMemo, useState } from 'react';
import {
  Wrench, Database, ShieldCheck, Brain, Search,
  ChevronRight, MapPin, Building2, EyeOff,
  Play, Plus, Trash2, Loader2, AlertCircle,
} from 'lucide-react';
import type {
  ReportSpec,
  ReportFilter,
  ReportFilterOp,
  ReportRunResult,
} from '@helm/shared-types';
import InsightsShell from './InsightsShell';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../../lib/api';

type FieldKind = 'scalar' | 'relation' | 'enum' | 'json';

interface CatalogField {
  name: string;
  type: string;
  kind: FieldKind;
  optional: boolean;
  isList: boolean;
  isId: boolean;
  hasDefault: boolean;
  isUnique: boolean;
  sensitive: boolean;
}

interface CatalogModel {
  name: string;
  tableName: string | null;
  fields: CatalogField[];
  fieldCount: number;
  relationCount: number;
  tenantScoped: boolean;
  locationScoped: boolean;
}

interface Catalog {
  generatedAt: string;
  modelCount: number;
  fieldCount: number;
  models: CatalogModel[];
}

const NAVY = '#0A2342';

const styles: Record<string, CSSProperties> = {
  panel: {
    background: '#FFFFFF',
    border: '1px dashed #CBD5E1',
    borderRadius: 12,
    padding: 28,
    color: '#475569',
    marginBottom: 24,
  },
  panelTitle: {
    display: 'flex', alignItems: 'center', gap: 10,
    fontSize: 18, fontWeight: 700, color: NAVY, margin: 0, marginBottom: 6,
  },
  panelBody: { fontSize: 13, lineHeight: 1.55, marginBottom: 16, maxWidth: 720 },
  pillarRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 },
  pillar: { background: '#F8FAFC', borderRadius: 10, padding: 14, border: '1px solid #E2E8F0' },
  pillarTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 4 },
  pillarBody: { fontSize: 12, color: '#64748B', lineHeight: 1.5, margin: 0 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', background: '#FEF3C7', color: '#92400E', marginLeft: 10, verticalAlign: 'middle' },

  catalogShell: { display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'flex-start' },
  modelListCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' },
  searchBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' },
  searchInput: { flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: NAVY },
  catalogStats: { padding: '10px 14px', fontSize: 11, color: '#64748B', borderBottom: '1px solid #F1F5F9', background: '#FAFBFC' },
  modelList: { maxHeight: 560, overflowY: 'auto' },
  modelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #F1F5F9', cursor: 'pointer', fontSize: 13, color: NAVY, transition: 'background 0.1s ease' },
  modelRowActive: { background: 'rgba(0,212,255,0.10)', borderLeft: '3px solid #00D4FF', paddingLeft: 11 },
  modelMeta: { fontSize: 11, color: '#94A3B8' },

  detail: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  detailHeader: { padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  detailTitle: { fontSize: 20, fontWeight: 700, color: NAVY, margin: 0 },
  detailSub: { fontSize: 12, color: '#94A3B8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  scopeBadges: { display: 'flex', gap: 6, padding: '0 20px', marginTop: 10, flexWrap: 'wrap' },
  scopeBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: '#DBEAFE', color: '#1E40AF' },

  tabStrip: { display: 'flex', gap: 0, padding: '16px 20px 0', borderBottom: '1px solid #E2E8F0' },
  tabBody: { padding: 20 },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', background: '#F8FAFC', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' },
  td: { padding: '8px 10px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' },
  sensitivePill: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#991B1B' },

  fieldList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginBottom: 18 },
  fieldChk: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
    background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6,
    cursor: 'pointer', fontSize: 13,
  },
  fieldChkActive: { background: 'rgba(0,212,255,0.10)', borderColor: '#00D4FF' },
  fieldChkDisabled: { opacity: 0.4, cursor: 'not-allowed' },

  sectionLabel: { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, marginTop: 4 },
  filterRow: { display: 'grid', gridTemplateColumns: '180px 140px 1fr auto', gap: 8, alignItems: 'center', marginBottom: 8 },
  select: { padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13, color: NAVY, background: '#FFFFFF' },
  input: { padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13, color: NAVY, background: '#FFFFFF' },
  smallBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, border: '1px solid #CBD5E1', borderRadius: 6, background: '#FFFFFF', color: NAVY, cursor: 'pointer' },
  runBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 6, background: NAVY, color: '#FFFFFF', cursor: 'pointer' },
  iconBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: '1px solid #FEE2E2', borderRadius: 6, background: '#FEF2F2', color: '#DC2626', cursor: 'pointer' },

  resultsWrap: { marginTop: 20, border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' },
  resultsMeta: { padding: '8px 14px', fontSize: 12, color: '#64748B', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  warning: { padding: '8px 14px', background: '#FEF3C7', color: '#92400E', fontSize: 12, borderBottom: '1px solid #FBE9A0' },
  errorBox: { padding: 14, background: '#FEF2F2', color: '#991B1B', borderRadius: 8, border: '1px solid #FCA5A5', fontSize: 13, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 },
  cell: { padding: '6px 10px', borderBottom: '1px solid #F1F5F9', fontSize: 12, color: NAVY, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  cellHead: { textAlign: 'left' as const, padding: '8px 10px', background: '#F8FAFC', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
};

function tabBtn(active: boolean): CSSProperties {
  return {
    padding: '8px 14px',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #00D4FF' : '2px solid transparent',
    color: active ? NAVY : '#64748B',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    marginBottom: -1,
    fontFamily: 'inherit',
  };
}

const KIND_BADGE_BASE: CSSProperties = {
  display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
};
function kindBadge(kind: FieldKind): CSSProperties {
  const tone =
    kind === 'scalar' ? { background: '#F1F5F9', color: '#475569' } :
    kind === 'relation' ? { background: '#FEF3C7', color: '#92400E' } :
    kind === 'enum' ? { background: '#E0E7FF', color: '#4338CA' } :
    { background: '#FDF2F8', color: '#9D174D' };
  return { ...KIND_BADGE_BASE, ...tone };
}

const OPS_BY_TYPE: Record<string, ReportFilterOp[]> = {
  String: ['eq', 'ne', 'contains', 'startsWith', 'endsWith', 'in', 'isNull', 'isNotNull'],
  Int: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'isNull', 'isNotNull'],
  BigInt: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'isNull', 'isNotNull'],
  Float: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'isNotNull'],
  Decimal: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'isNotNull'],
  Boolean: ['eq', 'ne', 'isNull', 'isNotNull'],
  DateTime: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'isNotNull'],
};
function opsFor(field: CatalogField): ReportFilterOp[] {
  if (field.kind === 'enum') return ['eq', 'ne', 'in', 'isNull', 'isNotNull'];
  return OPS_BY_TYPE[field.type] ?? ['eq', 'ne', 'isNull', 'isNotNull'];
}

function isBuildable(field: CatalogField): boolean {
  return !field.sensitive && !field.isList &&
    (field.kind === 'scalar' || field.kind === 'enum');
}

function ScopeBadges({ model }: { model: CatalogModel }) {
  return (
    <div style={styles.scopeBadges}>
      {model.tenantScoped && (
        <span style={styles.scopeBadge}>
          <Building2 size={12} /> tenant-scoped
        </span>
      )}
      {model.locationScoped && (
        <span style={{ ...styles.scopeBadge, background: '#DCFCE7', color: '#166534' }}>
          <MapPin size={12} /> location-scoped
        </span>
      )}
      <span style={{ ...styles.scopeBadge, background: '#F1F5F9', color: '#475569' }}>
        {model.fieldCount} field{model.fieldCount === 1 ? '' : 's'}
      </span>
      <span style={{ ...styles.scopeBadge, background: '#F1F5F9', color: '#475569' }}>
        {model.relationCount} relation{model.relationCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function SchemaView({ model }: { model: CatalogModel }) {
  return (
    <div style={styles.tabBody}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Field</th>
            <th style={styles.th}>Type</th>
            <th style={styles.th}>Kind</th>
            <th style={styles.th}>Modifiers</th>
          </tr>
        </thead>
        <tbody>
          {model.fields.map((f) => (
            <tr key={f.name}>
              <td style={styles.td}>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: f.isId ? 700 : 500 }}>
                  {f.name}
                  {f.optional && <span style={{ color: '#94A3B8', marginLeft: 4 }}>?</span>}
                  {f.isList && <span style={{ color: '#94A3B8', marginLeft: 4 }}>[]</span>}
                </div>
              </td>
              <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#475569' }}>
                {f.type}
              </td>
              <td style={styles.td}>
                <span style={kindBadge(f.kind)}>{f.kind}</span>
              </td>
              <td style={styles.td}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {f.isId && <span style={{ ...kindBadge('scalar'), background: '#FEF3C7', color: '#92400E' }}>id</span>}
                  {f.isUnique && <span style={kindBadge('scalar')}>unique</span>}
                  {f.hasDefault && <span style={kindBadge('scalar')}>default</span>}
                  {f.sensitive && (
                    <span style={styles.sensitivePill}>
                      <EyeOff size={10} /> sensitive
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuildView({ model }: { model: CatalogModel }) {
  const buildable = useMemo(() => model.fields.filter(isBuildable), [model]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(() => {
    // Default-select id + a handful of obvious display fields if present.
    const defaults = new Set<string>();
    const id = buildable.find((f) => f.isId);
    if (id) defaults.add(id.name);
    for (const n of ['name', 'firstName', 'lastName', 'email', 'status', 'createdAt']) {
      if (buildable.some((f) => f.name === n)) defaults.add(n);
    }
    return defaults;
  });
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [limit, setLimit] = useState(100);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { getToken } = useAuth();

  function toggleField(name: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addFilter() {
    const first = buildable[0];
    if (!first) return;
    setFilters((prev) => [...prev, { field: first.name, op: 'eq', value: '' }]);
  }

  function updateFilter(idx: number, patch: Partial<ReportFilter>) {
    setFilters((prev) => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  }

  function removeFilter(idx: number) {
    setFilters((prev) => prev.filter((_, i) => i !== idx));
  }

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const spec: ReportSpec = {
        model: model.name,
        fields: selectedFields.size > 0 ? Array.from(selectedFields) : undefined,
        // Drop value for unary ops so the engine doesn't get confused.
        filters: filters.map((f) =>
          f.op === 'isNull' || f.op === 'isNotNull'
            ? { field: f.field, op: f.op }
            : f,
        ),
        limit,
      };
      const token = await getToken();
      const res = await api.post<ReportRunResult>('/api/insights/run', spec, token);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  if (!model.tenantScoped) {
    return (
      <div style={styles.tabBody}>
        <div style={styles.errorBox}>
          <AlertCircle size={18} />
          <div>
            <strong>{model.name}</strong> is not tenant-scoped and can't be queried from the tenant builder.
            Platform-admin variant lives elsewhere.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.tabBody}>
      <div style={styles.sectionLabel}>Fields to include</div>
      <div style={styles.fieldList}>
        {model.fields.map((f) => {
          const ok = isBuildable(f);
          const checked = selectedFields.has(f.name);
          return (
            <label
              key={f.name}
              style={{ ...styles.fieldChk, ...(checked && ok ? styles.fieldChkActive : {}), ...(ok ? {} : styles.fieldChkDisabled) }}
              title={ok ? '' : f.sensitive ? 'Sensitive field — engine refuses to expose' : f.isList ? 'List relations not supported yet' : 'Relations not supported yet'}
            >
              <input
                type="checkbox"
                checked={ok && checked}
                disabled={!ok}
                onChange={() => ok && toggleField(f.name)}
              />
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>
                {f.name}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94A3B8' }}>{f.type}</span>
            </label>
          );
        })}
      </div>

      <div style={styles.sectionLabel}>Filters</div>
      {filters.map((filter, idx) => {
        const field = model.fields.find((f) => f.name === filter.field);
        const unary = filter.op === 'isNull' || filter.op === 'isNotNull';
        return (
          <div key={idx} style={styles.filterRow}>
            <select
              style={styles.select}
              value={filter.field}
              onChange={(e) => updateFilter(idx, { field: e.target.value, op: 'eq', value: '' })}
            >
              {buildable.map((f) => (
                <option key={f.name} value={f.name}>{f.name}</option>
              ))}
            </select>
            <select
              style={styles.select}
              value={filter.op}
              onChange={(e) => updateFilter(idx, { op: e.target.value as ReportFilterOp, value: '' })}
            >
              {(field ? opsFor(field) : ['eq']).map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            {unary ? (
              <div style={{ fontSize: 12, color: '#94A3B8' }}>—</div>
            ) : field?.type === 'Boolean' ? (
              <select
                style={styles.select}
                value={String(filter.value ?? '')}
                onChange={(e) => updateFilter(idx, { value: e.target.value === 'true' })}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                style={styles.input}
                value={filter.value === null || filter.value === undefined ? '' : String(filter.value)}
                onChange={(e) => updateFilter(idx, { value: e.target.value })}
                placeholder={field?.type === 'DateTime' ? 'YYYY-MM-DD' : 'value'}
              />
            )}
            <button style={styles.iconBtn} onClick={() => removeFilter(idx)} title="Remove filter">
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      <button style={styles.smallBtn} onClick={addFilter} disabled={buildable.length === 0}>
        <Plus size={12} /> Add filter
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20 }}>
        <div style={{ fontSize: 12, color: '#64748B' }}>Limit</div>
        <input
          type="number"
          min={1}
          max={10000}
          style={{ ...styles.input, width: 90 }}
          value={limit}
          onChange={(e) => setLimit(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))}
        />
        <button
          style={{ ...styles.runBtn, opacity: running || selectedFields.size === 0 ? 0.6 : 1 }}
          onClick={run}
          disabled={running || selectedFields.size === 0}
        >
          {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {running ? 'Running…' : 'Run report'}
        </button>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <AlertCircle size={18} />
          <div>{error}</div>
        </div>
      )}

      {result && (
        <div style={styles.resultsWrap}>
          <div style={styles.resultsMeta}>
            <span>
              {result.rowCount.toLocaleString()} row{result.rowCount === 1 ? '' : 's'} · {result.runtimeMs}ms
              {result.hasMore && ` · more available (raise limit)`}
            </span>
            <span style={{ color: '#94A3B8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
              {result.fields.length} field{result.fields.length === 1 ? '' : 's'}
            </span>
          </div>
          {result.warnings.map((w, i) => (
            <div key={i} style={styles.warning}>⚠ {w}</div>
          ))}
          {result.rowCount === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              No matching rows.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {result.fields.map((f) => (
                      <th key={f} style={styles.cellHead}>{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result.fields.map((f) => {
                        const v = row[f];
                        const display = v === null || v === undefined
                          ? '—'
                          : typeof v === 'object'
                            ? JSON.stringify(v)
                            : String(v);
                        return (
                          <td key={f} style={styles.cell} title={display}>{display}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function InsightsCustomBuilder() {
  const { data, loading, error } = useApi<Catalog>('get', '/api/insights/catalog', { immediate: true });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'schema' | 'build'>('build');

  const filteredModels = useMemo(() => {
    const all = data?.models ?? [];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((m) => m.name.toLowerCase().includes(q) || (m.tableName ?? '').toLowerCase().includes(q));
  }, [data, query]);

  const activeModel = useMemo(() => {
    if (!data?.models) return null;
    return data.models.find((m) => m.name === selected) ?? data.models[0] ?? null;
  }, [data, selected]);

  return (
    <InsightsShell
      title="Custom Report Builder"
      subtitle="Pick a model on the left, tick the fields you want, add filters, and run. Tenant scope is appended server-side — every result is scoped to your marina."
    >
      <div style={styles.panel}>
        <h2 style={styles.panelTitle}>
          <Wrench size={20} />
          Universal Report Builder
          <span style={styles.badge}>MVP</span>
        </h2>
        <p style={styles.panelBody}>
          MVP: scalar / enum fields on a single model, filters (eq, gt, contains, between, etc.), sort and limit. Relation traversal,
          group-by, aggregates, and saving / scheduling are next-phase work. Every query is tenant-scoped server-side; sensitive
          fields (secrets, signatures, Stripe IDs, raw webhook payloads) are refused by the engine regardless of UI state.
        </p>
        <div style={styles.pillarRow}>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}><Database size={14} /> Catalog</div>
            <p style={styles.pillarBody}>
              Auto-generated from <code>prisma/schema.prisma</code>. {data ? `${data.modelCount} models, ${data.fieldCount.toLocaleString()} fields.` : 'Loading…'}
            </p>
          </div>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}><ShieldCheck size={14} /> Guardrails</div>
            <p style={styles.pillarBody}>
              Tenant scope appended, sensitive fields refused, limit clamped to 10k rows, row-count is limit+1 "has more" check.
            </p>
          </div>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}><Brain size={14} /> AI assist</div>
            <p style={styles.pillarBody}>
              Future: natural-language → JSON spec. The same engine validates and runs it, so the AI never sees raw data.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: 16, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          Failed to load catalog: {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading data catalog…</div>
      ) : data ? (
        <div style={styles.catalogShell}>
          <div style={styles.modelListCard}>
            <div style={styles.searchBar}>
              <Search size={14} color="#94A3B8" />
              <input
                style={styles.searchInput}
                placeholder="Search models…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div style={styles.catalogStats}>
              {data.modelCount} models · {data.fieldCount.toLocaleString()} fields total
              {query && filteredModels.length !== data.modelCount && ` · ${filteredModels.length} matching`}
            </div>
            <div style={styles.modelList}>
              {filteredModels.map((m) => {
                const active = activeModel?.name === m.name;
                return (
                  <div
                    key={m.name}
                    style={{ ...styles.modelRow, ...(active ? styles.modelRowActive : {}) }}
                    onClick={() => setSelected(m.name)}
                  >
                    <div>
                      <div style={{ fontWeight: active ? 700 : 500 }}>{m.name}</div>
                      <div style={styles.modelMeta}>{m.tableName ?? '—'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={styles.modelMeta}>{m.fieldCount}f</span>
                      <ChevronRight size={14} color="#94A3B8" />
                    </div>
                  </div>
                );
              })}
              {filteredModels.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>
                  No models match "{query}".
                </div>
              )}
            </div>
          </div>

          <div style={styles.detail}>
            {activeModel ? (
              <>
                <div style={styles.detailHeader}>
                  <div>
                    <h2 style={styles.detailTitle}>{activeModel.name}</h2>
                    <div style={styles.detailSub}>{activeModel.tableName ?? '—'}</div>
                  </div>
                </div>
                <ScopeBadges model={activeModel} />
                <div style={styles.tabStrip}>
                  <button style={tabBtn(tab === 'build')} onClick={() => setTab('build')}>Build</button>
                  <button style={tabBtn(tab === 'schema')} onClick={() => setTab('schema')}>Schema</button>
                </div>
                {tab === 'build'
                  ? <BuildView key={activeModel.name} model={activeModel} />
                  : <SchemaView model={activeModel} />}
              </>
            ) : (
              <div style={{ padding: 24, color: '#94A3B8', fontSize: 13 }}>Pick a model on the left.</div>
            )}
          </div>
        </div>
      ) : null}
    </InsightsShell>
  );
}
