import React, { useState, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import {
  HelpCircle, X, Search, ChevronRight, Send,
  BookOpen, MessageSquare, Clock, CheckCircle2,
} from 'lucide-react';
import { HELP_ARTICLES, HELP_CATEGORIES, type HelpArticle } from '../data/help-articles';

/* ── Types ─────────────────────────────────────────────── */

interface Ticket {
  id: string;
  subject: string;
  category: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  submittedAt: string;
}

// TODO(api): support tickets endpoint (post-MVP)
const TICKETS: Ticket[] = [];

/* ── Styles ─────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  trigger: { position: 'fixed', bottom: '24px', right: '24px', width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#0A2342', color: '#00D4FF', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(10,35,66,0.3)', zIndex: 999 },
  panel: { position: 'fixed', top: 0, right: 0, width: '440px', height: '100vh', background: '#FFFFFF', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)', zIndex: 1001, display: 'flex', flexDirection: 'column' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.2)', zIndex: 1000 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #E2E8F0', background: '#0A2342', color: '#FFFFFF' },
  headerTitle: { fontSize: '18px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF', padding: '4px' },
  tabs: { display: 'flex', borderBottom: '2px solid #E2E8F0' },
  tab: { flex: 1, padding: '10px', fontSize: '13px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px', textAlign: 'center' as const },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  body: { flex: 1, overflow: 'auto', padding: '16px 24px' },
  searchWrap: { position: 'relative' as const, marginBottom: '16px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '10px 12px 10px 36px', fontSize: '14px', border: '1px solid #E2E8F0', borderRadius: '8px', color: '#0A2342', boxSizing: 'border-box' as const, outline: 'none' },
  catFilter: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px', marginBottom: '16px' },
  catPill: { padding: '4px 12px', fontSize: '12px', fontWeight: 500, borderRadius: '16px', border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#64748B', cursor: 'pointer' },
  catPillActive: { background: '#0A2342', color: '#FFFFFF', border: '1px solid #0A2342' },
  articleCard: { padding: '14px 0', borderBottom: '1px solid #F1F5F9', cursor: 'pointer' },
  articleTitle: { fontSize: '14px', fontWeight: 600, color: '#0A2342', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  articleExcerpt: { fontSize: '13px', color: '#64748B', lineHeight: 1.5 },
  articleCat: { fontSize: '11px', color: '#00D4FF', fontWeight: 600, marginBottom: '4px' },
  articleFull: { fontSize: '14px', color: '#0A2342', lineHeight: 1.7, whiteSpace: 'pre-line' as const },
  backBtn: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 600, color: '#00D4FF', background: 'none', border: 'none', cursor: 'pointer', padding: '0', marginBottom: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
  input: { padding: '10px 12px', fontSize: '14px', border: '1px solid #E2E8F0', borderRadius: '8px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const, width: '100%' },
  select: { padding: '10px 12px', fontSize: '14px', border: '1px solid #E2E8F0', borderRadius: '8px', color: '#0A2342', background: '#FFFFFF', width: '100%', boxSizing: 'border-box' as const },
  submitBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '12px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  ticketCard: { padding: '14px 16px', background: '#F8FAFC', borderRadius: '8px', marginBottom: '10px', border: '1px solid #E2E8F0' },
  ticketTitle: { fontSize: '14px', fontWeight: 600, color: '#0A2342', marginBottom: '4px' },
  ticketMeta: { fontSize: '12px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '12px' },
  badge: { display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px' },
  successMsg: { textAlign: 'center' as const, padding: '32px 0' },
};

const ticketStatusColors: Record<string, { bg: string; color: string }> = {
  Open: { bg: '#E0F7FF', color: '#0A2342' },
  'In Progress': { bg: '#FFF3CD', color: '#856404' },
  Resolved: { bg: '#DEF7EC', color: '#03543F' },
};

/* ── Component ─────────────────────────────────────────── */

export default function HelpCenter() {
  const { getToken } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'articles' | 'submit' | 'tickets'>('articles');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const [ticketSubmitted, setTicketSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmitTicket = async () => {
    const subject = subjectRef.current?.value.trim() ?? '';
    const description = descriptionRef.current?.value.trim() ?? '';
    const category = categoryRef.current?.value ?? '';
    if (!subject || !description) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      // tenantId is resolved server-side from the subdomain/token; pass category in description
      await fetch('/api/admin/support/tickets', {
        method: 'POST',
        headers,
        body: JSON.stringify({ subject, description: `[${category}] ${description}`, priority: 'medium' }),
      });
      setTicketSubmitted(true);
    } catch { /* keep form open */ } finally {
      setSubmitting(false);
    }
  };

  const filteredArticles = HELP_ARTICLES.filter((a) => {
    if (categoryFilter !== 'All' && a.category !== categoryFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q) || a.content.toLowerCase().includes(q);
  });

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'articles', label: 'Articles' },
    { key: 'submit', label: 'Submit Ticket' },
    { key: 'tickets', label: 'My Tickets' },
  ];

  if (!isOpen) {
    return (
      <button style={st.trigger} onClick={() => setIsOpen(true)} title="Help Center">
        <HelpCircle size={24} />
      </button>
    );
  }

  return (
    <>
      <div style={st.overlay} onClick={() => setIsOpen(false)} />
      <div style={st.panel} className="helm-detail-panel">
        <div style={st.header}>
          <h2 style={st.headerTitle}><BookOpen size={20} /> Help Center</h2>
          <button style={st.closeBtn} onClick={() => setIsOpen(false)}><X size={20} /></button>
        </div>

        <div style={st.tabs}>
          {tabs.map((t) => (
            <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => { setTab(t.key); setSelectedArticle(null); setTicketSubmitted(false); }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={st.body}>
          {/* Articles Tab */}
          {tab === 'articles' && !selectedArticle && (
            <>
              <div style={st.searchWrap}>
                <Search size={16} style={st.searchIcon} />
                <input style={st.searchInput} placeholder="Search help articles..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div style={st.catFilter}>
                <button style={{ ...st.catPill, ...(categoryFilter === 'All' ? st.catPillActive : {}) }} onClick={() => setCategoryFilter('All')}>All</button>
                {HELP_CATEGORIES.map((c) => (
                  <button key={c} style={{ ...st.catPill, ...(categoryFilter === c ? st.catPillActive : {}) }} onClick={() => setCategoryFilter(c)}>{c}</button>
                ))}
              </div>
              {filteredArticles.map((a) => (
                <div key={a.id} style={st.articleCard} onClick={() => setSelectedArticle(a)}>
                  <div style={st.articleCat}>{a.category}</div>
                  <div style={st.articleTitle}>{a.title} <ChevronRight size={16} style={{ color: '#94A3B8' }} /></div>
                  <div style={st.articleExcerpt}>{a.excerpt}</div>
                </div>
              ))}
              {filteredArticles.length === 0 && <div style={{ textAlign: 'center', color: '#94A3B8', padding: '32px 0' }}>No articles found</div>}
            </>
          )}

          {/* Article Detail */}
          {tab === 'articles' && selectedArticle && (
            <>
              <button style={st.backBtn} onClick={() => setSelectedArticle(null)}>← Back to articles</button>
              <div style={st.articleCat}>{selectedArticle.category}</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: '0 0 16px 0' }}>{selectedArticle.title}</h3>
              <div style={st.articleFull}>{selectedArticle.content}</div>
            </>
          )}

          {/* Submit Ticket Tab */}
          {tab === 'submit' && !ticketSubmitted && (
            <>
              <div style={st.field}>
                <label style={st.label}>Subject *</label>
                <input ref={subjectRef} style={st.input} placeholder="Brief description of your issue" />
              </div>
              <div style={st.field}>
                <label style={st.label}>Category</label>
                <select ref={categoryRef} style={st.select}>
                  {HELP_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div style={st.field}>
                <label style={st.label}>Description *</label>
                <textarea ref={descriptionRef} style={{ ...st.input, minHeight: '120px', resize: 'vertical' as const }} placeholder="Describe your issue in detail..." />
              </div>
              <button style={{ ...st.submitBtn, opacity: submitting ? 0.7 : 1 }} onClick={() => void handleSubmitTicket()} disabled={submitting}>
                <Send size={16} /> {submitting ? 'Submitting…' : 'Submit Ticket'}
              </button>
            </>
          )}

          {tab === 'submit' && ticketSubmitted && (
            <div style={st.successMsg}>
              <CheckCircle2 size={48} style={{ color: '#22C55E', marginBottom: '16px' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: '0 0 8px 0' }}>Ticket Submitted</h3>
              <p style={{ fontSize: '14px', color: '#64748B', lineHeight: 1.6 }}>We've received your ticket and will respond within 1 business day. You'll receive an email confirmation shortly.</p>
            </div>
          )}

          {/* My Tickets Tab */}
          {tab === 'tickets' && (
            <>
              {TICKETS.length === 0 && (
                <div style={{ textAlign: 'center', color: '#94A3B8', padding: '32px 0' }}>No tickets yet.</div>
              )}
              {TICKETS.map((t) => {
                const sc = ticketStatusColors[t.status];
                return (
                  <div key={t.id} style={st.ticketCard}>
                    <div style={st.ticketTitle}>{t.subject}</div>
                    <div style={st.ticketMeta}>
                      <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{t.status}</span>
                      <span>{t.category}</span>
                      <span><Clock size={12} style={{ verticalAlign: 'middle', marginRight: '2px' }} />{t.submittedAt}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </>
  );
}
