import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as models from '../../src/models/index.js';
import { api, firstSlot, mins, resetDb, startServer, stopServer, submit } from './helpers.js';

beforeAll(startServer);
afterAll(stopServer);

const reserve = async (registration: string, startIn: number, lenMin = 120, extra: object = {}) => {
  const slot = await firstSlot();
  return api('POST', '/reservations', { registration, vehicleType: 'car', slotId: slot._id, startTime: mins(startIn), endTime: mins(startIn + lenMin), ...extra }, 'operator');
};

describe('reservations', () => {
  beforeEach(() => resetDb());

  it('requires authentication and validates input', async () => {
    expect((await api('POST', '/reservations', {}, false)).status).toBe(401);
    expect((await reserve('RV1', 10, 5)).status).toBe(400); // shorter than 15 minutes
    expect((await api('POST', '/reservations', { registration: 'RV1', vehicleType: 'car', startTime: mins(10), endTime: mins(100) }, 'operator')).status).toBe(400); // no slot/area
  });

  it('open hold: slot becomes reserved, strangers wait, the holder claims it and the reservation is consumed', async () => {
    const r = await reserve('HOLDER1', 5);
    expect(r.status).toBe(201);
    const slot = await firstSlot();
    expect(slot.status).toBe('reserved');
    expect(slot.reservation.reservationId).toBe(r.data.reservation.reservationId);
    expect((await submit('STRANGER1')).data.allocated).toBe(false);
    const h = await submit('HOLDER1', { reservationId: r.data.reservation.reservationId });
    // the stranger is ahead in the queue but the slot is not eligible for them; holder is served
    expect(h.data.allocated).toBe(true);
    expect(h.body.message).toMatch(/Reservation verified/);
    expect((await models.Reservation.findOne({ reservationId: r.data.reservation.reservationId }))!.status).toBe('used');
    const a = (await api('GET', '/allocations')).data[0];
    expect(a.registration).toBe('HOLDER1');
    expect(a.factors.reservation).toBe(1);
  });

  it('future reservation: short stay may use the slot, a stay that would overlap the hold may not', async () => {
    await reserve('LATER1', 120); // hold opens in 105 min
    expect((await submit('LONG1', { expectedDurationMinutes: 240 })).data.allocated).toBe(false);
    const shortStay = await submit('SHORT1', { expectedDurationMinutes: 60 });
    expect(shortStay.data.allocated).toBe(true);
  });

  it('prevents overlapping reservations and incompatible vehicles', async () => {
    expect((await reserve('AAA1', 60)).status).toBe(201);
    expect((await reserve('BBB1', 90)).status).toBe(409);
    expect((await reserve('CCC1', 400)).status).toBe(201); // non-overlapping window is fine
    await resetDb([{ slotType: 'bike', count: 1 }]);
    expect((await reserve('CARONBIKE', 60)).status).toBe(400);
  });

  it('cancellation releases the hold; a cancelled reservation gives no benefit', async () => {
    const r = await reserve('CANCEL1', 5);
    expect((await firstSlot()).status).toBe('reserved');
    expect((await api('POST', `/reservations/${r.data.reservation._id}/cancel`, undefined, 'operator')).status).toBe(200);
    expect((await firstSlot()).status).toBe('available');
    expect((await api('POST', `/reservations/${r.data.reservation._id}/cancel`, undefined, 'operator')).status).toBe(409);
    const s = await submit('CANCEL1', { reservationId: r.data.reservation.reservationId });
    expect(s.body.message).toMatch(/no benefit: reservation is cancelled/);
    expect((await api('GET', '/allocations')).data[0].factors.reservation).toBe(0);
  });

  it('cancelling a hold immediately serves a waiting vehicle', async () => {
    const r = await reserve('HOLD2', 5);
    expect((await submit('WAITER1')).data.allocated).toBe(false);
    await api('POST', `/reservations/${r.data.reservation._id}/cancel`, undefined, 'operator');
    expect((await models.ParkingRequest.findOne({ registration: 'WAITER1' }))!.status).toBe('allocated');
  });

  it('expiry: a reservation past its end/no-show deadline is expired by the service and gives no benefit', async () => {
    const r = await reserve('EXP1', 5);
    await models.Reservation.updateOne({ _id: r.data.reservation._id }, { $set: { startTime: new Date(Date.now() - 3 * 3600_000), endTime: new Date(Date.now() - 3600_000) } });
    const list = (await api('GET', '/reservations')).data;
    expect(list.find((x: any) => x.reservationId === r.data.reservation.reservationId).status).toBe('expired');
    expect((await firstSlot()).status).toBe('available');
    expect((await submit('EXP1', { reservationId: r.data.reservation.reservationId })).body.message).toMatch(/no benefit: reservation is expired/);
  });

  it("rejects another vehicle's or a non-existent reservation id", async () => {
    const r = await reserve('OWNER1', 60);
    expect((await submit('THIEF1', { reservationId: r.data.reservation.reservationId })).status).toBe(400);
    expect((await submit('THIEF2', { reservationId: 'RSV-999999' })).status).toBe(400);
  });

  it('an extension may not run into the next reservation hold', async () => {
    await submit('PARKED1', { expectedDurationMinutes: 60 });
    await reserve('NEXT1', 90); // hold opens at +75 min
    const s = (await api('GET', '/sessions?status=active')).data[0];
    expect((await api('POST', `/sessions/${s._id}/extend`, { addedMinutes: 30 }, 'operator')).status).toBe(409);
    expect((await api('POST', `/sessions/${s._id}/extend`, { addedMinutes: 10 }, 'operator')).status).toBe(200);
  });

  it('warns when the current occupant would still be parked when the hold opens', async () => {
    await submit('OCC1', { expectedDurationMinutes: 120 });
    const r = await reserve('LATE1', 60); // hold opens at +45, occupant stays to +120
    expect(r.status).toBe(201);
    expect(r.data.warnings.length).toBe(1);
  });
});

