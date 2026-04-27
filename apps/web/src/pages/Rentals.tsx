import React, { useState, useMemo, useCallback } from 'react';
import {
  Ship, Search, Plus, X, Calendar, Tag, DollarSign,
  Star, Clock, Users, Filter, Eye, Edit2, Trash2,
} from 'lucide-react';
import PricingCalendar from '../components/PricingCalendar';
import PriceSimulator from '../components/PriceSimulator';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';

/* ── Types ─────────────────────────────────────────────── */

type ProductStatus = 'Available' | 'Maintenance' | 'Retired';
type ReservationStatus = 'Pending' | 'Confirmed' | 'Checked In' | 'Checked Out' | 'Cancelled' | 'No Show';

interface RentalProduct {
  id: string;
  name: string;
  type: string;
  capacity: number;
  hourlyRate: number;
  halfDayRate: number;
  dailyRate: number;
  status: ProductStatus;
  rating: number;
  totalBookings: number;
}

interface Reservation {
  id: string;
  number: string;
  customer: string;
  product: string;
  date: string;
  timeSlot: string;
  duration: string;
  total: number;
  status: ReservationStatus;
  notes: string;
}

interface PricingRule {
  id: string;
  name: string;
  type: string;
  adjustment: number;
  startDate: string;
  endDate: string;
  active: boolean;
}

interface PromoCode {
  id: string;
  code: string;
  discount: number;
  discountType: '%' | '$';
  validFrom: string;
  validTo: string;
  uses: number;
  maxUses: number;
  active: boolean;
}

/* ── API shapes ──────────────────────────────────────────── */

interface ApiRentalProduct {
  id: string;
  name: string;
  category: string | null;
  hourlyRateCents: number | null;
  dailyRateCents: number | null;
  basePriceCents: number;
  active: boolean;
  availableQuantity?: number;
  utilizationPct?: number;
}

interface ApiReservation {
  id: string;
  status: string;
  startDt: string;
  endDt: string;
  totalCents: number;
  notes?: string | null;
  cancellationReason?: string | null;
  customer: { id: string; firstName: string; lastName: string; email: string } | null;
  rentalProduct: { id: string; name: string; category: string | null } | null;
}

interface ApiPricingRule {
  id: string;
  name: string;
  type: string;
  adjustmentPct: number | null;
  adjustmentCents: number | null;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
}

function mapApiProduct(p: ApiRentalProduct): RentalProduct {
  const hourlyRate = p.hourlyRateCents ? p.hourlyRateCents / 100 : p.basePriceCents / 100;
  const dailyRate = p.dailyRateCents ? p.dailyRateCents / 100 : hourlyRate * 8;
  return {
    id: p.id,
    name: p.name,
    type: p.category ?? 'Other',
    capacity: 4,
    hourlyRate,
    halfDayRate: Math.round(hourlyRate * 4),
    dailyRate,
    status: p.active ? 'Available' : 'Retired',
    rating: 0,
    totalBookings: 0,
  };
}

function mapApiReservation(r: ApiReservation): Reservation {
  const statusMap: Record<string, ReservationStatus> = {
    PENDING: 'Pending',
    CONFIRMED: 'Confirmed',
    CHECKED_IN: 'Checked In',
    CHECKED_OUT: 'Checked Out',
    CANCELLED: 'Cancelled',
    NO_SHOW: 'No Show',
  };
  const start = new Date(r.startDt);
  const end = new Date(r.endDt);
  const hrs = Math.round((end.getTime() - start.getTime()) / 3600000);
  const durationStr = hrs >= 24 ? `${Math.round(hrs / 24)} day(s)` : `${hrs} hour(s)`;
  const timeSlot = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const customerName = r.customer
    ? `${r.customer.firstName} ${r.customer.lastName}`.trim()
    : 'Guest';
  return {
    id: r.id,
    number: `RES-${r.id.slice(-6).toUpperCase()}`,
    customer: customerName,
    product: r.rentalProduct?.name ?? '—',
    date: start.toISOString().slice(0, 10),
    timeSlot,
    duration: durationStr,
    total: r.totalCents / 100,
    status: statusMap[r.status] ?? 'Pending',
    notes: r.notes ?? r.cancellationReason ?? '',
  };
}

function mapApiPricingRule(r: ApiPricingRule): PricingRule {
  const adj = r.adjustmentPct ?? (r.adjustmentCents ? r.adjustmentCents / 100 : 0);
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    adjustment: adj,
    startDate: r.startDate ? r.startDate.slice(0, 10) : '',
    endDate: r.endDate ? r.endDate.slice(0, 10) : '',
    active: r.active,
  };
}

/* ── Availability Grid Types & Data ────────────────────── */

type SlotStatus = 'available' | 'booked' | 'maintenance' | 'blocked';
type TimeSlotKey = 'morning' | 'afternoon' | 'evening';

interface AvailabilitySlot {
  status: SlotStatus;
  customerFirstName?: string;
  reservationId?: string;
  notes?: string;
}

interface DayAvailability {
  morning: AvailabilitySlot;
  afternoon: AvailabilitySlot;
  evening: AvailabilitySlot;
}

const TIME_SLOT_LABELS: Record<TimeSlotKey, string> = {
  morning: '8 AM – 12 PM',
  afternoon: '12 PM – 4 PM',
  evening: '4 PM – 8 PM',
};

const SLOT_STATUS_COLORS: Record<SlotStatus, { bg: string; color: string; label: string }> = {
  available: { bg: '#DEF7EC', color: '#03543F', label: 'Available' },
  booked: { bg: '#D6E8F4', color: '#0A2342', label: 'Booked' },
  maintenance: { bg: '#FFF3CD', color: '#856404', label: 'Maintenance' },
  blocked: { bg: '#E2E8F0', color: '#64748B', label: 'Blocked' },
};

