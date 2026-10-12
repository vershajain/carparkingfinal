import { ParkingSession, ParkingSlot } from '../models/index.js';
import { audit } from '../utils/audit.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { computePenalty } from '../utils/penalty.js';
import { publish } from '../utils/socket.js';
import { runScheduler } from './allocationService.js';
import { Reservation } from '../models/index.js';
import { getRuntimeConfig } from './configService.js';

const r2 = (x: number) => Math.round(x * 100) / 100;

export async function listSessions(status?: string) {
  const cfg = await getRuntimeConfig();
  const q = status ? { status } : {};
  const rows = await ParkingSession.find(q).sort({ entryTime: -1 }).limit(500).lean();
  const now = new Date();
  return rows.map((s) => {
    const overstaying = s.status === 'active' && now > s.expectedDeparture;
    return {
      ...s,
      overstaying,
      // For an active overstaying vehicle: the penalty IF it left right now (shown with its calculation)
      projectedPenalty: overstaying ? computePenalty(s.expectedDeparture, now, cfg.penalty) : null,
    };
  });
}

export async function exitSession(id: string, actor: string, at?: Date) {
  const s = await ParkingSession.findById(id).lean();
  if (!s) throw notFound('Session not found');
  if (s.status !== 'active') throw conflict('Session is already completed');
  const cfg = await getRuntimeConfig();
  const exitAt = at ?? new Date();
  if (exitAt < s.entryTime) throw badRequest('Exit time cannot be before entry time');

  const penalty = computePenalty(s.expectedDeparture, exitAt, cfg.penalty);
  const early = exitAt < s.expectedDeparture;
  const done = await ParkingSession.findOneAndUpdate(
    { _id: id, status: 'active' },
    {
      $unset: { activeSlot: 1 },
      $set: {
        status: 'completed', actualExit: exitAt,
        finalDurationMinutes: r2((exitAt.getTime() - s.entryTime.getTime()) / 60000),
        overstayMinutes: penalty.overstayMinutes,
        penalty: { ...penalty, earlyDeparture: early, earlyByMinutes: early ? r2((s.expectedDeparture.getTime() - exitAt.getTime()) / 60000) : 0 },
      },
    },
    { new: true },
  ).lean();
  if (!done) throw conflict('Session was completed concurrently');

  await ParkingSlot.updateOne(
    { _id: s.slot, currentSession: s._id },
    { $set: { status: 'available', currentSession: null, currentVehicleRegistration: null } },
  );
  await audit(actor, 'session.exit', 'ParkingSession', id, { slot: s.slotCode, penalty: penalty.amount });
  publish('session:exited', { sessionId: s.sessionId });
  publish('slot:updated', { slotCode: s.slotCode, status: 'available' });
  const run = await runScheduler('exit'); // released capacity -> schedule waiting vehicles
  return { session: done, scheduler: run };
}

async function changeDeparture(id: string, newExpected: Date, actor: string) {
  const s = await ParkingSession.findById(id).lean();
  if (!s) throw notFound('Session not found');
  if (s.status !== 'active') throw conflict('Only active sessions can be changed');
  if (newExpected <= s.entryTime) throw badRequest('Expected departure must be after the entry time');
  if (newExpected > s.expectedDeparture) {
    // A longer stay must not run into the hold window of the next reservation on this slot.
    const cfg = await getRuntimeConfig();
    const holdMs = cfg.engine.reservation.earlyArrivalMinutes * 60_000;
    const next = await Reservation.findOne({ slot: s.slot, status: 'active', endTime: { $gt: new Date() } }).sort({ startTime: 1 }).lean();
    if (next && newExpected.getTime() > next.startTime.getTime() - holdMs) {
      throw conflict(`Cannot stay until ${newExpected.toISOString()}: reservation ${next.reservationId} holds this slot from ${new Date(next.startTime.getTime() - holdMs).toISOString()}`);
    }
  }
  const updated = await ParkingSession.findOneAndUpdate(
    { _id: id, status: 'active', expectedDeparture: s.expectedDeparture }, // optimistic check
    {
      $set: { expectedDeparture: newExpected },
      $push: {
        extensions: {
          at: new Date(), addedMinutes: r2((newExpected.getTime() - s.expectedDeparture.getTime()) / 60000),
          previousExpectedDeparture: s.expectedDeparture, newExpectedDeparture: newExpected, by: actor,
        },
      },
    },
    { new: true },
  ).lean();
  if (!updated) throw conflict('Session changed concurrently; retry');
  await audit(actor, 'session.expectedDeparture', 'ParkingSession', id, { from: s.expectedDeparture, to: newExpected });
  publish('session:extended', { sessionId: s.sessionId });
  publish('slot:updated', { slotCode: s.slotCode });
  return updated;
}

export async function extendSession(id: string, addedMinutes: number, actor: string) {
  const s = await ParkingSession.findById(id).lean();
  if (!s) throw notFound('Session not found');
  return changeDeparture(id, new Date(s.expectedDeparture.getTime() + addedMinutes * 60_000), actor);
}
export const setExpectedDeparture = changeDeparture;
