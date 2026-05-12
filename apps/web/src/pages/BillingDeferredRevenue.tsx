import { SubNav, BILLING_SUBNAV } from '@helm/ui-kit';

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '24px', borderRadius: '2px' },
  comingSoon: { background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: '8px', padding: '48px 24px', textAlign: 'center' as const, color: '#64748B' },
  comingTitle: { fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '8px' },
  comingBody: { fontSize: '14px', color: '#64748B', maxWidth: '520px', margin: '0 auto' },
};

export default function BillingDeferredRevenue() {
  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">Billing</h1>
      <hr style={styles.divider} />
      <SubNav items={BILLING_SUBNAV} />
      <div style={styles.comingSoon}>
        <div style={styles.comingTitle}>Deferred Revenue coming soon</div>
        <p style={styles.comingBody}>
          Track prepaid slip fees and recognize revenue over the contract term. The
          underlying data already lives on your invoices and contracts — this view
          will surface the schedule and the GL impact.
        </p>
      </div>
    </div>
  );
}
