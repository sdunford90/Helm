import React from 'react';
import { tokens } from '../styles/tokens';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ open, title, onClose, children, footer }) => {
  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: tokens.spacing.comfortable,
  };

  const dialogStyle: React.CSSProperties = {
    backgroundColor: tokens.colors.white,
    borderRadius: tokens.borderRadius.large,
    boxShadow: tokens.shadows.elevated,
    maxWidth: '640px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderTop: `3px solid ${tokens.colors.cyan}`,
  };

  const headerStyle: React.CSSProperties = {
    backgroundColor: tokens.colors.navy,
    color: tokens.colors.white,
    padding: `${tokens.spacing.default} ${tokens.spacing.comfortable}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontFamily: tokens.typography.fontFamily.primary,
    fontWeight: tokens.typography.fontWeight.bold,
    fontSize: tokens.typography.fontSize.bodyLarge,
  };

  const closeBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: tokens.colors.white,
    fontSize: '20px',
    cursor: 'pointer',
    padding: tokens.spacing.micro,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const bodyStyle: React.CSSProperties = {
    padding: tokens.spacing.comfortable,
    overflowY: 'auto',
    flex: 1,
  };

  const footerStyle: React.CSSProperties = {
    padding: `${tokens.spacing.default} ${tokens.spacing.comfortable}`,
    borderTop: `1px solid ${tokens.colors.border}`,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: tokens.spacing.tight,
  };

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={title}>
        <div style={headerStyle}>
          <span>{title}</span>
          <button style={closeBtnStyle} onClick={onClose} aria-label="Close modal">
            &#x2715;
          </button>
        </div>
        <div style={bodyStyle}>{children}</div>
        {footer && <div style={footerStyle}>{footer}</div>}
      </div>
    </div>
  );
};

Modal.displayName = 'Modal';
