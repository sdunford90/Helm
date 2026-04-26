import React, { useState, useMemo, useCallback, useEffect } from "react";
import { createApiClient, type ApiClient } from "../shared/api";
import {
  colors,
  fonts,
  spacing,
  radii,
  baseContainer,
  card,
  label as labelStyle,
  input as inputStyle,
  inputFocus,
  primaryButton,
  secondaryButton,
  fieldRow,
  fieldHalf,
  fieldGroup,
  successBox,
  errorBox,
  errorText,
  poweredBy,
  stepIndicator,
} from "../shared/styles";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TransientBookingWidgetProps {
  tenantId: string;
  primaryColor?: string;
  hostElement: HTMLElement;
}

interface BoatInfo {
  name: string;
  length: string;
  beam: string;
}

interface GuestInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface MockSlip {
  id: string;
  label: string;
  maxLength: number;
  maxBeam: number;
  nightlyRate: number;
  weekendPremium: number;
}

/* ------------------------------------------------------------------ */
/*  API slip shape                                                     */
/* ------------------------------------------------------------------ */

interface ApiAvailableSlip {
  id: string;
  slipNumber: string;
  lengthFt: number;
  widthFt: number;
  dockId: string | null;
  rateCents?: number;
}

function mapApiSlip(s: ApiAvailableSlip): MockSlip {
  return {
    id: s.id,
    label: s.slipNumber,
    maxLength: s.lengthFt,
    maxBeam: s.widthFt,
    nightlyRate: s.rateCents ? s.rateCents / 100 : 85,
    weekendPremium: 20,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const STEPS = ["Dates", "Boat Info", "Select Slip", "Guest & Payment"];

function nightsBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 5 || day === 6; // Fri, Sat, Sun
}

function countWeekendNights(checkIn: string, nights: number): number {
  let count = 0;
  const start = new Date(checkIn);
  for (let i = 0; i < nights; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (isWeekend(d)) count++;
  }
  return count;
}

function StepBar({ current, accent }: { current: number; accent: string }) {
  const indicators = stepIndicator(STEPS.length, current, accent);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        marginBottom: spacing.lg,
      }}
    >
      {STEPS.map((s, i) => (
        <React.Fragment key={s}>
          <div style={{ textAlign: "center" }}>
            <div style={indicators[i]}>{i + 1}</div>
            <div
              style={{
                fontSize: "10px",
                marginTop: "4px",
                color: i <= current ? accent : colors.gray400,
                fontWeight: i === current ? 700 : 400,
              }}
            >
              {s}
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div
              style={{
                flex: 1,
                maxWidth: "40px",
                height: "2px",
                background: i < current ? accent : colors.gray200,
                alignSelf: "flex-start",
                marginTop: "16px",
              }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TransientBookingWidget({
  primaryColor,
  hostElement,
}: TransientBookingWidgetProps) {
  const accent = primaryColor ?? colors.cyan;
  const api: ApiClient = useMemo(() => createApiClient(hostElement), [hostElement]);

  const [step, setStep] = useState(0);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [boat, setBoat] = useState<BoatInfo>({ name: "", length: "", beam: "" });
  const [selectedSlip, setSelectedSlip] = useState<MockSlip | null>(null);
  const [guest, setGuest] = useState<GuestInfo>({ firstName: "", lastName: "", email: "", phone: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiSlips, setApiSlips] = useState<MockSlip[]>([]);

  useEffect(() => {
    api.get<{ data: ApiAvailableSlip[] }>("/api/transient/available-slips").then(({ data }) => {
      if (data?.data && data.data.length > 0) {
        setApiSlips(data.data.map(mapApiSlip));
      }
    }).catch(() => {});
  }, [api]);

  const focusStyle = (name: string): React.CSSProperties =>
    focused === name
      ? { ...inputFocus, borderColor: accent, boxShadow: `0 0 0 3px ${accent}26` }
      : {};

  const nights = useMemo(() => nightsBetween(checkIn, checkOut), [checkIn, checkOut]);
  const weekendNights = useMemo(
    () => (checkIn ? countWeekendNights(checkIn, nights) : 0),
    [checkIn, nights]
  );

  const matchingSlips = useMemo(() => {
    const len = Number(boat.length) || 0;
    const bm = Number(boat.beam) || 0;
    if (!len) return apiSlips;
    return apiSlips.filter((s) => s.maxLength >= len && s.maxBeam >= bm);
  }, [boat.length, boat.beam, apiSlips]);

  const pricing = useMemo(() => {
    if (!selectedSlip || nights <= 0) return { base: 0, weekendSurcharge: 0, total: 0 };
    const base = selectedSlip.nightlyRate * nights;
    const weekendSurcharge = selectedSlip.weekendPremium * weekendNights;
    return { base, weekendSurcharge, total: base + weekendSurcharge };
  }, [selectedSlip, nights, weekendNights]);

  const setBoatField = useCallback(
    (field: keyof BoatInfo) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setBoat((p) => ({ ...p, [field]: e.target.value }));
        setErrors((p) => ({ ...p, [field]: "" }));
      },
    []
  );

  const setGuestField = useCallback(
    (field: keyof GuestInfo) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setGuest((p) => ({ ...p, [field]: e.target.value }));
        setErrors((p) => ({ ...p, [field]: "" }));
      },
    []
  );

  const validateStep = (): boolean => {
    const errs: Record<string, string> = {};
    if (step === 0) {
      if (!checkIn) errs.checkIn = "Required";
      if (!checkOut) errs.checkOut = "Required";
      else if (nights <= 0) errs.checkOut = "Check-out must be after check-in";
    }
    if (step === 1) {
      if (!boat.name.trim()) errs.boatName = "Required";
      if (!boat.length.trim()) errs.boatLength = "Required";
      if (!boat.beam.trim()) errs.boatBeam = "Required";
    }
    if (step === 2 && !selectedSlip) {
      errs.slip = "Please select a slip";
    }
    if (step === 3) {
      if (!guest.firstName.trim()) errs.firstName = "Required";
      if (!guest.lastName.trim()) errs.lastName = "Required";
      if (!guest.email.trim()) errs.email = "Required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) errs.email = "Invalid email";
      if (!guest.phone.trim()) errs.phone = "Required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (validateStep()) setStep((s) => Math.min(s + 1, 3));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setStatus("loading");
    setErrorMsg("");

    const { error } = await api.post("/api/transient", {
      checkIn,
      checkOut,
      nights,
      boat,
      slipId: selectedSlip?.id,
      guest,
      pricing,
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error);
    } else {
      setStatus("success");
    }
  };

  /* ---------- Success ---------- */
  if (status === "success") {
    return (
      <div style={{ ...baseContainer, maxWidth: "640px", margin: "0 auto" }}>
        <div style={card}>
          <div style={successBox}>
            <div style={{ fontSize: "28px", marginBottom: spacing.sm }}>&#10003;</div>
            <strong>Reservation Confirmed!</strong>
            <p style={{ margin: `${spacing.sm} 0 0` }}>
              A confirmation has been sent to <strong>{guest.email}</strong>.
            </p>
          </div>
          <div style={poweredBy}>Powered by Helm</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...baseContainer, maxWidth: "640px", margin: "0 auto" }}>
      <div style={card}>
        <h2
          style={{
            margin: `0 0 ${spacing.sm}`,
            fontSize: "20px",
            fontWeight: 700,
            color: colors.navy,
            fontFamily: fonts.sans,
            textAlign: "center",
          }}
        >
          Guest / Transient Slip Booking
        </h2>

        <StepBar current={step} accent={accent} />

        {status === "error" && errorMsg && (
          <div style={{ ...errorBox, marginBottom: spacing.md }}>{errorMsg}</div>
        )}

        {/* ---- Step 0: Dates ---- */}
        {step === 0 && (
          <div>
            <div style={fieldRow}>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Check-in Date *</label>
                <input
                  type="date"
                  style={{ ...inputStyle, ...focusStyle("checkIn") }}
                  value={checkIn}
                  onChange={(e) => { setCheckIn(e.target.value); setErrors((p) => ({ ...p, checkIn: "" })); }}
                  onFocus={() => setFocused("checkIn")}
                  onBlur={() => setFocused(null)}
                />
                {errors.checkIn && <div style={errorText}>{errors.checkIn}</div>}
              </div>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Check-out Date *</label>
                <input
                  type="date"
                  style={{ ...inputStyle, ...focusStyle("checkOut") }}
                  value={checkOut}
                  min={checkIn || undefined}
                  onChange={(e) => { setCheckOut(e.target.value); setErrors((p) => ({ ...p, checkOut: "" })); }}
                  onFocus={() => setFocused("checkOut")}
                  onBlur={() => setFocused(null)}
                />
                {errors.checkOut && <div style={errorText}>{errors.checkOut}</div>}
              </div>
            </div>

            {nights > 0 && (
              <div
                style={{
                  background: colors.gray50,
                  borderRadius: radii.md,
                  padding: spacing.sm,
                  fontSize: "14px",
                  color: colors.gray700,
                  marginBottom: spacing.md,
                  textAlign: "center",
                }}
              >
                <strong>{nights}</strong> night{nights !== 1 ? "s" : ""}
                {weekendNights > 0 && (
                  <span style={{ color: colors.orange }}>
                    {" "}(includes {weekendNights} weekend night{weekendNights !== 1 ? "s" : ""})
                  </span>
                )}
              </div>
            )}

            <button style={primaryButton(accent)} onClick={next}>
              Continue
            </button>
          </div>
        )}

        {/* ---- Step 1: Boat Info ---- */}
        {step === 1 && (
          <div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Boat Name *</label>
              <input
                style={{ ...inputStyle, ...focusStyle("boatName") }}
                value={boat.name}
                onChange={setBoatField("name")}
                onFocus={() => setFocused("boatName")}
                onBlur={() => setFocused(null)}
                placeholder="e.g. Sea Breeze"
              />
              {errors.boatName && <div style={errorText}>{errors.boatName}</div>}
            </div>
            <div style={fieldRow}>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Length (ft) *</label>
                <input
                  type="number"
                  style={{ ...inputStyle, ...focusStyle("boatLength") }}
                  value={boat.length}
                  onChange={setBoatField("length")}
                  onFocus={() => setFocused("boatLength")}
                  onBlur={() => setFocused(null)}
                  placeholder="e.g. 32"
                />
                {errors.boatLength && <div style={errorText}>{errors.boatLength}</div>}
              </div>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Beam (ft) *</label>
                <input
                  type="number"
                  style={{ ...inputStyle, ...focusStyle("boatBeam") }}
                  value={boat.beam}
                  onChange={setBoatField("beam")}
                  onFocus={() => setFocused("boatBeam")}
                  onBlur={() => setFocused(null)}
                  placeholder="e.g. 11"
                />
                {errors.boatBeam && <div style={errorText}>{errors.boatBeam}</div>}
              </div>
            </div>
            <div style={{ ...fieldRow, gap: spacing.sm }}>
              <button style={secondaryButton} onClick={back}>Back</button>
              <button style={primaryButton(accent)} onClick={next}>Continue</button>
            </div>
          </div>
        )}

        {/* ---- Step 2: Select Slip ---- */}
        {step === 2 && (
          <div>
            <p style={{ fontSize: "14px", color: colors.gray500, margin: `0 0 ${spacing.md}` }}>
              {matchingSlips.length
                ? `${matchingSlips.length} slip${matchingSlips.length !== 1 ? "s" : ""} available for your boat:`
                : "No slips match your boat dimensions. Please go back and adjust."}
            </p>
            {errors.slip && <div style={{ ...errorText, marginBottom: spacing.sm }}>{errors.slip}</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
              {matchingSlips.map((s) => {
                const sel = selectedSlip?.id === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => { setSelectedSlip(s); setErrors((p) => ({ ...p, slip: "" })); }}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: spacing.md,
                      borderRadius: radii.md,
                      border: `2px solid ${sel ? accent : colors.gray200}`,
                      background: sel ? `${accent}08` : colors.white,
                      cursor: "pointer",
                      transition: "border-color 0.15s ease",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: colors.navy }}>Slip {s.label}</div>
                      <div style={{ fontSize: "12px", color: colors.gray500 }}>
                        Max {s.maxLength}' x {s.maxBeam}' beam
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, color: accent }}>${s.nightlyRate}/night</div>
                      {s.weekendPremium > 0 && (
                        <div style={{ fontSize: "11px", color: colors.orange }}>
                          +${s.weekendPremium} weekend premium
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Price breakdown */}
            {selectedSlip && nights > 0 && (
              <div
                style={{
                  background: colors.gray50,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  marginTop: spacing.md,
                  fontSize: "14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span>{nights} night{nights !== 1 ? "s" : ""} x ${selectedSlip.nightlyRate}</span>
                  <span>${pricing.base.toFixed(2)}</span>
                </div>
                {pricing.weekendSurcharge > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", color: colors.orange }}>
                    <span>Weekend premium ({weekendNights} night{weekendNights !== 1 ? "s" : ""})</span>
                    <span>+${pricing.weekendSurcharge.toFixed(2)}</span>
                  </div>
                )}
                <hr style={{ border: "none", borderTop: `1px solid ${colors.gray200}`, margin: `${spacing.sm} 0` }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "16px" }}>
                  <span>Total</span>
                  <span style={{ color: accent }}>${pricing.total.toFixed(2)}</span>
                </div>
              </div>
            )}

            <div style={{ ...fieldRow, gap: spacing.sm, marginTop: spacing.lg }}>
              <button style={secondaryButton} onClick={back}>Back</button>
              <button
                style={{ ...primaryButton(accent), opacity: selectedSlip ? 1 : 0.5 }}
                disabled={!selectedSlip}
                onClick={next}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ---- Step 3: Guest Info & Payment ---- */}
        {step === 3 && (
          <div>
            <div style={fieldRow}>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>First Name *</label>
                <input
                  style={{ ...inputStyle, ...focusStyle("firstName") }}
                  value={guest.firstName}
                  onChange={setGuestField("firstName")}
                  onFocus={() => setFocused("firstName")}
                  onBlur={() => setFocused(null)}
                  placeholder="Jane"
                />
                {errors.firstName && <div style={errorText}>{errors.firstName}</div>}
              </div>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Last Name *</label>
                <input
                  style={{ ...inputStyle, ...focusStyle("lastName") }}
                  value={guest.lastName}
                  onChange={setGuestField("lastName")}
                  onFocus={() => setFocused("lastName")}
                  onBlur={() => setFocused(null)}
                  placeholder="Doe"
                />
                {errors.lastName && <div style={errorText}>{errors.lastName}</div>}
              </div>
            </div>
            <div style={fieldRow}>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Email *</label>
                <input
                  type="email"
                  style={{ ...inputStyle, ...focusStyle("email") }}
                  value={guest.email}
                  onChange={setGuestField("email")}
                  onFocus={() => setFocused("email")}
                  onBlur={() => setFocused(null)}
                  placeholder="jane@example.com"
                />
                {errors.email && <div style={errorText}>{errors.email}</div>}
              </div>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Phone *</label>
                <input
                  type="tel"
                  style={{ ...inputStyle, ...focusStyle("phone") }}
                  value={guest.phone}
                  onChange={setGuestField("phone")}
                  onFocus={() => setFocused("phone")}
                  onBlur={() => setFocused(null)}
                  placeholder="(555) 123-4567"
                />
                {errors.phone && <div style={errorText}>{errors.phone}</div>}
              </div>
            </div>

            {/* Stripe placeholder */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Card Details</label>
              <div
                style={{
                  padding: spacing.md,
                  border: `1px dashed ${colors.gray300}`,
                  borderRadius: radii.md,
                  background: colors.gray50,
                  color: colors.gray400,
                  fontSize: "13px",
                  textAlign: "center",
                }}
              >
                Stripe CardElement placeholder — integrate with{" "}
                <code style={{ fontFamily: fonts.mono }}>@stripe/react-stripe-js</code>
              </div>
            </div>

            {/* Final price summary */}
            {selectedSlip && (
              <div
                style={{
                  background: colors.gray50,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  marginBottom: spacing.md,
                  fontSize: "14px",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: spacing.sm, color: colors.navy }}>
                  Booking Summary
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span>Slip {selectedSlip.label} — {nights} night{nights !== 1 ? "s" : ""}</span>
                  <span>${pricing.base.toFixed(2)}</span>
                </div>
                {pricing.weekendSurcharge > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", color: colors.orange }}>
                    <span>Weekend premium</span>
                    <span>+${pricing.weekendSurcharge.toFixed(2)}</span>
                  </div>
                )}
                <hr style={{ border: "none", borderTop: `1px solid ${colors.gray200}`, margin: `${spacing.sm} 0` }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "16px" }}>
                  <span>Total</span>
                  <span style={{ color: accent }}>${pricing.total.toFixed(2)}</span>
                </div>
              </div>
            )}

            <div style={{ ...fieldRow, gap: spacing.sm }}>
              <button style={secondaryButton} onClick={back}>Back</button>
              <button
                style={{ ...primaryButton(accent), opacity: status === "loading" ? 0.7 : 1 }}
                disabled={status === "loading"}
                onClick={handleSubmit}
              >
                {status === "loading" ? "Processing..." : `Pay $${pricing.total.toFixed(2)}`}
              </button>
            </div>
          </div>
        )}

        <div style={poweredBy}>Powered by Helm</div>
      </div>
    </div>
  );
}
