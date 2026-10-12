import { FACTOR_KEYS, SchedulerConfig } from './types.js';

const inUnit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

/** Returns a list of problems; an empty list means the configuration is valid. */
export function validateConfig(c: SchedulerConfig): string[] {
  const errs: string[] = [];
  let sum = 0;
  for (const k of FACTOR_KEYS) {
    const w = c.weights[k];
    if (!Number.isFinite(w) || w < 0) errs.push(`weight "${k}" must be a non-negative number`);
    else sum += w;
  }
  if (Math.abs(sum - 1) > 1e-6) errs.push(`weights must sum to 1 (currently ${sum})`);
  if (!(c.waitingTimeCapMinutes > 0)) errs.push('waitingTimeCapMinutes must be > 0');
  if (!(c.durationReferenceMinutes > 0)) errs.push('durationReferenceMinutes must be > 0');
  if (!(c.aging.rampMinutes > 0)) errs.push('aging.rampMinutes must be > 0');
  if (c.aging.graceMinutes < 0) errs.push('aging.graceMinutes must be >= 0');
  if (c.starvationThresholdMinutes < 0) errs.push('starvationThresholdMinutes must be >= 0');
  for (const [k, v] of Object.entries(c.urgencyScores)) {
    if (!inUnit(v)) errs.push(`urgencyScores.${k} must be within [0,1]`);
  }
  for (const [k, v] of Object.entries(c.demandScores)) {
    if (!inUnit(v)) errs.push(`demandScores.${k} must be within [0,1]`);
  }
  const t = c.demandThresholds;
  if (!(t.low >= 0 && t.low <= t.medium && t.medium <= t.high)) {
    errs.push('demandThresholds must satisfy 0 <= low <= medium <= high');
  }
  if (c.durationPolicy !== 'shorter' && c.durationPolicy !== 'longer') {
    errs.push('durationPolicy must be "shorter" or "longer"');
  }
  return errs;
}
