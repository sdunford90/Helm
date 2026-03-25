import { useState, useRef, useEffect, CSSProperties } from 'react';

interface Message {
  id: string;
  sender: 'staff' | 'customer';
  senderName: string;
  content: string;
  timestamp: string;
  read: boolean;
}

const mockMessages: Message[] = [
  {
    id: 'm1',
    sender: 'customer',
    senderName: 'You',
    content: 'Hi, I have a question about my most recent invoice. It seems like I was charged for a full month but I only arrived on the 15th.',
    timestamp: '2026-03-20T09:14:00Z',
    read: true,
  },
  {
    id: 'm2',
    sender: 'staff',
    senderName: 'Sarah (Marina Office)',
    content: 'Hi! Thanks for reaching out. Let me pull up your account and take a look at that invoice for you.',
    timestamp: '2026-03-20T09:32:00Z',
    read: true,
  },
  {
    id: 'm3',
    sender: 'staff',
    senderName: 'Sarah (Marina Office)',
    content: 'I found the invoice — it looks like the system generated a full-month charge because your contract start date was set to March 1st. Since you actually arrived on the 15th, we should prorate that.',
    timestamp: '2026-03-20T09:45:00Z',
    read: true,
  },
  {
    id: 'm4',
    sender: 'customer',
    senderName: 'You',
    content: 'That makes sense. Is it possible to get a credit for the difference? I have the email confirmation showing my arrival date.',
    timestamp: '2026-03-20T10:02:00Z',
    read: true,
  },
  {
    id: 'm5',
    sender: 'staff',
    senderName: 'Sarah (Marina Office)',
    content: 'Absolutely! I\'ve submitted a credit memo for $437.50 which covers the 15-day proration. You should see it applied to your account within 24 hours.',
    timestamp: '2026-03-20T10:18:00Z',
    read: true,
  },
  {
    id: 'm6',
    sender: 'customer',
    senderName: 'You',
    content: 'That\'s great, thank you! One more thing — can I set up autopay so I don\'t have to worry about future invoices?',
    timestamp: '2026-03-20T10:25:00Z',
    read: true,
  },
  {
    id: 'm7',
    sender: 'staff',
    senderName: 'Sarah (Marina Office)',
    content: 'Of course! You can enable autopay right from your portal under Payment Methods. Just add a bank account or card and toggle on "Auto-pay". Let me know if you need help with that.',
    timestamp: '2026-03-20T10:41:00Z',
    read: true,
  },
  {
    id: 'm8',
    sender: 'customer',
    senderName: 'You',
    content: 'Perfect, I\'ll set that up now. Thanks for the quick help, Sarah!',
    timestamp: '2026-03-20T10:43:00Z',
    read: true,
  },
];

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
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [input, setInput] = useState('');
  const [hasNew, setHasNew] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    const newMsg: Message = {
      id: `m${Date.now()}`,
      sender: 'customer',
      senderName: 'You',
      content: text,
      timestamp: new Date().toISOString(),
      read: true,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput('');

    // Simulate staff reply after a short delay
    setTimeout(() => {
      setHasNew(true);
      const reply: Message = {
        id: `m${Date.now() + 1}`,
        sender: 'staff',
        senderName: 'Sarah (Marina Office)',
        content: 'Thanks for your message! I\'ll look into this and get back to you shortly.',
        timestamp: new Date().toISOString(),
        read: false,
      };
      setMessages((prev) => [...prev, reply]);
      setTimeout(() => setHasNew(false), 3000);
    }, 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const s: Record<string, CSSProperties> = {
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
    title: {
      fontSize: 24,
      fontWeight: 800,
      color: '#0a2540',
      margin: 0,
    },
    newBadge: {
      fontSize: 11,
      fontWeight: 700,
      color: '#fff',
      background: '#ef4444',
      borderRadius: 20,
      padding: '3px 10px',
      animation: 'pulse 1s ease-in-out infinite',
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
      padding: '12px 24px',
      fontSize: 14,
      fontWeight: 700,
      color: '#ffffff',
      background: 'linear-gradient(135deg, #0ea5e9, #0077b6)',
      border: 'none',
      borderRadius: 10,
      cursor: 'pointer',
      whiteSpace: 'nowrap' as const,
      alignSelf: 'flex-end',
    },
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Messages</h1>
        {hasNew && <span style={s.newBadge}>New Message</span>}
      </div>
      <hr style={s.divider} />

      <div style={s.threadContainer}>
        {messages.map((msg) => {
          const isCustomer = msg.sender === 'customer';
          return (
            <div key={msg.id} style={s.bubbleRow(isCustomer)}>
              <div style={s.bubble(isCustomer)}>
                <div style={s.senderName(isCustomer)}>{msg.senderName}</div>
                <div>{msg.content}</div>
                <div style={s.timestamp(isCustomer)}>{formatTime(msg.timestamp)}</div>
              </div>
            </div>
          );
        })}
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
        />
        <button style={s.sendButton} onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  );
}
