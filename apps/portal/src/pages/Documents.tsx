import { CSSProperties, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { FileText, Download, AlertCircle, Loader2 } from 'lucide-react';

const NAVY = '#0A2342';

interface Doc {
  id: string;
  category: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

const styles: Record<string, CSSProperties> = {
  page: { padding: 32, maxWidth: 1000 },
  title: { fontSize: 32, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 16, marginBottom: 24, borderRadius: 2 },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th: { textAlign: 'left' as const, padding: '12px 18px', background: '#F8FAFC', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' },
  td: { padding: '12px 18px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' as const },
  filenameCell: { display: 'flex', alignItems: 'center', gap: 10 },
  fileIcon: { color: '#64748B' },
  categoryBadge: { display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#DBEAFE', color: '#1E40AF', textTransform: 'capitalize' as const },
  downloadBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: NAVY, background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 6, cursor: 'pointer' },
  empty: { padding: 48, textAlign: 'center' as const, color: '#94A3B8', fontSize: 14 },
  err: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 13 },
  loading: { padding: 48, textAlign: 'center' as const, color: '#94A3B8' },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Documents() {
  const { getToken } = useAuth();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/portal/documents', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
        const body = (await res.json()) as { documents: Doc[] };
        if (!cancelled) setDocs(body.documents ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  async function download(id: string) {
    try {
      const token = await getToken();
      const res = await fetch(`/api/portal/documents/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const body = (await res.json()) as { url: string };
      window.open(body.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Download failed');
    }
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Documents</h1>
      <div style={styles.subtitle}>
        Signed contracts, certificates, and receipts the marina has on file for you. Click a row to download.
      </div>
      <hr style={styles.divider} />

      {err ? (
        <div style={styles.err}><AlertCircle size={16} /> {err}</div>
      ) : docs === null ? (
        <div style={styles.loading}><Loader2 size={20} /></div>
      ) : docs.length === 0 ? (
        <div style={styles.card}>
          <div style={styles.empty}>
            No documents yet. When the marina uploads contracts, certificates,
            or receipts for you, they&apos;ll show up here.
          </div>
        </div>
      ) : (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>File</th>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>Size</th>
                <th style={styles.th}>Added</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td style={styles.td}>
                    <div style={styles.filenameCell}>
                      <FileText size={18} style={styles.fileIcon} />
                      <span style={{ fontWeight: 600 }}>{d.filename}</span>
                    </div>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.categoryBadge}>{d.category}</span>
                  </td>
                  <td style={styles.td}>{formatBytes(d.sizeBytes)}</td>
                  <td style={styles.td}>{formatDate(d.createdAt)}</td>
                  <td style={styles.td}>
                    <button style={styles.downloadBtn} onClick={() => download(d.id)}>
                      <Download size={12} /> Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
