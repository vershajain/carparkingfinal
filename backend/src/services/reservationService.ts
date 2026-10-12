import { ParkingArea, ParkingSession, ParkingSlot, Reservation, Vehicle, nextId } from '../models/index.js';
import { audit } from '../utils/audit.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { publish } from '../utils/socket.js';
import { runScheduler } from './allocationService.js';
import { getRuntimeConfig } from './configService.js';
import { syncReservations } from './reservationSync.js';

export interface CreateReservationInput {
  registration: string;
  vehicleType?: 'bike' | 'car' | 'suv' | 'other';
  slotId?: string;
  areaCode?: string;
  startTime: Date;
  endTime: Date;
}
const DAY = 86_400_000;

/**
 * Reserved-capacity policy (documented in the README):
 *  - SLOT reservation: holds that exact slot from (start - earlyArrival). Before the hold opens the slot
 *    is usable by any vehicle whose stay ends first; verified emergencies may use it as a last resort.
 *  - AREA reservation: gives the vehicle the valid-reservation benefit (R = 1) and an area preference,
 *    but does NOT hold a particular slot or guarantee capacity.
 */
export async function createReservation(input: CreateReservationInput, actor: string) {
  const now = new Date();
  const cfg = await getRuntimeConfig();
  if (!input.slotId === !input.areaCode) throw badRequest('Provide exactly one of slotId or areaCode');
  if (input.endTime <= input.startTime) throw badRequest('endTime must be after startTime');
  if (input.endTime <= now) throw badRequest('Reservation window is already over');
  if (input.endTime.getTime() - input.startTime.getTime() < 15 * 60_000) throw badRequest('Reservation must last at least 15 minutes');
  if (input.endTime.getTime() - input.startTime.getTime() > 7 * DAY) throw badRequest('Reservation cannot exceed 7 days');
  if (input.startTime.getTime() - now.getTime() > 30 * DAY) throw badRequest('Reservation cannot start more than 30 days ahead');

  let vehicle = await Vehicle.findOne({ registration: input.registration });
  if (!vehicle) {
    if (!input.vehicleType) throw badRequest('vehicleType is required for a vehicle that is not registered yet');
    vehicle = await Vehicle.create({ registration: input.registration, vehicleType: input.vehicleType });
  } else if (input.vehicleType && input.vehicleType !== vehicle.vehicleType) {
    throw conflict(`${input.registration} is registered as "${vehicle.vehicleType}"`);
  }

  const warnings: string[] = [];
  let slot = null;
  let areaCode = input.areaCode ?? null;
  if (input.slotId) {
    slot = await ParkingSlot.findById(input.slotId);
    if (!slot) throw notFound('Slot not found');
    if (!slot.compatibleVehicleTypes.includes(vehicle.vehicleType)) throw badRequest(`Slot ${slot.code} does not accept "${vehicle.vehicleType}" vehicles`);
    if (slot.status === 'unavailable') throw conflict(`Slot ${slot.code} is unavailable`);
    const overlap = await Reservation.findOne({ slot: slot._id, status: 'active', startTime: { $lt: input.endTime }, endTime: { $gt: input.startTime } });
    if (overlap) throw conflict(`Slot ${slot.code} is already reserved in that window (${overlap.reservationId})`);
    areaCode = slot.areaCode;
    if (slot.status === 'occupied') {
      const sess = await ParkingSession.findOne({ slot: slot._id, status: 'active' }).lean();
      const holdOpens = input.startTime.getTime() - cfg.engine.reservation.earlyArrivalMinutes * 60_000;
      if (sess && sess.expectedDeparture.getTime() > holdOpens) {
        warnings.push(`The current occupant is expected to stay until ${sess.expectedDeparture.toISOString()}, after the hold opens; the slot may not be free on time.`);
      }
    }
  } else if (!(await ParkingArea.exists({ code: input.areaCode }))) {
    throw notFound(`Area "${input.areaCode}" not found`);
  }

  const reservation = await Reservation.create({
    reservationId: await nextId('RSV'), vehicle: vehicle._id, registration: input.registration,
    slot: slot?._id ?? null, areaCode, startTime: input.startTime, endTime: input.endTime, createdBy: actor,
  });
  await syncReservations();
  await audit(actor, 'reservation.create', 'Reservation', reservation.reservationId, { registration: input.registration, slot: slot?.code, areaCode });
  publish('reservation:changed', { reservationId: reservation.reservationId });
  publish('queue:updated', {});
  return { reservation, slotCode: slot?.code ?? null, warnings };
}

export async function cancelReservation(id: string, actor: string) {
  const r = await Reservation.findOneAndUpdate({ _id: id, status: 'active' }, { $set: { status: 'cancelled' } }, { new: true }).lean();
  if (!r) {
    if (!(await Reservation.exists({ _id: id }))) throw notFound('Reservation not found');
    throw conflict('Only active reservations can be cancelled');
  }
  await syncReservations(); // releases the slot hold
  await audit(actor, 'reservation.cancel', 'Reservation', r.reservationId, {});
  publish('reservation:changed', { reservationId: r.reservationId });
  await runScheduler('reservation-cancelled'); // freed capacity may serve waiting vehicles
  return r;
}

export async function listReservations(status?: string) {
  await syncReservations(); // never show stale 'active' reservations that have actually expired
  const rows = await Reservation.find(status ? { status } : {}).sort({ startTime: -1 }).limit(500).lean();
  const slots = await ParkingSlot.find({ _id: { $in: rows.map((r) => r.slot).filter(Boolean) } }, { code: 1 }).lean();
  const code = new Map(slots.map((s) => [String(s._id), s.code]));
  return rows.map((r) => ({ ...r, slotCode: r.slot ? code.get(String(r.slot)) ?? null : null }));
}
