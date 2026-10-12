import { ParkingSlot, Reservation } from '../models/index.js';
import { publish } from '../utils/socket.js';
import { getRuntimeConfig } from './configService.js';

/**
 * Keeps reservations and slot state consistent (called at the start of every scheduler run,
 * including the 30 s tick, and after reservation changes):
 *  1. EXPIRY: an 'active' reservation becomes 'expired' once its end time has passed or its
 *     claim deadline (start + lateArrival, i.e. no-show) has passed.
 *  2. SLOT ATTACHMENT: each slot points (currentReservation) at its earliest still-active reservation.
 *  3. HOLD: from (start - earlyArrival) the slot's status becomes 'reserved' (if it was free);
 *     when the hold is gone (cancelled/expired/used) a 'reserved' slot returns to 'available'.
 * Slot updates are conditional on the status that was read, so they cannot clobber an allocation.
 */
export async function syncReservations(now: Date = new Date()): Promise<boolean> {
  const cfg = await getRuntimeConfig();
  const early = cfg.engine.reservation.earlyArrivalMinutes * 60_000;
  const late = cfg.engine.reservation.lateArrivalMinutes * 60_000;
  let changed = false;

  const exp = await Reservation.updateMany(
    { status: 'active', $or: [{ endTime: { $lte: now } }, { startTime: { $lt: new Date(now.getTime() - late) } }] },
    { $set: { status: 'expired' } },
  );
  if (exp.modifiedCount > 0) changed = true;

  const active = await Reservation.find({ status: 'active', slot: { $ne: null } }).sort({ startTime: 1 }).lean();
  const next = new Map<string, (typeof active)[number]>();
  for (const r of active) if (!next.has(String(r.slot))) next.set(String(r.slot), r);

  const slots = await ParkingSlot.find({
    $or: [{ currentReservation: { $ne: null } }, { status: 'reserved' }, { _id: { $in: [...next.keys()] } }],
  }).lean();

  for (const s of slots) {
    const want = next.get(String(s._id)) ?? null;
    const holdOpen = !!want && now.getTime() >= want.startTime.getTime() - early;
    let status = s.status as string;
    if (status === 'available' && holdOpen) status = 'reserved';
    else if (status === 'reserved' && !holdOpen) status = 'available';
    const cur = s.currentReservation ? String(s.currentReservation) : null;
    const wantId = want ? String(want._id) : null;
    if (status !== s.status || cur !== wantId) {
      const r = await ParkingSlot.updateOne({ _id: s._id, status: s.status }, { $set: { status, currentReservation: want?._id ?? null } });
      if (r.modifiedCount > 0) changed = true;
    }
  }
  if (changed) {
    publish('reservation:changed', {});
    publish('slot:updated', {});
  }
  return changed;
}
