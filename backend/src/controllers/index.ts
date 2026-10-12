import bcrypt from 'bcryptjs';
import { Request } from 'express';
import mongoose from 'mongoose';
import { signToken } from '../middleware/auth.js';
import { AllocationRecord, AuditLog, ParkingArea, ParkingRequest, User, Vehicle } from '../models/index.js';
import { getSchedulerStatus, runScheduler } from '../services/allocationService.js';
import { getRuntimeConfig } from '../services/configService.js';
import { buildRun, listRuns, listScenarios, liveSummary, runComparison } from '../services/analyticsService.js';
import { updateConfig } from '../services/configAdminService.js';
import { cancelReservation, createReservation, listReservations } from '../services/reservationService.js';
import { getDashboard } from '../services/dashboardService.js';
import { getQueue } from '../services/queueService.js';
import { cancelRequest, submitRequest } from '../services/requestService.js';
import { exitSession, extendSession, listSessions, setExpectedDeparture } from '../services/sessionService.js';
import { addSlots, createArea, getSlot, listAreas, listSlots, setSlotStatus } from '../services/slotService.js';
import { ok } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { badRequest, notFound, unauthorized } from '../utils/errors.js';
import { publish } from '../utils/socket.js';

const actor = (req: Request) => req.user?.username ?? 'system';
const oid = (v: unknown) => {
  if (typeof v !== 'string' || !mongoose.isValidObjectId(v)) throw badRequest('Invalid id');
  return v;
};
const registrationParam = (v: string) => v.toUpperCase().replace(/[\s-]+/g, '');

// ---- auth ----
export const login = asyncHandler(async (req, res) => {
  const u = await User.findOne({ username: req.body.username });
  if (!u || !(await bcrypt.compare(req.body.password, u.passwordHash))) throw unauthorized('Invalid username or password');
  ok(res, { token: signToken({ username: u.username, role: u.role as 'admin' | 'operator' }), username: u.username, role: u.role }, 'Logged in');
});
export const me = asyncHandler(async (req, res) => ok(res, req.user));
export const createUser = asyncHandler(async (req, res) => {
  const u = await User.create({ username: req.body.username, passwordHash: await bcrypt.hash(req.body.password, 10), role: req.body.role });
  await audit(actor(req), 'user.create', 'User', String(u._id), { username: u.username, role: u.role });
  ok(res, { username: u.username, role: u.role }, 'User created', 201);
});

// ---- dashboard / scheduler ----
export const dashboard = asyncHandler(async (_req, res) => ok(res, await getDashboard()));
export const queue = asyncHandler(async (_req, res) => ok(res, await getQueue()));
export const schedulerStatus = asyncHandler(async (_req, res) => ok(res, getSchedulerStatus()));
export const schedulerRun = asyncHandler(async (req, res) => {
  const r = await runScheduler(`manual:${actor(req)}`);
  ok(res, r, `Scheduler ran: ${r.allocations} allocation(s)`);
});
export const config = asyncHandler(async (_req, res) => ok(res, await getRuntimeConfig()));
export const configUpdate = asyncHandler(async (req, res) => ok(res, await updateConfig(req.body, actor(req)), 'Configuration updated'));
export const auditLog = asyncHandler(async (req, res) => {
  const q = req.query.action ? { action: req.query.action as string } : {};
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  ok(res, await AuditLog.find(q).sort({ createdAt: -1 }).limit(limit).lean());
});

// ---- analytics ----
export const analyticsScenarios = asyncHandler(async (_req, res) => ok(res, listScenarios()));
export const analyticsRun = asyncHandler(async (req, res) => ok(res, await runComparison(req.body.scenario, req.body.overrides ?? {}, actor(req)), 'Comparison complete', 201));
export const analyticsResults = asyncHandler(async (req, res) => ok(res, await listRuns(req.query.scenarioId as string | undefined, Math.min(Number(req.query.limit) || 50, 200))));
export const analyticsResult = asyncHandler(async (req, res) => {
  const r = await buildRun(req.params.runId);
  if (!r) throw notFound('Run not found');
  ok(res, r);
});
export const analyticsLive = asyncHandler(async (_req, res) => ok(res, await liveSummary()));

// ---- reservations ----
export const reservations = asyncHandler(async (req, res) => ok(res, await listReservations(req.query.status as string | undefined)));
export const reservationCreate = asyncHandler(async (req, res) => {
  const r = await createReservation(req.body, actor(req));
  ok(res, r, r.warnings.length ? `Reservation created. ${r.warnings.join(' ')}` : 'Reservation created', 201);
});
export const reservationCancel = asyncHandler(async (req, res) => ok(res, await cancelReservation(oid(req.params.id), actor(req)), 'Reservation cancelled'));

