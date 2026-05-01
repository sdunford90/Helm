import React, { useState, useEffect, useCallback } from 'react';
import {
  Check, AlertTriangle, ChevronDown, ChevronRight,
  Plug, BookOpen, Tag, DollarSign, Percent, FileText,
  Activity, BarChart2, Calendar, Clock,
} from 'lucide-react';
import { useModules } from '../context/ModulesContext';
import { api } from '../lib/api';

import QBConnectionPanel from '../components/accounting/QBConnectionPanel';
import PostingAccountsPanel from '../components/accounting/PostingAccountsPanel';
import CategoryGLPanel from '../components/accounting/CategoryGLPanel';
import SalesTaxPanel from '../components/accounting/SalesTaxPanel';
import RatesFeesPanel from '../components/accounting/RatesFeesPanel';
import AuditTrailPanel from '../components/accounting/AuditTrailPanel';
import SyncHealthPanel from '../components/accounting/SyncHealthPanel';
import PeriodManagementPanel from '../components/accounting/PeriodManagementPanel';
import ReconciliationPanel from '../components/accounting/ReconciliationPanel';

/* ── Types ─────────────────────────────────────────────── */

interface SetupStatus {
  step1_qbo: { complete: boolean; companyName: string | null; glAccountCount: number; missingMappings: number };
  step2_posting: { complete: boolean; mappedCount: number; totalCount: number };
  step3_categories: { complete: boolean; mappedCount: number; totalCount: number };
  step4_tax: { complete: boolean; jurisdictionCount: number };
  step5_rates: { complete: boolean; dockageCount: number; serviceFeeCount: number };
  overallComplete: boolean;
  gracePeriodEndsAt: string | null;
}

type TabId = 'setup' | 'periods' | 'sync-health' | 'reconciliation' | 'change-log';

/* ── Styles ─────────────────────────────────────────────── */

const stl = {
  page: { padding: '32px', maxWidth: '1100px', margin: '0 auto' } as React.CSSProperties,
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 } as React.CSSProperties,
  pageSubtitle: { fontSize: '14px', color: '#64748B', marginTop: '4px', marginBottom: '0' } as React.CSSProperties,
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '24px', borderRadius: '2px' } as React.CSSProperties,
  // Location bar
  locationBar: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', marginBottom: '24px', fontSize: '13px', color: '#475569' } as React.CSSProperties,
  locationSelect: { padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '13px', color: '#0A2342', background: '#FFFFFF', fontWeight: 500 } as React.CSSProperties,
  // Tabs
  tabBar: { display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    padding: '10px 20px', fontSize: '14px', fontWeight: active ? 700 : 500,
    color: active ? '#0A2342' : '#64748B', cursor: 'pointer', border: 'none',
    background: 'none', borderBottom: active ? '2px solid #0A2342' : '2px solid transparent',
    marginBottom: '-2px', display: 'inline-flex', alignItems: 'center', gap: '6px',
    transition: 'color 0.15s',
  }),
  // Progress tracker
  progressTracker: { display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' as const } as React.CSSProperties,
  progressStep: (complete: boolean, pending: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '6px 14px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600,
    background: pending ? '#F1F5F9' : complete ? '#DCFCE7' : '#FEF3C7',
    color: pending ? '#64748B' : complete ? '#15803D' : '#92400E',
    border: `1px solid ${pending ? '#E2E8F0' : complete ? '#86EFAC' : '#FDE68A'}`,
  }),
  // Step cards
  stepCard: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '12px', overflow: 'hidden' } as React.CSSProperties,
  stepHeader: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', cursor: 'pointer', userSelect: 'none' as const } as React.CSSProperties,
  stepNumber: (complete: boolean): React.CSSProperties => ({
    width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0,
    background: complete ? '#10B981' : '#F1F5F9',
    color: complete ? '#FFFFFF' : '#64748B',
    border: `2px solid ${complete ? '#10B981' : '#E2E8F0'}`,
  }),
  stepTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342' } as React.CSSProperties,
  stepMeta: { fontSize: '12px', color: '#64748B', marginTop: '2px' } as React.CSSProperties,
  stepBadge: (complete: boolean, pending: boolean): React.CSSProperties => ({
    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '3px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600,
    background: pending ? '#F1F5F9' : complete ? '#DCFCE7' : '#FEF3C7',
    color: pending ? '#94A3B8' : complete ? '#15803D' : '#92400E',
  }),
  stepBody: { padding: '20px', borderTop: '1px solid #E2E8F0' } as React.CSSProperties,
  // Status banner
  statusBanner: (complete: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 20px', borderRadius: '8px', marginTop: '24px',
    background: complete ? '#F0FDF4' : '#FFFBEB',
    border: `1px solid ${complete ? '#86EFAC' : '#FDE68A'}`,
    fontSize: '14px', color: complete ? '#15803D' : '#92400E', fontWeight: 600,
  }),
};

