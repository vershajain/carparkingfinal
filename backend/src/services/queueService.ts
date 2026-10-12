import { decideDynamic, fcfsOrder, rankQueue, TIER_NAMES } from '../scheduler/index.js';
import { getRuntimeConfig } from './configService.js';
import { loadState } from './views.js';

/** Live queue: scores are recomputed NOW from the engine (not read from stale snapshots). */
export async function getQueue() {
  const cfg = await getRuntimeConfig();
  const state = await loadState();
  const now = new Date();
  const { ranked } = rankQueue(state.requests, state.slots, cfg.engine, now);
  const fcfsPos = new Map(fcfsOrder(state.requests).map((r, i) => [r.id, i + 1]));
  const preview = decideDynamic(state.requests, state.slots, cfg.engine, now);
  return {
    computedAt: now.toISOString(),
    activeAlgorithm: cfg.activeAlgorithm,
    weights: cfg.engine.weights,
    tieBreakRule: 'tier (emergency > starving > regular), then higher priority score, then earlier arrival, then request ID',
    rows: ranked.map((r) => ({
      id: r.request.id, requestId: r.request.requestId, registration: r.request.registration, vehicleType: r.request.vehicleType,
      arrivalTime: r.request.arrivalTime, waitingMinutes: Math.round(r.waitingMinutes * 100) / 100,
      urgency: r.request.urgency, expectedDurationMinutes: r.request.expectedDurationMinutes,
      reservationId: r.request.reservation?.reservationId ?? null,
      reservationValid: r.score.factors.reservation === 1,
      preferredAreaCode: r.request.preferredAreaCode, requiresAccessibleSlot: r.request.requiresAccessibleSlot,
      priorityScore: r.score.priorityScore, factors: r.score.factors, contributions: r.score.contributions,
      tier: r.tier, tierName: TIER_NAMES[r.tier],
      position: r.position, fcfsPosition: fcfsPos.get(r.request.id),
      eligibleSlotCount: r.eligibleSlotCount,
      status: r.schedulable ? 'waiting (slot available - will be scheduled)' : 'waiting (no eligible slot)',
    })),
    nextSelection: preview && {
      requestId: preview.request.requestId, slotCode: preview.slot.code, slotScore: preview.slot.slotScore,
      vehicleReason: preview.vehicleReason, slotReason: preview.slotReason, fcfs: preview.fcfs,
    },
  };
}
