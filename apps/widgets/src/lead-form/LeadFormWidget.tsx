import React, { useState, useCallback, useMemo } from "react";
import { createApiClient, type ApiClient } from "../shared/api";
import {
  colors,
  baseContainer,
  card,
  label as labelStyle,
  input as inputStyle,
  inputFocus,
  primaryButton,
  fieldRow,
  fieldHalf,
  fieldGroup,
  successBox,
  errorBox,
  errorText,
  poweredBy,
  fonts,
  spacing,
  radii,
} from "../shared/styles";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type FormType = "slip-inquiry" | "rental-inquiry" | "waitlist" | "general";

export interface LeadFormWidgetProps {
  tenantId: string;
  formId: string;
  formType: FormType;
  primaryColor?: string;
  hostElement: HTMLElement;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  boatLength: string;
  slipType: string;
  message: string;
}

const INITIAL_STATE: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  boatLength: "",
  slipType: "",
  message: "",
};

const FORM_TYPE_TITLES: Record<FormType, string> = {
  "slip-inquiry": "Slip Inquiry",
  "rental-inquiry": "Rental Inquiry",
  waitlist: "Join the Waitlist",
  general: "Contact Us",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function useInputFocus() {
  const [focused, setFocused] = useState<string | null>(null);
  return { focused, onFocus: setFocused, onBlur: () => setFocused(null) };
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function LeadFormWidget({
  formId,
  formType,
  primaryColor,
  hostElement,
}: LeadFormWidgetProps) {
  const accent = primaryColor ?? colors.cyan;
  const api: ApiClient = useMemo(
    () => createApiClient(hostElement),
    [hostElement]
  );

  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [serverError, setServerError] = useState("");
  const { focused, onFocus, onBlur } = useInputFocus();

  const set = useCallback(
    (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((p) => ({ ...p, [field]: e.target.value }));
      setErrors((p) => ({ ...p, [field]: undefined }));
    },
    []
  );

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.firstName.trim()) next.firstName = "First name is required";
    if (!form.lastName.trim()) next.lastName = "Last name is required";
    if (!form.email.trim()) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      next.email = "Enter a valid email";
    if (!form.phone.trim()) next.phone = "Phone number is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setStatus("loading");
    setServerError("");

    // reCAPTCHA v3 placeholder — in production this would call grecaptcha.execute()
    const recaptchaToken = "recaptcha-placeholder-token";

    const { error } = await api.post(`/api/lead-forms/${formId}/submit`, {
      ...form,
      formType,
      recaptchaToken,
    });

    if (error) {
      setStatus("error");
      setServerError(error);
    } else {
      setStatus("success");
    }
  };

  /* ---------- Render ---------- */

  const inputStyleFor = (name: string): React.CSSProperties => ({
    ...inputStyle,
    ...(focused === name ? { ...inputFocus, borderColor: accent, boxShadow: `0 0 0 3px ${accent}26` } : {}),
  });

  if (status === "success") {
    return (
      <div style={{ ...baseContainer, maxWidth: "540px", margin: "0 auto" }}>
        <div style={card}>
          <div style={successBox}>
            <div style={{ fontSize: "28px", marginBottom: spacing.sm }}>&#10003;</div>
            <strong>Thank you!</strong>
            <p style={{ margin: `${spacing.sm} 0 0` }}>
              Your inquiry has been submitted. We'll be in touch shortly.
            </p>
          </div>
          <div style={poweredBy}>Powered by Helm</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...baseContainer, maxWidth: "540px", margin: "0 auto" }}>
      <div style={card}>
        {/* Header */}
        <div style={{ marginBottom: spacing.lg }}>
          <h2
            style={{
              margin: 0,
              fontSize: "20px",
              fontWeight: 700,
              color: colors.navy,
              fontFamily: fonts.sans,
            }}
          >
            {FORM_TYPE_TITLES[formType] ?? "Contact Us"}
          </h2>
          <p
            style={{
              margin: `${spacing.xs} 0 0`,
              fontSize: "14px",
              color: colors.gray500,
            }}
          >
            Fill out the form below and we'll get back to you as soon as
            possible.
          </p>
        </div>

        {status === "error" && serverError && (
          <div style={{ ...errorBox, marginBottom: spacing.md }}>
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Name row */}
          <div style={fieldRow}>
            <div style={{ ...fieldHalf, ...fieldGroup }}>
              <label style={labelStyle}>First Name *</label>
              <input
                style={inputStyleFor("firstName")}
                value={form.firstName}
                onChange={set("firstName")}
                onFocus={() => onFocus("firstName")}
                onBlur={onBlur}
                placeholder="Jane"
              />
              {errors.firstName && <div style={errorText}>{errors.firstName}</div>}
            </div>
            <div style={{ ...fieldHalf, ...fieldGroup }}>
              <label style={labelStyle}>Last Name *</label>
              <input
                style={inputStyleFor("lastName")}
                value={form.lastName}
                onChange={set("lastName")}
                onFocus={() => onFocus("lastName")}
                onBlur={onBlur}
                placeholder="Doe"
              />
              {errors.lastName && <div style={errorText}>{errors.lastName}</div>}
            </div>
          </div>

          {/* Email + Phone */}
          <div style={fieldRow}>
            <div style={{ ...fieldHalf, ...fieldGroup }}>
              <label style={labelStyle}>Email *</label>
              <input
                type="email"
                style={inputStyleFor("email")}
                value={form.email}
                onChange={set("email")}
                onFocus={() => onFocus("email")}
                onBlur={onBlur}
                placeholder="jane@example.com"
              />
              {errors.email && <div style={errorText}>{errors.email}</div>}
            </div>
            <div style={{ ...fieldHalf, ...fieldGroup }}>
              <label style={labelStyle}>Phone *</label>
              <input
                type="tel"
                style={inputStyleFor("phone")}
                value={form.phone}
                onChange={set("phone")}
                onFocus={() => onFocus("phone")}
                onBlur={onBlur}
                placeholder="(555) 123-4567"
              />
              {errors.phone && <div style={errorText}>{errors.phone}</div>}
            </div>
          </div>

          {/* Optional fields for slip / rental inquiries */}
          {(formType === "slip-inquiry" || formType === "waitlist") && (
            <div style={fieldRow}>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Boat Length (ft)</label>
                <input
                  type="number"
                  style={inputStyleFor("boatLength")}
                  value={form.boatLength}
                  onChange={set("boatLength")}
                  onFocus={() => onFocus("boatLength")}
                  onBlur={onBlur}
                  placeholder="e.g. 32"
                />
              </div>
              <div style={{ ...fieldHalf, ...fieldGroup }}>
                <label style={labelStyle}>Slip Type</label>
                <select
                  style={inputStyleFor("slipType")}
                  value={form.slipType}
                  onChange={set("slipType")}
                  onFocus={() => onFocus("slipType")}
                  onBlur={onBlur}
                >
                  <option value="">Select...</option>
                  <option value="wet">Wet Slip</option>
                  <option value="dry">Dry Storage</option>
                  <option value="mooring">Mooring</option>
                  <option value="end-tie">End Tie</option>
                </select>
              </div>
            </div>
          )}

          {/* Message */}
          <div style={fieldGroup}>
            <label style={labelStyle}>Message</label>
            <textarea
              rows={4}
              style={{
                ...inputStyleFor("message"),
                resize: "vertical" as const,
              }}
              value={form.message}
              onChange={set("message")}
              onFocus={() => onFocus("message")}
              onBlur={onBlur}
              placeholder="Tell us about your needs..."
            />
          </div>

          {/* reCAPTCHA notice */}
          <p
            style={{
              fontSize: "11px",
              color: colors.gray400,
              margin: `0 0 ${spacing.md}`,
            }}
          >
            This form is protected by reCAPTCHA.
          </p>

          {/* Submit */}
          <button
            type="submit"
            disabled={status === "loading"}
            style={{
              ...primaryButton(accent),
              opacity: status === "loading" ? 0.7 : 1,
            }}
          >
            {status === "loading" ? "Submitting..." : "Submit"}
          </button>
        </form>

        <div style={poweredBy}>Powered by Helm</div>
      </div>
    </div>
  );
}
