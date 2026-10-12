import { describe, it, expect } from 'vitest';
import { cfg, minsAgo, minsFromNow, NOW, req, reservation, slot } from './helpers.js';
import { checkEligibility, decideDynamic, decideFcfs, evaluateCandidates } from '../../src/scheduler/index.js';

const C = cfg(); // hold opens 15 min before start; claim deadline 30 min after start
const upcoming = (startIn: number, extra = {}) =>
  slot('R1', { status: 'available', reservation: reservation({ registration: 'REG-owner', slotId: 'id-R1', startTime: minsFromNow(startIn), endTime: minsFromNow(startIn + 120), ...extra }) });

describe('reserved capacity vs ordinary / emergency requests', () => {
  it('upcoming reservation: a stay that ends before the hold opens may use the slot', () => {
    const s = upcoming(120); // hold opens in 105 min
    expect(checkEligibility(s, req('short', { expectedDurationMinutes: 60 }), NOW, C).eligible).toBe(true);
    expect(checkEligibility(s, req('edge', { expectedDurationMinutes: 105 }), NOW, C).eligible).toBe(true);
    expect(checkEligibility(s, req('long', { expectedDurationMinutes: 106 }), NOW, C).eligible).toBe(false);
  });
  it('upcoming reservation: a long-stay emergency may use it only as a flagged last resort', () => {
    const s = upcoming(120);
    const e = checkEligibility(s, req('e', { urgency: 'emergency', expectedDurationMinutes: 240 }), NOW, C);
    expect(e.eligible && e.emergencyOverride).toBe(true);
    const off = cfg(); off.emergencyPolicy.allowUseOfReservedUnclaimedSlots = false;
    expect(checkEligibility(s, req('e', { urgency: 'emergency', expectedDurationMinutes: 240 }), NOW, off).eligible).toBe(false);
  });
  it('open hold: nobody but the holder (not even an emergency) can use the slot', () => {
    const held = slot('R1', { status: 'reserved', reservation: reservation({ registration: 'REG-owner', slotId: 'id-R1' }) });
    expect(checkEligibility(held, req('o', { registration: 'REG-owner' }), NOW, C).ownReservation).toBe(true);
    expect(checkEligibility(held, req('x', { expectedDurationMinutes: 5 }), NOW, C).eligible).toBe(false);
    expect(checkEligibility(held, req('e', { urgency: 'emergency' }), NOW, C).eligible).toBe(false);
  });
  it('no-show: after the claim deadline the slot is free again (if the service has not yet released it, it is not usable)', () => {
    const r = reservation({ registration: 'REG-owner', slotId: 'id-R1', startTime: minsAgo(45), endTime: minsFromNow(60) });
    expect(checkEligibility(slot('R1', { status: 'available', reservation: r }), req('x'), NOW, C).eligible).toBe(true);
    expect(checkEligibility(slot('R1', { status: 'reserved', reservation: r }), req('x'), NOW, C).eligible).toBe(false);
  });
  it('a holder arriving before the hold opens gets no special access', () => {
    const s = upcoming(120);
    const early = req('o', { registration: 'REG-owner', expectedDurationMinutes: 240 });
    expect(checkEligibility(s, early, NOW, C).ownReservation).toBe(false);
    expect(checkEligibility(s, early, NOW, C).eligible).toBe(false);
  });
});

describe('a valid slot-specific reservation is a hard assignment', () => {
  const own = slot('R1', { slotType: 'large', areaCode: 'Area 1', status: 'reserved', reservation: reservation({ registration: 'REG-o', slotId: 'id-R1' }) });
  const better = slot('G1', { slotType: 'standard', areaCode: 'Area 2' });
  const r = req('o', { registration: 'REG-o', preferredAreaCode: 'Area 2', reservation: own.reservation });
  it('only the reserved slot is offered, even if another slot would score higher', () => {
    const c = evaluateCandidates([own, better], r, NOW, C);
    expect(c.map((x) => x.code)).toEqual(['R1']);
  });
  it('both algorithms allocate the reserved slot', () => {
    expect(decideDynamic([r], [own, better], C, NOW)!.slot.code).toBe('R1');
    expect(decideFcfs([r], [own, better], C, NOW)!.slot.code).toBe('R1');
  });
});
