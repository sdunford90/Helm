/** Helm design-system tokens shared across all embeddable widgets. */

export const colors = {
  navy: "#0f2b46",
  navyLight: "#1a3a5c",
  cyan: "#00bcd4",
  cyanLight: "#4dd0e1",
  cyanDark: "#0097a7",
  white: "#ffffff",
  offWhite: "#f7f9fb",
  gray50: "#f8fafc",
  gray100: "#f1f5f9",
  gray200: "#e2e8f0",
  gray300: "#cbd5e1",
  gray400: "#94a3b8",
  gray500: "#64748b",
  gray600: "#475569",
  gray700: "#334155",
  gray800: "#1e293b",
  green: "#22c55e",
  greenLight: "#dcfce7",
  red: "#ef4444",
  redLight: "#fee2e2",
  orange: "#f59e0b",
  orangeLight: "#fef3c7",
} as const;

export const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace',
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  xxl: "48px",
} as const;

export const radii = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.05)",
  md: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)",
  lg: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)",
  xl: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
} as const;

/* ------------------------------------------------------------------ */
/*  Reusable CSS-in-JS style objects                                  */
/* ------------------------------------------------------------------ */

export const baseContainer: React.CSSProperties = {
  fontFamily: fonts.sans,
  color: colors.gray800,
  lineHeight: 1.5,
  boxSizing: "border-box",
};

export const card: React.CSSProperties = {
  background: colors.white,
  borderRadius: radii.lg,
  boxShadow: shadows.md,
  padding: spacing.lg,
  border: `1px solid ${colors.gray200}`,
};

export const label: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: colors.gray700,
  marginBottom: spacing.xs,
};

export const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  fontFamily: fonts.sans,
  border: `1px solid ${colors.gray300}`,
  borderRadius: radii.md,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s ease",
};

export const inputFocus: React.CSSProperties = {
  borderColor: colors.cyan,
  boxShadow: `0 0 0 3px rgba(0,188,212,0.15)`,
};

export const primaryButton = (
  accent: string = colors.cyan
): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  padding: "12px 24px",
  fontSize: "15px",
  fontWeight: 600,
  fontFamily: fonts.sans,
  color: colors.white,
  background: accent,
  border: "none",
  borderRadius: radii.md,
  cursor: "pointer",
  transition: "background 0.15s ease, opacity 0.15s ease",
});

export const secondaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  padding: "12px 24px",
  fontSize: "15px",
  fontWeight: 600,
  fontFamily: fonts.sans,
  color: colors.gray700,
  background: colors.white,
  border: `1px solid ${colors.gray300}`,
  borderRadius: radii.md,
  cursor: "pointer",
  transition: "background 0.15s ease",
};

export const errorText: React.CSSProperties = {
  color: colors.red,
  fontSize: "13px",
  marginTop: spacing.xs,
};

export const successBox: React.CSSProperties = {
  background: colors.greenLight,
  border: `1px solid ${colors.green}`,
  borderRadius: radii.md,
  padding: spacing.md,
  color: colors.gray800,
  fontSize: "14px",
  textAlign: "center",
};

export const errorBox: React.CSSProperties = {
  background: colors.redLight,
  border: `1px solid ${colors.red}`,
  borderRadius: radii.md,
  padding: spacing.md,
  color: colors.gray800,
  fontSize: "14px",
  textAlign: "center",
};

export const stepIndicator = (
  totalSteps: number,
  currentStep: number,
  accent: string = colors.cyan
): React.CSSProperties[] => {
  const items: React.CSSProperties[] = [];
  for (let i = 0; i < totalSteps; i++) {
    items.push({
      width: "32px",
      height: "32px",
      borderRadius: radii.full,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "13px",
      fontWeight: 700,
      color: i <= currentStep ? colors.white : colors.gray400,
      background: i <= currentStep ? accent : colors.gray200,
      transition: "background 0.2s ease, color 0.2s ease",
    });
  }
  return items;
};

export const fieldRow: React.CSSProperties = {
  display: "flex",
  gap: spacing.md,
  flexWrap: "wrap",
};

export const fieldHalf: React.CSSProperties = {
  flex: "1 1 calc(50% - 8px)",
  minWidth: "180px",
};

export const fieldGroup: React.CSSProperties = {
  marginBottom: spacing.md,
};

export const poweredBy: React.CSSProperties = {
  textAlign: "center",
  fontSize: "11px",
  color: colors.gray400,
  marginTop: spacing.md,
};
