/**
 * End-to-end tests against a REAL MongoDB-compatible server through the real Express API.
 * They WIPE the database named in TEST_MONGODB_URI (name must end with "_test").
 */
import http from 'node:http';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { connectDb, disconnectDb } from '../../src/config/db.js';
import * as models from '../../src/models/index.js';
import { ensureConfig } from '../../src/services/configService.js';

let server: http.Server;
let base = '';
let token = '';

async function api(method: string, path: string, body?: unknown, auth = true) {
  const res = await fetch(base + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json();
  return { status: res.status, body: json, data: json.data };
}

async function resetDb(slots: { slotType: string; count: number }[] = [{ slotType: 'standard', count: 2 }]) {
  await mongoose.connection.dropDatabase();
  for (const m of Object.values(models)) if (typeof (m as any)?.syncIndexes === 'function') await (m as any).syncIndexes();
  await ensureConfig();
  await models.User.create({ username: 'admin', passwordHash: await bcrypt.hash('pw-admin-123', 4), role: 'admin' });
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'pw-admin-123' }, false);
  token = login.data.token;
  const a = await api('POST', '/areas', { code: 'Area 1', prefix: 'T1', name: 'Test Area', slots });
  expect(a.status).toBe(201);
}
const submit = (registration: string, extra: object = {}) =>
  api('POST', '/requests', { registration, vehicleType: 'car', expectedDurationMinutes: 60, ...extra }, false);

beforeAll(async () => {
  expect(mongoose.connection.name ?? '').toBeDefined();
  await connectDb();
  if (!mongoose.connection.name.endsWith('_test')) throw new Error('Refusing to wipe a database whose name does not end with _test');
  server = http.createServer(createApp());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { server?.close(); await disconnectDb(); });

describe('request -> schedule -> allocate flow', () => {
  beforeEach(() => resetDb());

  it('rejects invalid input on the backend', async () => {
    expect((await api('POST', '/requests', { registration: '!!', vehicleType: 'boat', expectedDurationMinutes: -5 }, false)).status).toBe(400);
  });

  it('allocates automatically when slots are free and queues the rest', async () => {
    const a = await submit('AA 1111'); const b = await submit('BB-2222'); const c = await submit('CC3333');
    expect(a.data.allocated).toBe(true); expect(b.data.allocated).toBe(true);
    expect(c.data.allocated).toBe(false);
    expect(c.data.request.status).toBe('waiting');
    const q = await api('GET', '/queue');
    expect(q.data.rows.map((r: any) => r.registration)).toEqual(['CC3333']);
    expect(q.data.rows[0].eligibleSlotCount).toBe(0);
    const dash = await api('GET', '/dashboard');
    expect(dash.data).toMatchObject({ totalSlots: 2, occupiedSlots: 2, availableSlots: 0, waitingVehicles: 1, parkedVehicles: 2, utilizationPercent: 100 });
  });

  it('blocks duplicate requests for the same vehicle', async () => {
    await submit('AA1111');
    expect((await submit('AA1111')).status).toBe(409);
  });

  it('never trusts a self-declared emergency', async () => {
    expect((await submit('AAA1')).data.allocated).toBe(true); expect((await submit('AAA2')).data.allocated).toBe(true);
    const r = await submit('FAKE1', { urgencyClaim: 'emergency' });
    expect(r.data.request.urgency).toBe('normal');
    expect(r.body.message).toMatch(/not verified/);
  });

  it('on exit, the VERIFIED emergency is allocated before an earlier normal request, with a full explanation', async () => {
    const a = await submit('FULL1'); await submit('FULL2');
    await submit('NORMAL1');                                         // waits (first)
    await api('PUT', '/vehicles/AMBU1', { vehicleType: 'car', priorityCategory: 'emergency' }); // operator verifies
    await submit('AMBU1');                                           // waits (second)
    const sessions = (await api('GET', '/sessions?status=active')).data;
    const sess = sessions.find((s: any) => s.registration === 'FULL1');
    const exit = await api('POST', `/sessions/${sess._id}/exit`);
    expect(exit.status).toBe(200);
    const allocs = (await api('GET', '/allocations')).data;
    const latest = allocs[0];
    expect(latest.registration).toBe('AMBU1');
    expect(latest.algorithm).toBe('dynamic');
    expect(latest.priorityScore).toBeGreaterThan(0);
    expect(Object.keys(latest.contributions)).toHaveLength(7);
    expect(latest.vehicleReason).toMatch(/verified emergency/);
    expect(latest.fcfsComparison.differs).toBe(true);        // FCFS would have served NORMAL1
    expect(latest.fcfsComparison.explanation).toMatch(/NORMAL1/);
    expect(latest.slotScore).toBeGreaterThan(0);
    expect((await api('GET', '/queue')).data.rows[0].registration).toBe('NORMAL1');
    void a;
  });

  it('never allocates incompatible slots', async () => {
    await resetDb([{ slotType: 'bike', count: 2 }]);
    const r = await submit('CAR1');           // a car cannot use bike slots
    expect(r.data.allocated).toBe(false);
    const bike = await api('POST', '/requests', { registration: 'BIKE1', vehicleType: 'bike', expectedDurationMinutes: 30 }, false);
    expect(bike.data.allocated).toBe(true);
  });

  it('prevents double allocation under concurrent requests', async () => {
    await resetDb([{ slotType: 'standard', count: 1 }]);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => submit(`RACE${i}`)));
    expect(results.filter((r) => r.data?.allocated).length).toBe(1);
    expect(await models.ParkingSession.countDocuments({ status: 'active' })).toBe(1);
    expect(await models.ParkingRequest.countDocuments({ status: 'waiting' })).toBe(9);
    expect(await models.ParkingSlot.countDocuments({ status: 'occupied' })).toBe(1);
  });

  it('unavailable slots are never allocated; restoring one schedules the waiting vehicle', async () => {
    await resetDb([{ slotType: 'standard', count: 1 }]);
    const slot = (await api('GET', '/slots')).data[0];
    expect((await api('PATCH', `/slots/${slot._id}/status`, { status: 'unavailable', reason: 'maintenance' })).status).toBe(200);
    expect((await submit('WAIT1')).data.allocated).toBe(false);
    await api('PATCH', `/slots/${slot._id}/status`, { status: 'available' });
    expect((await models.ParkingRequest.findOne({ registration: 'WAIT1' }))!.status).toBe('allocated');
  });

  it('cannot mark an occupied slot unavailable', async () => {
    await submit('PARK1');
    const occupied = (await api('GET', '/slots?status=occupied')).data[0];
    expect((await api('PATCH', `/slots/${occupied._id}/status`, { status: 'unavailable' })).status).toBe(409);
  });

  it('requires authentication for operator and admin actions', async () => {
    const r = await api('PATCH', '/slots/000000000000000000000000/status', { status: 'unavailable' }, false);
    expect(r.status).toBe(401);
  });
});

