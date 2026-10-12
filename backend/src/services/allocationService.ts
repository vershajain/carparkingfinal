import { AllocationRecord, ParkingRequest, ParkingSession, ParkingSlot, Reservation, nextId } from '../models/index.js';
import { decideDynamic, decideFcfs, rankQueue, validateReservation, type Decision } from '../scheduler/index.js';
import { publish } from '../utils/socket.js';
import { getRuntimeConfig, type RuntimeConfig } from './configService.js';
import { syncReservations } from './reservationSync.js';
import { loadState, type SchedulerState } from './views.js';

export interface SchedulerStatus {
  algorithm: string;
  running: boolean;
  lastRunAt: Date | null;
  lastTrigger: string | null;
  lastRunAllocations: number;
  totalAllocationsSinceStart: number;
}
const status: SchedulerStatus = {
  algorithm: 'dynamic', running: false, lastRunAt: null, lastTrigger: null,
  lastRunAllocations: 0, totalAllocationsSinceStart: 0,
};
export const getSchedulerStatus = () => ({ ...status });

/**
 * Serialises scheduler runs inside this process (a simple mutex). If several processes ran the
 * backend, the atomic conditional updates in allocate() are the second line of defence.
 */
let chain: Promise<unknown> = Promise.resolve();
export function runScheduler(trigger: string): Promise<{ allocations: number }> {
  const p = chain.then(() => runOnce(trigger));
  chain = p.catch(() => undefined);
  return p;
}

async function runOnce(trigger: string): Promise<{ allocations: number }> {
  status.running = true;
  let count = 0;
  try {
    const cfg = await getRuntimeConfig();
    status.algorithm = cfg.activeAlgorithm;
    await syncReservations(); // expire stale reservations, open/close slot holds, BEFORE deciding
    let guard = 0;
    for (;;) {
      const state = await loadState();
      if (state.requests.length === 0 || state.slots.length === 0 || guard++ > 500) break;
      const now = new Date();
      const decide = cfg.activeAlgorithm === 'fcfs' ? decideFcfs : decideDynamic;
      const decision = decide(state.requests, state.slots, cfg.engine, now);
      if (!decision) break;
      const done = await allocate(decision, state, cfg, now);
      if (done) count++;
    }
    await refreshScoreSnapshots(cfg);
  } finally {
    status.running = false;
    status.lastRunAt = new Date();
    status.lastTrigger = trigger;
    status.lastRunAllocations = count;
    status.totalAllocationsSinceStart += count;
  }
  if (count > 0) publish('queue:updated', { trigger });
  return { allocations: count };
}

/** Stores the latest score/breakdown on every still-waiting request (read model for the queue page). */
async function refreshScoreSnapshots(cfg: RuntimeConfig) {
  const state = await loadState();
  if (state.requests.length === 0) return;
  const { ranked } = rankQueue(state.requests, state.slots, cfg.engine, new Date());
  await ParkingRequest.bulkWrite(
    ranked.map((r) => ({
      updateOne: {
        filter: { _id: r.request.id, status: 'waiting' },
        update: { $set: { priorityScore: r.score.priorityScore, scoreBreakdown: { ...r.score, tier: r.tier, position: r.position } } },
      },
    })),
  );
}

/**
 * Persists one allocation using atomic conditional updates (works on a standalone MongoDB too):
 *  1. claim the slot only if it is still in the status the decision was based on
 *  2. claim the request only if it is still 'waiting'
 *  3. create the session (a unique partial index allows one active session per slot)
 *  4. write the AllocationRecord (inputs, factors, contributions, explanations)
 * If any step fails, earlier steps are rolled back and the run re-plans from fresh state.
 */
