import { checkEligibility } from './eligibility.js';
import { RequestView, SchedulerConfig, SlotCandidate, SlotType, SlotView, VehicleType } from './types.js';

/** How well a slot TYPE fits a vehicle TYPE (1 = ideal). Only applied to already-eligible slots. */
const TYPE_FIT: Record<VehicleType, Record<SlotType, number>> = {
  bike: { bike: 1, compact: 0.6, standard: 0.4, large: 0.3, accessible: 0.3 },
  car: { bike: 0, compact: 1, standard: 0.8, large: 0.5, accessible: 0.5 },
  suv: { bike: 0, compact: 0.3, standard: 0.8, large: 1, accessible: 0.6 },
  other: { bike: 0, compact: 0.3, standard: 0.7, large: 1, accessible: 0.5 },
};

/** Weights of the slot-suitability components (sum = 1 after dropping unused ones). */
export const SUITABILITY_WEIGHTS = { type: 0.4, area: 0.25, reservation: 0.15, accessibility: 0.2 };
const EMERGENCY_OVERRIDE_PENALTY = 0.3;

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/**
 * Slot suitability S in [0,1] for ONE (request, slot) pair; null if the slot is ineligible.
 * Components: type fit, area match, own-slot reservation (only counted if the request has a
 * slot-specific reservation), and "don't waste accessible slots".
 */
export function evaluateSlot(
  slot: SlotView,
  req: RequestView,
  now: Date,
  cfg: SchedulerConfig,
): SlotCandidate | null {
  const el = checkEligibility(slot, req, now, cfg);
  if (!el.eligible) return null;

  const notes: string[] = [el.reason];
  const comp: Record<string, number> = {};
  let num = 0;
  let den = 0;
  const add = (name: keyof typeof SUITABILITY_WEIGHTS, v: number) => {
    comp[name] = v;
    num += SUITABILITY_WEIGHTS[name] * v;
    den += SUITABILITY_WEIGHTS[name];
  };

  const typeFit = TYPE_FIT[req.vehicleType][slot.slotType];
  add('type', typeFit);
  notes.push(`slot type "${slot.slotType}" fit for "${req.vehicleType}" = ${typeFit}`);

  const wantedArea = req.preferredAreaCode ?? req.reservation?.areaCode ?? null;
  const areaScore = wantedArea === null ? 0.5 : wantedArea === slot.areaCode ? 1 : 0;
  add('area', areaScore);
  notes.push(wantedArea === null ? 'no area preference' : areaScore === 1 ? `in preferred area ${wantedArea}` : `not in preferred area ${wantedArea}`);

  if (req.reservation?.slotId) {
    add('reservation', el.ownReservation ? 1 : 0);
    if (el.ownReservation) notes.push('this is the vehicle\'s own reserved slot');
  }

  const accessEff = slot.isAccessible && !req.requiresAccessibleSlot ? 0 : 1;
  add('accessibility', accessEff);
  if (accessEff === 0) notes.push('accessible slot would be used by a vehicle that does not need it');

  let score = num / den;
  if (el.emergencyOverride) {
    score = Math.max(0, score - EMERGENCY_OVERRIDE_PENALTY);
    notes.push('penalised: uses a slot reserved for a future reservation (last resort)');
  }
  return { slotId: slot.id, code: slot.code, areaCode: slot.areaCode, slotScore: round6(score), ownReservation: el.ownReservation, components: comp, notes };
}

/** All eligible slots for a request, best first. Ties: higher score, then natural slot-code order. */
export function evaluateCandidates(
  slots: SlotView[],
  req: RequestView,
  now: Date,
  cfg: SchedulerConfig,
): SlotCandidate[] {
  const out: SlotCandidate[] = [];
  for (const s of slots) {
    const c = evaluateSlot(s, req, now, cfg);
    if (c) out.push(c);
  }
  out.sort((a, b) => b.slotScore - a.slotScore || naturalCompare(a.code, b.code));
  // HARD rule: a vehicle holding a valid slot-specific reservation is given that slot, not a better-scoring one.
  const own = out.filter((c) => c.ownReservation);
  return own.length ? own : out;
}