describe('configuration & audit', () => {
  beforeEach(() => resetDb());

  it('only admins can change configuration', async () => {
    expect((await api('PATCH', '/config', { waitingTimeCapMinutes: 30 }, 'operator')).status).toBe(403);
    expect((await api('PATCH', '/config', { waitingTimeCapMinutes: 30 }, false)).status).toBe(401);
  });

  it('rejects invalid configuration (weights must sum to 1, no unknown keys)', async () => {
    const bad = await api('PATCH', '/config', { weights: { waiting: 0.9 } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body.details)).toMatch(/sum to 1/);
    expect((await api('PATCH', '/config', { weights: { waiting: -1 } })).status).toBe(400);
    expect((await api('PATCH', '/config', { bogus: 1 })).status).toBe(400);
    expect((await api('GET', '/config')).data.engine.weights.waiting).toBe(0.25); // unchanged
  });

  it('accepts a valid change, persists it, and records an audit entry', async () => {
    const r = await api('PATCH', '/config', { weights: { waiting: 0.35, urgency: 0.15 }, penalty: { ratePerHour: 80 } });
    expect(r.status).toBe(200);
    expect(r.data.engine.weights.waiting).toBe(0.35);
    expect(r.data.penalty.ratePerHour).toBe(80);
    expect(r.data.penalty.graceMinutes).toBe(10); // untouched fields kept
    const audit = (await api('GET', '/audit?action=config.update')).data;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe('admin');
    expect(audit[0].details.before.engine.weights.waiting).toBe(0.25);
    expect((await api('GET', '/audit', undefined, 'operator')).status).toBe(403);
  });

  it('the live system really uses FCFS when selected (no emergency preemption)', async () => {
    expect((await api('PATCH', '/config', { activeAlgorithm: 'fcfs' })).status).toBe(200);
    expect((await submit('PARKED9')).data.allocated).toBe(true); // fills the only slot
    await submit('NORMAL1');
    await api('PUT', '/vehicles/AMBU9', { vehicleType: 'car', priorityCategory: 'emergency' }, 'operator');
    await submit('AMBU9');
    const s = (await api('GET', '/sessions?status=active')).data[0];
    await api('POST', `/sessions/${s._id}/exit`, undefined, 'operator');
    const a = (await api('GET', '/allocations')).data[0];
    expect(a.algorithm).toBe('fcfs');
    expect(a.registration).toBe('NORMAL1'); // earlier arrival wins under FCFS
    expect(a.priorityScore).toBeNull();
    expect((await api('GET', '/dashboard')).data.scheduler.algorithm).toBe('fcfs');
  });

  it('operators can verify priority and the audit trail records who did it', async () => {
    await api('PUT', '/vehicles/AMBU1', { vehicleType: 'car', priorityCategory: 'emergency', note: 'ambulance #4' }, 'operator');
    const v = await models.Vehicle.findOne({ registration: 'AMBU1' });
    expect(v!.priorityVerifiedBy).toBe('op1');
    expect((await api('GET', '/audit?action=vehicle.verifyPriority')).data[0].actor).toBe('op1');
  });
});
