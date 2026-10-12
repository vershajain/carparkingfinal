import { ParkingArea, ParkingRequest, ParkingSlot, Reservation } from '../models/index.js';
import type { RequestView, ReservationView, SlotView } from '../scheduler/index.js';

type Lean = Record<string, any>;

export const toReservationView = (r: Lean | null | undefined): ReservationView | null =>
  r
    ? {
        reservationId: r.reservationId, registration: r.registration,
        slotId: r.slot ? String(r.slot) : null, areaCode: r.areaCode ?? null,
        startTime: r.startTime, endTime: r.endTime, status: r.status,
      }
    : null;

export const toSlotView = (s: Lean, res: Lean | null): SlotView => ({
  id: String(s._id), code: s.code, areaCode: s.areaCode, slotType: s.slotType,
  compatibleVehicleTypes: s.compatibleVehicleTypes, isAccessible: s.isAccessible,
  status: s.status, reservation: toReservationView(res),
});

export const toRequestView = (r: Lean, res: Lean | null): RequestView => ({
  id: String(r._id), requestId: r.requestId, registration: r.registration, vehicleType: r.vehicleType,
  arrivalTime: r.arrivalTime, expectedDurationMinutes: r.expectedDurationMinutes, urgency: r.urgency,
  preferredAreaCode: r.preferredAreaCode ?? null, requiresAccessibleSlot: !!r.requiresAccessibleSlot,
  reservation: toReservationView(res),
});

export interface SchedulerState {
  requests: RequestView[];
  slots: SlotView[];
  reqDocs: Map<string, Lean>;
  slotDocs: Map<string, Lean>;
}

/** Loads the authoritative state (waiting requests + slots of active areas) from MongoDB. */
export async function loadState(): Promise<SchedulerState> {
  const [reqDocs, areas, slotAll] = await Promise.all([
    ParkingRequest.find({ status: 'waiting' }).sort({ arrivalTime: 1 }).lean(),
    ParkingArea.find({ isActive: true }).lean(),
    ParkingSlot.find().lean(),
  ]);
  const active = new Set(areas.map((a) => a.code));
  const slotDocs = slotAll.filter((s) => active.has(s.areaCode));
  const resIds = [
    ...reqDocs.map((r: Lean) => r.reservation).filter(Boolean),
    ...slotDocs.map((s: Lean) => s.currentReservation).filter(Boolean),
  ];
  const resDocs = resIds.length ? await Reservation.find({ _id: { $in: resIds } }).lean() : [];
  const resById = new Map<string, Lean>(resDocs.map((r: Lean) => [String(r._id), r]));
  return {
    requests: reqDocs.map((r: Lean) => toRequestView(r, r.reservation ? resById.get(String(r.reservation)) ?? null : null)),
    slots: slotDocs.map((s: Lean) => toSlotView(s, s.currentReservation ? resById.get(String(s.currentReservation)) ?? null : null)),
    reqDocs: new Map(reqDocs.map((r: Lean) => [String(r._id), r])),
    slotDocs: new Map(slotDocs.map((s: Lean) => [String(s._id), s])),
  };
}
