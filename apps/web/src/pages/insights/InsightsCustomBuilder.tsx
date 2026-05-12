import { CSSProperties } from 'react';
import { Wrench, Database, ShieldCheck, Brain } from 'lucide-react';
import InsightsShell from './InsightsShell';

const styles: Record<string, CSSProperties> = {
  panel: {
    background: '#FFFFFF',
    border: '1px dashed #CBD5E1',
    borderRadius: 12,
    padding: 32,
    color: '#475569',
  },
  panelTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 20,
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
    marginBottom: 6,
  },
  panelBody: { fontSize: 14, lineHeight: 1.55, marginBottom: 20, maxWidth: 720 },
  pillarRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 },
  pillar: {
    background: '#F8FAFC',
    borderRadius: 10,
    padding: 18,
    border: '1px solid #E2E8F0',
  },
  pillarTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 700,
    color: '#0A2342',
    marginBottom: 6,
  },
  pillarBody: { fontSize: 13, color: '#64748B', lineHeight: 1.5, margin: 0 },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    background: '#FEF3C7',
    color: '#92400E',
    marginLeft: 10,
    verticalAlign: 'middle',
  },
};

export default function InsightsCustomBuilder() {
  return (
    <InsightsShell
      title="Custom Report Builder"
      subtitle="Toggle on any model and any field in the database, set filters, group, aggregate, save, schedule. The Universal Report Builder is the centerpiece of Insights — see docs/app-layout-roadmap.md for the full spec."
    >
      <div style={styles.panel}>
        <h2 style={styles.panelTitle}>
          <Wrench size={22} />
          Universal Report Builder
          <span style={styles.badge}>Phase 5c</span>
        </h2>
        <p style={styles.panelBody}>
          A schema-driven builder where every Prisma model and every field is
          reportable. Pick a starting entity (e.g. <em>Boat</em>), tick the
          columns you want, follow relations into <em>Customer</em> or
          <em> Insurance</em>, set filters, group / aggregate, save as a view,
          schedule the export. Guardrails — tenant scope, role permissions,
          sensitive-field allowlist, query-budget cap — are enforced
          server-side.
        </p>
        <div style={styles.pillarRow}>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}>
              <Database size={16} /> Catalog
            </div>
            <p style={styles.pillarBody}>
              Auto-generated from <code>prisma/schema.prisma</code> on API
              startup. Platform- and tenant-layer toggles control what's
              exposed.
            </p>
          </div>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}>
              <ShieldCheck size={16} /> Guardrails
            </div>
            <p style={styles.pillarBody}>
              Tenant scope, location scope, sensitive-field allowlist, join-depth cap,
              EXPLAIN-cost ceiling, async export for heavy queries.
            </p>
          </div>
          <div style={styles.pillar}>
            <div style={styles.pillarTitle}>
              <Brain size={16} /> AI assist
            </div>
            <p style={styles.pillarBody}>
              Natural-language input → JSON spec. The model emits a validated
              spec; the engine runs it. AI never sees raw data — so prompt
              injection cannot exfiltrate.
            </p>
          </div>
        </div>
      </div>
    </InsightsShell>
  );
}
