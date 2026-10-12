import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULER_CONFIG } from '../../src/config/defaults.js';
import { compareMetrics, improvement } from '../../src/analytics/comparison.js';
import { arrivalsDigest, buildSlots, generateArrivals, PRESETS, resolveSpec, type SimArrival } from '../../src/analytics/scenarios.js';
import { simulate } from '../../src/analytics/simulator.js';
import type { SchedulerConfig } from '../../src/scheduler/index.js';

const CFG = structuredClone(DEFAULT_SCHEDULER_CONFIG) as unknown as SchedulerConfig;
const one = (o: Partial<SimArrival> & { id: string; arrivalMinute: number }): SimArrival => ({
  vehicleType: 'car', durationMinutes: 60, urgency: 'normal', requiresAccessibleSlot: false, ...o,
});
const spec1 = resolveSpec('normal_demand', { layout: [{ slotType: 'standard', count: 1 }] });
const slots1 = () => buildSlots(spec1);
const stripTime = (m: any) => ({ ...m, decisionTime: undefined });

describe('improvement formulas', () => {
  it('lower-is-better: (FCFS - Dynamic) / FCFS x 100', () => {
    expect(improvement(50, 40, 'lower').percent).toBe(20);
    expect(improvement(40, 50, 'lower').percent).toBe(-25); // worse is shown as negative, never hidden
  });
  it('higher-is-better: (Dynamic - FCFS) / FCFS x 100', () => {
    expect(improvement(50, 60, 'higher').percent).toBe(20);
    expect(improvement(60, 50, 'higher').percent).toBe(-16.67);
  });
  it('handles zero denominators and missing data without inventing a number', () => {
    expect(improvement(0, 5, 'lower')).toEqual({ percent: null, note: 'FCFS value is 0: percentage undefined' });
    expect(improvement(0, 0, 'higher').percent).toBe(0);
    expect(improvement(null, 5, 'lower').percent).toBeNull();
    expect(improvement(5, null, 'higher').percent).toBeNull();
  });
});

describe('scenario generation is reproducible', () => {
  it('same seed -> identical arrivals; different seed -> different', () => {
    const a = generateArrivals(PRESETS.normal_demand), b = generateArrivals(PRESETS.normal_demand);
    expect(a).toEqual(b);
    expect(arrivalsDigest(a)).toBe(arrivalsDigest(b));
    expect(arrivalsDigest(generateArrivals({ ...PRESETS.normal_demand, seed: 7 }))).not.toBe(arrivalsDigest(a));
  });
  it('respects counts, ordering, ratios of zero, and slot unavailability', () => {
    const s = { ...PRESETS.normal_demand, emergencyRatio: 0, arrivalCount: 40 };
    const a = generateArrivals(s);
    expect(a).toHaveLength(40);
    expect(a.some((x) => x.urgency === 'emergency')).toBe(false);
    expect(a.map((x) => x.arrivalMinute)).toEqual([...a.map((x) => x.arrivalMinute)].sort((x, y) => x - y));
    expect(buildSlots(PRESETS.capacity_shortage).filter((x) => x.status === 'unavailable')).toHaveLength(6);
  });
});