describe('sessions: extension, early exit, overstay', () => {
  beforeEach(() => resetDb([{ slotType: 'standard', count: 1 }]));

  it('extends a stay and records history', async () => {
    await submit('EXT1');
    const s = (await api('GET', '/sessions?status=active')).data[0];
    const r = await api('POST', `/sessions/${s._id}/extend`, { addedMinutes: 30 });
    expect(new Date(r.data.expectedDeparture).getTime() - new Date(s.expectedDeparture).getTime()).toBe(30 * 60_000);
    expect(r.data.extensions).toHaveLength(1);
  });

  it('early exit: no penalty, slot released, waiting vehicle allocated', async () => {
    await submit('EARLY1'); await submit('NEXT1');
    const s = (await api('GET', '/sessions?status=active')).data[0];
    const r = await api('POST', `/sessions/${s._id}/exit`);
    expect(r.data.session.penalty.earlyDeparture).toBe(true);
    expect(r.data.session.penalty.amount).toBe(0);
    expect((await models.ParkingRequest.findOne({ registration: 'NEXT1' }))!.status).toBe('allocated');
    expect(await models.ParkingSession.countDocuments({ status: 'active' })).toBe(1);
  });

  it('overstay: detected live and penalty computed from config with the calculation shown', async () => {
    await submit('LATE1');
    const s = await models.ParkingSession.findOne({ registration: 'LATE1' });
    await models.ParkingSession.updateOne({ _id: s!._id }, { $set: { expectedDeparture: new Date(Date.now() - 60 * 60_000) } });
    const live = (await api('GET', '/sessions?status=active')).data[0];
    expect(live.overstaying).toBe(true);
    expect(live.projectedPenalty.amount).toBeGreaterThan(0);
    const r = await api('POST', `/sessions/${s!._id}/exit`);
    const p = r.data.session.penalty;
    // defaults: grace 10, block 15, 50/h. overstay ~60 -> chargeable ~50 -> billed 60 -> 50
    expect(p.chargeableMinutes).toBeGreaterThan(49); expect(p.chargeableMinutes).toBeLessThan(51);
    expect(p.amount).toBe(50);
    expect(p.formula).toMatch(/grace 10 min/);
    expect((await api('POST', `/sessions/${s!._id}/exit`)).status).toBe(409); // already completed
  });
});
