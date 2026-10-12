import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as models from '../../src/models/index.js';
import { api, resetDb, startServer, stopServer } from './helpers.js';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(() => resetDb());

const run = (overrides: object = {}, auth: boolean | 'operator' = 'operator') =>
  api('POST', '/analytics/run', { scenario: 'normal_demand', overrides: { arrivalCount: 30, horizonMinutes: 240, ...overrides } }, auth);
const strip = (rows: any[]) => rows.filter((r) => r.deterministic).map((r) => [r.key, r.fcfs, r.dynamic, r.improvementPercent]);

describe('analytics API', () => {
  it('requires authentication and validates input', async () => {
    expect((await run({}, false)).status).toBe(401);
    expect((await api('POST', '/analytics/run', { scenario: 'nope' }, 'operator')).status).toBe(400);
    expect((await run({ arrivalCount: 99999 })).status).toBe(400);
  });

  it('shows no results (empty state) before any run', async () => {
    expect((await api('GET', '/analytics/results', undefined, false)).data).toEqual([]);
  });

  it('runs FCFS and dynamic on the same scenario and persists measured results', async () => {
    const r = await run();
    expect(r.status).toBe(201);
    const d = r.data;
    expect(d.sufficient).toBe(true);
    expect(d.simulated).toBe(true);
    expect(d.fcfs.raw.arrivedCount).toBe(d.dynamic.raw.arrivedCount);
    expect(d.metrics.length).toBeGreaterThanOrEqual(10);
    const wait = d.metrics.find((m: any) => m.key === 'avgWaitingMinutes');
    expect(wait.direction).toBe('lower');
    expect(typeof wait.fcfs).toBe('number');
    const rows = await models.PerformanceResult.find({ runId: d.runId });
    expect(rows.map((x) => x.algorithm).sort()).toEqual(['dynamic', 'fcfs']);
    expect(rows[0].scenarioMetadata.arrivalsDigest).toBe(rows[1].scenarioMetadata.arrivalsDigest);
    const list = await api('GET', '/analytics/results', undefined, false);
    expect(list.data).toHaveLength(1);
    expect((await api('GET', `/analytics/results/${d.runId}`, undefined, false)).data.runId).toBe(d.runId);
  });

  it('is reproducible: the same seed gives the same measurements', async () => {
    const a = (await run({ seed: 123 })).data, b = (await run({ seed: 123 })).data;
    expect(a.runId).not.toBe(b.runId);
    expect(a.arrivalsDigest).toBe(b.arrivalsDigest);
    expect(strip(a.metrics)).toEqual(strip(b.metrics));
    const c = (await run({ seed: 124 })).data;
    expect(c.arrivalsDigest).not.toBe(a.arrivalsDigest);
  });

  it('uses the current configuration (changing weights is recorded in the run)', async () => {
    await api('PATCH', '/config', { weights: { waiting: 0.4, urgency: 0.1 } });
    const r = (await run()).data;
    expect(r.configSnapshot.weights.waiting).toBe(0.4);
  });

  it('can evaluate on the real configured layout, and filters history by scenario', async () => {
    const r = await run({ slotSource: 'database', arrivalCount: 20 });
    expect(r.data.spec.slotSource).toBe('database');
    await api('POST', '/analytics/run', { scenario: 'low_demand', overrides: { arrivalCount: 10, horizonMinutes: 120 } }, 'operator');
    expect((await api('GET', '/analytics/results?scenarioId=low_demand', undefined, false)).data).toHaveLength(1);
  });

  it('live summary reports recorded application data per algorithm, with nulls when empty', async () => {
    const empty = (await api('GET', '/analytics/live', undefined, false)).data;
    expect(empty.dynamic.allocations).toBe(0);
    expect(empty.dynamic.avgWaitingMinutes).toBeNull();
    await api('POST', '/requests', { registration: 'LIVE111', vehicleType: 'car', expectedDurationMinutes: 30 }, false);
    const live = (await api('GET', '/analytics/live', undefined, false)).data;
    expect(live.dynamic.allocations).toBe(1);
    expect(live.dynamic.avgDecisionTimeMs).not.toBeNull();
  });
});
