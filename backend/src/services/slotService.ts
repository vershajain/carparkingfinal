import { ParkingArea, ParkingSession, ParkingSlot, Reservation } from '../models/index.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { publish } from '../utils/socket.js';
import { runScheduler } from './allocationService.js';

import { SLOT_COMPATIBILITY } from '../scheduler/slotTypes.js';
import type { SlotType } from '../scheduler/types.js';
export { SLOT_COMPATIBILITY };

export async function addSlots(areaId: string, slotType: SlotType, count: number) {
  const area = await ParkingArea.findById(areaId);
  if (!area) throw notFound('Area not found');
  const existing = await ParkingSlot.find({ area: area._id }, { code: 1 }).lean();
  let n = existing.reduce((m, s) => Math.max(m, parseInt(s.code.split('-S')[1] ?? '0', 10) || 0), 0);
  const docs = Array.from({ length: count }, () => ({
    code: `${area.prefix}-S${String(++n).padStart(2, '0')}`,
    area: area._id, areaCode: area.code, areaName: area.name, slotType,
    compatibleVehicleTypes: SLOT_COMPATIBILITY[slotType], isAccessible: slotType === 'accessible',
  }));
  return ParkingSlot.insertMany(docs);
}

export async function createArea(
  input: { code: string; prefix: string; name: string; description?: string; slots?: { slotType: SlotType; count: number }[] },
  actor: string,
) {
  const area = await ParkingArea.create({ code: input.code, prefix: input.prefix, name: input.name, description: input.description ?? '' });
  for (const s of input.slots ?? []) await addSlots(String(area._id), s.slotType, s.count);
  await audit(actor, 'area.create', 'ParkingArea', String(area._id), input);
  publish('slot:updated', { area: area.code });
  void runScheduler('layout-change');
  return area;
}

export async function listAreas() {
  const [areas, slots] = await Promise.all([ParkingArea.find().sort({ code: 1 }).lean(), ParkingSlot.find({}, { areaCode: 1, status: 1 }).lean()]);
  return areas.map((a) => ({
    ...a,
    slotCount: slots.filter((s) => s.areaCode === a.code).length,
    availableCount: slots.filter((s) => s.areaCode === a.code && s.status === 'available').length,
  }));
}

export async function listSlots(filter: { areaCode?: string; status?: string }) {
  const q: Record<string, unknown> = {};
  if (filter.areaCode) q.areaCode = filter.areaCode;
  if (filter.status) q.status = filter.status;
  const slots = await ParkingSlot.find(q).sort({ areaCode: 1, code: 1 }).lean();
  const sessions = await ParkingSession.find({ _id: { $in: slots.map((s) => s.currentSession).filter(Boolean) } }).lean();
  const reservations = await Reservation.find({ _id: { $in: slots.map((s) => s.currentReservation).filter(Boolean) } }).lean();
  const sById = new Map(sessions.map((s) => [String(s._id), s]));
  const rById = new Map(reservations.map((r) => [String(r._id), r]));
  return slots.map((s) => ({
    ...s,
    session: s.currentSession ? sById.get(String(s.currentSession)) ?? null : null,
    reservation: s.currentReservation ? rById.get(String(s.currentReservation)) ?? null : null,
  }));
}

export async function getSlot(id: string) {
  const [slot] = (await listSlots({})).filter((s) => String(s._id) === id);
  if (!slot) throw notFound('Slot not found');
  return slot;
}

export async function setSlotStatus(id: string, target: 'available' | 'unavailable', reason: string | undefined, actor: string) {
  const from = target === 'unavailable' ? 'available' : 'unavailable';
  const updated = await ParkingSlot.findOneAndUpdate(
    { _id: id, status: from },
    { $set: { status: target, unavailableReason: target === 'unavailable' ? reason ?? 'unspecified' : null } },
    { new: true },
  ).lean();
  if (!updated) {
    const s = await ParkingSlot.findById(id).lean();
    if (!s) throw notFound('Slot not found');
    if (s.status === target) return s; // idempotent
    throw conflict(`Cannot change a slot from "${s.status}" to "${target}" (only available <-> unavailable)`);
  }
  await audit(actor, `slot.${target === 'unavailable' ? 'markUnavailable' : 'restore'}`, 'ParkingSlot', id, { code: updated.code, reason });
  publish('slot:updated', { slotCode: updated.code, status: target });
  if (target === 'available') await runScheduler('slot-restored');
  return updated;
}

export function assertCount(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 500) throw badRequest('count must be an integer between 1 and 500');
}
