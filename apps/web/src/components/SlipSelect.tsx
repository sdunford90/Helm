import { useList } from '../hooks/useApi';

export interface SlipOption {
  id: string;
  slipNumber: string;
  lengthFt?: number | null;
  beamFt?: number | null;
  status?: string;
}

/**
 * <select> over real slips from GET /slips (vacant by default). The value is
 * the slip id (uuid), never a display label.
 */
export default function SlipSelect({
  value,
  onChange,
  style,
  status = 'VACANT',
  minLengthFt,
}: {
  value: string;
  onChange: (slipId: string, slip: SlipOption | null) => void;
  style?: React.CSSProperties;
  status?: 'VACANT' | 'OCCUPIED' | 'MAINTENANCE' | 'RESERVED' | null;
  minLengthFt?: number | null;
}) {
  const path = `/slips?take=200${status ? `&status=${status}` : ''}`;
  const slips = useList<SlipOption>(path);
  const options = slips.items.filter((s) => !minLengthFt || !s.lengthFt || s.lengthFt >= minLengthFt);
  return (
    <>
      <select
        style={style}
        value={value}
        disabled={slips.loading || !!slips.error}
        onChange={(e) => onChange(e.target.value, options.find((s) => s.id === e.target.value) ?? null)}
      >
        <option value="">
          {slips.loading
            ? 'Loading slips…'
            : slips.error
              ? 'Could not load slips'
              : options.length === 0
                ? `No ${status ? status.toLowerCase() + ' ' : ''}slips${minLengthFt ? ` for a ${minLengthFt}' boat` : ''}`
                : 'Select slip...'}
        </option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.slipNumber}
            {s.lengthFt ? ` (${s.lengthFt}')` : ''}
          </option>
        ))}
      </select>
      {slips.error && <div style={{ fontSize: 12, color: '#B71C1C', marginTop: 4 }}>{slips.error}</div>}
    </>
  );
}