// ---- areas & slots ----
export const areas = asyncHandler(async (_req, res) => ok(res, await listAreas()));
export const areaCreate = asyncHandler(async (req, res) => ok(res, await createArea(req.body, actor(req)), 'Area created', 201));
export const areaPatch = asyncHandler(async (req, res) => {
  const a = await ParkingArea.findByIdAndUpdate(oid(req.params.id), { $set: req.body }, { new: true }).lean();
  if (!a) throw notFound('Area not found');
  await audit(actor(req), 'area.update', 'ParkingArea', String(a._id), req.body);
  publish('slot:updated', { area: a.code });
  void runScheduler('layout-change');
  ok(res, a, 'Area updated');
});
export const areaAddSlots = asyncHandler(async (req, res) => {
  const created = await addSlots(oid(req.params.id), req.body.slotType, req.body.count);
  await audit(actor(req), 'slots.add', 'ParkingArea', req.params.id, req.body);
  publish('slot:updated', {});
  void runScheduler('layout-change');
  ok(res, created, `${created.length} slot(s) added`, 201);
});
export const slots = asyncHandler(async (req, res) =>
  ok(res, await listSlots({ areaCode: req.query.areaCode as string | undefined, status: req.query.status as string | undefined })));
export const slotOne = asyncHandler(async (req, res) => ok(res, await getSlot(oid(req.params.id))));
export const slotStatus = asyncHandler(async (req, res) =>
  ok(res, await setSlotStatus(oid(req.params.id), req.body.status, req.body.reason, actor(req)), 'Slot updated'));

// ---- vehicles ----
export const vehicles = asyncHandler(async (_req, res) => ok(res, await Vehicle.find().sort({ registration: 1 }).limit(500).lean()));
export const vehicleUpsert = asyncHandler(async (req, res) => {
  const registration = registrationParam(req.params.registration);
  const { vehicleType, priorityCategory, needsAccessibleSlot, note } = req.body;
  const set: Record<string, unknown> = {};
  if (priorityCategory) Object.assign(set, { priorityCategory, priorityVerifiedBy: actor(req), priorityVerifiedAt: new Date() });
  if (needsAccessibleSlot !== undefined) set.needsAccessibleSlot = needsAccessibleSlot;
  if (note !== undefined) set.priorityNote = note;
  const v = await Vehicle.findOneAndUpdate({ registration }, { $set: set, $setOnInsert: { registration, vehicleType } }, { new: true, upsert: true }).lean();
  if (v.vehicleType !== vehicleType) throw badRequest(`${registration} is registered as "${v.vehicleType}"`);
  // keep waiting requests consistent with the newly verified status, then re-schedule
  if (priorityCategory) await ParkingRequest.updateMany({ registration, status: 'waiting' }, { $set: { urgency: priorityCategory } });
  if (needsAccessibleSlot !== undefined) await ParkingRequest.updateMany({ registration, status: 'waiting' }, { $set: { requiresAccessibleSlot: needsAccessibleSlot } });
  await audit(actor(req), 'vehicle.verifyPriority', 'Vehicle', registration, req.body);
  publish('queue:updated', { registration });
  void runScheduler('vehicle-verified');
  ok(res, v, 'Vehicle updated');
});

// ---- requests ----
export const requestSubmit = asyncHandler(async (req, res) => {
  const r = await submitRequest(req.body);
  ok(res, r, r.messages.join(' '), 201);
});
export const requests = asyncHandler(async (req, res) => {
  const q = req.query.status ? { status: req.query.status as string } : {};
  ok(res, await ParkingRequest.find(q).sort({ arrivalTime: -1 }).limit(500).lean());
});
export const requestOne = asyncHandler(async (req, res) => {
  const r = await ParkingRequest.findOne({ $or: [{ requestId: req.params.id }, ...(mongoose.isValidObjectId(req.params.id) ? [{ _id: req.params.id }] : [])] }).populate('allocation').lean();
  if (!r) throw notFound('Request not found');
  ok(res, r);
});
export const requestCancel = asyncHandler(async (req, res) => ok(res, await cancelRequest(oid(req.params.id)), 'Request cancelled'));

// ---- allocations ----
export const allocations = asyncHandler(async (req, res) => {
  const q = req.query.algorithm ? { algorithm: req.query.algorithm as string } : {};
  ok(res, await AllocationRecord.find(q).sort({ allocatedAt: -1 }).limit(200).lean());
});
export const allocationOne = asyncHandler(async (req, res) => {
  const a = await AllocationRecord.findById(oid(req.params.id)).lean();
  if (!a) throw notFound('Allocation not found');
  ok(res, a);
});

// ---- sessions ----
export const sessions = asyncHandler(async (req, res) => ok(res, await listSessions(req.query.status as string | undefined)));
export const sessionExit = asyncHandler(async (req, res) => ok(res, await exitSession(oid(req.params.id), actor(req)), 'Vehicle exited; slot released'));
export const sessionExtend = asyncHandler(async (req, res) => ok(res, await extendSession(oid(req.params.id), req.body.addedMinutes, actor(req)), 'Stay extended'));
export const sessionDeparture = asyncHandler(async (req, res) => ok(res, await setExpectedDeparture(oid(req.params.id), req.body.expectedDeparture, actor(req)), 'Expected departure updated'));
