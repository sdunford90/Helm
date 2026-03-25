export const tokens = {
  colors: {
    navy: '#0A2342',
    cyan: '#00D4FF',
    slate: '#2E4A6B',
    white: '#FFFFFF',
    skyBlue: '#D6E8F4',
    offWhite: '#F7F9FB',
    lightGray: '#F2F4F6',
    border: '#CCCCCC',
    successBg: '#E8F5E9',
    successText: '#1B5E20',
    warningBg: '#FFF3CD',
    warningText: '#856404',
    alertBg: '#FDECEA',
    alertText: '#B71C1C',
    textPrimary: '#0A2342',
    textSecondary: '#2E4A6B',
    textMuted: '#444444',
  },
  typography: {
    fontFamily: {
      primary: 'Inter, system-ui, sans-serif',
      display: '"DM Serif Display", serif',
      mono: '"JetBrains Mono", monospace',
    },
    fontSize: {
      display: '56px',
      h1: '36px',
      h2: '28px',
      h3: '22px',
      bodyLarge: '18px',
      body: '15px',
      bodySmall: '13px',
      caption: '11px',
      mono: '14px',
    },
    fontWeight: {
      bold: 700,
      semibold: 600,
      regular: 400,
    },
    lineHeight: {
      heading: 1.2,
      body: 1.5,
    },
    letterSpacing: {
      heading: '-0.02em',
      body: '0',
      caps: '0.05em',
    },
  },
  spacing: {
    micro: '4px',
    tight: '8px',
    default: '16px',
    comfortable: '24px',
    loose: '32px',
    open: '48px',
    hero: '64px',
  },
  borderRadius: {
    small: '4px',
    default: '6px',
    large: '8px',
    pill: '9999px',
  },
  shadows: {
    card: '0 1px 3px rgba(0,0,0,0.08)',
    elevated: '0 4px 12px rgba(0,0,0,0.12)',
  },
} as const;

export type Tokens = typeof tokens;