describe('simulator measurements (hand-computed expectations)', () => {
  const arrivals = [one({ id: 'SIM-0001', arrivalMinute: 0 }), one({ id: 'SIM-0002', arrivalMinute: 5 }), one({ id: 'SIM-0003', arrivalMinute: 10, urgency: 'emergency' })];

  it('FCFS: waits 0/55/110, utilization 60%, throughput 0.6/h', () => {
    const r = simulate('fcfs', slots1(), arrivals, CFG, 300, 30).metrics;
    expect(r.servedCount).toBe(3);
    expect(r.avgWaitingMinutes).toBe(55);              // (0+55+110)/3
    expect(r.emergencyAllocationMinutes).toBe(110);    // emergency served last under FCFS
    expect(r.utilizationPercent).toBe(60);             // 180 busy min / 300
    expect(r.throughputPerHour).toBe(0.6);             // 3 / 5h
    expect(r.maxWaitingMinutes).toBe(110);
    expect(r.idleEligibleSlotMinutes).toBe(0);
  });
  it('Dynamic: the verified emergency is served second (wait 50), same utilization', () => {
    const r = simulate('dynamic', slots1(), arrivals, CFG, 300, 30).metrics;
    expect(r.emergencyAllocationMinutes).toBe(50);
    expect(r.avgWaitingMinutes).toBe(55);              // (0+50+115)/3
    expect(r.maxWaitingMinutes).toBe(115);
    expect(r.utilizationPercent).toBe(60);
  });
  it('comparison applies the formulas to those measurements', () => {
    const f = simulate('fcfs', slots1(), arrivals, CFG, 300, 30).metrics, d = simulate('dynamic', slots1(), arrivals, CFG, 300, 30).metrics;
    const row = compareMetrics(f, d).find((m) => m.key === 'emergencyAllocationMinutes')!;
    expect(row.improvementPercent).toBe(54.55);        // (110-50)/110
    const wait = compareMetrics(f, d).find((m) => m.key === 'avgWaitingMinutes')!;
    expect(wait.improvementPercent).toBe(0);
    const maxw = compareMetrics(f, d).find((m) => m.key === 'maxWaitingMinutes')!;
    expect(maxw.improvementPercent).toBe(-4.55);       // dynamic is WORSE on max wait here; reported honestly
  });
  it('vehicles still waiting at the end are unserved and counted for starvation', () => {
    const many = Array.from({ length: 6 }, (_, i) => one({ id: `SIM-000${i + 1}`, arrivalMinute: i, durationMinutes: 120 }));
    const r = simulate('fcfs', slots1(), many, CFG, 200, 20).metrics; // only 2 fit in 200 min (0-120, 120-240)
    expect(r.servedCount).toBe(2);
    expect(r.unservedCount).toBe(4);
    expect(r.starvedCount).toBe(4);                    // each waited > 90 min threshold
  });
  it('empty scenario: no served vehicles -> null averages, 0 utilization, no division by zero', () => {
    const r = simulate('dynamic', slots1(), [], CFG, 100, 20).metrics;
    expect(r.avgWaitingMinutes).toBeNull(); expect(r.emergencyAllocationMinutes).toBeNull();
    expect(r.utilizationPercent).toBe(0); expect(r.throughputPerHour).toBe(0); expect(r.maxWaitingMinutes).toBeNull();
  });
  it('no usable slots: nothing is served and utilization is 0', () => {
    const r = simulate('dynamic', buildSlots(resolveSpec('normal_demand', { unavailableSlots: 99 })), arrivals, CFG, 100, 20).metrics;
    expect(r.servedCount).toBe(0); expect(r.usableSlots).toBe(0); expect(r.utilizationPercent).toBe(0);
  });
  it('a vehicle that needs an accessible slot is never given a normal one; accessible misuse is measured', () => {
    const s = resolveSpec('normal_demand', { layout: [{ slotType: 'accessible', count: 1 }] });
    const misuse = simulate('fcfs', buildSlots(s), [one({ id: 'SIM-0001', arrivalMinute: 0 })], CFG, 120, 20).metrics;
    expect(misuse.accessibleMisuseSlotMinutes).toBe(60); // a car without the need sat in the accessible slot for 60 min
    const needs = simulate('fcfs', slots1(), [one({ id: 'SIM-0001', arrivalMinute: 0, requiresAccessibleSlot: true })], CFG, 120, 20).metrics;
    expect(needs.servedCount).toBe(0);
  });
});

describe('equivalent-scenario comparison', () => {
  const spec = resolveSpec('high_demand', { arrivalCount: 60, horizonMinutes: 300 });
  const arrivals = generateArrivals(spec);
  it('both algorithms see identical input and the initial state is not mutated', () => {
    const initial = buildSlots(spec);
    const before = JSON.stringify(initial);
    const f = simulate('fcfs', initial, arrivals, CFG, 300, 25), d = simulate('dynamic', initial, arrivals, CFG, 300, 25);
    expect(JSON.stringify(initial)).toBe(before);
    expect(f.metrics.arrivedCount).toBe(d.metrics.arrivedCount);
    expect(f.metrics.usableSlots).toBe(d.metrics.usableSlots);
  });
  it('re-running with identical inputs gives identical measurements (except machine-dependent decision time)', () => {
    const a = simulate('dynamic', buildSlots(spec), arrivals, CFG, 300, 25), b = simulate('dynamic', buildSlots(spec), arrivals, CFG, 300, 25);
    expect(stripTime(a.metrics)).toEqual(stripTime(b.metrics));
    expect(a.timeline).toEqual(b.timeline);
  });
  it('timeline is monotone in served count and covers the whole period', () => {
    const t = simulate('dynamic', buildSlots(spec), arrivals, CFG, 300, 25).timeline;
    expect(t[0].minute).toBe(0); expect(t[t.length - 1].minute).toBe(300);
    for (let i = 1; i < t.length; i++) expect(t[i].served).toBeGreaterThanOrEqual(t[i - 1].served);
  });
  it('is work-conserving: no slot idles while an eligible request waits', () => {
    for (const algo of ['fcfs', 'dynamic'] as const)
      expect(simulate(algo, buildSlots(spec), arrivals, CFG, 300, 25).metrics.idleEligibleSlotMinutes).toBe(0);
  });
  it('every preset runs for both algorithms and respects utilization bounds', () => {
    for (const key of Object.keys(PRESETS)) {
      const s = resolveSpec(key);
      const a = generateArrivals(s);
      for (const algo of ['fcfs', 'dynamic'] as const) {
        const m = simulate(algo, buildSlots(s), a, CFG, s.horizonMinutes, 30).metrics;
        expect(m.utilizationPercent).toBeGreaterThanOrEqual(0); expect(m.utilizationPercent).toBeLessThanOrEqual(100);
        expect(m.servedCount + m.unservedCount).toBe(m.arrivedCount);
      }
    }
  });
});