async function allocate(d: Decision, state: SchedulerState, cfg: RuntimeConfig, now: Date): Promise<boolean> {
  const slotDoc = state.slotDocs.get(d.slot.slotId)!;
  const reqDoc = state.reqDocs.get(d.request.id)!;
  const prevStatus = slotDoc.status;

  const claimedSlot = await ParkingSlot.findOneAndUpdate(
    { _id: slotDoc._id, status: prevStatus },
    { $set: { status: 'occupied', currentVehicleRegistration: reqDoc.registration } },
    { new: true },
  );
  if (!claimedSlot) return false;

  const revertSlot = () =>
    ParkingSlot.updateOne(
      { _id: slotDoc._id },
      { $set: { status: prevStatus, currentVehicleRegistration: null, currentSession: null } },
    );

  const claimedReq = await ParkingRequest.findOneAndUpdate(
    { _id: reqDoc._id, status: 'waiting' },
    { $set: { status: 'allocated', allocatedAt: now }, $unset: { activeRegistration: 1 } },
    { new: true },
  );
  if (!claimedReq) {
    await revertSlot();
    return false;
  }

  let session;
  try {
    session = await ParkingSession.create({
      sessionId: await nextId('SES'), vehicle: reqDoc.vehicle, registration: reqDoc.registration,
      request: reqDoc._id, slot: slotDoc._id, activeSlot: slotDoc._id, slotCode: slotDoc.code, entryTime: now,
      expectedDeparture: new Date(now.getTime() + reqDoc.expectedDurationMinutes * 60_000),
    });
  } catch (e) {
    await revertSlot();
    await ParkingRequest.updateOne({ _id: reqDoc._id }, { $set: { status: 'waiting', allocatedAt: null, activeRegistration: reqDoc.registration } });
    if ((e as { code?: number }).code === 11000) return false; // slot already has an active session
    throw e;
  }

  const rank = d.ranking?.find((r) => r.request.id === d.request.id);
  const record = await AllocationRecord.create({
    request: reqDoc._id, requestId: reqDoc.requestId, vehicle: reqDoc.vehicle, registration: reqDoc.registration,
    slot: slotDoc._id, slotCode: slotDoc.code, session: session._id, allocatedAt: now, algorithm: d.algorithm,
    priorityScore: d.vehicleScore?.priorityScore ?? null,
    factors: d.vehicleScore?.factors ?? null,
    contributions: d.vehicleScore?.contributions ?? null,
    slotScore: d.slot.slotScore,
    vehicleReason: d.vehicleReason, slotReason: d.slotReason,
    alternativeSlots: d.alternatives, fcfsComparison: d.fcfs,
    configSnapshot: { ...cfg.engine },
    stateSnapshot: {
      queueLength: state.requests.length,
      availableSlots: state.slots.filter((s) => s.status === 'available').length,
      tier: d.tier, slotComponents: d.slot.components, slotNotes: d.slot.notes,
      ranking: (d.ranking ?? []).slice(0, 10).map((r) => ({
        requestId: r.request.requestId, position: r.position, tier: r.tier,
        score: r.score.priorityScore, schedulable: r.schedulable,
      })),
      selectedPosition: rank?.position ?? null,
    },
    decisionTimeMs: d.decisionTimeMs,
  });

  await ParkingSlot.updateOne({ _id: slotDoc._id }, { $set: { currentSession: session._id } });
  await ParkingRequest.updateOne(
    { _id: reqDoc._id },
    { $set: { allocation: record._id, priorityScore: d.vehicleScore?.priorityScore ?? null, scoreBreakdown: d.vehicleScore ?? null } },
  );
  // A VALID reservation that the vehicle just claimed is consumed.
  if (d.request.reservation && validateReservation(d.request.reservation, d.request.registration, now, cfg.engine).valid) {
    await Reservation.updateOne({ _id: reqDoc.reservation, status: 'active' }, { $set: { status: 'used' } });
    publish('reservation:changed', { reservationId: d.request.reservation.reservationId });
  }
  publish('slot:allocated', { slotCode: slotDoc.code, registration: reqDoc.registration, allocationId: String(record._id) });
  publish('session:entered', { sessionId: session.sessionId });
  publish('slot:updated', { slotCode: slotDoc.code });
  return true;
}
