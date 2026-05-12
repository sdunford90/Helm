import { CSSProperties, useMemo, useState } from 'react';
import {
  Wrench, Database, ShieldCheck, Brain, Search,
  ChevronRight, MapPin, Building2, EyeOff,
} from 'lucide-react';
import InsightsShell from './InsightsShell';
import { useApi } from '../../hooks/useApi';

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
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 18,
    fontWeight: 700,
    color: NAVY,
    margin: 0,
    marginBottom: 6,
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

  detail: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 20 },
  detailHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  detailTitle: { fontSize: 20, fontWeight: 700, color: NAVY, margin: 0 },
  detailSub: { fontSize: 12, color: '#94A3B8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  scopeBadges: { display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  scopeBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: '#DBEAFE', color: '#1E40AF' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', background: '#F8FAFC', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' },
  td: { padding: '8px 10px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' },
  sensitivePill: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#991B1B' },
};

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

export default function InsightsCustomBuilder() {
  const { data, loading, error } = useApi<Catalog>('get', '/api/insights/catalog', { immediate: true });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

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
      subtitle="Browse every model and field that's reportable. The builder UI lands in Phase 5c — for now this is the live data catalog the engine will read from."
    >
      <div style={styles.panel}>
        <h2 style={styles.panelTitle}>
          <Wrench size={20} />
          Universal Report Builder
          <span style={styles.badge}>Phase 5c</span>
        </h2>
        <p style={styles.panelBody}>
          A schema-driven builder where every Prisma model and every field is
          reportable. Pick a starting entity (e.g. <em>Boat</em>), tick the columns
          you want, follow relations into <em>Customer</em> or <em>Insurance</em>,
          set filters, group / aggregate, save as a view, schedule the export.
          Guardrails — tenant scope, role permissions, sensitive-field allowlist,
          query-budget cap — are enforced server-side.
        </p>
        <div style={styles.pillarRow}>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}><Database size={14} /> Catalog</div>
            <p style={styles.pillarBody}>
              Auto-generated from <code>prisma/schema.prisma</code> on first
              request and cached for the lifetime of the API process. Below is
              what's live today.
            </p>
          </div>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}><ShieldCheck size={14} /> Guardrails</div>
            <p style={styles.pillarBody}>
              Tenant scope, location scope, sensitive-field allowlist, join-depth cap,
              EXPLAIN-cost ceiling, async export for heavy queries.
            </p>
          </div>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}><Brain size={14} /> AI assist</div>
            <p style={styles.pillarBody}>
              Natural-language input → JSON spec. The model emits a validated spec;
              the engine runs it. AI never sees raw data.
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
                    {activeModel.fields.map((f) => (
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