/* ── Step definition ─────────────────────────────────── */

interface StepDef {
  id: string;
  number: number;
  title: string;
  icon: React.ReactNode;
  getMetaText: (status: SetupStatus | null) => string;
  complete: (status: SetupStatus | null) => boolean;
  component: React.ReactNode;
}

const STEPS: StepDef[] = [
  {
    id: 'qbo',
    number: 1,
    title: 'QuickBooks Connection',
    icon: <Plug size={16} />,
    getMetaText: (s) => s
      ? s.step1_qbo.complete
        ? `Connected to "${s.step1_qbo.companyName}" · ${s.step1_qbo.glAccountCount} GL accounts`
        : 'Not connected'
      : 'Loading…',
    complete: (s) => s?.step1_qbo.complete ?? false,
    component: <QBConnectionPanel />,
  },
  {
    id: 'posting',
    number: 2,
    title: 'Posting Accounts',
    icon: <BookOpen size={16} />,
    getMetaText: (s) => s
      ? `${s.step2_posting.mappedCount} of ${s.step2_posting.totalCount} accounts mapped`
      : 'Loading…',
    complete: (s) => s?.step2_posting.complete ?? false,
    component: <PostingAccountsPanel />,
  },
  {
    id: 'categories',
    number: 3,
    title: 'Category GL & Costing',
    icon: <Tag size={16} />,
    getMetaText: (s) => s
      ? `${s.step3_categories.mappedCount} of ${s.step3_categories.totalCount} categories fully mapped`
      : 'Loading…',
    complete: (s) => s?.step3_categories.complete ?? false,
    component: <CategoryGLPanel />,
  },
  {
    id: 'tax',
    number: 4,
    title: 'Sales Tax',
    icon: <Percent size={16} />,
    getMetaText: (s) => s
      ? `${s.step4_tax.jurisdictionCount} jurisdiction${s.step4_tax.jurisdictionCount !== 1 ? 's' : ''} configured`
      : 'Loading…',
    complete: (s) => s?.step4_tax.complete ?? false,
    component: <SalesTaxPanel />,
  },
  {
    id: 'rates',
    number: 5,
    title: 'Rates & Fees',
    icon: <DollarSign size={16} />,
    getMetaText: (s) => s
      ? `${s.step5_rates.dockageCount} dockage · ${s.step5_rates.serviceFeeCount} service fee GL maps`
      : 'Loading…',
    complete: (s) => s?.step5_rates.complete ?? false,
    component: <RatesFeesPanel />,
  },
];

/* ── Tab definition ─────────────────────────────────── */

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'setup', label: 'Setup', icon: <BookOpen size={14} /> },
  { id: 'periods', label: 'Periods', icon: <Calendar size={14} /> },
  { id: 'sync-health', label: 'Sync Health', icon: <Activity size={14} /> },
  { id: 'reconciliation', label: 'Reconciliation', icon: <BarChart2 size={14} /> },
  { id: 'change-log', label: 'Change Log', icon: <FileText size={14} /> },
];

/* ── Main component ─────────────────────────────────── */

