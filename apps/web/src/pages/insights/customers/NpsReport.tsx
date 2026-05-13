import { formatDate } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface HistogramRow { score: number; count: number; }
interface CommentRow { score: number; comment: string | null; respondedAt: string | null; }
interface NpsData {
  period: { startDate: string; endDate: string };
  sent: number;
  responded: number;
  responseRate: number;
  nps: number;
  promoters: number;
  passives: number;
  detractors: number;
  histogram: HistogramRow[];
  recentComments: CommentRow[];
}

function npsAccent(score: number): string {
  if (score >= 50) return '#166534';
  if (score >= 0) return '#0EA5E9';
  return '#B71C1C';
}

export default function NpsReport() {
  return (
    <ReportPage<NpsData>
      title="NPS"
      subtitle="Net promoter score for the window, response rate, and the most recent verbatim feedback."
      apiPath="/api/reports/nps"
      render={(data) => {
        const max = Math.max(1, ...data.histogram.map((h) => h.count));
        return (
          <>
            <div style={styles.kpiRow}>
              <KpiTile label="NPS" value={data.nps} accent={npsAccent(data.nps)} />
              <KpiTile label="Promoters" value={data.promoters} accent="#166534" />
              <KpiTile label="Passives" value={data.passives} />
              <KpiTile label="Detractors" value={data.detractors} accent="#B71C1C" />
              <KpiTile label="Response rate" value={`${data.responseRate.toFixed(1)}%`} sub={`${data.responded}/${data.sent}`} />
            </div>

            <div style={styles.sectionTitle}>Score distribution</div>
            <div style={styles.card}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: 20, height: 160 }}>
                {data.histogram.map((h) => {
                  const accent = h.score <= 6 ? '#FCA5A5' : h.score <= 8 ? '#FCD34D' : '#86EFAC';
                  return (
                    <div key={h.score} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#0A2342' }}>{h.count > 0 ? h.count : ''}</div>
                      <div style={{
                        width: '100%',
                        height: `${(h.count / max) * 110}px`,
                        minHeight: 1,
                        background: accent,
                        borderRadius: 3,
                      }} />
                      <div style={{ fontSize: 10, color: '#64748B' }}>{h.score}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={styles.sectionTitle}>Recent comments</div>
            <div style={styles.card}>
              {data.recentComments.length === 0 ? (
                <div style={styles.empty}>No written feedback in this window.</div>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Score</th>
                      <th style={styles.th}>Comment</th>
                      <th style={styles.th}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentComments.map((c, idx) => (
                      <tr key={idx}>
                        <td style={{ ...styles.td, fontWeight: 700, color: c.score >= 9 ? '#166534' : c.score <= 6 ? '#B71C1C' : '#0A2342' }}>
                          {c.score}
                        </td>
                        <td style={styles.td}>{c.comment}</td>
                        <td style={{ ...styles.td, color: '#64748B' }}>{c.respondedAt ? formatDate(c.respondedAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        );
      }}
    />
  );
}
