import React from 'react';
import { Wrench } from 'lucide-react';

/**
 * Full-page notice for a module that cannot show real data yet. Used instead
 * of rendering sample data or saving to state that is lost on reload.
 */
export default function UnavailablePage({
  title,
  icon,
  heading,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ padding: '32px' }}>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 }} className="helm-page-title">
        {title}
      </h1>
      <hr style={{ height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' }} />
      <div
        role="status"
        style={{
          display: 'flex', gap: 20, alignItems: 'flex-start', background: '#FFFFFF', border: '1px dashed #CBD5E1',
          borderRadius: 12, padding: '28px 32px', maxWidth: 760,
        }}
      >
        <div style={{ background: '#F1F5F9', borderRadius: 12, padding: 14, flexShrink: 0 }}>{icon}</div>
        <div>
          <h2 style={{ fontSize: 20, color: '#0A2342', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wrench size={18} /> {heading}
          </h2>
          <div style={{ color: '#2E4A6B', lineHeight: 1.6 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
