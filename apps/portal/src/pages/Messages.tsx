import { useState, useRef, useEffect, CSSProperties } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Loader, AlertCircle, Send } from 'lucide-react';

interface Message {
  id: string;
  sender: 'staff' | 'customer';
  staffName?: string | null;
  content: string;
  createdAt: string;
  read: boolean;
}

const API_BASE = '/api/portal/messages';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function Messages() {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const authFetch = async (url: string, options: RequestInit = {}) => {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  };

  const loadMessages = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await authFetch(API_BASE);
      if (!res.ok) throw new Error('Failed to load');
      const data: Message[] = await res.json();
      setMessages((prev) => {
        if (data.length > prevCountRef.current && prevCountRef.current > 0) {
          const latestNew = data.slice(prevCountRef.current);
          const hasStaffNew = latestNew.some((m) => m.sender === 'staff');
          if (hasStaffNew) {
            setHasNew(true);
            setTimeout(() => setHasNew(false), 4000);
          }
        }
        prevCountRef.current = data.length;
        return data;
      });
      setError(null);
    } catch {
      if (showLoading) setError('Could not load messages. Please refresh the page.');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages(true);
    const interval = setInterval(() => loadMessages(false), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      sender: 'customer',
      content: text,
      createdAt: new Date().toISOString(),
      read: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    try {
      const res = await authFetch(API_BASE, {
        method: 'POST',
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) throw new Error('Failed to send');
      await loadMessages(false);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
      setError('Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const s = {
    page: {
      padding: 32,
      maxWidth: 720,
      margin: '0 auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    title: { fontSize: 24, fontWeight: 800, color: '#0a2540', margin: 0 },
    newBadge: {
      fontSize: 11,
      fontWeight: 700,
      color: '#fff',
      background: '#ef4444',
      borderRadius: 20,
      padding: '3px 10px',
    },
    divider: {
      height: 3,
      background: 'linear-gradient(90deg, #0ea5e9, #06b6d4)',
      border: 'none',
      borderRadius: 2,
      marginBottom: 24,
    },
    threadContainer: {
      background: '#f8fafc',
      borderRadius: 12,
      border: '1px solid #e2e8f0',
      padding: 24,
      minHeight: 240,
      maxHeight: 480,
      overflowY: 'auto' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 16,
    },
    bubbleRow: (isCustomer: boolean): CSSProperties => ({
      display: 'flex',
      justifyContent: isCustomer ? 'flex-end' : 'flex-start',
    }),
    bubble: (isCustomer: boolean): CSSProperties => ({
      maxWidth: '75%',
      padding: '12px 16px',
      borderRadius: 16,
      borderBottomRightRadius: isCustomer ? 4 : 16,
      borderBottomLeftRadius: isCustomer ? 16 : 4,
      background: isCustomer ? 'linear-gradient(135deg, #0ea5e9, #06b6d4)' : '#ffffff',
      color: isCustomer ? '#ffffff' : '#0a2540',
      fontSize: 14,
      lineHeight: 1.5,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }),
    senderName: (isCustomer: boolean): CSSProperties => ({
      fontSize: 11,
      fontWeight: 700,
      color: isCustomer ? 'rgba(255,255,255,0.8)' : '#64748b',
      marginBottom: 4,
    }),
    timestamp: (isCustomer: boolean): CSSProperties => ({
      fontSize: 10,
      color: isCustomer ? 'rgba(255,255,255,0.6)' : '#94a3b8',
      marginTop: 6,
    }),
    inputRow: {
      display: 'flex',
      gap: 12,
      marginTop: 20,
    },
    textInput: {
      flex: 1,
      padding: '12px 16px',
      fontSize: 14,
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      outline: 'none',
      fontFamily: 'inherit',
      resize: 'none' as const,
      minHeight: 44,
      maxHeight: 120,
    },
    sendButton: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '12px 20px',
      fontSize: 14,
      fontWeight: 700,
      color: '#ffffff',
      background: sending ? '#94a3b8' : 'linear-gradient(135deg, #0ea5e9, #0077b6)',
      border: 'none',
      borderRadius: 10,
      cursor: sending ? 'not-allowed' : 'pointer',
      whiteSpace: 'nowrap' as const,
      alignSelf: 'flex-end',
    },
    emptyState: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 0',
      color: '#94a3b8',
      gap: 8,
      flex: 1,
    },
    note: {
      marginTop: 16,
      padding: '12px 16px',
      background: '#f0f9ff',
      borderRadius: 10,
      border: '1px solid #bae6fd',
      fontSize: 13,
      color: '#0369a1',
      lineHeight: 1.5,
    },
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Messages</h1>
        {hasNew && <span style={s.newBadge}>New Message</span>}
      </div>
      <hr style={s.divider} />

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div style={s.threadContainer}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1, color: '#64748b', padding: 32 }}>
            <Loader size={18} />
            <span style={{ fontSize: 14 }}>Loading messages…</span>
          </div>
        ) : messages.length === 0 ? (
          <div style={s.emptyState}>
            <Send size={32} color="#cbd5e1" />
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#0a2540' }}>No messages yet</p>
            <p style={{ margin: 0, fontSize: 13 }}>Send a message below and the marina team will respond.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isCustomer = msg.sender === 'customer';
            return (
              <div key={msg.id} style={s.bubbleRow(isCustomer)}>
                <div style={s.bubble(isCustomer)}>
                  <div style={s.senderName(isCustomer)}>
                    {isCustomer ? 'You' : (msg.staffName ?? 'Marina Office')}
                  </div>
                  <div>{msg.content}</div>
                  <div style={s.timestamp(isCustomer)}>{formatTime(msg.createdAt)}</div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <textarea
          style={s.textInput}
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button style={s.sendButton} onClick={handleSend} disabled={sending || loading}>
          {sending ? <Loader size={16} /> : <Send size={16} />}
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div style={s.note}>
        Messages are received by the marina office team. Typical response time is a few hours during business hours. For urgent matters, please call the marina directly.
      </div>
    </div>
  );
}
