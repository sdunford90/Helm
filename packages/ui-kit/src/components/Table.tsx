import React from 'react';
import { tokens } from '../styles/tokens';

export interface TableColumn<T = Record<string, unknown>> {
  key: string;
  header: string;
  isMoney?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
}

export interface TableProps<T = Record<string, unknown>> {
  columns: TableColumn<T>[];
  data: T[];
  onRowClick?: (row: T, index: number) => void;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
}: TableProps<T>) {
  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: tokens.typography.fontFamily.primary,
    fontSize: tokens.typography.fontSize.body,
  };

  const headerCellStyle: React.CSSProperties = {
    backgroundColor: tokens.colors.navy,
    color: tokens.colors.white,
    padding: `12px ${tokens.spacing.default}`,
    textAlign: 'left',
    fontWeight: tokens.typography.fontWeight.semibold,
    fontSize: tokens.typography.fontSize.bodySmall,
    letterSpacing: tokens.typography.letterSpacing.caps,
    textTransform: 'uppercase',
  };

  const getCellStyle = (rowIndex: number, isMoney?: boolean): React.CSSProperties => ({
    padding: `12px ${tokens.spacing.default}`,
    backgroundColor: rowIndex % 2 === 0 ? tokens.colors.white : tokens.colors.skyBlue,
    borderBottom: `1px solid ${tokens.colors.lightGray}`,
    ...(isMoney
      ? {
          fontFamily: tokens.typography.fontFamily.mono,
          fontSize: tokens.typography.fontSize.mono,
          fontVariantNumeric: 'tabular-nums' as const,
        }
      : {}),
  });

  const rowStyle: React.CSSProperties = {
    cursor: onRowClick ? 'pointer' : 'default',
    transition: 'background-color 0.1s ease',
  };

  return (
    <div style={{ overflowX: 'auto', borderRadius: tokens.borderRadius.large, border: `1px solid ${tokens.colors.border}` }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={headerCellStyle}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              style={rowStyle}
              onClick={() => onRowClick?.(row, rowIndex)}
            >
              {columns.map((col) => (
                <td key={col.key} style={getCellStyle(rowIndex, col.isMoney)}>
                  {col.render
                    ? col.render(row[col.key], row)
                    : (row[col.key] as React.ReactNode)}
                </td>
              ))}
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: tokens.spacing.open,
                  textAlign: 'center',
                  color: tokens.colors.textMuted,
                }}
              >
                No data available
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

Table.displayName = 'Table';