const avail = (s: SlotStatus, name?: string, resId?: string, notes?: string): AvailabilitySlot => ({
  status: s, customerFirstName: name, reservationId: resId, notes,
});

const FREE: DayAvailability = { morning: avail('available'), afternoon: avail('available'), evening: avail('available') };

/** Count available slots today for a product from live data */
function countAvailableToday(
  productId: string,
  availabilityData: Record<string, Record<string, DayAvailability>>,
): { available: number; total: number } {
  const today = new Date().toISOString().slice(0, 10);
  const day = availabilityData[productId]?.[today];
  if (!day) return { available: 3, total: 3 };
  let a = 0;
  if (day.morning.status === 'available') a++;
  if (day.afternoon.status === 'available') a++;
  if (day.evening.status === 'available') a++;
  return { available: a, total: 3 };
}

/* ── Availability Grid Component ───────────────────────── */

function AvailabilityGrid({ products, onViewReservation, availabilityData }: { products: RentalProduct[]; onViewReservation?: (resId: string) => void; availabilityData: Record<string, Record<string, DayAvailability>> }) {
  const [selectedCell, setSelectedCell] = useState<{ productId: string; date: string; slot: TimeSlotKey } | null>(null);
  const activeProducts = products.filter(p => p.status !== 'Retired');

  const dates = useMemo(() => {
    const today = new Date();
    const result: Date[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      result.push(d);
    }
    return result;
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);

  const formatDateHeader = (d: Date) => {
    const day = d.toLocaleDateString('en-US', { weekday: 'short' });
    const num = d.getDate();
    const mon = d.toLocaleDateString('en-US', { month: 'short' });
    return { day, num, mon };
  };

  const getDominantStatus = (day: DayAvailability): SlotStatus => {
    const slots = [day.morning, day.afternoon, day.evening];
    const counts: Record<SlotStatus, number> = { available: 0, booked: 0, maintenance: 0, blocked: 0 };
    slots.forEach(s => counts[s.status]++);
    if (counts.booked >= 2) return 'booked';
    if (counts.maintenance >= 2) return 'maintenance';
    if (counts.blocked >= 2) return 'blocked';
    if (counts.booked > 0) return 'booked';
    if (counts.maintenance > 0) return 'maintenance';
    if (counts.blocked > 0) return 'blocked';
    return 'available';
  };

  const getBookedName = (day: DayAvailability): string | undefined => {
    if (day.morning.customerFirstName) return day.morning.customerFirstName;
    if (day.afternoon.customerFirstName) return day.afternoon.customerFirstName;
    if (day.evening.customerFirstName) return day.evening.customerFirstName;
    return undefined;
  };

  type CellSelection = { productId: string; date: string; slot: TimeSlotKey } | null;

  const handleCellClick = useCallback((productId: string, dateStr: string, slot: TimeSlotKey) => {
    setSelectedCell((prev: CellSelection) =>
      prev && prev.productId === productId && prev.date === dateStr && prev.slot === slot
        ? null
        : { productId, date: dateStr, slot }
    );
  }, []);

  const selectedSlotData = useMemo(() => {
    if (!selectedCell) return null;
    const day = availabilityData[selectedCell.productId]?.[selectedCell.date];
    if (!day) return null;
    const slotKey: TimeSlotKey = selectedCell.slot;
    const slot: AvailabilitySlot = day[slotKey];
    const product = products.find((p: RentalProduct) => p.id === selectedCell.productId);
    return { status: slot.status as SlotStatus, customerFirstName: slot.customerFirstName, reservationId: slot.reservationId, notes: slot.notes, productName: product?.name ?? '', timeLabel: TIME_SLOT_LABELS[slotKey] };
  }, [selectedCell, products]);

  const gridSt = {
    wrapper: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' } as React.CSSProperties,
    scrollArea: { overflowX: 'auto', overflowY: 'visible', position: 'relative' } as React.CSSProperties,
    table: { borderCollapse: 'collapse', fontSize: '13px', minWidth: '1200px', width: '100%' } as React.CSSProperties,
    stickyTh: { position: 'sticky', left: 0, zIndex: 10, backgroundColor: '#0A2342', color: '#FFFFFF', padding: '10px 16px', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', borderBottom: '2px solid #00D4FF', minWidth: '180px' } as React.CSSProperties,
    dateTh: { padding: '6px 4px', fontSize: '11px', fontWeight: 600, backgroundColor: '#0A2342', color: '#FFFFFF', textAlign: 'center', borderBottom: '2px solid #00D4FF', minWidth: '80px', borderLeft: '1px solid rgba(255,255,255,0.1)' } as React.CSSProperties,
    todayTh: { padding: '6px 4px', fontSize: '11px', fontWeight: 600, backgroundColor: '#0D2E52', color: '#00D4FF', textAlign: 'center', borderBottom: '2px solid #00D4FF', minWidth: '80px', borderLeft: '1px solid rgba(255,255,255,0.1)' } as React.CSSProperties,
    stickyTd: { position: 'sticky', left: 0, zIndex: 5, backgroundColor: '#FFFFFF', padding: '10px 16px', fontWeight: 600, color: '#0A2342', borderBottom: '1px solid #E2E8F0', minWidth: '180px' } as React.CSSProperties,
    cell: { padding: '4px 3px', borderBottom: '1px solid #E2E8F0', borderLeft: '1px solid #E2E8F0', textAlign: 'center', cursor: 'pointer', verticalAlign: 'top' } as React.CSSProperties,
    todayCol: { backgroundColor: 'rgba(0, 212, 255, 0.06)' } as React.CSSProperties,
    slotPill: { display: 'block', padding: '3px 4px', borderRadius: '3px', fontSize: '10px', fontWeight: 600, marginBottom: '2px', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', transition: 'opacity 0.15s', border: '1px solid transparent' } as React.CSSProperties,
    legend: { display: 'flex', gap: '16px', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid #E2E8F0', flexWrap: 'wrap' } as React.CSSProperties,
    legendItem: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#2E4A6B' } as React.CSSProperties,
    legendDot: { width: '12px', height: '12px', borderRadius: '3px', flexShrink: 0 } as React.CSSProperties,
    detailPopover: { position: 'fixed', zIndex: 1100, background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', padding: '20px', width: '300px', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } as React.CSSProperties,
    detailOverlay: { position: 'fixed', inset: 0, zIndex: 1050, backgroundColor: 'rgba(10,35,66,0.25)' } as React.CSSProperties,
  };

  return (
    <div>
      {/* Legend */}
      <div style={{ ...gridSt.legend, border: '1px solid #E2E8F0', borderRadius: '8px', marginBottom: '16px', background: '#FFFFFF' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#0A2342', marginRight: '8px' }}>Legend:</span>
        {(Object.entries(SLOT_STATUS_COLORS) as [SlotStatus, typeof SLOT_STATUS_COLORS['available']][]).map(([key, val]) => (
          <span key={key} style={gridSt.legendItem}>
            <span style={{ ...gridSt.legendDot, backgroundColor: val.bg, border: `1px solid ${val.color}33` }} />
            {val.label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#64748B' }}>Click any slot for details</span>
      </div>

      <div style={gridSt.wrapper}>
        <div style={gridSt.scrollArea}>
          <table style={gridSt.table}>
            <thead>
              <tr>
                <th style={gridSt.stickyTh}>Vessel / Product</th>
                {dates.map((d: Date) => {
                  const dStr = d.toISOString().slice(0, 10);
                  const { day, num, mon } = formatDateHeader(d);
                  const isToday = dStr === todayStr;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <th key={dStr} style={{ ...(isToday ? gridSt.todayTh : gridSt.dateTh), ...(isWeekend && !isToday ? { color: '#94A3B8' } : {}) }}>
                      <div>{day}</div>
                      <div style={{ fontSize: '15px', fontWeight: 700, lineHeight: '1.2' }}>{num}</div>
                      <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.8 }}>{mon}</div>
                      {isToday && <div style={{ fontSize: '9px', background: '#00D4FF', color: '#0A2342', borderRadius: '3px', padding: '1px 4px', marginTop: '2px', fontWeight: 700 }}>TODAY</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {activeProducts.map((p, pIdx) => {
                const rowBg = pIdx % 2 === 0 ? '#FFFFFF' : '#FAFBFC';
                return (
                  <tr key={p.id}>
                    <td style={{ ...gridSt.stickyTd, backgroundColor: rowBg }}>
                      <div>{p.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 400 }}>{p.type} &middot; {p.capacity} pax</div>
                    </td>
                    {dates.map((d: Date) => {
                      const dStr = d.toISOString().slice(0, 10);
                      const isToday = dStr === todayStr;
                      const dayData = availabilityData[p.id]?.[dStr] ?? FREE;
                      const slots: TimeSlotKey[] = ['morning', 'afternoon', 'evening'];
                      return (
                        <td key={dStr} style={{ ...gridSt.cell, backgroundColor: isToday ? `${rowBg === '#FFFFFF' ? 'rgba(0,212,255,0.04)' : 'rgba(0,212,255,0.07)'}` : rowBg }}>
                          {slots.map(slotKey => {
                            const slot = dayData[slotKey];
                            const sc = SLOT_STATUS_COLORS[slot.status];
                            const isSelected = selectedCell?.productId === p.id && selectedCell?.date === dStr && selectedCell?.slot === slotKey;
                            return (
                              <span
                                key={slotKey}
                                style={{
                                  ...gridSt.slotPill,
                                  backgroundColor: sc.bg,
                                  color: sc.color,
                                  ...(isSelected ? { border: `2px solid #00D4FF`, padding: '2px 3px' } : {}),
                                }}
                                title={`${TIME_SLOT_LABELS[slotKey]}: ${sc.label}${slot.customerFirstName ? ` - ${slot.customerFirstName}` : ''}${slot.notes ? ` (${slot.notes})` : ''}`}
                                onClick={() => handleCellClick(p.id, dStr, slotKey)}
                              >
                                {slot.status === 'booked' && slot.customerFirstName
                                  ? slot.customerFirstName
                                  : slot.status === 'maintenance' ? 'Maint'
                                  : slot.status === 'blocked' ? 'Blocked'
                                  : '\u2713'}
                              </span>
                            );
                          })}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Popover */}
      {selectedCell && selectedSlotData && (
        <>
          <div style={gridSt.detailOverlay} onClick={() => setSelectedCell(null)} />
          <div style={gridSt.detailPopover}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342' }}>{selectedSlotData.productName}</div>
                <div style={{ fontSize: '13px', color: '#64748B' }}>{selectedCell.date} &middot; {selectedSlotData.timeLabel}</div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '2px' }} onClick={() => setSelectedCell(null)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ marginBottom: '12px' }}>
              {(() => {
                const statusKey = selectedSlotData.status as SlotStatus;
                return (
                  <span style={{
                    display: 'inline-block', padding: '4px 12px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600,
                    backgroundColor: SLOT_STATUS_COLORS[statusKey].bg,
                    color: SLOT_STATUS_COLORS[statusKey].color,
                  }}>
                    {SLOT_STATUS_COLORS[statusKey].label}
                  </span>
                );
              })()}
            </div>
            {selectedSlotData.customerFirstName && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>Customer</div>
                <div style={{ fontSize: '14px', color: '#0A2342' }}>{selectedSlotData.customerFirstName}</div>
              </div>
            )}
            {selectedSlotData.reservationId && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>Reservation</div>
                <div style={{ fontSize: '14px', color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>{selectedSlotData.reservationId}</div>
              </div>
            )}
            {selectedSlotData.notes && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>Notes</div>
                <div style={{ fontSize: '14px', color: '#0A2342' }}>{selectedSlotData.notes}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              {selectedSlotData.status === 'available' && (
                <button style={{ padding: '6px 16px', fontSize: '13px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                  <Plus size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> New Booking
                </button>
              )}
              {selectedSlotData.status === 'booked' && selectedSlotData.reservationId && (
                <button
                  style={{ padding: '6px 16px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#E0F7FF', border: '1px solid #B3E8FF', borderRadius: '6px', cursor: 'pointer' }}
                  onClick={() => { if (onViewReservation && selectedSlotData.reservationId) { onViewReservation(selectedSlotData.reservationId); setSelectedCell(null); } }}
                >
                  View Reservation
                </button>
              )}
              <button style={{ padding: '6px 16px', fontSize: '13px', fontWeight: 600, color: '#64748B', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer' }} onClick={() => setSelectedCell(null)}>
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────── */

const productStatusColors: Record<ProductStatus, { bg: string; color: string }> = {
  Available: { bg: '#DEF7EC', color: '#03543F' },
  Maintenance: { bg: '#FFF3CD', color: '#856404' },
  Retired: { bg: '#FDE8E8', color: '#9B1C1C' },
};

const resStatusColors: Record<ReservationStatus, { bg: string; color: string }> = {
  Pending: { bg: '#E0F7FF', color: '#0A2342' },
  Confirmed: { bg: '#DEF7EC', color: '#03543F' },
  'Checked In': { bg: '#D6E8F4', color: '#0A2342' },
  'Checked Out': { bg: '#F3F4F6', color: '#64748B' },
  Cancelled: { bg: '#FDE8E8', color: '#9B1C1C' },
  'No Show': { bg: '#FFF3CD', color: '#856404' },
};

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '13px', color: '#2E4A6B', marginTop: '2px' },
  tabs: { display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px', transition: 'all 0.15s' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, flex: 1, minWidth: '200px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '14px' },
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10, 35, 66, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '8px', width: '560px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px 16px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: '22px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px' },
  modalBody: { padding: '24px 32px' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const, width: '100%' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 32px 24px', borderTop: '1px solid #E2E8F0' },
  cancelBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  saveBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  detailPanel: { position: 'fixed' as const, top: 0, right: 0, width: '420px', height: '100vh', background: '#FFFFFF', boxShadow: '-4px 0 12px rgba(0,0,0,0.1)', zIndex: 1000, overflow: 'auto' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', borderBottom: '1px solid #E2E8F0' },
  detailSection: { padding: '20px 24px', borderBottom: '1px solid #E2E8F0' },
  detailLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  detailValue: { fontSize: '15px', color: '#0A2342', marginBottom: '12px' },
  toggleTrack: { width: '40px', height: '22px', borderRadius: '11px', cursor: 'pointer', position: 'relative' as const, transition: 'background 0.2s', border: 'none', padding: 0 },
  toggleThumb: { width: '18px', height: '18px', borderRadius: '50%', background: '#FFFFFF', position: 'absolute' as const, top: '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' },
};

/* ── Add Product Modal ─────────────────────────────────── */

function AddProductModal({ onClose, onSave }: { onClose: () => void; onSave: (p: RentalProduct) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [capacity, setCapacity] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [halfDayRate, setHalfDayRate] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [status, setStatus] = useState<ProductStatus>('Available');
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    if (!name || !type) return;
    setSaving(true);
    const product: RentalProduct = {
      id: `prod-${Date.now()}`,
      name,
      type,
      capacity: parseInt(capacity) || 0,
      hourlyRate: parseFloat(hourlyRate) || 0,
      halfDayRate: parseFloat(halfDayRate) || 0,
      dailyRate: parseFloat(dailyRate) || 0,
      status,
      rating: 0,
      totalBookings: 0,
    };
    onSave(product);
    setSaving(false);
    onClose();
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Add Rental Product</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.field}>
            <label style={st.label}>Product Name *</label>
            <input style={st.input} placeholder="e.g. Bay Cruiser 24" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div style={st.twoCol} className="helm-form-grid">
            <div style={st.field}>
              <label style={st.label}>Type *</label>
              <select style={{ ...st.input, cursor: 'pointer' }} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Select type...</option>
                <option>Pontoon</option>
                <option>Jet Ski</option>
                <option>Kayak</option>
                <option>Paddleboard</option>
                <option>Sailboat</option>
                <option>Powerboat</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Capacity</label>
              <input style={st.input} type="number" placeholder="e.g. 10" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Hourly Rate ($)</label>
              <input style={st.input} type="number" placeholder="85.00" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Half-Day Rate ($)</label>
              <input style={st.input} type="number" placeholder="280.00" value={halfDayRate} onChange={(e) => setHalfDayRate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Daily Rate ($)</label>
              <input style={st.input} type="number" placeholder="450.00" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Status</label>
              <select style={{ ...st.input, cursor: 'pointer' }} value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)}>
                <option>Available</option>
                <option>Maintenance</option>
                <option>Retired</option>
              </select>
            </div>
          </div>
          {(!name || !type) && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 8 }}>* Name and Type are required</div>}
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...st.saveBtn, opacity: (!name || !type) ? 0.5 : 1 }}
            onClick={handleSave}
            disabled={saving || !name || !type}
          >
            {saving ? 'Saving…' : 'Save Product'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Reservation Detail Panel ──────────────────────────── */

function ReservationDetail({ res, onClose }: { res: Reservation; onClose: () => void }) {
  const sc = resStatusColors[res.status];
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const showMsg = (msg: string) => { setActionMsg(msg); setTimeout(() => { setActionMsg(null); onClose(); }, 1500); };
  return (
    <div style={st.detailPanel} className="helm-detail-panel">
      <div style={st.detailHeader}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 }}>{res.number}</h2>
        <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
      </div>
      {actionMsg && <div style={{ padding: '12px 24px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', textAlign: 'center' }}>{actionMsg}</div>}
      <div style={st.detailSection}>
        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{res.status}</span>
      </div>
      <div style={st.detailSection}>
        <div style={st.detailLabel}>Customer</div>
        <div style={st.detailValue}>{res.customer}</div>
        <div style={st.detailLabel}>Product</div>
        <div style={st.detailValue}>{res.product}</div>
        <div style={st.detailLabel}>Date</div>
        <div style={st.detailValue}>{res.date}</div>
        <div style={st.detailLabel}>Time Slot</div>
        <div style={st.detailValue}>{res.timeSlot}</div>
        <div style={st.detailLabel}>Duration</div>
        <div style={st.detailValue}>{res.duration}</div>
      </div>
      <div style={st.detailSection}>
        <div style={st.detailLabel}>Total</div>
        <div style={{ ...st.detailValue, fontSize: '22px', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>${res.total.toFixed(2)}</div>
        {res.notes && (
          <>
            <div style={st.detailLabel}>Notes</div>
            <div style={st.detailValue}>{res.notes}</div>
          </>
        )}
      </div>
      <div style={{ padding: '20px 24px', display: 'flex', gap: '12px' }}>
        {res.status === 'Confirmed' && <button style={st.saveBtn} onClick={() => showMsg(`${res.customer} checked in for ${res.product}`)}>Check In</button>}
        {res.status === 'Checked In' && <button style={st.saveBtn} onClick={() => showMsg(`${res.customer} checked out from ${res.product}`)}>Check Out</button>}
        {(res.status === 'Pending' || res.status === 'Confirmed') && (
          <button style={{ ...st.cancelBtn, color: '#9B1C1C', borderColor: '#FCA5A5' }} onClick={() => showMsg(`Reservation ${res.number} cancelled`)}>Cancel</button>
        )}
      </div>
    </div>
  );
}

/* ── Duration CRUD ───────────────────────────────────────── */

interface Duration {
  id: string; name: string; minutes: number; price: number;
  location: string; availDays: string[]; unlockRule: 'always' | 'after_time' | 'after_slot_booked';
  unlockTime?: string; unlockSlot?: 'morning' | 'afternoon';
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const INIT_DURATIONS: Duration[] = [
  { id: '1', name: 'Half Day (Morning)', minutes: 240, price: 85, location: 'Main Dock', availDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], unlockRule: 'always' },
  { id: '2', name: 'Half Day (Afternoon)', minutes: 240, price: 85, location: 'Main Dock', availDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], unlockRule: 'after_slot_booked', unlockSlot: 'morning' },
  { id: '3', name: 'Full Day', minutes: 480, price: 150, location: 'Main Dock', availDays: ['Sat', 'Sun'], unlockRule: 'always' },
  { id: '4', name: '2-Hour Express', minutes: 120, price: 45, location: 'Fuel Dock', availDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], unlockRule: 'after_time', unlockTime: '08:00' },
  { id: '5', name: 'Sunset Cruise', minutes: 180, price: 120, location: 'Main Dock', availDays: ['Fri', 'Sat', 'Sun'], unlockRule: 'after_time', unlockTime: '15:00' },
];

function DurationModal({ duration, onClose, onSave }: { duration?: Duration | null; onClose: () => void; onSave: (d: Duration) => void }) {
  const isEdit = !!duration;
  const [name, setName] = useState(duration?.name ?? '');
  const [minutes, setMinutes] = useState(duration ? String(duration.minutes) : '120');
  const [price, setPrice] = useState(duration ? String(duration.price) : '');
  const [location, setLocation] = useState(duration?.location ?? 'Main Dock');
  const [availDays, setAvailDays] = useState<string[]>(duration?.availDays ?? [...DAYS]);
  const [unlockRule, setUnlockRule] = useState<Duration['unlockRule']>(duration?.unlockRule ?? 'always');
  const [unlockTime, setUnlockTime] = useState(duration?.unlockTime ?? '08:00');
  const [unlockSlot, setUnlockSlot] = useState<'morning' | 'afternoon'>(duration?.unlockSlot ?? 'morning');

  const toggleDay = (d: string) => setAvailDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const fStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' };
  const lStyle: React.CSSProperties = { fontSize: '13px', fontWeight: 600, color: '#0A2342' };
  const iStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box', width: '100%' };
  const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 };
  const modalStyle: React.CSSProperties = { background: '#FFFFFF', borderRadius: '8px', width: '520px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 28px 14px', borderBottom: '1px solid #E2E8F0' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>{isEdit ? 'Edit Duration' : 'Add Duration'}</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 28px' }}>
          <div style={fStyle}><label style={lStyle}>Duration Name *</label><input style={iStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Half Day (Morning)" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={fStyle}><label style={lStyle}>Duration (minutes)</label><input style={iStyle} type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
            <div style={fStyle}><label style={lStyle}>Price ($)</label><input style={iStyle} type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          </div>
          <div style={fStyle}><label style={lStyle}>Location</label>
            <select style={iStyle} value={location} onChange={(e) => setLocation(e.target.value)}>
              <option>Main Dock</option><option>Fuel Dock</option><option>Beach Launch</option><option>Kayak Bay</option><option>Any</option>
            </select>
          </div>
          <div style={fStyle}>
            <label style={lStyle}>Available Days</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
              {DAYS.map((d) => (
                <button key={d} onClick={() => toggleDay(d)} style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '4px', cursor: 'pointer', backgroundColor: availDays.includes(d) ? '#0A2342' : '#F1F5F9', color: availDays.includes(d) ? '#FFFFFF' : '#64748B', border: 'none' }}>{d}</button>
              ))}
            </div>
          </div>
          <div style={fStyle}>
            <label style={lStyle}>Unlock Rule</label>
            <select style={iStyle} value={unlockRule} onChange={(e) => setUnlockRule(e.target.value as Duration['unlockRule'])}>
              <option value="always">Always available</option>
              <option value="after_time">Available after time</option>
              <option value="after_slot_booked">Available after slot is booked</option>
            </select>
          </div>
          {unlockRule === 'after_time' && (
            <div style={fStyle}><label style={lStyle}>Available After (time)</label><input style={iStyle} type="time" value={unlockTime} onChange={(e) => setUnlockTime(e.target.value)} /></div>
          )}
          {unlockRule === 'after_slot_booked' && (
            <div style={fStyle}><label style={lStyle}>Unlocks After Slot</label>
              <select style={iStyle} value={unlockSlot} onChange={(e) => setUnlockSlot(e.target.value as 'morning' | 'afternoon')}>
                <option value="morning">Morning slot is booked</option>
                <option value="afternoon">Afternoon slot is booked</option>
              </select>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '12px 28px 20px', borderTop: '1px solid #E2E8F0' }}>
          <button style={{ padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' }} onClick={onClose}>Cancel</button>
          <button style={{ padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', background: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' }} onClick={() => {
            if (!name) return;
            onSave({ id: duration?.id ?? String(Date.now()), name, minutes: parseInt(minutes) || 120, price: parseFloat(price) || 0, location, availDays, unlockRule, unlockTime, unlockSlot });
            onClose();
          }}>{isEdit ? 'Save Changes' : 'Add Duration'}</button>
        </div>
      </div>
    </div>
  );
}

function DurationsTab() {
  const [durations, setDurations] = useState<Duration[]>(INIT_DURATIONS);
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Duration | null>(null);

  const unlockLabel = (d: Duration) => {
    if (d.unlockRule === 'always') return 'Always';
    if (d.unlockRule === 'after_time') return `After ${d.unlockTime}`;
    if (d.unlockRule === 'after_slot_booked') return `After ${d.unlockSlot} booked`;
    return '—';
  };

  const thS: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF', whiteSpace: 'nowrap' };
  const tdS: React.CSSProperties = { padding: '10px 14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0', fontSize: '13px' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ fontSize: '14px', color: '#64748B' }}>Configure rental duration slots with pricing, availability, and unlock rules.</div>
        <button style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' }} onClick={() => { setEditing(null); setModal('add'); }}>
          <Plus size={16} /> Add Duration
        </button>
      </div>
      <div style={{ background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead><tr>
            <th style={thS}>Name</th>
            <th style={thS}>Minutes</th>
            <th style={thS}>Price</th>
            <th style={thS}>Location</th>
            <th style={thS}>Available Days</th>
            <th style={thS}>Unlock Rule</th>
            <th style={thS}>Actions</th>
          </tr></thead>
          <tbody>
            {durations.map((d, idx) => (
              <tr key={d.id} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4' }}>
                <td style={{ ...tdS, fontWeight: 600 }}>{d.name}</td>
                <td style={{ ...tdS, fontFamily: '"JetBrains Mono", monospace' }}>{d.minutes} min</td>
                <td style={{ ...tdS, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>${d.price.toFixed(2)}</td>
                <td style={tdS}>{d.location}</td>
                <td style={tdS}>{d.availDays.length === 7 ? 'Every day' : d.availDays.join(', ')}</td>
                <td style={tdS}><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, backgroundColor: d.unlockRule === 'always' ? '#DEF7EC' : '#E0F7FF', color: d.unlockRule === 'always' ? '#03543F' : '#0A2342' }}>{unlockLabel(d)}</span></td>
                <td style={tdS}>
                  <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', marginRight: '8px' }} onClick={() => { setEditing(d); setModal('edit'); }} title="Edit"><Edit2 size={14} /></button>
                  <button style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }} onClick={() => setDurations((prev) => prev.filter((x) => x.id !== d.id))} title="Delete"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <DurationModal
          duration={modal === 'edit' ? editing : null}
          onClose={() => setModal(null)}
          onSave={(d) => setDurations((prev) => modal === 'edit' ? prev.map((x) => x.id === d.id ? d : x) : [...prev, d])}
        />
      )}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function Rentals() {
  const toast = useToast();
  const [tab, setTab] = useState<'products' | 'reservations' | 'availability' | 'settings'>('products');
  const [settingsTab, setSettingsTab] = useState<'durations' | 'pricing' | 'promos' | 'calendar' | 'simulator'>('durations');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  const [localProducts, setLocalProducts] = useState<RentalProduct[]>([]);

  // API calls
  const { data: apiProductData, loading: loadingProducts } = useApi<{ data: ApiRentalProduct[]; pagination: unknown }>('get', '/api/rentals/products', { immediate: true });
  const { data: apiReservationData, loading: loadingRes } = useApi<{ data: ApiReservation[]; pagination: unknown }>('get', '/api/rentals/reservations?take=100', { immediate: true });
  const { data: apiPricingRuleData } = useApi<{ data: ApiPricingRule[]; pagination: unknown }>('get', '/api/rentals/pricing-rules', { immediate: true });
  const { data: apiAvailabilityData } = useApi<{ data: Record<string, Record<string, DayAvailability>> }>('get', '/api/rentals/availability', { immediate: true });
  const availabilityData: Record<string, Record<string, DayAvailability>> = apiAvailabilityData?.data ?? {};
  const createProduct = useApi<ApiRentalProduct>('post', '/api/rentals/products');

  const handleAddProduct = (p: RentalProduct) => {
    setLocalProducts((prev) => [p, ...(prev.length > 0 ? prev : products)]);
    createProduct.execute({ body: { name: p.name, category: p.type, basePriceCents: Math.round(p.hourlyRate * 100), hourlyRateCents: Math.round(p.hourlyRate * 100), dailyRateCents: Math.round(p.dailyRate * 100), active: true } }).catch(() => {});
  };

  const products = useMemo(
    () => localProducts.length > 0 ? localProducts : (apiProductData?.data ?? []).map(mapApiProduct),
    [localProducts, apiProductData]
  );
  const reservations = useMemo(() => (apiReservationData?.data ?? []).map(mapApiReservation), [apiReservationData]);
  const pricingRules = useMemo(() => (apiPricingRuleData?.data ?? []).map(mapApiPricingRule), [apiPricingRuleData]);
  const promoCodes = useMemo<PromoCode[]>(() => [], []);

  const loading = loadingProducts || loadingRes;

  const activeProducts = products.filter((p) => p.status === 'Available').length;
  const activeRes = reservations.filter((r) => ['Pending', 'Confirmed', 'Checked In'].includes(r.status)).length;
  const monthRevenue = reservations.filter((r) => r.status !== 'Cancelled').reduce((sum, r) => sum + r.total, 0);
  const avgRating = (products.reduce((sum, p) => sum + p.rating, 0) / products.length).toFixed(1);

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'products', label: 'Products' },
    { key: 'availability', label: 'Availability' },
    { key: 'reservations', label: 'Reservations' },
    { key: 'settings', label: 'Settings' },
  ];

  const settingsTabs: { key: typeof settingsTab; label: string }[] = [
    { key: 'durations', label: 'Durations' },
    { key: 'pricing', label: 'Pricing Rules' },
    { key: 'promos', label: 'Promo Codes' },
    { key: 'calendar', label: 'Pricing Calendar' },
    { key: 'simulator', label: 'Price Simulator' },
  ];

  const handleViewReservation = (resId: string) => {
    const found = reservations.find((r) => r.number === resId);
    if (found) { setSelectedRes(found); setTab('reservations'); }
  };

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Rentals</h1>
      <hr style={st.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading rentals...</div>}

      {/* Stats */}
      <div style={st.statsRow} className="helm-stats-grid">
        <div style={st.statCard}>
          <div style={st.statLabel}>Total Products</div>
          <div style={st.statValue}>{products.length}</div>
          <div style={st.statSub}>{activeProducts} available</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Active Reservations</div>
          <div style={st.statValue}>{activeRes}</div>
          <div style={st.statSub}>{reservations.filter((r) => r.status === 'Checked In').length} checked in today</div>
        </div>
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Revenue This Month</div>
          <div style={st.statValue}>${monthRevenue.toLocaleString()}</div>
          <div style={st.statSub}>+18% vs last month</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Avg Rating</div>
          <div style={st.statValue}>{avgRating}</div>
          <div style={st.statSub}>{products.reduce((s, p) => s + p.totalBookings, 0)} total bookings</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={st.tabs} className="helm-tabs">
        {tabs.map((t) => (
          <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Products Tab */}
      {tab === 'products' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button style={st.addBtn} onClick={() => setShowAdd(true)}><Plus size={16} /> Add Product</button>
          </div>
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Name</th>
                  <th style={st.th}>Type</th>
                  <th style={st.th}>Capacity</th>
                  <th style={st.th}>Hourly</th>
                  <th style={st.th}>Half-Day</th>
                  <th style={st.th}>Daily</th>
                  <th style={st.th}>Rating</th>
                  <th style={st.th}>Bookings</th>
                  <th style={st.th}>Today&apos;s Availability</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.type.toLowerCase().includes(search.toLowerCase())).map((p, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const sc = productStatusColors[p.status];
                  return (
                    <tr key={p.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.name}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.type}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{p.capacity}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${p.hourlyRate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${p.halfDayRate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${p.dailyRate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Star size={14} style={{ color: '#F59E0B', fill: '#F59E0B' }} /> {p.rating}
                        </span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.totalBookings}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        {(() => {
                          const av = countAvailableToday(p.id, availabilityData);
                          const pct = Math.round((av.available / av.total) * 100);
                          const barBg = pct === 0 ? '#FDE8E8' : pct <= 33 ? '#FFF3CD' : '#DEF7EC';
                          const barFg = pct === 0 ? '#9B1C1C' : pct <= 33 ? '#856404' : '#03543F';
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ flex: 1, height: '6px', borderRadius: '3px', backgroundColor: '#E2E8F0', overflow: 'hidden', minWidth: '48px' }}>
                                <div style={{ width: `${pct}%`, height: '100%', borderRadius: '3px', backgroundColor: barFg, transition: 'width 0.3s' }} />
                              </div>
                              <span style={{ ...st.badge, backgroundColor: barBg, color: barFg, fontSize: '11px', whiteSpace: 'nowrap' as const }}>
                                {av.available}/{av.total} slots
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{p.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => setShowAdd(true)}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Reservations Tab */}
      {tab === 'reservations' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search reservations..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              <option>Pending</option>
              <option>Confirmed</option>
              <option>Checked In</option>
              <option>Checked Out</option>
              <option>Cancelled</option>
              <option>No Show</option>
            </select>
          </div>
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Reservation #</th>
                  <th style={st.th}>Customer</th>
                  <th style={st.th}>Product</th>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Time Slot</th>
                  <th style={st.th}>Duration</th>
                  <th style={st.th}>Total</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.filter((r) => {
                  if (statusFilter !== 'All' && r.status !== statusFilter) return false;
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return r.number.toLowerCase().includes(q) || r.customer.toLowerCase().includes(q) || r.product.toLowerCase().includes(q);
                }).map((r, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const sc = resStatusColors[r.status];
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedRes(r)}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{r.number}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.customer}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.product}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px' }}>{r.timeSlot}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.duration}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${r.total.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{r.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={(e) => { e.stopPropagation(); setSelectedRes(r); }}>
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Availability Grid Tab */}
      {tab === 'availability' && <AvailabilityGrid products={products} onViewReservation={handleViewReservation} availabilityData={availabilityData} />}

      {/* Settings Tab */}
      {tab === 'settings' && (
        <div>
          {/* Settings sub-nav */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '28px', borderBottom: '2px solid #E2E8F0', paddingBottom: '0' }}>
            {settingsTabs.map((st2) => (
              <button
                key={st2.key}
                onClick={() => setSettingsTab(st2.key)}
                style={{
                  padding: '8px 18px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: 'none',
                  borderBottom: settingsTab === st2.key ? '2px solid #00D4FF' : '2px solid transparent',
                  marginBottom: '-2px',
                  backgroundColor: 'transparent',
                  color: settingsTab === st2.key ? '#0A2342' : '#64748B',
                  cursor: 'pointer',
                  borderRadius: '4px 4px 0 0',
                  transition: 'color 0.15s',
                }}
              >
                {st2.label}
              </button>
            ))}
          </div>

          {settingsTab === 'durations' && <DurationsTab />}

          {settingsTab === 'pricing' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div style={{ fontSize: '14px', color: '#64748B' }}>Configure dynamic pricing rules applied to rental products.</div>
                <button style={{ ...st.addBtn }} onClick={() => toast.info('Coming Soon', 'Pricing rule form will open here')}><Plus size={16} /> Add Rule</button>
              </div>
              <div style={st.tableWrap} className="helm-table-wrap">
                <table style={st.table}>
                  <thead><tr>
                    <th style={st.th}>Rule Name</th><th style={st.th}>Applies To</th><th style={st.th}>Type</th>
                    <th style={st.th}>Adjustment</th><th style={st.th}>Days / Conditions</th><th style={st.th}>Status</th><th style={st.th}></th>
                  </tr></thead>
                  <tbody>
                    {pricingRules.map((rule, idx) => {
                      const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                      return (
                        <tr key={rule.id}>
                          <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{rule.name}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>{(rule as any).appliesTo ?? 'All Products'}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>{rule.type}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{rule.adjustment > 0 ? '+' : ''}{rule.adjustment}%</td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>{(rule as any).days?.join(', ') || (rule as any).conditions || `${rule.startDate} – ${rule.endDate}`}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>
                            <span style={{ ...st.badge, backgroundColor: rule.active ? '#DEF7EC' : '#F3F4F6', color: rule.active ? '#03543F' : '#64748B' }}>{rule.active ? 'Active' : 'Inactive'}</span>
                          </td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>
                            <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => toast.info('Edit', 'Edit form opening...')}>Edit</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {settingsTab === 'promos' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div style={{ fontSize: '14px', color: '#64748B' }}>Manage promotional discount codes for rental bookings.</div>
                <button style={{ ...st.addBtn }} onClick={() => toast.info('Coming Soon', 'Promo code form will open here')}><Plus size={16} /> Add Promo Code</button>
              </div>
              <div style={st.tableWrap} className="helm-table-wrap">
                <table style={st.table}>
                  <thead><tr>
                    <th style={st.th}>Code</th><th style={st.th}>Discount</th><th style={st.th}>Valid From</th>
                    <th style={st.th}>Valid To</th><th style={st.th}>Uses</th><th style={st.th}>Status</th><th style={st.th}></th>
                  </tr></thead>
                  <tbody>
                    {promoCodes.map((pc, idx) => {
                      const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                      return (
                        <tr key={pc.id}>
                          <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600, ...st.mono }}>{pc.code}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{pc.discountType === '%' ? `${pc.discount}%` : `$${pc.discount}`} off</td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>{pc.validFrom}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>{pc.validTo}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{pc.uses} / {pc.maxUses || '∞'}</td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>
                            <span style={{ ...st.badge, backgroundColor: pc.active ? '#DEF7EC' : '#F3F4F6', color: pc.active ? '#03543F' : '#64748B' }}>{pc.active ? 'Active' : 'Expired'}</span>
                          </td>
                          <td style={{ ...st.td, backgroundColor: rowBg }}>
                            <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }} onClick={() => toast.info('Edit', 'Edit form opening...')}>Edit</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {settingsTab === 'calendar' && (
            <PricingCalendar
              products={[
                { id: 'pontoon', name: 'Bay Cruiser 24 (Pontoon)', basePriceCents: 8500 },
                { id: 'jetski',  name: 'Wave Runner Pro (Jet Ski)', basePriceCents: 6500 },
                { id: 'kayak',   name: 'Harbor Explorer (Kayak)',   basePriceCents: 2500 },
              ]}
              onOverrideChange={async (productId, date, priceCents) => {
                try {
                  const token = null; // Will use useApi in production
                  await fetch('/api/rentals/pricing-calendar-overrides', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rentalProductId: productId, overrideDate: date, priceCents }),
                  });
                } catch { /* API unavailable — override saved locally in calendar state */ }
              }}
            />
          )}

          {settingsTab === 'simulator' && <PriceSimulator />}
        </div>
      )}

      {showAdd && <AddProductModal onClose={() => setShowAdd(false)} onSave={handleAddProduct} />}
      {selectedRes && <ReservationDetail res={selectedRes} onClose={() => setSelectedRes(null)} />}
    </div>
  );
}
