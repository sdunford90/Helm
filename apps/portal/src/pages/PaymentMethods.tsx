import { useState } from 'react';
import { CreditCard, Building2, Star, Trash2, Plus, ToggleLeft, ToggleRight } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const mockPaymentMethods = [
  {
    id: '1',
    type: 'visa',
    label: 'Visa',
    last4: '4242',
    expiry: '09/28',
    isDefault: true,
  },
  {
    id: '2',
    type: 'mastercard',
    label: 'Mastercard',
    last4: '8888',
    expiry: '03/27',
    isDefault: false,
  },
  {
    id: '3',
    type: 'bank',
    label: 'Bank Account',
    last4: '6789',
    expiry: null,
    isDefault: false,
  },
];

export default function PaymentMethods() {
  const [autopay, setAutopay] = useState(true);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Payment Methods</h1>
          <p style={{ color: '#64748B', fontSize: 14 }}>Manage your saved payment methods and auto-pay settings.</p>
        </div>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: CYAN,
            color: NAVY,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus size={16} /> Add Payment Method
        </button>
      </div>

      {/* Auto-Pay Toggle */}
      <div style={{ ...card, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Auto-Pay</h2>
          <p style={{ color: '#64748B', fontSize: 13 }}>
            Automatically pay invoices on their due date using your default payment method.
          </p>
        </div>
        <button
          onClick={() => setAutopay(!autopay)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {autopay ? (
            <ToggleRight size={40} color="#0D9F6E" />
          ) : (
            <ToggleLeft size={40} color="#94A3B8" />
          )}
        </button>
      </div>

      {/* Payment Methods List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {mockPaymentMethods.map((pm) => (
          <div
            key={pm.id}
            style={{
              ...card,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              border: pm.isDefault ? `2px solid ${CYAN}` : '2px solid transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 10,
                  background: pm.type === 'bank' ? '#EDE9FE' : '#EFF6FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {pm.type === 'bank' ? (
                  <Building2 size={22} color="#8B5CF6" />
                ) : (
                  <CreditCard size={22} color="#3B82F6" />
                )}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: NAVY }}>
                    {pm.label} ending in {pm.last4}
                  </span>
                  {pm.isDefault && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 8px',
                        borderRadius: 12,
                        background: '#E6FAF0',
                        color: '#0D9F6E',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      <Star size={10} /> Default
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
                  {pm.expiry ? `Expires ${pm.expiry}` : 'Checking account'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {!pm.isDefault && (
                <button
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: '1px solid #E2E8F0',
                    background: '#fff',
                    color: '#64748B',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Set Default
                </button>
              )}
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#DC2626',
                  cursor: 'pointer',
                  padding: 4,
                }}
                title="Remove"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
