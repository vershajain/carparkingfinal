import { checkEligibility, decideDynamic, decideFcfs, type RequestView, type SchedulerConfig, type SlotView } from '../scheduler/index.js';
import { SIM_EPOCH, toRequestView, type SimArrival } from './scenarios.js';

export interface SimMetrics {
  arrivedCount: number;
  servedCount: number; // vehicles allocated a slot within the observation period
  unservedCount: number; // still waiting at the end of the period
  avgWaitingMinutes: number | null; // served vehicles only
  emergencyServedCount: number;
  emergencyUnservedCount: number;
  emergencyAllocationMinutes: number | null; // average over served emergency requests
  maxEmergencyAllocationMinutes: number | null;
  utilizationPercent: number; // occupied slot-minutes / usable slot-minutes x 100
  idleEligibleSlotMinutes: number; // free usable slot-time while an eligible request was waiting
  throughputPerHour: number; // served / observation period (hours)
  maxWaitingMinutes: number | null; // all arrived vehicles (still-waiting ones count up to the period end)
  p50WaitingMinutes: number | null;
  p90WaitingMinutes: number | null;
  p95WaitingMinutes: number | null;
  waitDistribution: { label: string; count: number }[];
  exceedingThresholdCount: number; // waited longer than starvationThresholdMinutes
  starvedCount: number; // never served in the period AND over the threshold
  avgSlotFit: number | null; // mean slot suitability of the allocations (0..1)
  accessibleMisuseSlotMinutes: number; // accessible slots occupied by vehicles that do not need them
  decisionTime: { meanMs: number | null; maxMs: number | null; count: number };
  usableSlots: number;
  observationMinutes: number;
}
export interface TimelinePoint { minute: number; occupied: number; utilizationPercent: number; waiting: number; served: number; avgWaitServed: number | null }
export interface SimResult { algorithm: 'dynamic' | 'fcfs'; metrics: SimMetrics; timeline: TimelinePoint[] }

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
const BUCKETS = [[0, 5], [5, 15], [15, 30], [30, 60], [60, 120], [120, Infinity]] as const;

/**
 * Discrete-event simulation with a virtual clock. Runs the REAL scheduling engine
 * (decideDynamic / decideFcfs) on its own copy of the slots, so two runs never share state.
 * Decisions are taken whenever state changes (arrival or departure); both schedulers are
 * work-conserving, i.e. they allocate whenever any waiting vehicle has an eligible free slot.
 * Reservations are not modelled in simulations (they are covered by unit/integration tests).
 */
