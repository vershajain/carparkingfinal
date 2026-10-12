import { ReservationView, SchedulerConfig } from './types.js';

const MIN = 60_000;

export interface ReservationCheck {
  valid: boolean;
  reason: string;
}

/**
 * A reservation grants a benefit only when ALL hold:
 *  - status is 'active' (not used / cancelled / expired)
 *  - it belongs to the requesting vehicle
 *  - now is inside the CLAIM WINDOW: [start - earlyArrival, start + lateArrival]
 *    (after start + lateArrival the hold is treated as a no-show), and now < endTime
 */
export function validateReservation(
  r: ReservationView | null,
  registration: string,
  now: Date,
  cfg: Pick<SchedulerConfig, 'reservation'>,
): ReservationCheck {
  if (!r) return { valid: false, reason: 'no reservation' };
  if (r.status !== 'active') return { valid: false, reason: `reservation is ${r.status}` };
  if (r.registration.toUpperCase() !== registration.toUpperCase()) {
    return { valid: false, reason: 'reservation belongs to another vehicle' };
  }
  const t = now.getTime();
  const opens = r.startTime.getTime() - cfg.reservation.earlyArrivalMinutes * MIN;
  const claimDeadline = r.startTime.getTime() + cfg.reservation.lateArrivalMinutes * MIN;
  if (t >= r.endTime.getTime()) return { valid: false, reason: 'reservation window has ended' };
  if (t < opens) return { valid: false, reason: 'reservation window has not opened yet' };
  if (t > claimDeadline) return { valid: false, reason: 'claim deadline passed (no-show)' };
  return { valid: true, reason: 'valid reservation' };
}
