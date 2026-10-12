import { validateReservation } from './reservation.js';
import { FactorValues, FACTOR_KEYS, RequestView, SchedulerConfig, ScoreBreakdown } from './types.js';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export const waitingMinutes = (req: RequestView, now: Date) =>
  Math.max(0, (now.getTime() - req.arrivalTime.getTime()) / 60_000);

/** W = min(waiting / cap, 1) */
export const waitingFactor = (wait: number, cfg: SchedulerConfig) =>
  clamp01(wait / cfg.waitingTimeCapMinutes);

/** U = configured score for the VERIFIED urgency category */
export const urgencyFactor = (req: RequestView, cfg: SchedulerConfig) => clamp01(cfg.urgencyScores[req.urgency]);

/**
 * D: system pressure. ratio = waitingRequests / max(eligibleSlotsForThisRequest, 1).
 * ratio >= high -> demandScores.high; >= medium -> .medium; >= low -> .low; else 0.
 * Requests with fewer eligible slots see higher demand (they are the scarcer case).
 */
export function demandFactor(waitingCount: number, eligibleSlotCount: number, cfg: SchedulerConfig) {
  const ratio = waitingCount / Math.max(eligibleSlotCount, 1);
  const { low, medium, high } = cfg.demandThresholds;
  if (ratio >= high) return clamp01(cfg.demandScores.high);
  if (ratio >= medium) return clamp01(cfg.demandScores.medium);
  if (ratio >= low) return clamp01(cfg.demandScores.low);
  return 0;
}

/**
 * T: x = min(duration / reference, 1).
 * Policy 'shorter' (default): T = 1 - x. Short stays free slots sooner, which helps throughput
 *   and average waiting time (shortest-job-first idea). Long stays are NOT assumed more deserving.
 * Policy 'longer': T = x.
 */
export function durationFactor(minutes: number, cfg: SchedulerConfig) {
  const x = clamp01(minutes / cfg.durationReferenceMinutes);
  return cfg.durationPolicy === 'shorter' ? 1 - x : x;
}

/** R = 1 only for a reservation that passes validateReservation(); otherwise 0. */
export const reservationFactor = (req: RequestView, now: Date, cfg: SchedulerConfig) =>
  validateReservation(req.reservation, req.registration, now, cfg).valid ? 1 : 0;

/**
 * F (aging): F = min(max(waiting - graceMinutes, 0) / rampMinutes, 1).
 * The grace period means F stays 0 while W is already rising, so waiting time is not
 * double-counted early on; F only adds extra pull for requests that have waited unusually long.
 */
export function fairnessFactor(wait: number, cfg: SchedulerConfig) {
  return clamp01(Math.max(wait - cfg.aging.graceMinutes, 0) / cfg.aging.rampMinutes);
}

/** PriorityScore = 100 x (wW*W + wU*U + wD*D + wT*T + wR*R + wS*S + wF*F) */
export function combine(f: FactorValues, cfg: SchedulerConfig): ScoreBreakdown {
  const contributions = {} as FactorValues;
  let total = 0;
  for (const k of FACTOR_KEYS) {
    contributions[k] = round6(100 * cfg.weights[k] * f[k]);
    total += 100 * cfg.weights[k] * f[k];
  }
  return { factors: f, weights: cfg.weights, contributions, priorityScore: round6(total) };
}

export interface FactorContext {
  waitingCount: number;
  eligibleSlotCount: number;
  bestSlotScore: number; // S: best suitability among eligible slots (0 if none)
}

export function computeScore(req: RequestView, ctx: FactorContext, cfg: SchedulerConfig, now: Date): ScoreBreakdown {
  const wait = waitingMinutes(req, now);
  const factors: FactorValues = {
    waiting: round6(waitingFactor(wait, cfg)),
    urgency: round6(urgencyFactor(req, cfg)),
    demand: round6(demandFactor(ctx.waitingCount, ctx.eligibleSlotCount, cfg)),
    duration: round6(durationFactor(req.expectedDurationMinutes, cfg)),
    reservation: reservationFactor(req, now, cfg),
    suitability: round6(clamp01(ctx.bestSlotScore)),
    fairness: round6(fairnessFactor(wait, cfg)),
  };
  return combine(factors, cfg);
}
