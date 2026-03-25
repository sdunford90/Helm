import React from 'react';
import { tokens } from '../styles/tokens';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const sizeStyles: Record<string, React.CSSProperties> = {
  sm: {
    padding: `${tokens.spacing.micro} ${tokens.spacing.default}`,
    fontSize: tokens.typography.fontSize.bodySmall,
  },
  md: {
    padding: `${tokens.spacing.tight} ${tokens.spacing.comfortable}`,
    fontSize: tokens.typography.fontSize.body,
  },
  lg: {
    padding: `12px ${tokens.spacing.loose}`,
    fontSize: tokens.typography.fontSize.bodyLarge,
  },
};

const variantStyles: Record<string, React.CSSProperties> = {
  primary: {
    backgroundColor: tokens.colors.navy,
    color: tokens.colors.white,
    border: 'none',
  },
  secondary: {
    backgroundColor: tokens.colors.white,
    color: tokens.colors.navy,
    border: `1px solid ${tokens.colors.navy}`,
  },
  destructive: {
    backgroundColor: tokens.colors.alertText,
    color: tokens.colors.white,
    border: 'none',
  },
};

const hoverColors: Record<string, string> = {
  primary: tokens.colors.cyan,
  secondary: tokens.colors.skyBlue,
  destructive: '#D32F2F',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, disabled, children, style, onMouseEnter, onMouseLeave, ...props }, ref) => {
    const [hovered, setHovered] = React.useState(false);

    const baseStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens.spacing.tight,
      fontFamily: tokens.typography.fontFamily.primary,
      fontWeight: tokens.typography.fontWeight.semibold,
      borderRadius: tokens.borderRadius.default,
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'background-color 0.15s ease, border-color 0.15s ease',
      lineHeight: tokens.typography.lineHeight.body,
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...(hovered && !disabled && !loading
        ? variant === 'primary'
          ? { backgroundColor: hoverColors.primary }
          : variant === 'secondary'
            ? { backgroundColor: hoverColors.secondary }
            : { backgroundColor: hoverColors.destructive }
        : {}),
      ...style,
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        style={baseStyle}
        onMouseEnter={(e) => {
          setHovered(true);
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          setHovered(false);
          onMouseLeave?.(e);
        }}
        {...props}
      >
        {loading && (
          <span
            style={{
              display: 'inline-block',
              width: '14px',
              height: '14px',
              border: '2px solid currentColor',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'helm-spin 0.6s linear infinite',
            }}
          />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
