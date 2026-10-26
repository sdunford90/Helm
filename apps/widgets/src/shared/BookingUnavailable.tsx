import { colors, fonts, radii, spacing } from "./styles";

interface BookingUnavailableProps {
  title: string;
  primaryColor?: string;
}

/**
 * Shown in place of a booking widget until its public booking API exists.
 * The widgets previously listed hard-coded slips and boats as available;
 * telling a boater something is bookable when it isn't is worse than saying
 * online booking isn't open yet.
 */
export default function BookingUnavailable({ title, primaryColor }: BookingUnavailableProps) {
  const accent = primaryColor ?? colors.cyan;
  return (
    <div
      role="status"
      style={{
        fontFamily: fonts.sans,
        border: `1px solid ${colors.gray200}`,
        borderTop: `4px solid ${accent}`,
        borderRadius: radii.lg,
        padding: spacing.lg,
        background: colors.white,
        color: colors.gray700,
        maxWidth: 480,
      }}
    >
      <h3 style={{ margin: 0, marginBottom: spacing.sm, color: colors.navy, fontSize: 18 }}>
        {title}
      </h3>
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        Online booking isn&apos;t available yet. Please call or email the marina to reserve.
      </p>
    </div>
  );
}
