import React, { useState, useMemo, useCallback, useEffect } from "react";
import { createApiClient, type ApiClient } from "../shared/api";
import {
  colors,
  fonts,
  spacing,
  radii,
  shadows,
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

export interface RentalBookingWidgetProps {
  tenantId: string;
  primaryColor?: string;
  hostElement: HTMLElement;
}

interface Product {
  id: string;
  name: string;
  description: string;
  capacity: number;
  hourlyRate: number;
  dailyRate: number;
  imageUrl: string | null;
}

interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/* ------------------------------------------------------------------ */
/*  API product shape                                                  */
/* ------------------------------------------------------------------ */

interface ApiRentalProduct {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  basePriceCents: number;
  hourlyRateCents?: number | null;
  dailyRateCents?: number | null;
  active: boolean;
}

function mapApiProduct(p: ApiRentalProduct): Product {
  const hourlyRate = p.hourlyRateCents ? p.hourlyRateCents / 100 : p.basePriceCents / 100;
  const dailyRate = p.dailyRateCents ? p.dailyRateCents / 100 : hourlyRate * 8;
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? p.category ?? '',
    capacity: 4,
    hourlyRate,
    dailyRate,
    imageUrl: null,
  };
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const STEPS = ["Select Boat", "Date & Time", "Your Info", "Review & Pay"];

function StepBar({
  current,
  accent,
}: {
  current: number;
  accent: string;
}) {
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
/*  Main Widget                                                        */
/* ------------------------------------------------------------------ */

export default function RentalBookingWidget({
  primaryColor,
  hostElement,
}: RentalBookingWidgetProps) {
  const accent = primaryColor ?? colors.cyan;
  const api: ApiClient = useMemo(() => createApiClient(hostElement), [hostElement]);

  const [step, setStep] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [apiProducts, setApiProducts] = useState<Product[]>([]);

  useEffect(() => {
    api.get<{ data: ApiRentalProduct[] }>("/api/rentals/products").then(({ data }) => {
      if (data?.data && data.data.length > 0) {
        setApiProducts(data.data.filter((p) => p.active).map(mapApiProduct));
      }
    }).catch(() => {});
  }, [api]);

  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState<"hourly" | "daily">("hourly");
  const [hours, setHours] = useState("2");
  const [customer, setCustomer] = useState<CustomerInfo>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [promoCode, setPromoCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const focusStyle = (name: string): React.CSSProperties =>
    focused === name
      ? { ...inputFocus, borderColor: accent, boxShadow: `0 0 0 3px ${accent}26` }
      : {};

  const setCustomerField = useCallback(
    (field: keyof CustomerInfo) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setCustomer((p) => ({ ...p, [field]: e.target.value }));
        setErrors((p) => ({ ...p, [field]: "" }));
      },
    []
  );

  /* Price calculation */
  const price = useMemo(() => {
    if (!selectedProduct) return 0;
    if (duration === "daily") return selectedProduct.dailyRate;
    return selectedProduct.hourlyRate * Number(hours || 0);
  }, [selectedProduct, duration, hours]);

  /* Validation per step */
  const validateStep = (): boolean => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      if (!date) errs.date = "Please select a date";
      if (!startTime) errs.startTime = "Please select a start time";
    }
    if (step === 2) {
      if (!customer.firstName.trim()) errs.firstName = "Required";
      if (!customer.lastName.trim()) errs.lastName = "Required";
      if (!customer.email.trim()) errs.email = "Required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))
        errs.email = "Invalid email";
      if (!customer.phone.trim()) errs.phone = "Required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (validateStep()) setStep((s) => Math.min(s + 1, 3));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    setStatus("loading");
    setErrorMsg("");

    const { error } = await api.post("/api/rentals/reservations", {
      productId: selectedProduct?.id,
      date,
      startTime,
      duration,
      hours: duration === "hourly" ? Number(hours) : null,
      customer,
      promoCode: promoCode || undefined,
      totalPrice: price,
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
            <strong>Booking Confirmed!</strong>
            <p style={{ margin: `${spacing.sm} 0 0` }}>
              You'll receive a confirmation email at{" "}
              <strong>{customer.email}</strong> shortly.
            </p>
          </div>
          <div style={poweredBy}>Powered by Helm</div>
        </div>
      </div>
    );
  }

  /* ---------- Main ---------- */
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
          Book a Rental
        </h2>

        <StepBar current={step} accent={accent} />

        {status === "error" && errorMsg && (
          <div style={{ ...errorBox, marginBottom: spacing.md }}>{errorMsg}</div>
        )}

        {/* ---- Step 0: Select Product ---- */}
        {step === 0 && (
          <div>
            <p style={{ fontSize: "14px", color: colors.gray500, margin: `0 0 ${spacing.md}` }}>
              Choose from our available boats and watercraft:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              {apiProducts.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: '#94A3B8', fontSize: '14px' }}>Loading products...</div>
              )}
              {apiProducts.map((p) => {
                const isSelected = selectedProduct?.id === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProduct(p)}
                    style={{
                      display: "flex",
                      gap: spacing.md,
                      padding: spacing.md,
                      borderRadius: radii.md,
                      border: `2px solid ${isSelected ? accent : colors.gray200}`,
                      background: isSelected ? `${accent}08` : colors.white,
                      cursor: "pointer",
                      transition: "border-color 0.15s ease",
                    }}
                  >
                    {/* Photo placeholder */}
                    <div
                      style={{
                        width: "80px",
                        height: "80px",
                        borderRadius: radii.md,
                        background: colors.gray100,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "24px",
                        color: colors.gray400,
                      }}
                    >
                      &#9973;
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "15px", color: colors.navy }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: "13px", color: colors.gray500, margin: `2px 0 ${spacing.xs}` }}>
                        {p.description}
                      </div>
                      <div style={{ fontSize: "13px", color: colors.gray600 }}>
                        <span style={{ marginRight: spacing.md }}>Capacity: {p.capacity}</span>
                        <strong>${p.hourlyRate}/hr</strong>
                        <span style={{ margin: `0 ${spacing.xs}`, color: colors.gray300 }}>|</span>
                        <strong>${p.dailyRate}/day</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              style={{
                ...primaryButton(accent),
                marginTop: spacing.lg,
                opacity: selectedProduct ? 1 : 0.5,
              }}
              disabled={!selectedProduct}
              onClick={next}
            >
              Continue
            </button>
          </div>
        )}

        {/* ---- Step 1: Date & Time ---- */}
        {step === 1 && (
          <div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Date *</label>
              <input
                type="date"
                style={{ ...inputStyle, ...focusStyle("date") }}
                value={date}
                onChange={(e) => { setDate(e.target.value); setErrors((p) => ({ ...p, date: "" })); }}
                onFocus={() => setFocused("date")}
                onBlur={() => setFocused(null)}
              />
              {errors.date && <div style={errorText}>{errors.date}</div>}
            </div>

            <div style={fieldRow}>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Start Time *</label>
                <select
                  style={{ ...inputStyle, ...focusStyle("startTime") }}
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); setErrors((p) => ({ ...p, startTime: "" })); }}
                  onFocus={() => setFocused("startTime")}
                  onBlur={() => setFocused(null)}
                >
                  <option value="">Select time...</option>
                  {["8:00 AM","9:00 AM","10:00 AM","11:00 AM","12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM"].map(
                    (t) => <option key={t} value={t}>{t}</option>
                  )}
                </select>
                {errors.startTime && <div style={errorText}>{errors.startTime}</div>}
              </div>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Duration Type</label>
                <select
                  style={{ ...inputStyle, ...focusStyle("duration") }}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as "hourly" | "daily")}
                  onFocus={() => setFocused("duration")}
                  onBlur={() => setFocused(null)}
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Full Day</option>
                </select>
              </div>
            </div>

            {duration === "hourly" && (
              <div style={fieldGroup}>
                <label style={labelStyle}>Number of Hours</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  style={{ ...inputStyle, ...focusStyle("hours"), maxWidth: "120px" }}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  onFocus={() => setFocused("hours")}
                  onBlur={() => setFocused(null)}
                />
              </div>
            )}

            {/* Availability placeholder */}
            <div
              style={{
                background: colors.greenLight,
                borderRadius: radii.md,
                padding: spacing.sm,
                fontSize: "13px",
                color: colors.gray700,
                marginBottom: spacing.md,
              }}
            >
              &#9989; Available at the selected time
            </div>

            <div style={{ ...fieldRow, gap: spacing.sm }}>
              <button style={secondaryButton} onClick={back}>Back</button>
              <button style={primaryButton(accent)} onClick={next}>Continue</button>
            </div>
          </div>
        )}

        {/* ---- Step 2: Customer Info ---- */}
        {step === 2 && (
          <div>
            <div style={fieldRow}>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>First Name *</label>
                <input
                  style={{ ...inputStyle, ...focusStyle("firstName") }}
                  value={customer.firstName}
                  onChange={setCustomerField("firstName")}
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
                  value={customer.lastName}
                  onChange={setCustomerField("lastName")}
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
                  value={customer.email}
                  onChange={setCustomerField("email")}
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
                  value={customer.phone}
                  onChange={setCustomerField("phone")}
                  onFocus={() => setFocused("phone")}
                  onBlur={() => setFocused(null)}
                  placeholder="(555) 123-4567"
                />
                {errors.phone && <div style={errorText}>{errors.phone}</div>}
              </div>
            </div>
            <div style={{ ...fieldRow, gap: spacing.sm }}>
              <button style={secondaryButton} onClick={back}>Back</button>
              <button style={primaryButton(accent)} onClick={next}>Continue</button>
            </div>
          </div>
        )}

        {/* ---- Step 3: Review & Pay ---- */}
        {step === 3 && (
          <div>
            {/* Summary */}
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
                <span>{selectedProduct?.name}</span>
                <span style={{ fontWeight: 600 }}>
                  {duration === "daily"
                    ? `$${selectedProduct?.dailyRate} (full day)`
                    : `$${selectedProduct?.hourlyRate} x ${hours} hrs`}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span>Date</span>
                <span>{date || "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span>Time</span>
                <span>{startTime || "—"}</span>
              </div>
              <hr style={{ border: "none", borderTop: `1px solid ${colors.gray200}`, margin: `${spacing.sm} 0` }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "16px" }}>
                <span>Total</span>
                <span style={{ color: accent }}>${price.toFixed(2)}</span>
              </div>
            </div>

            {/* Price lock notice */}
            <div
              style={{
                background: colors.orangeLight,
                borderRadius: radii.md,
                padding: spacing.sm,
                fontSize: "12px",
                color: colors.gray700,
                marginBottom: spacing.md,
                textAlign: "center",
              }}
            >
              &#128274; Price locked for 15 minutes
            </div>

            {/* Promo Code */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Promo Code</label>
              <input
                style={{ ...inputStyle, ...focusStyle("promo"), maxWidth: "220px" }}
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                onFocus={() => setFocused("promo")}
                onBlur={() => setFocused(null)}
                placeholder="Enter code"
              />
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

            <div style={{ ...fieldRow, gap: spacing.sm }}>
              <button style={secondaryButton} onClick={back}>Back</button>
              <button
                style={{ ...primaryButton(accent), opacity: status === "loading" ? 0.7 : 1 }}
                disabled={status === "loading"}
                onClick={handleSubmit}
              >
                {status === "loading" ? "Processing..." : `Pay $${price.toFixed(2)}`}
              </button>
            </div>
          </div>
        )}

        <div style={poweredBy}>Powered by Helm</div>
      </div>
    </div>
  );
}
