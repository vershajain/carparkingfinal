import { checkEligibility } from './eligibility.js';
import { naturalCompare } from './suitability.js';
import { waitingMinutes } from './factors.js';
import { RequestView, SchedulerConfig, SlotView } from './types.js';

/**
 * FCFS baseline.
 * Order: arrivalTime ascending; tie-break requestId (natural order). No scoring, no urgency boost.
 * Constraints are the SAME hard rules as the dynamic scheduler (availability, compatibility,
 * accessibility, valid reservations, emergency-reserved-slot rule): FCFS serves the earliest-
 * arrived request that currently has at least one eligible slot (it does not block behind a
 * request that cannot be placed). Slot choice: own valid reserved slot, else lowest slot code.
 */
export function fcfsOrder(requests: RequestView[]): RequestView[] {
  return [...requests].sort(
    (a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime() || naturalCompare(a.requestId, b.requestId),
  );
}

export interface FcfsPick {
  request: RequestView;
  slot: SlotView;
  position: number;
  waitingMinutes: number;
  reason: string;
}

export function fcfsPick(
  requests: RequestView[],
  slots: SlotView[],
  cfg: SchedulerConfig,
  now: Date,
): FcfsPick | null {
  const ordered = fcfsOrder(requests);
  const sortedSlots = [...slots].sort((a, b) => naturalCompare(a.code, b.code));
  for (let i = 0; i < ordered.length; i++) {
    const req = ordered[i];
    const eligible = sortedSlots
      .map((s) => ({ s, el: checkEligibility(s, req, now, cfg) }))
      .filter((x) => x.el.eligible);
    if (eligible.length === 0) continue;
    const own = eligible.find((x) => x.el.ownReservation);
    const chosen = (own ?? eligible[0]).s;
    return {
      request: req,
      slot: chosen,
      position: i + 1,
      waitingMinutes: waitingMinutes(req, now),
      reason: own
        ? `FCFS: ${req.requestId} is the earliest-arrived request with an eligible slot; its own valid reserved slot ${chosen.code} was used.`
        : `FCFS: ${req.requestId} is the earliest-arrived request with an eligible slot; the first eligible slot by code (${chosen.code}) was used.`,
    };
  }
  return null;
}
