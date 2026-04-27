import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Ship, Shield, AlertCircle, CheckCircle, ChevronRight, ChevronLeft, Anchor } from 'lucide-react';

/* ── Types ──────────────────────────────────────────────── */

interface ContractData {
  contractId: string;
  requestId: string;
  rateCents: number;
  billingCycle: string;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  slip: { slipNumber: string };
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    emergencyContactJson: { name?: string; phone?: string; relationship?: string } | null;
  };
  boat: {
    id: string;
    name: string | null;
    hin: string | null;
    registrationNumber: string | null;
    registrationState: string | null;
    registrationExpiry: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    lengthFt: number;
  } | null;
  latestInsurance: {
    insurer: string | null;
    policyNumber: string | null;
    startDate: string | null;
    expiryDate: string | null;
  } | null;
}

const CYCLE_LABEL: Record<string, string> = {
  MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', SEMI_ANNUAL: 'Semi-Annual', ANNUAL: 'Annual',
};

/* ── Styles ─────────────────────────────────────────────── */

const pg: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#F0F4F8',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '32px 16px 64px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const card: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '12px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  width: '100%',
  maxWidth: '600px',
};

const hdr: React.CSSProperties = {
  background: '#0A2342',
  borderRadius: '12px 12px 0 0',
  padding: '24px 32px',
};

const body: React.CSSProperties = { padding: '28px 32px' };

const field: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px',
};

const lbl: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: '#0A2342',
};

const inp: React.CSSProperties = {
  padding: '9px 12px', fontSize: '14px', border: '1px solid #CBD5E1',
  borderRadius: '6px', color: '#0A2342', outline: 'none',
  boxSizing: 'border-box' as const, width: '100%',
};

const twoCol: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px',
};

const sectionHdr: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, color: '#64748B',
  textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  marginBottom: '14px', marginTop: '4px',
  display: 'flex', alignItems: 'center', gap: '6px',
};

const ftr: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 32px 24px', borderTop: '1px solid #E2E8F0',
};

const btn = (primary = true): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '10px 24px', fontSize: '14px', fontWeight: 600,
  borderRadius: '6px', cursor: 'pointer',
  border: primary ? 'none' : '1px solid #CBD5E1',
  backgroundColor: primary ? '#0A2342' : '#FFFFFF',
  color: primary ? '#FFFFFF' : '#2E4A6B',
});

const progressDot = (active: boolean, done: boolean): React.CSSProperties => ({
  width: '28px', height: '28px', borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '12px', fontWeight: 700,
  backgroundColor: done ? '#0A2342' : active ? '#0A2342' : '#E2E8F0',
  color: done || active ? '#FFFFFF' : '#94A3B8',
  border: active && !done ? '3px solid #00D4FF' : 'none',
  flexShrink: 0,
});

/* ── Steps ──────────────────────────────────────────────── */

type Step = 'vessel' | 'insurance' | 'emergency' | 'sign';
const STEPS: { key: Step; label: string }[] = [
  { key: 'vessel', label: 'Vessel' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'emergency', label: 'Emergency' },
  { key: 'sign', label: 'Sign' },
];
const STEP_IDX: Record<Step, number> = { vessel: 0, insurance: 1, emergency: 2, sign: 3 };

function ProgressBar({ step }: { step: Step }) {
  const current = STEP_IDX[step];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '28px' }}>
      {STEPS.map((s, i) => (
        <React.Fragment key={s.key}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: 1 }}>
            <div style={progressDot(i === current, i < current)}>
              {i < current ? <CheckCircle size={14} color="#FFFFFF" /> : i + 1}
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: i === current ? '#0A2342' : i < current ? '#0A2342' : '#94A3B8' }}>
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 1, height: '2px', backgroundColor: i < current ? '#0A2342' : '#E2E8F0', marginBottom: '20px' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────── */

