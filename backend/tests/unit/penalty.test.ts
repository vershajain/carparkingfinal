import { describe, it, expect } from 'vitest';
import { computePenalty } from '../../src/utils/penalty.js';

const cfg = { graceMinutes: 10, ratePerHour: 60, currency: 'units', roundingMinutes: 15 };
const T0 = new Date('2026-10-12T10:00:00Z');
const plus = (m: number) => new Date(T0.getTime() + m * 60_000);

describe('overstay penalty calculation', () => {
  it('no penalty for early or on-time exit', () => {
    expect(computePenalty(T0, plus(-30), cfg).amount).toBe(0);
    expect(computePenalty(T0, T0, cfg).overstayMinutes).toBe(0);
  });
  it('no penalty inside the grace period, but overstay is still recorded', () => {
    const p = computePenalty(T0, plus(8), cfg);
    expect(p.overstayMinutes).toBe(8); expect(p.amount).toBe(0);
  });
  it('charges only beyond grace, rounded UP to blocks', () => {
    // overstay 50 - grace 10 = 40 chargeable -> 3 blocks of 15 = 45 min -> 45/60*60 = 45
    const p = computePenalty(T0, plus(50), cfg);
    expect(p.chargeableMinutes).toBe(40); expect(p.billedMinutes).toBe(45); expect(p.amount).toBe(45);
    expect(p.formula).toContain('45');
  });
  it('supports no rounding (block = 0) and different rates', () => {
    const p = computePenalty(T0, plus(40), { ...cfg, roundingMinutes: 0, ratePerHour: 120 });
    expect(p.billedMinutes).toBe(30); expect(p.amount).toBe(60);
  });
  it('a zero rate yields zero amount', () => expect(computePenalty(T0, plus(500), { ...cfg, ratePerHour: 0 }).amount).toBe(0));
});
