import React from 'react';
import { tokens } from '../styles/tokens';

export interface CardProps {
  title?: string;
  accent?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ title, accent = false, children, style }) => {
  const cardStyle: React.CSSProperties = {
    backgroundColor: tokens.colors.white,
    border: `1px solid ${tokens.colors.border}`,
    borderRadius: tokens.borderRadius.large,
    padding: tokens.spacing.comfortable,
    boxShadow: tokens.shadows.card,
    ...(accent ? { borderTop: `3px solid ${tokens.colors.cyan}` } : {}),
    ...style,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: tokens.typography.fontSize.h3,
    fontWeight: tokens.typography.fontWeight.bold,
    color: tokens.colors.navy,
    marginBottom: tokens.spacing.default,
    lineHeight: tokens.typography.lineHeight.heading,
  };

  return (
    <div style={cardStyle}>
      {title && <h3 style={titleStyle}>{title}</h3>}
      {children}
    </div>
  );
};

Card.displayName = 'Card';