export default function AccountingHub() {
  const { currentLocationId, locations, setCurrentLocationId } = useModules();
  const [activeTab, setActiveTab] = useState<TabId>('setup');
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!currentLocationId) return;
    setStatusLoading(true);
    try {
      const r = await api.get<SetupStatus>(
        `/api/accounting/setup-status?locationId=${encodeURIComponent(currentLocationId)}`,
      );
      setSetupStatus(r);
    } catch {
      // Endpoint may not exist yet — silently keep null status (show pending state)
      setSetupStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const completedCount = STEPS.filter((s) => s.complete(setupStatus)).length;
  const overallComplete = setupStatus?.overallComplete ?? false;
  const incompleteCount = STEPS.length - completedCount;

  return (
    <div style={stl.page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={stl.pageTitle}>Accounting Setup</h1>
          <div style={stl.pageSubtitle}>
            Configure QuickBooks connection, GL mappings, tax rates, and revenue accounts for each location.
          </div>
        </div>
        {statusLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#94A3B8' }}>
            <Clock size={14} /> Refreshing…
          </div>
        )}
      </div>

      <hr style={stl.divider} />

      {/* Location selector bar */}
      {locations.length > 1 && (
        <div style={stl.locationBar}>
          <span style={{ fontWeight: 600 }}>Location:</span>
          <select
            style={stl.locationSelect}
            value={currentLocationId ?? ''}
            onChange={(e) => setCurrentLocationId(e.target.value || null)}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
          <span style={{ color: '#94A3B8', fontSize: '12px' }}>
            Accounting settings are per-location.
          </span>
        </div>
      )}

      {/* Tab navigation */}
      <div style={stl.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            style={stl.tab(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Setup tab */}
      {activeTab === 'setup' && (
        <div>
          {/* Progress tracker */}
          <div style={stl.progressTracker}>
            {STEPS.map((step) => {
              const complete = step.complete(setupStatus);
              const pending = setupStatus === null;
              return (
                <div key={step.id} style={stl.progressStep(complete, pending)}>
                  {pending ? null : complete ? <Check size={12} /> : <AlertTriangle size={12} />}
                  Step {step.number}: {step.title}
                </div>
              );
            })}
          </div>

          {/* Step cards */}
          {STEPS.map((step) => {
            const complete = step.complete(setupStatus);
            const pending = setupStatus === null;
            const isExpanded = expandedStep === step.id;

            return (
              <div key={step.id} style={stl.stepCard}>
                <div
                  style={stl.stepHeader}
                  onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                >
                  <div style={stl.stepNumber(complete)}>
                    {complete ? <Check size={13} /> : step.number}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#64748B' }}>{step.icon}</span>
                    <div>
                      <div style={stl.stepTitle}>{step.title}</div>
                      <div style={stl.stepMeta}>{step.getMetaText(setupStatus)}</div>
                    </div>
                  </div>
                  <div style={stl.stepBadge(complete, pending)}>
                    {pending ? (
                      '—'
                    ) : complete ? (
                      <><Check size={11} /> Complete</>
                    ) : (
                      <><AlertTriangle size={11} /> Needs attention</>
                    )}
                  </div>
                  <span style={{ color: '#94A3B8', marginLeft: '8px' }}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </div>

                {isExpanded && (
                  <div style={stl.stepBody}>
                    {step.component}
                  </div>
                )}
              </div>
            );
          })}

          {/* Status banner */}
          {setupStatus !== null && (
            <div style={stl.statusBanner(overallComplete)}>
              {overallComplete ? (
                <>
                  <Check size={20} />
                  <div>
                    <div>Accounting setup is complete.</div>
                    <div style={{ fontSize: '13px', fontWeight: 400, marginTop: '2px', opacity: 0.85 }}>
                      All {STEPS.length} steps configured. Revenue and payments will sync to QuickBooks automatically.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle size={20} />
                  <div>
                    <div>{incompleteCount} step{incompleteCount !== 1 ? 's' : ''} need{incompleteCount === 1 ? 's' : ''} attention.</div>
                    {setupStatus.gracePeriodEndsAt && (
                      <div style={{ fontSize: '13px', fontWeight: 400, marginTop: '2px', opacity: 0.85 }}>
                        Grace period ends {new Date(setupStatus.gracePeriodEndsAt).toLocaleDateString()}.
                        Complete setup before then to avoid GL sync errors.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {setupStatus === null && !statusLoading && (
            <div style={{ ...stl.statusBanner(false), background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#64748B' }}>
              <Clock size={16} />
              <div>
                Setup status will appear here once the accounting status endpoint is available.
                Each step can still be expanded and configured independently.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Periods tab */}
      {activeTab === 'periods' && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' }}>Fiscal Period Management</div>
            <div style={{ fontSize: '13px', color: '#64748B' }}>Open and close accounting periods to control which transactions can be edited.</div>
          </div>
          <PeriodManagementPanel />
        </div>
      )}

      {/* Sync Health tab */}
      {activeTab === 'sync-health' && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' }}>QuickBooks Sync Health</div>
            <div style={{ fontSize: '13px', color: '#64748B' }}>Monitor the status of outgoing syncs to QuickBooks Online and retry failed items.</div>
          </div>
          <SyncHealthPanel />
        </div>
      )}

      {/* Reconciliation tab */}
      {activeTab === 'reconciliation' && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' }}>Inventory Reconciliation</div>
            <div style={{ fontSize: '13px', color: '#64748B' }}>Compare Helm inventory values against QuickBooks GL balances to identify discrepancies.</div>
          </div>
          <ReconciliationPanel />
        </div>
      )}

      {/* Change Log tab */}
      {activeTab === 'change-log' && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' }}>Accounting Change Log</div>
            <div style={{ fontSize: '13px', color: '#64748B' }}>Audit trail of all accounting configuration changes made by your team.</div>
          </div>
          <AuditTrailPanel />
        </div>
      )}
    </div>
  );
}