export function simulate(
  algorithm: 'dynamic' | 'fcfs',
  initialSlots: SlotView[],
  arrivals: SimArrival[],
  cfg: SchedulerConfig,
  horizonMinutes: number,
  sampleEveryMinutes: number,
): SimResult {
  const decide = algorithm === 'dynamic' ? decideDynamic : decideFcfs;
  const slots: SlotView[] = structuredClone(initialSlots); // private copy
  const usable = slots.filter((s) => s.status !== 'unavailable').length;
  const views = arrivals.filter((a) => a.arrivalMinute <= horizonMinutes).map((a) => ({ a, view: toRequestView(a) }));
  const viewById = new Map(views.map((v) => [v.a.id, v]));

  let waiting: RequestView[] = [];
  const running = new Map<string, { end: number; misuse: boolean }>(); // slotId -> session
  const waits = new Map<string, number>(); // served: requestId -> wait
  const emergencyWaits: number[] = [];
  const fits: number[] = [];
  const decisionMs: number[] = [];
  const timeline: TimelinePoint[] = [];
  let occupiedMinutes = 0, idleEligible = 0, misuseMinutes = 0;
  let ai = 0, t = 0, nextSample = 0;

  const toDate = (m: number) => new Date(SIM_EPOCH + m * 60_000);
  const servedWaitSum = () => [...waits.values()].reduce((a, b) => a + b, 0);

  for (;;) {
    // 1. departures
    for (const [slotId, s] of running) {
      if (s.end <= t + 1e-9) {
        running.delete(slotId);
        slots.find((x) => x.id === slotId)!.status = 'available';
      }
    }
    // 2. arrivals
    while (ai < views.length && views[ai].a.arrivalMinute <= t + 1e-9) waiting.push(views[ai++].view);
    // 3. schedule until nothing more can be placed
    const now = toDate(t);
    for (let guard = 0; waiting.length && guard < 10_000; guard++) {
      const d = decide(waiting, slots, cfg, now);
      if (!d) break;
      decisionMs.push(d.decisionTimeMs);
      const slot = slots.find((s) => s.id === d.slot.slotId)!;
      const { a } = viewById.get(d.request.id)!;
      slot.status = 'occupied';
      running.set(slot.id, { end: t + a.durationMinutes, misuse: slot.isAccessible && !a.requiresAccessibleSlot });
      const wait = t - a.arrivalMinute;
      waits.set(a.id, wait);
      if (a.urgency === 'emergency') emergencyWaits.push(wait);
      fits.push(d.slot.slotScore);
      waiting = waiting.filter((w) => w.id !== d.request.id);
    }
    // 4. sample
    if (t >= nextSample - 1e-9 || t >= horizonMinutes) {
      const occ = running.size;
      timeline.push({
        minute: r2(t), occupied: occ, utilizationPercent: usable ? r2((occ / usable) * 100) : 0,
        waiting: waiting.length, served: waits.size, avgWaitServed: waits.size ? r2(servedWaitSum() / waits.size) : null,
      });
      while (nextSample <= t + 1e-9) nextSample += sampleEveryMinutes;
    }
    if (t >= horizonMinutes) break;
    // 5. advance to the next event and integrate the (constant) state over the interval
    const candidates = [horizonMinutes, nextSample];
    if (ai < views.length) candidates.push(views[ai].a.arrivalMinute);
    for (const s of running.values()) candidates.push(s.end);
    const next = Math.min(...candidates.filter((c) => c > t + 1e-9));
    const dt = next - t;
    occupiedMinutes += running.size * dt;
    for (const s of running.values()) if (s.misuse) misuseMinutes += dt;
    const freeEligible = slots.filter((s) => s.status === 'available' && waiting.some((w) => checkEligibility(s, w, toDate(t), cfg).eligible)).length;
    idleEligible += freeEligible * dt;
    t = next;
  }

  // ---- metrics ----
  const allWaits = views.map(({ a }) => waits.get(a.id) ?? horizonMinutes - a.arrivalMinute).sort((x, y) => x - y);
  const served = [...waits.values()];
  const unserved = views.filter(({ a }) => !waits.has(a.id));
  const threshold = cfg.starvationThresholdMinutes;
  const emUnserved = unserved.filter(({ a }) => a.urgency === 'emergency').length;
  const m: SimMetrics = {
    arrivedCount: views.length,
    servedCount: served.length,
    unservedCount: unserved.length,
    avgWaitingMinutes: served.length ? r2(avg(served)!) : null,
    emergencyServedCount: emergencyWaits.length,
    emergencyUnservedCount: emUnserved,
    emergencyAllocationMinutes: emergencyWaits.length ? r2(avg(emergencyWaits)!) : null,
    maxEmergencyAllocationMinutes: emergencyWaits.length ? r2(Math.max(...emergencyWaits)) : null,
    utilizationPercent: usable ? r2((occupiedMinutes / (usable * horizonMinutes)) * 100) : 0,
    idleEligibleSlotMinutes: r2(idleEligible),
    throughputPerHour: r2(served.length / (horizonMinutes / 60)),
    maxWaitingMinutes: allWaits.length ? r2(allWaits[allWaits.length - 1]) : null,
    p50WaitingMinutes: percentile(allWaits, 50) === null ? null : r2(percentile(allWaits, 50)!),
    p90WaitingMinutes: percentile(allWaits, 90) === null ? null : r2(percentile(allWaits, 90)!),
    p95WaitingMinutes: percentile(allWaits, 95) === null ? null : r2(percentile(allWaits, 95)!),
    waitDistribution: BUCKETS.map(([lo, hi]) => ({
      label: hi === Infinity ? `${lo}+ min` : `${lo}-${hi} min`,
      count: allWaits.filter((w) => w >= lo && w < hi).length,
    })),
    exceedingThresholdCount: allWaits.filter((w) => w > threshold).length,
    starvedCount: unserved.filter(({ a }) => horizonMinutes - a.arrivalMinute > threshold).length,
    avgSlotFit: fits.length ? r4(avg(fits)!) : null,
    accessibleMisuseSlotMinutes: r2(misuseMinutes),
    decisionTime: { meanMs: decisionMs.length ? r4(avg(decisionMs)!) : null, maxMs: decisionMs.length ? r4(Math.max(...decisionMs)) : null, count: decisionMs.length },
    usableSlots: usable,
    observationMinutes: horizonMinutes,
  };
  return { algorithm, metrics: m, timeline };
}
