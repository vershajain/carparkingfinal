export interface PenaltyConfig {
  graceMinutes: number;
  ratePerHour: number;
  currency: string;
  roundingMinutes: number;
}
export interface PenaltyBreakdown {
  expectedDeparture: string;
  actualExit: string;
  overstayMinutes: number;
  graceMinutes: number;
  chargeableMinutes: number; // overstay beyond the grace period
  billedMinutes: number; // chargeable rounded UP to the next block
  roundingMinutes: number;
  ratePerHour: number;
  currency: string;
  amount: number;
  formula: string; // human-readable calculation shown in the UI
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * overstay    = max(0, actualExit - expectedDeparture)           [minutes]
 * chargeable  = max(0, overstay - grace)
 * billed      = ceil(chargeable / block) * block                 (block = roundingMinutes; 0 = no rounding)
 * amount      = billed / 60 * ratePerHour
 * All values come from configuration - nothing is hard-coded.
 */
export function computePenalty(expected: Date, actual: Date, cfg: PenaltyConfig): PenaltyBreakdown {
  const overstay = Math.max(0, (actual.getTime() - expected.getTime()) / 60000);
  const chargeable = Math.max(0, overstay - cfg.graceMinutes);
  const billed = chargeable === 0 ? 0 : cfg.roundingMinutes > 0 ? Math.ceil(chargeable / cfg.roundingMinutes) * cfg.roundingMinutes : chargeable;
  const amount = r2((billed / 60) * cfg.ratePerHour);
  return {
    expectedDeparture: expected.toISOString(),
    actualExit: actual.toISOString(),
    overstayMinutes: r2(overstay),
    graceMinutes: cfg.graceMinutes,
    chargeableMinutes: r2(chargeable),
    billedMinutes: r2(billed),
    roundingMinutes: cfg.roundingMinutes,
    ratePerHour: cfg.ratePerHour,
    currency: cfg.currency,
    amount,
    formula:
      `overstay ${r2(overstay)} min - grace ${cfg.graceMinutes} min = ${r2(chargeable)} chargeable min; ` +
      `rounded up to ${cfg.roundingMinutes}-min blocks = ${r2(billed)} min; ` +
      `${r2(billed)} / 60 x ${cfg.ratePerHour} ${cfg.currency}/h = ${amount} ${cfg.currency}`,
  };
}
