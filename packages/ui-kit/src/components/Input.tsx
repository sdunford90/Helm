import React from 'react';
import { tokens } from '../styles/tokens';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  inputType?: 'text' | 'email' | 'number' | 'password';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, inputType = 'text', style, onFocus, onBlur, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);

    const wrapperStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.spacing.micro,
    };

    const labelStyle: React.CSSProperties = {
      fontSize: tokens.typography.fontSize.bodySmall,
      fontWeight: tokens.typography.fontWeight.semibold,
      color: tokens.colors.textSecondary,
      fontFamily: tokens.typography.fontFamily.primary,
    };

    const inputStyle: React.CSSProperties = {
      padding: `${tokens.spacing.tight} 12px`,
      fontSize: tokens.typography.fontSize.body,
      fontFamily: tokens.typography.fontFamily.primary,
      lineHeight: tokens.typography.lineHeight.body,
      border: `1px solid ${error ? tokens.colors.alertText : focused ? tokens.colors.slate : tokens.colors.border}`,
      borderRadius: tokens.borderRadius.small,
      outline: 'none',
      backgroundColor: tokens.colors.white,
      color: tokens.colors.textPrimary,
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      ...(focused && !error
        ? { boxShadow: `0 0 0 2px ${tokens.colors.slate}33` }
        : {}),
      ...(error
        ? { boxShadow: `0 0 0 2px ${tokens.colors.alertText}33` }
        : {}),
      ...style,
    };

    const errorStyle: React.CSSProperties = {
      fontSize: tokens.typography.fontSize.bodySmall,
      color: tokens.colors.alertText,
      fontFamily: tokens.typography.fontFamily.primary,
    };

    return (
      <div style={wrapperStyle}>
        {label && <label style={labelStyle}>{label}</label>}
        <input
          ref={ref}
          type={inputType}
          style={inputStyle}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {error && <span style={errorStyle}>{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