export default function ESignPage() {
  const { requestId } = useParams<{ requestId: string }>();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [alreadySigned, setAlreadySigned] = useState(false);
  const [contractData, setContractData] = useState<ContractData | null>(null);

  const [step, setStep] = useState<Step>('vessel');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  /* ── Vessel state ── */
  const [hin, setHin] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [regState, setRegState] = useState('');
  const [regExpiry, setRegExpiry] = useState('');
  const [boatMake, setBoatMake] = useState('');
  const [boatModel, setBoatModel] = useState('');
  const [boatYear, setBoatYear] = useState('');

  /* ── Insurance state ── */
  const [insurer, setInsurer] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [insStart, setInsStart] = useState('');
  const [insExpiry, setInsExpiry] = useState('');

  /* ── Emergency contact state ── */
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [ecRelationship, setEcRelationship] = useState('');

  /* ── Signature state ── */
  const [signerName, setSignerName] = useState('');
  const [agreed, setAgreed] = useState(false);

  /* ── Load contract data ── */
  useEffect(() => {
    if (!requestId) return;
    fetch(`/api/contracts/public/esign/${requestId}`)
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return; }
        if (res.status === 410) { setAlreadySigned(true); return; }
        if (!res.ok) { setNotFound(true); return; }
        const data: ContractData = await res.json();
        setContractData(data);
        const b = data.boat;
        if (b) {
          setHin(b.hin ?? '');
          setRegNumber(b.registrationNumber ?? '');
          setRegState(b.registrationState ?? '');
          setRegExpiry(b.registrationExpiry ? b.registrationExpiry.split('T')[0] : '');
          setBoatMake(b.make ?? '');
          setBoatModel(b.model ?? '');
          setBoatYear(b.year != null ? String(b.year) : '');
        }
        const ins = data.latestInsurance;
        if (ins) {
          setInsurer(ins.insurer ?? '');
          setPolicyNumber(ins.policyNumber ?? '');
          setInsStart(ins.startDate ? ins.startDate.split('T')[0] : '');
          setInsExpiry(ins.expiryDate ? ins.expiryDate.split('T')[0] : '');
        }
        const ec = data.customer.emergencyContactJson;
        if (ec) {
          setEcName(ec.name ?? '');
          setEcPhone(ec.phone ?? '');
          setEcRelationship(ec.relationship ?? '');
        }
        setSignerName(`${data.customer.firstName} ${data.customer.lastName}`);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [requestId]);

  const fmt = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

  const handleSubmit = async () => {
    if (!agreed) { setError('You must agree to the terms to sign.'); return; }
    if (!signerName.trim()) { setError('Please confirm your name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/contracts/public/esign/${requestId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hin: hin || null,
          registrationNumber: regNumber || null,
          registrationState: regState || null,
          registrationExpiry: regExpiry || null,
          make: boatMake || null,
          model: boatModel || null,
          year: boatYear ? parseInt(boatYear) : null,
          insurer: insurer || null,
          policyNumber: policyNumber || null,
          insStartDate: insStart || null,
          insExpiryDate: insExpiry || null,
          ecName: ecName || null,
          ecPhone: ecPhone || null,
          ecRelationship: ecRelationship || null,
          signerName: signerName.trim(),
          agreed: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Submission failed');
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Render states ── */

  if (loading) {
    return (
      <div style={pg}>
        <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
          <Anchor size={32} color="#0A2342" style={{ marginBottom: '16px' }} />
          <p style={{ color: '#64748B', fontSize: '15px' }}>Loading your contract…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={pg}>
        <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
          <AlertCircle size={40} color="#DC2626" style={{ marginBottom: '16px' }} />
          <h2 style={{ color: '#0A2342', marginBottom: '8px' }}>Link Not Found</h2>
          <p style={{ color: '#64748B' }}>This signing link is invalid or has expired. Please contact your marina.</p>
        </div>
      </div>
    );
  }

  if (alreadySigned) {
    return (
      <div style={pg}>
        <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
          <CheckCircle size={48} color="#1B5E20" style={{ marginBottom: '16px' }} />
          <h2 style={{ color: '#0A2342', marginBottom: '8px' }}>Already Signed</h2>
          <p style={{ color: '#64748B' }}>This contract has already been signed. No further action is needed.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={pg}>
        <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ width: '72px', height: '72px', borderRadius: '50%', backgroundColor: '#E8F5E9', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
            <CheckCircle size={36} color="#1B5E20" />
          </div>
          <h2 style={{ color: '#0A2342', marginBottom: '8px', fontSize: '22px' }}>Contract Signed!</h2>
          <p style={{ color: '#64748B', maxWidth: '380px', margin: '0 auto', lineHeight: 1.6 }}>
            Thank you, <strong>{signerName}</strong>. Your slip contract has been signed and your vessel information has been saved. You will receive a confirmation shortly.
          </p>
        </div>
      </div>
    );
  }

  const c = contractData!;

  return (
    <div style={pg}>
      {/* Marina header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <Anchor size={22} color="#0A2342" />
        <span style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>Slip Agreement</span>
      </div>

      <div style={card}>
        {/* Header */}
        <div style={hdr}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#FFFFFF' }}>
            Review &amp; Sign Your Contract
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94A3B8' }}>
            {c.customer.firstName} {c.customer.lastName} &middot; Slip {c.slip.slipNumber}
          </p>
        </div>

        <div style={body}>
          {/* Contract summary box */}
          <div style={{ background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '16px 20px', marginBottom: '28px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
              <div><span style={{ color: '#64748B' }}>Slip </span><strong style={{ color: '#0A2342' }}>{c.slip.slipNumber}</strong></div>
              <div><span style={{ color: '#64748B' }}>Rate </span><strong style={{ color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>{fmt(c.rateCents)}/{CYCLE_LABEL[c.billingCycle] ?? c.billingCycle}</strong></div>
              <div><span style={{ color: '#64748B' }}>Start </span><strong style={{ color: '#0A2342' }}>{c.startDate ? c.startDate.split('T')[0] : '—'}</strong></div>
              {c.endDate && <div><span style={{ color: '#64748B' }}>End </span><strong style={{ color: '#0A2342' }}>{c.endDate.split('T')[0]}</strong></div>}
            </div>
          </div>

          <ProgressBar step={step} />

          {/* ── Step 1: Vessel ── */}
          {step === 'vessel' && (
            <>
              <div style={sectionHdr}><Ship size={14} /> Vessel Information</div>
              <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '18px' }}>
                Please verify or fill in your vessel details. This information is required for marina compliance records.
              </p>
              {c.boat && (
                <div style={{ fontSize: '13px', color: '#0369A1', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '6px', padding: '8px 12px', marginBottom: '16px' }}>
                  Vessel on file: <strong>{c.boat.name || 'Unnamed vessel'}</strong> &middot; {c.boat.lengthFt}ft
                </div>
              )}
              <div style={twoCol}>
                <div style={field}>
                  <label style={lbl}>Hull ID (HIN)</label>
                  <input style={inp} placeholder="US-ABCD12345E678" value={hin} onChange={(e) => setHin(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>Make</label>
                  <input style={inp} placeholder="e.g. Sea Ray" value={boatMake} onChange={(e) => setBoatMake(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>Model</label>
                  <input style={inp} placeholder="e.g. Sundancer 320" value={boatModel} onChange={(e) => setBoatModel(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>Year</label>
                  <input style={inp} type="number" placeholder="e.g. 2019" value={boatYear} onChange={(e) => setBoatYear(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>Registration #</label>
                  <input style={inp} placeholder="FL1234AB" value={regNumber} onChange={(e) => setRegNumber(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>State</label>
                  <input style={inp} placeholder="FL" maxLength={2} value={regState} onChange={(e) => setRegState(e.target.value.toUpperCase())} />
                </div>
              </div>
              <div style={field}>
                <label style={lbl}>Registration Expiry</label>
                <input style={{ ...inp, maxWidth: '200px' }} type="date" value={regExpiry} onChange={(e) => setRegExpiry(e.target.value)} />
              </div>
            </>
          )}

          {/* ── Step 2: Insurance ── */}
          {step === 'insurance' && (
            <>
              <div style={sectionHdr}><Shield size={14} /> Insurance Information</div>
              <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '18px' }}>
                Valid marine liability insurance is required for all slip tenants. Please provide your current policy details.
              </p>
              <div style={twoCol}>
                <div style={field}>
                  <label style={lbl}>Insurance Company</label>
                  <input style={inp} placeholder="e.g. Progressive Marine" value={insurer} onChange={(e) => setInsurer(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>Policy Number</label>
                  <input style={inp} placeholder="POL-000000" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>Coverage Start</label>
                  <input style={inp} type="date" value={insStart} onChange={(e) => setInsStart(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>Coverage Expiry</label>
                  <input style={inp} type="date" value={insExpiry} onChange={(e) => setInsExpiry(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {/* ── Step 3: Emergency Contact ── */}
          {step === 'emergency' && (
            <>
              <div style={sectionHdr}><AlertCircle size={14} /> Emergency Contact</div>
              <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '18px' }}>
                Please provide a contact person we can reach in an emergency. This information stays on file and is never shared.
              </p>
              <div style={field}>
                <label style={lbl}>Contact Name</label>
                <input style={inp} placeholder="Full name" value={ecName} onChange={(e) => setEcName(e.target.value)} />
              </div>
              <div style={twoCol}>
                <div style={field}>
                  <label style={lbl}>Phone Number</label>
                  <input style={inp} type="tel" placeholder="(555) 000-0000" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} />
                </div>
                <div style={field}>
                  <label style={lbl}>Relationship</label>
                  <select style={inp} value={ecRelationship} onChange={(e) => setEcRelationship(e.target.value)}>
                    <option value="">Select…</option>
                    <option value="Spouse">Spouse</option>
                    <option value="Partner">Partner</option>
                    <option value="Parent">Parent</option>
                    <option value="Sibling">Sibling</option>
                    <option value="Child">Child</option>
                    <option value="Friend">Friend</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* ── Step 4: Sign ── */}
          {step === 'sign' && (
            <>
              <div style={sectionHdr}>Review &amp; Sign</div>
              <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '20px' }}>
                Review your contract terms below, then type your full name and check the box to sign electronically.
              </p>

              {/* Terms summary */}
              <div style={{ background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '16px 20px', marginBottom: '20px', fontSize: '13px', color: '#334155', lineHeight: 1.7 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#0A2342' }}>Slip Rental Agreement Summary</p>
                <p style={{ margin: '0 0 4px' }}>Tenant agrees to rent Slip <strong>{c.slip.slipNumber}</strong> at a rate of <strong>{fmt(c.rateCents)}</strong> per {CYCLE_LABEL[c.billingCycle]?.toLowerCase() ?? 'period'}, beginning <strong>{c.startDate?.split('T')[0]}</strong>{c.endDate ? ` through ${c.endDate.split('T')[0]}` : ''}.</p>
                <p style={{ margin: '0 0 4px' }}>Tenant agrees to maintain valid marine liability insurance, keep vessel registration current, and comply with all marina rules and regulations.</p>
                {c.autoRenew && <p style={{ margin: '0' }}>This agreement will automatically renew unless cancelled with 30 days written notice.</p>}
              </div>

              <div style={field}>
                <label style={lbl}>Sign by typing your full name *</label>
                <input
                  style={{ ...inp, fontStyle: 'italic', fontSize: '16px', borderColor: signerName ? '#0A2342' : '#CBD5E1' }}
                  placeholder="Your full legal name"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                />
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  style={{ marginTop: '2px', width: '16px', height: '16px', flexShrink: 0 }}
                />
                I agree to the terms of this slip rental agreement. I understand that by typing my name above and checking this box, I am signing this contract electronically and it is legally binding.
              </label>

              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', marginTop: '16px', fontSize: '13px', color: '#DC2626' }}>
                  <AlertCircle size={15} /> {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer nav */}
        <div style={ftr}>
          <button
            style={btn(false)}
            onClick={() => {
              const idx = STEP_IDX[step];
              if (idx > 0) setStep(STEPS[idx - 1].key);
            }}
            disabled={STEP_IDX[step] === 0}
          >
            <ChevronLeft size={16} /> Back
          </button>

          {step !== 'sign' ? (
            <button
              style={btn(true)}
              onClick={() => setStep(STEPS[STEP_IDX[step] + 1].key)}
            >
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button
              style={{ ...btn(true), opacity: submitting ? 0.7 : 1 }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Signing…' : 'Sign Contract'}
            </button>
          )}
        </div>
      </div>

      <p style={{ marginTop: '20px', fontSize: '12px', color: '#94A3B8' }}>
        Secured signing &middot; Your information is encrypted and stored securely.
      </p>
    </div>
  );
}
