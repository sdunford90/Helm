import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  confirm: (title: string, message: string, onConfirm: () => void) => void;
}

/* ── Context ───────────────────────────────────────────── */

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback when not wrapped in provider (shouldn't happen)
    return {
      addToast: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
      confirm: () => {},
    };
  }
  return ctx;
}

/* ── Styles ────────────────────────────────────────────── */

const typeConfig: Record<ToastType, { bg: string; border: string; icon: typeof CheckCircle2; iconColor: string }> = {
  success: { bg: '#F0FDF4', border: '#BBF7D0', icon: CheckCircle2, iconColor: '#16A34A' },
  error: { bg: '#FEF2F2', border: '#FECACA', icon: XCircle, iconColor: '#DC2626' },
  warning: { bg: '#FFFBEB', border: '#FDE68A', icon: AlertTriangle, iconColor: '#D97706' },
  info: { bg: '#EFF6FF', border: '#BFDBFE', icon: Info, iconColor: '#2563EB' },
};

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  top: '24px',
  right: '24px',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  maxWidth: '420px',
  width: '100%',
  pointerEvents: 'none',
};

const toastStyle = (type: ToastType): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
  padding: '16px 20px',
  borderRadius: '12px',
  backgroundColor: typeConfig[type].bg,
  border: `1px solid ${typeConfig[type].border}`,
  boxShadow: '0 4px 12px rgba(10, 35, 66, 0.12), 0 1px 3px rgba(0,0,0,0.08)',
  animation: 'helmToastSlideIn 0.3s ease-out',
  pointerEvents: 'auto' as const,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
});

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#0A2342',
  lineHeight: 1.3,
  margin: 0,
};

const messageStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#475569',
  lineHeight: 1.5,
  margin: '4px 0 0 0',
};

const closeStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#94A3B8',
  padding: '2px',
  marginLeft: 'auto',
  flexShrink: 0,
};

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '6px 14px',
  fontSize: '13px',
  fontWeight: 600,
  color: '#FFFFFF',
  backgroundColor: '#0A2342',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  marginTop: '8px',
};

const cancelBtnStyle: React.CSSProperties = {
  ...actionBtnStyle,
  backgroundColor: 'transparent',
  color: '#64748B',
  border: '1px solid #CBD5E1',
};

/* ── Confirm Dialog ────────────────────────────────────── */

interface ConfirmDialog {
  title: string;
  message: string;
  onConfirm: () => void;
}

const confirmOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(10, 35, 66, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const confirmBoxStyle: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  borderRadius: '12px',
  padding: '32px',
  maxWidth: '440px',
  width: '100%',
  boxShadow: '0 20px 60px rgba(10, 35, 66, 0.2)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

/* ── Provider Component ────────────────────────────────── */

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duration = toast.duration ?? (toast.type === 'error' ? 6000 : toast.type === 'warning' ? 5000 : 3500);
    setToasts((prev) => [...prev, { ...toast, id }]);
    const timer = setTimeout(() => removeToast(id), duration);
    timersRef.current.set(id, timer);
  }, [removeToast]);

  const success = useCallback((title: string, message?: string) => addToast({ type: 'success', title, message }), [addToast]);
  const error = useCallback((title: string, message?: string) => addToast({ type: 'error', title, message, duration: 6000 }), [addToast]);
  const warning = useCallback((title: string, message?: string) => addToast({ type: 'warning', title, message, duration: 5000 }), [addToast]);
  const info = useCallback((title: string, message?: string) => addToast({ type: 'info', title, message }), [addToast]);

  const confirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ title, message, onConfirm });
  }, []);

  // Inject animation keyframes once
  useEffect(() => {
    if (document.getElementById('helm-toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'helm-toast-styles';
    style.textContent = `
      @keyframes helmToastSlideIn {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, success, error, warning, info, confirm }}>
      {children}

      {/* Toast Container */}
      <div style={containerStyle}>
        {toasts.map((toast) => {
          const config = typeConfig[toast.type];
          const Icon = config.icon;
          return (
            <div key={toast.id} style={toastStyle(toast.type)}>
              <Icon size={20} style={{ color: config.iconColor, flexShrink: 0, marginTop: '1px' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={titleStyle}>{toast.title}</div>
                {toast.message && <div style={messageStyle}>{toast.message}</div>}
                {toast.action && (
                  <button style={actionBtnStyle} onClick={() => { toast.action!.onClick(); removeToast(toast.id); }}>
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button style={closeStyle} onClick={() => removeToast(toast.id)}>
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div style={confirmOverlayStyle} onClick={() => setConfirmDialog(null)}>
          <div style={confirmBoxStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <AlertTriangle size={24} style={{ color: '#D97706', flexShrink: 0 }} />
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 }}>{confirmDialog.title}</h3>
            </div>
            <p style={{ fontSize: '14px', color: '#475569', lineHeight: 1.6, margin: '0 0 24px 0' }}>{confirmDialog.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button style={cancelBtnStyle} onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button style={actionBtnStyle} onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
