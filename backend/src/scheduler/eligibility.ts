import { validateReservation } from './reservation.js';
import { RequestView, SchedulerConfig, SlotView } from './types.js';

export interface Eligibility {
  eligible: boolean; // HARD constraint result
  reason: string;
  ownReservation: boolean;
  emergencyOverride: boolean;
}

const no = (reason: string): Eligibility => ({
  eligible: false, reason, ownReservation: false, emergencyOverride: false,
});

/**
 * HARD eligibility rules (never overridden by any score):
 *  1. Slot must not be occupied or unavailable.
 *  2. Vehicle type must be in the slot's compatibleVehicleTypes.
 *  3. A vehicle that requires an accessible slot may only use accessible slots.
 *  4. RESERVATION HOLD rules, when the slot has an attached reservation R (hold opens at
 *     R.start - earlyArrival; R is void after R.start + lateArrival, after R.end, or when not 'active'):
 *     - R void: the slot is free (if its status is 'available'); a 'reserved' slot with a void R
 *       is ineligible until the service releases it.
 *     - vehicle holds a VALID R: eligible (its own reserved slot).
 *     - hold not open yet: eligible only if the vehicle's stay ENDS before the hold opens;
 *       otherwise only a verified emergency may use it (policy flag), as a last resort.
 *     - hold open: reserved for the holder, ineligible for everyone else.
 * Preferred area is NOT a hard rule (it is a weighted preference in slot suitability).
 */
export function checkEligibility(
  slot: SlotView,
  req: RequestView,
  now: Date,
  cfg: SchedulerConfig,
): Eligibility {
  if (slot.status === 'occupied') return no('slot is occupied');
  if (slot.status === 'unavailable') return no('slot is unavailable');
  if (!slot.compatibleVehicleTypes.includes(req.vehicleType)) {
    return no(`slot does not accept vehicle type "${req.vehicleType}"`);
  }
  if (req.requiresAccessibleSlot && !slot.isAccessible) return no('vehicle requires an accessible slot');

  const free: Eligibility = { eligible: true, reason: 'available and compatible', ownReservation: false, emergencyOverride: false };
  const res = slot.reservation;
  const t = now.getTime();
  const MIN = 60_000;
  const live =
    !!res && res.status === 'active' && t < res.endTime.getTime() &&
    t <= res.startTime.getTime() + cfg.reservation.lateArrivalMinutes * MIN;
  if (!res || !live) {
    return slot.status === 'available' ? free : no('slot is reserved but its reservation is no longer valid (awaiting release)');
  }

  if (validateReservation(res, req.registration, now, cfg).valid) {
    return { eligible: true, reason: 'reserved for this vehicle (valid reservation)', ownReservation: true, emergencyOverride: false };
  }
  const opens = res.startTime.getTime() - cfg.reservation.earlyArrivalMinutes * MIN;
  if (t < opens) {
    if (t + req.expectedDurationMinutes * MIN <= opens) {
      return { ...free, reason: 'available; the stay ends before the slot\'s upcoming reservation hold opens' };
    }
    if (req.urgency === 'emergency' && cfg.emergencyPolicy.allowUseOfReservedUnclaimedSlots) {
      return { eligible: true, reason: 'emergency use of a slot with an upcoming reservation (hold not open yet)', ownReservation: false, emergencyOverride: true };
    }
    return no('stay would overlap an upcoming reservation on this slot');
  }
  return no('slot is held for another vehicle\'s reservation');
}
