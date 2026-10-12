import { describe, it, expect } from 'vitest';
import { cfg, minsAgo, minsFromNow, NOW, req, reservation, slot } from './helpers.js';
import {
  checkEligibility, combine, decideDynamic, decideFcfs, demandFactor, durationFactor, evaluateCandidates,
  fairnessFactor, fcfsOrder, rankQueue, reservationFactor, urgencyFactor, validateConfig, validateReservation,
  waitingFactor,
} from '../../src/scheduler/index.js';

const C = cfg();

describe('configuration & weight validation', () => {
  it('accepts the default config', () => expect(validateConfig(C)).toEqual([]));
  it('rejects weights that do not sum to 1', () => {
    const c = cfg(); c.weights.waiting = 0.5;
    expect(validateConfig(c).join()).toMatch(/sum to 1/);
  });
  it('rejects negative weights and bad scores', () => {
    const c = cfg(); c.weights.waiting = -0.1; c.weights.urgency = 0.6; c.urgencyScores.normal = 1.5;
    const e = validateConfig(c).join();
    expect(e).toMatch(/non-negative/); expect(e).toMatch(/urgencyScores.normal/);
  });
  it('rejects non-monotonic demand thresholds', () => {
    const c = cfg(); c.demandThresholds = { low: 2, medium: 1, high: 0.5 };
    expect(validateConfig(c).join()).toMatch(/demandThresholds/);
  });
});

describe('factor normalisation', () => {
  it('waiting time: linear then capped at 1', () => {
    expect(waitingFactor(0, C)).toBe(0);
    expect(waitingFactor(30, C)).toBeCloseTo(0.5);
    expect(waitingFactor(600, C)).toBe(1);
  });
  it('urgency maps verified category', () => {
    expect(urgencyFactor(req('a', { urgency: 'emergency' }), C)).toBe(1);
    expect(urgencyFactor(req('a'), C)).toBe(0.2);
  });
  it('demand bands come from config thresholds', () => {
    expect(demandFactor(1, 10, C)).toBe(0);          // ratio 0.1 < low
    expect(demandFactor(5, 10, C)).toBe(0.2);        // 0.5 -> low
    expect(demandFactor(10, 10, C)).toBe(0.6);       // 1.0 -> medium
    expect(demandFactor(30, 10, C)).toBe(1);         // 3.0 -> high
    expect(demandFactor(4, 0, C)).toBe(1);           // zero eligible slots: no divide-by-zero
  });
  it('duration policy: shorter vs longer', () => {
    expect(durationFactor(60, C)).toBeCloseTo(1 - 60 / 480);
    expect(durationFactor(9999, C)).toBe(0);
    expect(durationFactor(60, cfg({ durationPolicy: 'longer' }))).toBeCloseTo(60 / 480);
  });
  it('fairness has a grace period so it does not duplicate early waiting', () => {
    expect(fairnessFactor(10, C)).toBe(0);
    expect(fairnessFactor(15 + 60, C)).toBeCloseTo(0.5);
    expect(fairnessFactor(1000, C)).toBe(1);
  });
});

