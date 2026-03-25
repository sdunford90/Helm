import React from 'react';
import { tokens } from '../styles/tokens';

export type StatusType =
  | 'paid'
  | 'compliant'
  | 'pending'
  | 'expiring'
  | 'overdue'
  | 'expired'
  | 'failed'
  | 'active'
  | 'inactive';

export interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  style?: React.CSSProperties;
}

const statusColorMap: Record<StatusType, { bg: string; text: string }> = {
  paid: { bg: tokens.colors.successBg, text: tokens.colors.successText },
  compliant: { bg: tokens.colors.successBg, text: tokens.colors.successText },
  pending: { bg: tokens.colors.warningBg, text: tokens.colors.warningText },
  expiring: { bg: tokens.colors.warningBg, text: tokens.colors.warningText },
  overdue: { bg: tokens.colors.alertBg, text: tokens.colors.alertText },
  expired: { bg: tokens.colors.alertBg, text: tokens.colors.alertText },
  failed: { bg: tokens.colors.alertBg, text: tokens.colors.alertText },
  active: { bg: tokens.colors.navy, text: tokens.colors.white },
  inactive: { bg: tokens.colors.lightGray, text: tokens.colors.textMuted },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, style }) => {
  const colors = statusColorMap[status];
  const displayLabel = label ?? status.charAt(0).toUpperCase() + status.slice(1);

  const badgeStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: `${tokens.spacing.micro} 12px`,
    fontSize: tokens.typography.fontSize.bodySmall,
    fontWeight: tokens.typography.fontWeight.semibold,
    fontFamily: tokens.typography.fontFamily.primary,
    lineHeight: tokens.typography.lineHeight.body,
    borderRadius: tokens.borderRadius.pill,
    backgroundColor: colors.bg,
    color: colors.text,
    whiteSpace: 'nowrap',
    ...style,
  };

  return <span style={badgeStyle}>{displayLabel}</span>;
};

StatusBadge.displayName = 'StatusBadge';
