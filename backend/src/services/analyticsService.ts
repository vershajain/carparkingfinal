import { arrivalsDigest, buildSlots, generateArrivals, PRESETS, resolveSpec, type SpecOverrides } from '../analytics/scenarios.js';
import { compareMetrics } from '../analytics/comparison.js';
import { simulate, type SimMetrics, type SimResult } from '../analytics/simulator.js';
import { AllocationRecord, ParkingRequest, ParkingSlot, PerformanceResult, nextId } from '../models/index.js';
import { audit } from '../utils/audit.js';
import { publish } from '../utils/socket.js';
import { getRuntimeConfig } from './configService.js';
import { toSlotView } from './views.js';

export const listScenarios = () => Object.values(PRESETS);

/**
 * Controlled evaluation: BOTH algorithms get an identical private copy of the initial state and the
 * identical, seeded arrival list. Results are measured by the simulator and stored in MongoDB.
 */
export async function runComparison(scenarioKey: string, overrides: SpecOverrides, actor: string) {
  const spec = resolveSpec(scenarioKey, overrides);
  const cfg = await getRuntimeConfig();
  let dbSlots;
  if (spec.slotSource === 'database') {
    const rows = await ParkingSlot.find().lean();
    dbSlots = rows.map((s) => toSlotView(s, null));
  }
  const arrivals = generateArrivals(spec);
  const digest = arrivalsDigest(arrivals);
  const sampleEvery = Math.max(5, Math.round(spec.horizonMinutes / 24));
  const initial = buildSlots(spec, dbSlots);
  const results: Record<'fcfs' | 'dynamic', SimResult> = {
    fcfs: simulate('fcfs', buildSlots(spec, dbSlots), arrivals, cfg.engine, spec.horizonMinutes, sampleEvery),
    dynamic: simulate('dynamic', buildSlots(spec, dbSlots), arrivals, cfg.engine, spec.horizonMinutes, sampleEvery),
  };
  const runId = await nextId('RUN');
  const metadata = {
    simulated: true, spec, arrivalCount: arrivals.length, arrivalsDigest: digest, configSnapshot: cfg.engine,
    slotCount: initial.length, usableSlots: initial.filter((s) => s.status !== 'unavailable').length,
    note: 'Identical initial state and identical seeded arrival list for both algorithms; times are simulated minutes.',
  };
  const t0 = new Date('2026-01-05T08:00:00Z');
  for (const algorithm of ['fcfs', 'dynamic'] as const) {
    await PerformanceResult.create({
      scenarioId: spec.key, scenarioName: spec.name, runId, algorithm, scenarioMetadata: metadata,
      periodStart: t0, periodEnd: new Date(t0.getTime() + spec.horizonMinutes * 60_000),
      metrics: results[algorithm].metrics, timeline: results[algorithm].timeline,
    });
  }
  await audit(actor, 'analytics.run', 'PerformanceResult', runId, { scenario: spec.key, seed: spec.seed });
  publish('analytics:updated', { runId });
  return buildRun(runId);
}

export async function buildRun(runId: string) {
  const rows = await PerformanceResult.find({ runId }).lean();
  return assemble(rows as any[]);
}

function assemble(rows: any[]) {
  const f = rows.find((r) => r.algorithm === 'fcfs');
  const d = rows.find((r) => r.algorithm === 'dynamic');
  if (!f || !d) return null;
  const meta = d.scenarioMetadata;
  const sufficient = (f.metrics as SimMetrics).servedCount > 0 && (d.metrics as SimMetrics).servedCount > 0;
  return {
    runId: d.runId, scenarioId: d.scenarioId, scenarioName: d.scenarioName, executedAt: d.executedAt,
    simulated: true, observationMinutes: (d.metrics as SimMetrics).observationMinutes,
    arrivals: meta.arrivalCount, arrivalsDigest: meta.arrivalsDigest, spec: meta.spec, configSnapshot: meta.configSnapshot,
    sufficient, metrics: sufficient ? compareMetrics(f.metrics, d.metrics) : [],
    fcfs: { raw: f.metrics, timeline: f.timeline }, dynamic: { raw: d.metrics, timeline: d.timeline },
  };
}

export async function listRuns(scenarioId?: string, limit = 50) {
  const rows = await PerformanceResult.find(scenarioId ? { scenarioId } : {}).sort({ executedAt: -1 }).limit(limit * 2).lean();
  const byRun = new Map<string, any[]>();
  for (const r of rows as any[]) byRun.set(r.runId, [...(byRun.get(r.runId) ?? []), r]);
  return [...byRun.values()].map(assemble).filter(Boolean).slice(0, limit);
}

/** Recorded application data: what the LIVE system measured, grouped by the algorithm that made each decision. */
export async function liveSummary() {
  const allocs = await AllocationRecord.find().sort({ allocatedAt: -1 }).limit(5000).lean();
  const reqs = await ParkingRequest.find({ _id: { $in: allocs.map((a) => a.request) } }, { arrivalTime: 1, urgency: 1 }).lean();
  const rById = new Map(reqs.map((r) => [String(r._id), r]));
  const out: Record<string, any> = {};
  for (const algo of ['dynamic', 'fcfs']) {
    const rows = allocs.filter((a) => a.algorithm === algo);
    const waits = rows.map((a) => (a.allocatedAt.getTime() - (rById.get(String(a.request))?.arrivalTime.getTime() ?? a.allocatedAt.getTime())) / 60000);
    const em = rows.filter((a) => rById.get(String(a.request))?.urgency === 'emergency')
      .map((a) => (a.allocatedAt.getTime() - rById.get(String(a.request))!.arrivalTime.getTime()) / 60000);
    const dt = rows.map((a) => a.decisionTimeMs).filter((x): x is number => typeof x === 'number');
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
    out[algo] = { allocations: rows.length, avgWaitingMinutes: avg(waits), maxWaitingMinutes: waits.length ? Math.round(Math.max(...waits) * 100) / 100 : null,
      emergencyAllocations: em.length, avgEmergencyAllocationMinutes: avg(em), avgDecisionTimeMs: dt.length ? Math.round((dt.reduce((a, b) => a + b, 0) / dt.length) * 10000) / 10000 : null };
  }
  return out;
}