describe('priority score formula', () => {
  it('equals 100 * sum(weight * value) and contributions add up', () => {
    const f = { waiting: 0.5, urgency: 1, demand: 0.2, duration: 0.5, reservation: 1, suitability: 0.8, fairness: 0.25 };
    const b = combine(f, C);
    const w = C.weights;
    const expected = 100 * (w.waiting * 0.5 + w.urgency * 1 + w.demand * 0.2 + w.duration * 0.5 + w.reservation * 1 + w.suitability * 0.8 + w.fairness * 0.25);
    expect(b.priorityScore).toBeCloseTo(expected, 4);
    expect(Object.values(b.contributions).reduce((a, x) => a + x, 0)).toBeCloseTo(expected, 4);
    expect(b.priorityScore).toBeGreaterThanOrEqual(0); expect(b.priorityScore).toBeLessThanOrEqual(100);
  });
  it('all factors stay in [0,1] for extreme inputs', () => {
    const r = rankQueue([req('x', { arrivalTime: minsAgo(99999), expectedDurationMinutes: 99999 })], [slot('S1')], C, NOW).ranked[0];
    for (const v of Object.values(r.score.factors)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe('reservation validity', () => {
  const r = (o = {}) => reservation({ registration: 'REG-A', ...o });
  it('valid inside the claim window', () => expect(validateReservation(r(), 'REG-A', NOW, C).valid).toBe(true));
  it('invalid: wrong vehicle', () => expect(validateReservation(r(), 'REG-B', NOW, C).valid).toBe(false));
  it('invalid: cancelled / expired / used', () => {
    for (const status of ['cancelled', 'expired', 'used'] as const)
      expect(validateReservation(r({ status }), 'REG-A', NOW, C).valid).toBe(false);
  });
  it('invalid: window not open yet, and no-show after claim deadline, and ended', () => {
    expect(validateReservation(r({ startTime: minsFromNow(60) }), 'REG-A', NOW, C).reason).toMatch(/not opened/);
    expect(validateReservation(r({ startTime: minsAgo(45) }), 'REG-A', NOW, C).reason).toMatch(/no-show/);
    expect(validateReservation(r({ endTime: minsAgo(1) }), 'REG-A', NOW, C).reason).toMatch(/ended/);
  });
  it('invalid reservation gets R = 0', () => {
    const bad = req('A', { registration: 'REG-A', reservation: r({ status: 'expired' }) });
    expect(reservationFactor(bad, NOW, C)).toBe(0);
    expect(reservationFactor(req('A', { registration: 'REG-A', reservation: r() }), NOW, C)).toBe(1);
  });
});

describe('hard eligibility (vehicle-slot compatibility)', () => {
  it('never allows occupied / unavailable / incompatible / inaccessible slots', () => {
    const car = req('c');
    expect(checkEligibility(slot('A', { status: 'occupied' }), car, NOW, C).eligible).toBe(false);
    expect(checkEligibility(slot('A', { status: 'unavailable' }), car, NOW, C).eligible).toBe(false);
    expect(checkEligibility(slot('A', { compatibleVehicleTypes: ['bike'] }), car, NOW, C).eligible).toBe(false);
    expect(checkEligibility(slot('A'), req('d', { requiresAccessibleSlot: true }), NOW, C).eligible).toBe(false);
    expect(checkEligibility(slot('A', { isAccessible: true }), req('d', { requiresAccessibleSlot: true }), NOW, C).eligible).toBe(true);
  });
  it('a reserved slot is usable only by the holder with a VALID reservation', () => {
    const held = slot('R1', { status: 'reserved', reservation: reservation({ registration: 'REG-owner', slotId: 'id-R1' }) });
    expect(checkEligibility(held, req('o', { registration: 'REG-owner' }), NOW, C).ownReservation).toBe(true);
    expect(checkEligibility(held, req('other'), NOW, C).eligible).toBe(false);
    const expiredHold = slot('R1', { status: 'reserved', reservation: reservation({ registration: 'REG-owner', status: 'expired' }) });
    expect(checkEligibility(expiredHold, req('o', { registration: 'REG-owner' }), NOW, C).eligible).toBe(false);
  });
  it('emergency may use a reserved slot only if its claim window has not opened (and policy allows)', () => {
    const future = slot('R1', { status: 'reserved', reservation: reservation({ registration: 'REG-owner', startTime: minsFromNow(120), endTime: minsFromNow(240) }) });
    const em = req('e', { urgency: 'emergency' });
    expect(checkEligibility(future, em, NOW, C).emergencyOverride).toBe(true);
    expect(checkEligibility(future, req('n'), NOW, C).eligible).toBe(false);
    const off = cfg(); off.emergencyPolicy.allowUseOfReservedUnclaimedSlots = false;
    expect(checkEligibility(future, em, NOW, off).eligible).toBe(false);
    const active = slot('R2', { status: 'reserved', reservation: reservation({ registration: 'REG-owner' }) });
    expect(checkEligibility(active, em, NOW, C).eligible).toBe(false);
  });
});

describe('slot suitability / selection', () => {
  it('prefers the matching slot type and preferred area; saves accessible slots', () => {
    const slots = [slot('A1', { slotType: 'large', areaCode: 'Area 2' }), slot('A2', { slotType: 'compact', areaCode: 'Area 1' }), slot('A3', { slotType: 'compact', isAccessible: true })];
    const c = evaluateCandidates(slots, req('c', { preferredAreaCode: 'Area 1' }), NOW, C);
    expect(c[0].code).toBe('A2');
    expect(c[c.length - 1].code).not.toBe('A2');
  });
  it('ties on suitability resolve by natural slot-code order', () => {
    const c = evaluateCandidates([slot('B1-S10'), slot('B1-S02'), slot('B1-S01')], req('c'), NOW, C);
    expect(c.map((x) => x.code)).toEqual(['B1-S01', 'B1-S02', 'B1-S10']);
  });
  it("gives an owner's reserved slot the best suitability", () => {
    const own = slot('R1', { status: 'reserved', reservation: reservation({ registration: 'REG-o', slotId: 'id-R1' }) });
    const r = req('o', { registration: 'REG-o', reservation: own.reservation });
    expect(evaluateCandidates([slot('A1'), own], r, NOW, C)[0].code).toBe('R1');
  });
});

describe('dynamic queue ordering', () => {
  const slots = [slot('S1')];
  it('verified emergency outranks everyone, including longer-waiting vehicles', () => {
    const ranked = rankQueue([req('old', { arrivalTime: minsAgo(50) }), req('em', { urgency: 'emergency', arrivalTime: minsAgo(1) })], slots, C, NOW).ranked;
    expect(ranked[0].request.id).toBe('em');
  });
  it('multiple emergencies are ordered by score then arrival', () => {
    const ranked = rankQueue([
      req('e2', { urgency: 'emergency', arrivalTime: minsAgo(5), expectedDurationMinutes: 60 }),
      req('e1', { urgency: 'emergency', arrivalTime: minsAgo(30), expectedDurationMinutes: 60 }),
    ], slots, C, NOW).ranked;
    expect(ranked.map((r) => r.request.id)).toEqual(['e1', 'e2']);
  });
  it('higher score wins within a tier (priority beats normal at equal wait)', () => {
    const ranked = rankQueue([req('n'), req('p', { urgency: 'priority' })], slots, C, NOW).ranked;
    expect(ranked[0].request.id).toBe('p');
  });
  it('recomputes with time: a long-waiting normal request overtakes a newer priority one', () => {
    const q = [req('n', { arrivalTime: minsAgo(80) }), req('p', { urgency: 'priority', arrivalTime: minsAgo(2) })];
    expect(rankQueue(q, slots, C, NOW).ranked[0].request.id).toBe('n');
    const early = new Date(NOW.getTime() - 78 * 60_000); // 2 min after n arrived
    const q2 = [req('n', { arrivalTime: minsAgo(80) }), req('p', { urgency: 'priority', arrivalTime: minsAgo(80) })];
    expect(rankQueue(q2, slots, C, early).ranked[0].request.id).toBe('p');
  });
  it('deterministic tie-break: arrival, then requestId', () => {
    const a = req('REQ-000002', { arrivalTime: minsAgo(5) });
    const b = req('REQ-000010', { arrivalTime: minsAgo(5) });
    expect(rankQueue([b, a], slots, C, NOW).ranked.map((r) => r.request.requestId)).toEqual(['REQ-000002', 'REQ-000010']);
  });
  it('same inputs in any order give the same decision', () => {
    const q = [req('a', { arrivalTime: minsAgo(9) }), req('b', { arrivalTime: minsAgo(20) }), req('c', { urgency: 'priority' }), req('d', { arrivalTime: minsAgo(20) })];
    const s = [slot('S1'), slot('S2')];
    const d1 = decideDynamic(q, s, C, NOW)!;
    const d2 = decideDynamic([...q].reverse(), [...s].reverse(), C, NOW)!;
    expect([d1.request.id, d1.slot.code]).toEqual([d2.request.id, d2.slot.code]);
  });
  it('does not mutate its inputs', () => {
    const q = [req('a'), req('b')]; const s = [slot('S1')];
    const before = JSON.stringify([q, s]);
    decideDynamic(q, s, C, NOW);
    expect(JSON.stringify([q, s])).toBe(before);
  });
});

describe('aging / starvation prevention', () => {
  it('a starving regular request outranks a fresh non-emergency request with a higher raw score', () => {
    const q = [req('starved', { arrivalTime: minsAgo(100), expectedDurationMinutes: 900 }), req('fresh', { urgency: 'priority', arrivalTime: minsAgo(1), expectedDurationMinutes: 30 })];
    // urgency-heavy weights: raw score alone would favour the fresh priority request
    const heavy = cfg(); heavy.weights = { waiting: 0.05, urgency: 0.5, demand: 0.05, duration: 0.2, reservation: 0.05, suitability: 0.1, fairness: 0.05 };
    expect(validateConfig(heavy)).toEqual([]);
    const r = rankQueue(q, [slot('S1')], heavy, NOW).ranked;
    const fresh = r.find((x) => x.request.id === 'fresh')!, starved = r.find((x) => x.request.id === 'starved')!;
    expect(fresh.score.priorityScore).toBeGreaterThan(starved.score.priorityScore);
    expect(starved.tier).toBe(1);
    expect(r[0].request.id).toBe('starved');
  });
  it('emergency still precedes a starving vehicle (documented rule)', () => {
    const q = [req('starved', { arrivalTime: minsAgo(500) }), req('em', { urgency: 'emergency' })];
    expect(rankQueue(q, [slot('S1')], C, NOW).ranked[0].request.id).toBe('em');
  });
  it('fairness score grows monotonically with waiting time', () => {
    const f = [20, 40, 80, 150].map((m) => fairnessFactor(m, C));
    expect(f).toEqual([...f].sort((a, b) => a - b));
  });
});

describe('dynamic allocation decision', () => {
  it('returns null when no slot exists (no forced allocation)', () => {
    expect(decideDynamic([req('a')], [slot('S1', { status: 'occupied' }), slot('S2', { status: 'unavailable' })], C, NOW)).toBeNull();
    expect(decideDynamic([], [slot('S1')], C, NOW)).toBeNull();
  });
  it('incompatible vehicles are never allocated, and skipped without blocking others', () => {
    const q = [req('suv', { vehicleType: 'suv', urgency: 'emergency' }), req('bike', { vehicleType: 'bike' })];
    const s = [slot('B1', { slotType: 'bike', compatibleVehicleTypes: ['bike'] })];
    const d = decideDynamic(q, s, C, NOW)!;
    expect(d.request.id).toBe('bike');
    expect(d.vehicleReason).toMatch(/skipped/);
  });
  it('invalid reservation gives no benefit and no access to the reserved slot', () => {
    const held = slot('R1', { status: 'reserved', reservation: reservation({ registration: 'REG-v', status: 'cancelled', slotId: 'id-R1' }) });
    const v = req('v', { registration: 'REG-v', reservation: held.reservation });
    expect(decideDynamic([v], [held], C, NOW)).toBeNull();
    expect(rankQueue([v], [slot('S1')], C, NOW).ranked[0].score.factors.reservation).toBe(0);
  });
  it('provides full explanation data: factors, contributions, alternatives, FCFS comparison', () => {
    const q = [req('old', { arrivalTime: minsAgo(40), expectedDurationMinutes: 600 }), req('em', { urgency: 'emergency', arrivalTime: minsAgo(2) })];
    const d = decideDynamic(q, [slot('S1'), slot('S2'), slot('S3')], C, NOW)!;
    expect(d.request.id).toBe('em');
    expect(d.vehicleScore!.priorityScore).toBeGreaterThan(0);
    expect(Object.keys(d.vehicleScore!.contributions)).toHaveLength(7);
    expect(d.alternatives.length).toBe(2);
    expect(d.slot.slotScore).toBeGreaterThan(0);
    expect(d.fcfs!.differs).toBe(true);
    expect(d.fcfs!.requestId).toBe('old');
    expect(d.decisionTimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('FCFS baseline', () => {
  it('orders by arrival then requestId', () => {
    const o = fcfsOrder([req('b', { arrivalTime: minsAgo(1) }), req('c', { arrivalTime: minsAgo(9) }), req('a', { arrivalTime: minsAgo(9) })]);
    expect(o.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });
  it('ignores urgency (no emergency boost) but respects hard constraints', () => {
    const d = decideFcfs([req('em', { urgency: 'emergency', arrivalTime: minsAgo(1) }), req('first', { arrivalTime: minsAgo(30) })], [slot('S1')], C, NOW)!;
    expect(d.request.id).toBe('first');
    expect(d.algorithm).toBe('fcfs'); expect(d.vehicleScore).toBeNull();
  });
  it('skips a request with no eligible slot and serves the next earliest', () => {
    const q = [req('suv', { vehicleType: 'suv', arrivalTime: minsAgo(30) }), req('bike', { vehicleType: 'bike', arrivalTime: minsAgo(10) })];
    const d = decideFcfs(q, [slot('B1', { compatibleVehicleTypes: ['bike'], slotType: 'bike' })], C, NOW)!;
    expect(d.request.id).toBe('bike');
  });
  it('picks the lowest slot code and returns null when full', () => {
    expect(decideFcfs([req('a')], [slot('S3'), slot('S1'), slot('S2')], C, NOW)!.slot.code).toBe('S1');
    expect(decideFcfs([req('a')], [slot('S1', { status: 'occupied' })], C, NOW)).toBeNull();
  });
});
