import { performance } from 'node:perf_hooks';
import { computeScore, waitingMinutes } from './factors.js';
import { fcfsPick } from './fcfs.js';
import { evaluateCandidates, naturalCompare } from './suitability.js';
import {
  Decision, FACTOR_KEYS, RankedRequest, RequestView, SchedulerConfig, SlotCandidate, SlotView, Tier, TIER_NAMES,
} from './types.js';

/** Tier 0: verified emergency. Tier 1: starving (waited >= threshold). Tier 2: everyone else. */
export function tierOf(req: RequestView, wait: number, cfg: SchedulerConfig): Tier {
  if (req.urgency === 'emergency') return 0;
  if (wait >= cfg.starvationThresholdMinutes) return 1;
  return 2;
}

/**
 * Orders the waiting queue. Sort key (all deterministic):
 *   1. tier ascending              (HARD rule: emergency > starving > regular)
 *   2. priorityScore descending    (weighted preference)
 *   3. arrivalTime ascending       (earlier arrival wins ties)
 *   4. requestId natural ascending (final, total tie-break)
 * Pure function: inputs are not mutated, so equal inputs always yield equal output.
 */
export function rankQueue(
  requests: RequestView[],
  slots: SlotView[],
  cfg: SchedulerConfig,
  now: Date,
): { ranked: RankedRequest[]; candidates: Map<string, SlotCandidate[]> } {
  const candidates = new Map<string, SlotCandidate[]>();
  const rows: Omit<RankedRequest, 'position'>[] = requests.map((request) => {
    const cands = evaluateCandidates(slots, request, now, cfg);
    candidates.set(request.id, cands);
    const wait = waitingMinutes(request, now);
    const score = computeScore(
      request,
      { waitingCount: requests.length, eligibleSlotCount: cands.length, bestSlotScore: cands[0]?.slotScore ?? 0 },
      cfg,
      now,
    );
    return {
      request, tier: tierOf(request, wait, cfg), waitingMinutes: wait, score,
      eligibleSlotCount: cands.length, schedulable: cands.length > 0,
    };
  });
  rows.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.score.priorityScore - a.score.priorityScore ||
      a.request.arrivalTime.getTime() - b.request.arrivalTime.getTime() ||
      naturalCompare(a.request.requestId, b.request.requestId),
  );
  return { ranked: rows.map((r, i) => ({ ...r, position: i + 1 })), candidates };
}

const fmt = (n: number) => n.toFixed(2);

function vehicleReason(r: RankedRequest, ranked: RankedRequest[]): string {
  const top = FACTOR_KEYS.map((k) => ({ k, v: r.score.contributions[k] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((x) => `${x.k} ${fmt(x.v)}`)
    .join(', ');
  const skipped = ranked.filter((x) => x.position < r.position && !x.schedulable);
  let s = `${r.request.requestId} (${r.request.registration}) was selected: tier "${TIER_NAMES[r.tier]}", priority score ${fmt(r.score.priorityScore)}/100 (largest contributions: ${top}).`;
  if (skipped.length) {
    s += ` Higher-ranked ${skipped.map((x) => x.request.requestId).join(', ')} had no eligible slot right now and were skipped.`;
  }
  const next = ranked.find((x) => x.position > r.position && x.schedulable);
  if (next) {
    s += next.tier === r.tier
      ? ` Next best: ${next.request.requestId} (${fmt(next.score.priorityScore)}).`
      : ` Next best is in a lower tier: ${next.request.requestId}.`;
  }
  return s;
}

function slotReason(best: SlotCandidate, all: SlotCandidate[]): string {
  const n = all.length;
  let s = `${best.code} was chosen from ${n} eligible slot${n === 1 ? '' : 's'} with suitability ${fmt(best.slotScore)}/1 (${best.notes.slice(1).join('; ')}).`;
  const tied = all.filter((c) => c.slotScore === best.slotScore);
  if (tied.length > 1) s += ` ${tied.length} slots tied on suitability; the lowest slot code won.`;
  return s;
}

/**
 * Dynamic multi-factor decision = (1) rank the queue, (2) pick the first schedulable request,
 * (3) pick that request's best eligible slot. decisionTimeMs covers steps 1-3 plus building the
 * explanation and the FCFS comparison is excluded (it is timed separately inside fcfsPick and
 * not counted). DB reads/writes are NOT included - this is the pure decision phase.
 */
export function decideDynamic(
  requests: RequestView[],
  slots: SlotView[],
  cfg: SchedulerConfig,
  now: Date,
): Decision | null {
  const t0 = performance.now();
  const { ranked, candidates } = rankQueue(requests, slots, cfg, now);
  const chosen = ranked.find((r) => r.schedulable);
  if (!chosen) return null;
  const cands = candidates.get(chosen.request.id)!;
  const best = cands[0];
  const decisionTimeMs = performance.now() - t0;

  const f = fcfsPick(requests, slots, cfg, now);
  let fcfs: Decision['fcfs'] = null;
  if (f) {
    const sameReq = f.request.id === chosen.request.id;
    const sameSlot = f.slot.code === best.code;
    fcfs = {
      requestId: f.request.requestId,
      slotCode: f.slot.code,
      differs: !(sameReq && sameSlot),
      explanation: sameReq && sameSlot
        ? 'FCFS would have made the same decision.'
        : !sameReq
          ? `FCFS would have served ${f.request.requestId} (${f.request.registration}; earliest arrival with an eligible slot) into ${f.slot.code}, instead of ${chosen.request.requestId} (${chosen.request.registration}) into ${best.code}.`
          : `Same vehicle, but FCFS would have used ${f.slot.code} (first eligible by code) instead of ${best.code} (best suitability).`,
    };
  }

  return {
    algorithm: 'dynamic',
    request: chosen.request,
    slot: best,
    vehicleScore: chosen.score,
    tier: chosen.tier,
    ranking: ranked,
    alternatives: cands.slice(1, 4),
    vehicleReason: vehicleReason(chosen, ranked),
    slotReason: slotReason(best, cands),
    fcfs,
    decisionTimeMs,
  };
}

/** FCFS decision in the same shape, so the allocation service can use either algorithm. */
export function decideFcfs(
  requests: RequestView[],
  slots: SlotView[],
  cfg: SchedulerConfig,
  now: Date,
): Decision | null {
  const t0 = performance.now();
  const p = fcfsPick(requests, slots, cfg, now);
  if (!p) return null;
  const cand = evaluateCandidates(slots, p.request, now, cfg).find((c) => c.slotId === p.slot.id)!;
  return {
    algorithm: 'fcfs',
    request: p.request,
    slot: cand,
    vehicleScore: null,
    tier: null,
    ranking: null,
    alternatives: [],
    vehicleReason: p.reason,
    slotReason: `Slot ${p.slot.code} is the first eligible slot by code (no suitability optimisation in FCFS).`,
    fcfs: null,
    decisionTimeMs: performance.now() - t0,
  };
}
