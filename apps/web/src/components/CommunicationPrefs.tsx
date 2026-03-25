import React, { useEffect, useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommunicationPref {
  id: string;
  channel: string;
  category: string;
  optedIn: boolean;
}

interface CommunicationPrefsProps {
  customerId: string;
  onSave?: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'billing', label: 'Billing' },
  { key: 'inspections', label: 'Inspections' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'announcements', label: 'Announcements' },
];

const CHANNELS = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
];

// Operational categories cannot be fully opted out
const OPERATIONAL_CATEGORIES = new Set(['billing', 'inspections']);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    border: '1px solid #E2E8F0',
    overflow: 'hidden',
  },
  header: {
    padding: '20px 24px',
    borderBottom: '1px solid #E2E8F0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
  },
  subtitle: {
    fontSize: '13px',
    color: '#64748B',
    margin: '4px 0 0',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    padding: '12px 24px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    textAlign: 'left' as const,
    backgroundColor: '#F8FAFC',
    borderBottom: '1px solid #E2E8F0',
  },
  td: {
    padding: '14px 24px',
    fontSize: '14px',
    color: '#0A2342',
    borderBottom: '1px solid #F1F5F9',
  },
  categoryLabel: {
    fontWeight: 600,
    fontSize: '14px',
    color: '#0A2342',
  },
  toggleWrapper: {
    position: 'relative' as const,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  },
  toggle: {
    width: '40px',
    height: '22px',
    borderRadius: '11px',
    border: 'none',
    cursor: 'pointer',
    position: 'relative' as const,
    transition: 'background-color 0.2s ease',
    padding: 0,
  },
  toggleDot: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    backgroundColor: '#FFFFFF',
    position: 'absolute' as const,
    top: '3px',
    transition: 'left 0.2s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  tooltip: {
    position: 'absolute' as const,
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#1E293B',
    color: '#FFFFFF',
    fontSize: '12px',
    padding: '6px 10px',
    borderRadius: '6px',
    whiteSpace: 'nowrap' as const,
    marginBottom: '6px',
    zIndex: 10,
    pointerEvents: 'none' as const,
  },
  saving: {
    fontSize: '13px',
    color: '#64748B',
    fontStyle: 'italic' as const,
  },
  error: {
    padding: '12px 24px',
    color: '#DC2626',
    fontSize: '13px',
    backgroundColor: '#FEF2F2',
  },
  loading: {
    padding: '32px 24px',
    textAlign: 'center' as const,
    color: '#64748B',
    fontSize: '14px',
  },
};

// ─── Toggle Component ────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
  tooltipText,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
  tooltipText?: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      style={styles.toggleWrapper}
      onMouseEnter={() => tooltipText && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        style={{
          ...styles.toggle,
          backgroundColor: checked ? '#00D4FF' : '#CBD5E1',
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        onClick={() => !disabled && onChange(!checked)}
        aria-label={checked ? 'Opted in' : 'Opted out'}
      >
        <div
          style={{
            ...styles.toggleDot,
            left: checked ? '21px' : '3px',
          }}
        />
      </button>
      {showTooltip && tooltipText && <div style={styles.tooltip}>{tooltipText}</div>}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CommunicationPrefs({ customerId, onSave }: CommunicationPrefsProps) {
  const { data: prefs, loading, error, execute: fetchPrefs } = useApi<CommunicationPref[]>(
    'get',
    `/api/communication-prefs/${customerId}`,
    { immediate: true },
  );
  const updatePrefs = useApi<CommunicationPref[]>('put', `/api/communication-prefs/${customerId}`);

  const [localPrefs, setLocalPrefs] = useState<CommunicationPref[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (prefs) {
      setLocalPrefs(prefs);
    }
  }, [prefs]);

  const getPref = useCallback(
    (channel: string, category: string): boolean => {
      const pref = localPrefs.find((p) => p.channel === channel && p.category === category);
      return pref?.optedIn ?? true;
    },
    [localPrefs],
  );

  const handleToggle = useCallback(
    async (channel: string, category: string, newValue: boolean) => {
      // Update local state immediately
      setLocalPrefs((prev) =>
        prev.map((p) =>
          p.channel === channel && p.category === category ? { ...p, optedIn: newValue } : p,
        ),
      );

      // Persist to API
      setSaving(true);
      try {
        await updatePrefs.execute([{ channel, category, optedIn: newValue }]);
        onSave?.();
      } catch {
        // Revert on failure
        setLocalPrefs((prev) =>
          prev.map((p) =>
            p.channel === channel && p.category === category ? { ...p, optedIn: !newValue } : p,
          ),
        );
      } finally {
        setSaving(false);
      }
    },
    [updatePrefs, onSave],
  );

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading communication preferences...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>Failed to load preferences: {error}</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Communication Preferences</h3>
          <p style={styles.subtitle}>
            Manage how this customer receives notifications across channels.
          </p>
        </div>
        {saving && <span style={styles.saving}>Saving...</span>}
      </div>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Category</th>
            {CHANNELS.map((ch) => (
              <th key={ch.key} style={{ ...styles.th, textAlign: 'center' }}>
                {ch.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((cat, i) => {
            const isOperational = OPERATIONAL_CATEGORIES.has(cat.key);
            const rowBg = i % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
            return (
              <tr key={cat.key}>
                <td style={{ ...styles.td, backgroundColor: rowBg }}>
                  <span style={styles.categoryLabel}>{cat.label}</span>
                </td>
                {CHANNELS.map((ch) => (
                  <td
                    key={ch.key}
                    style={{ ...styles.td, backgroundColor: rowBg, textAlign: 'center' }}
                  >
                    <Toggle
                      checked={getPref(ch.key, cat.key)}
                      onChange={(val) => handleToggle(ch.key, cat.key, val)}
                      disabled={isOperational && getPref(ch.key, cat.key)}
                      tooltipText={
                        isOperational && getPref(ch.key, cat.key)
                          ? 'Operational notifications cannot be disabled'
                          : undefined
                      }
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
