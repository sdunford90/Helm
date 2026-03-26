import { useState } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  User,
  Ship,
  Anchor,
  ClipboardCheck,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stage: string;
  source: string;
  slipType: string;
  boatLength: number;
  assignedTo: string;
  createdAt: string;
  notes: string;
}

interface ConversionWizardProps {
  lead: Lead;
  onClose: () => void;
  onConvert: () => void;
}

/* ── Mock Slips ───────────────────────────────────────── */

const AVAILABLE_SLIPS = [
  { id: 'A-12', label: 'A-12 (30ft)', maxLength: 30, rate: 850 },
  { id: 'A-15', label: 'A-15 (35ft)', maxLength: 35, rate: 1050 },
  { id: 'B-03', label: 'B-03 (40ft)', maxLength: 40, rate: 1250 },
  { id: 'B-07', label: 'B-07 (45ft)', maxLength: 45, rate: 1450 },
  { id: 'C-01', label: 'C-01 (50ft)', maxLength: 50, rate: 1800 },
  { id: 'D-10', label: 'D-10 (25ft)', maxLength: 25, rate: 650 },
];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.55)',
    zIndex: 1200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    width: '580px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '24px 24px 16px',
    borderBottom: '1px solid #E2E8F0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
  },
  closeBtn: {
    padding: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: '#2E4A6B',
    display: 'flex',
    alignItems: 'center',
  },
  progressBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '20px 24px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#E2E8F0',
    transition: 'all 0.2s ease',
  },
  dotActive: {
    backgroundColor: '#00D4FF',
    width: '12px',
    height: '12px',
  },
  dotDone: {
    backgroundColor: '#0A2342',
  },
  connector: {
    width: '32px',
    height: '2px',
    backgroundColor: '#E2E8F0',
  },
  connectorDone: {
    backgroundColor: '#0A2342',
  },
  stepLabel: {
    textAlign: 'center' as const,
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    padding: '0 24px 16px',
    borderBottom: '1px solid #F2F4F6',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  formGroup: {
    marginBottom: '0px',
  },
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFF',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    padding: '10px 32px 10px 12px',
    fontSize: '14px',
    color: '#0A2342',
    border: '1px solid #CCC',
    borderRadius: '6px',
    backgroundColor: '#FFF',
    appearance: 'none' as const,
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
  },
  sectionHeading: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  optionalLabel: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#64748B',
    backgroundColor: '#F2F4F6',
    padding: '2px 8px',
    borderRadius: '9999px',
    marginLeft: '8px',
  },
  summaryCard: {
    backgroundColor: '#F7F9FB',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '16px',
  },
  summaryTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '12px',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    fontSize: '14px',
    borderBottom: '1px solid #E2E8F0',
  },
  summaryLabel: {
    color: '#64748B',
    fontWeight: 500,
  },
  summaryValue: {
    color: '#0A2342',
    fontWeight: 600,
  },
  summaryValueMono: {
    color: '#0A2342',
    fontWeight: 600,
    fontFamily: '"JetBrains Mono", monospace',
  },
  skipText: {
    fontSize: '13px',
    color: '#64748B',
    textAlign: 'center' as const,
    padding: '32px 0',
    lineHeight: 1.6,
  },
  footer: {
    padding: '20px 24px',
    borderTop: '1px solid #E2E8F0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F7F9FB',
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2E4A6B',
    backgroundColor: 'transparent',
    border: '1px solid #CCC',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  nextBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  convertBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#1B5E20',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  skipBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#64748B',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

/* ── Step Labels ──────────────────────────────────────── */

const STEP_LABELS = [
  'Review Customer Details',
  'Add Boat (Optional)',
  'Assign Slip (Optional)',
  'Confirm & Convert',
];

const STEP_ICONS = [User, Ship, Anchor, ClipboardCheck];

/* ── Component ─────────────────────────────────────────── */

export default function ConversionWizard({ lead, onClose, onConvert }: ConversionWizardProps) {
  const [step, setStep] = useState(0);

  // Step 1 state
  const [firstName, setFirstName] = useState(lead.firstName);
  const [lastName, setLastName] = useState(lead.lastName);
  const [email, setEmail] = useState(lead.email);
  const [phone, setPhone] = useState(lead.phone);

  // Step 2 state
  const [boatName, setBoatName] = useState('');
  const [boatLength, setBoatLength] = useState(String(lead.boatLength));
  const [boatBeam, setBoatBeam] = useState('');
  const [boatRegistration, setBoatRegistration] = useState('');
  const [skipBoat, setSkipBoat] = useState(false);

  // Step 3 state
  const [selectedSlip, setSelectedSlip] = useState('');
  const [billingCycle, setBillingCycle] = useState('Monthly');
  const [skipSlip, setSkipSlip] = useState(false);

  const StepIcon = STEP_ICONS[step];

  const selectedSlipData = AVAILABLE_SLIPS.find((sl) => sl.id === selectedSlip);

  const goNext = () => {
    if (step < 3) setStep(step + 1);
  };

  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <h2 style={s.headerTitle}>Convert Lead to Customer</h2>
          <button style={s.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Progress Dots */}
        <div style={s.progressBar}>
          {STEP_LABELS.map((_, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  ...s.dot,
                  ...(idx === step ? s.dotActive : {}),
                  ...(idx < step ? s.dotDone : {}),
                }}
              />
              {idx < STEP_LABELS.length - 1 && (
                <div
                  style={{
                    ...s.connector,
                    ...(idx < step ? s.connectorDone : {}),
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step Label */}
        <div style={s.stepLabel}>
          <StepIcon size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
          Step {step + 1}: {STEP_LABELS[step]}
        </div>

        {/* Body */}
        <div style={s.body}>
          {/* Step 1: Customer Details */}
          {step === 0 && (
            <div style={s.fieldGrid}>
              <div style={s.formGroup}>
                <label style={s.label}>First Name</label>
                <input
                  style={s.input}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Last Name</label>
                <input
                  style={s.input}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Email</label>
                <input
                  style={s.input}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Phone</label>
                <input
                  style={s.input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Step 2: Add Boat */}
          {step === 1 && (
            <>
              {!skipBoat ? (
                <>
                  <div style={s.sectionHeading}>
                    <Ship size={14} />
                    Boat Details
                    <span style={s.optionalLabel}>Optional</span>
                  </div>
                  <div style={s.fieldGrid}>
                    <div style={s.formGroup}>
                      <label style={s.label}>Boat Name</label>
                      <input
                        style={s.input}
                        placeholder="e.g., Sea Breeze"
                        value={boatName}
                        onChange={(e) => setBoatName(e.target.value)}
                      />
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Length (ft)</label>
                      <input
                        style={s.input}
                        type="number"
                        value={boatLength}
                        onChange={(e) => setBoatLength(e.target.value)}
                      />
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Beam (ft)</label>
                      <input
                        style={s.input}
                        type="number"
                        placeholder="e.g., 12"
                        value={boatBeam}
                        onChange={(e) => setBoatBeam(e.target.value)}
                      />
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Registration #</label>
                      <input
                        style={s.input}
                        placeholder="e.g., FL1234AB"
                        value={boatRegistration}
                        onChange={(e) => setBoatRegistration(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div style={s.skipText}>
                  Boat details will be skipped. You can add a boat later from the customer profile.
                </div>
              )}
            </>
          )}

          {/* Step 3: Assign Slip */}
          {step === 2 && (
            <>
              {!skipSlip ? (
                <>
                  <div style={s.sectionHeading}>
                    <Anchor size={14} />
                    Slip Assignment
                    <span style={s.optionalLabel}>Optional</span>
                  </div>
                  <div style={s.fieldGrid}>
                    <div style={s.formGroup}>
                      <label style={s.label}>Select Slip</label>
                      <select
                        style={s.select}
                        value={selectedSlip}
                        onChange={(e) => setSelectedSlip(e.target.value)}
                      >
                        <option value="">Choose a slip...</option>
                        {AVAILABLE_SLIPS.map((sl) => (
                          <option key={sl.id} value={sl.id}>
                            {sl.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Billing Cycle</label>
                      <select
                        style={s.select}
                        value={billingCycle}
                        onChange={(e) => setBillingCycle(e.target.value)}
                      >
                        <option>Monthly</option>
                        <option>Quarterly</option>
                        <option>Annual</option>
                      </select>
                    </div>
                  </div>
                  {selectedSlipData && (
                    <div style={{ ...s.summaryCard, marginTop: '16px' }}>
                      <div style={s.summaryTitle}>Slip Rate</div>
                      <div style={s.summaryRow}>
                        <span style={s.summaryLabel}>Slip</span>
                        <span style={s.summaryValue}>{selectedSlipData.label}</span>
                      </div>
                      <div style={s.summaryRow}>
                        <span style={s.summaryLabel}>Max Length</span>
                        <span style={s.summaryValueMono}>{selectedSlipData.maxLength} ft</span>
                      </div>
                      <div style={{ ...s.summaryRow, borderBottom: 'none' }}>
                        <span style={s.summaryLabel}>Monthly Rate</span>
                        <span style={s.summaryValueMono}>${selectedSlipData.rate.toLocaleString()}/mo</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={s.skipText}>
                  Slip assignment will be skipped. You can assign a slip later from the customer profile.
                </div>
              )}
            </>
          )}

          {/* Step 4: Summary */}
          {step === 3 && (
            <>
              <div style={s.summaryCard}>
                <div style={s.summaryTitle}>
                  <User size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  Customer
                </div>
                <div style={s.summaryRow}>
                  <span style={s.summaryLabel}>Name</span>
                  <span style={s.summaryValue}>{firstName} {lastName}</span>
                </div>
                <div style={s.summaryRow}>
                  <span style={s.summaryLabel}>Email</span>
                  <span style={s.summaryValue}>{email}</span>
                </div>
                <div style={{ ...s.summaryRow, borderBottom: 'none' }}>
                  <span style={s.summaryLabel}>Phone</span>
                  <span style={s.summaryValue}>{phone}</span>
                </div>
              </div>

              <div style={s.summaryCard}>
                <div style={s.summaryTitle}>
                  <Ship size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  Boat
                </div>
                {!skipBoat && boatName ? (
                  <>
                    <div style={s.summaryRow}>
                      <span style={s.summaryLabel}>Name</span>
                      <span style={s.summaryValue}>{boatName}</span>
                    </div>
                    <div style={s.summaryRow}>
                      <span style={s.summaryLabel}>Length</span>
                      <span style={s.summaryValueMono}>{boatLength} ft</span>
                    </div>
                    {boatBeam && (
                      <div style={s.summaryRow}>
                        <span style={s.summaryLabel}>Beam</span>
                        <span style={s.summaryValueMono}>{boatBeam} ft</span>
                      </div>
                    )}
                    {boatRegistration && (
                      <div style={{ ...s.summaryRow, borderBottom: 'none' }}>
                        <span style={s.summaryLabel}>Registration</span>
                        <span style={s.summaryValueMono}>{boatRegistration}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: '13px', color: '#64748B', padding: '4px 0' }}>
                    No boat added — can be added later.
                  </div>
                )}
              </div>

              <div style={s.summaryCard}>
                <div style={s.summaryTitle}>
                  <Anchor size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  Slip
                </div>
                {!skipSlip && selectedSlipData ? (
                  <>
                    <div style={s.summaryRow}>
                      <span style={s.summaryLabel}>Slip</span>
                      <span style={s.summaryValue}>{selectedSlipData.label}</span>
                    </div>
                    <div style={s.summaryRow}>
                      <span style={s.summaryLabel}>Billing</span>
                      <span style={s.summaryValue}>{billingCycle}</span>
                    </div>
                    <div style={{ ...s.summaryRow, borderBottom: 'none' }}>
                      <span style={s.summaryLabel}>Rate</span>
                      <span style={s.summaryValueMono}>${selectedSlipData.rate.toLocaleString()}/mo</span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '13px', color: '#64748B', padding: '4px 0' }}>
                    No slip assigned — can be assigned later.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <div>
            {step > 0 && (
              <button style={s.backBtn} onClick={goBack}>
                <ChevronLeft size={16} />
                Back
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(step === 1 || step === 2) && (
              <button
                style={s.skipBtn}
                onClick={() => {
                  if (step === 1) setSkipBoat(true);
                  if (step === 2) setSkipSlip(true);
                  goNext();
                }}
              >
                Skip
              </button>
            )}
            {step < 3 && (
              <button style={s.nextBtn} onClick={goNext}>
                Next
                <ChevronRight size={16} />
              </button>
            )}
            {step === 3 && (
              <button style={s.convertBtn} onClick={onConvert}>
                <Check size={16} />
                Convert
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
