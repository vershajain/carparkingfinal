import http from 'node:http';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { expect } from 'vitest';
import { createApp } from '../../src/app.js';
import { connectDb, disconnectDb } from '../../src/config/db.js';
import * as models from '../../src/models/index.js';
import { ensureConfig } from '../../src/services/configService.js';

let server: http.Server;
let base = '';
export const tokens: Record<string, string> = {};

export async function startServer() {
  await connectDb();
  if (!mongoose.connection.name.endsWith('_test')) throw new Error('Refusing to wipe a database whose name does not end with _test');
  server = http.createServer(createApp());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
export async function stopServer() { server?.close(); await disconnectDb(); }

/** auth: true = admin token, false = none, 'operator' = operator token */
export async function api(method: string, path: string, body?: unknown, auth: boolean | 'operator' = true) {
  const t = auth === true ? tokens.admin : auth === 'operator' ? tokens.operator : undefined;
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json();
  return { status: res.status, body: json, data: json.data };
}

export async function resetDb(slots: { slotType: string; count: number }[] = [{ slotType: 'standard', count: 1 }]) {
  await mongoose.connection.dropDatabase();
  for (const m of Object.values(models)) if (typeof (m as any)?.syncIndexes === 'function') await (m as any).syncIndexes();
  await ensureConfig();
  await models.User.create({ username: 'admin', passwordHash: await bcrypt.hash('pw-admin-123', 4), role: 'admin' });
  tokens.admin = (await api('POST', '/auth/login', { username: 'admin', password: 'pw-admin-123' }, false)).data.token;
  expect((await api('POST', '/auth/users', { username: 'op1', password: 'pw-operator-1', role: 'operator' })).status).toBe(201);
  tokens.operator = (await api('POST', '/auth/login', { username: 'op1', password: 'pw-operator-1' }, false)).data.token;
  expect((await api('POST', '/areas', { code: 'Area 1', prefix: 'T1', name: 'Test Area', slots })).status).toBe(201);
}

export const submit = (registration: string, extra: object = {}) =>
  api('POST', '/requests', { registration, vehicleType: 'car', expectedDurationMinutes: 60, ...extra }, false);
export const mins = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
export const firstSlot = async () => (await api('GET', '/slots')).data[0];
