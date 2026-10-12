import { Router } from 'express';
import { env } from '../config/env.js';
import rateLimit from 'express-rate-limit';
import * as c from '../controllers/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody as v } from '../middleware/validate.js';
import * as z from '../validators/index.js';

const r = Router();
const limiter = (limit: number) =>
  rateLimit({ windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' });
const operator = [requireAuth, requireRole('operator')];
const admin = [requireAuth, requireRole('admin')];

// auth
r.post('/auth/login', limiter(10), v(z.loginSchema), c.login);
r.get('/auth/me', requireAuth, c.me);
r.post('/auth/users', ...admin, v(z.createUserSchema), c.createUser);

// read-only live state (public in this academic setup; see README security notes)
r.get('/dashboard', c.dashboard);
r.get('/queue', c.queue);
r.get('/config', c.config);
r.get('/areas', c.areas);
r.get('/slots', c.slots);
r.get('/slots/:id', c.slotOne);
r.get('/allocations', c.allocations);
r.get('/allocations/:id', c.allocationOne);
r.get('/sessions', c.sessions);
r.get('/requests', c.requests);
r.get('/requests/:id', c.requestOne);
r.get('/scheduler/status', c.schedulerStatus);
r.get('/reservations', c.reservations);
r.get('/analytics/scenarios', c.analyticsScenarios);
r.get('/analytics/results', c.analyticsResults);
r.get('/analytics/results/:runId', c.analyticsResult);
r.get('/analytics/live', c.analyticsLive);

// vehicle entry form (public, rate limited; urgency is never trusted from it)
r.post('/requests', limiter(30), v(z.submitRequestSchema), c.requestSubmit);

// operator actions
r.post('/requests/:id/cancel', ...operator, c.requestCancel);
r.get('/vehicles', ...operator, c.vehicles);
r.put('/vehicles/:registration', ...operator, v(z.vehicleUpsertSchema), c.vehicleUpsert);
r.patch('/slots/:id/status', ...operator, v(z.slotStatusSchema), c.slotStatus);
r.post('/sessions/:id/exit', ...operator, c.sessionExit);
r.post('/sessions/:id/extend', ...operator, v(z.extendSchema), c.sessionExtend);
r.patch('/sessions/:id/expected-departure', ...operator, v(z.expectedDepartureSchema), c.sessionDeparture);
r.post('/scheduler/run', ...operator, c.schedulerRun);
r.post('/analytics/run', limiter(10), ...operator, v(z.analyticsRunSchema), c.analyticsRun);
r.post('/reservations', ...operator, v(z.reservationCreateSchema), c.reservationCreate);
r.post('/reservations/:id/cancel', ...operator, c.reservationCancel);

// admin layout configuration
r.patch('/config', ...admin, v(z.configPatchSchema), c.configUpdate);
r.get('/audit', ...admin, c.auditLog);
r.post('/areas', ...admin, v(z.areaCreateSchema), c.areaCreate);
r.patch('/areas/:id', ...admin, v(z.areaPatchSchema), c.areaPatch);
r.post('/areas/:id/slots', ...admin, v(z.addSlotsSchema), c.areaAddSlots);

export default r;
