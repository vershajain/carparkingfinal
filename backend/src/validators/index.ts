import { z } from 'zod';

const registration = z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9 -]+$/, 'letters, digits, spaces and hyphens only')
  .transform((s) => s.toUpperCase().replace(/[\s-]+/g, ''));
const vehicleType = z.enum(['bike', 'car', 'suv', 'other']);
const urgency = z.enum(['normal', 'priority', 'emergency']);
const slotType = z.enum(['bike', 'compact', 'standard', 'large', 'accessible']);

export const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
export const createUserSchema = z.object({ username: z.string().trim().min(3).max(40), password: z.string().min(8).max(100), role: z.enum(['admin', 'operator']) });

export const submitRequestSchema = z.object({
  registration, vehicleType,
  expectedDurationMinutes: z.coerce.number().int().min(5).max(1440),
  urgencyClaim: urgency.optional(), // a CLAIM only - never trusted
  reservationId: z.string().trim().min(1).max(40).optional(),
  preferredAreaCode: z.string().trim().min(1).max(40).optional(),
  requiresAccessibleSlot: z.boolean().optional(),
  specialRequirements: z.string().trim().max(200).optional(),
});

export const vehicleUpsertSchema = z.object({
  vehicleType,
  priorityCategory: urgency.optional(),
  needsAccessibleSlot: z.boolean().optional(),
  note: z.string().trim().max(200).optional(),
});

export const slotStatusSchema = z.object({ status: z.enum(['available', 'unavailable']), reason: z.string().trim().max(200).optional() });
export const areaCreateSchema = z.object({
  code: z.string().trim().min(1).max(40), prefix: z.string().trim().min(1).max(10), name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  slots: z.array(z.object({ slotType, count: z.number().int().min(1).max(500) })).max(10).optional(),
});
export const areaPatchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(300).optional(), isActive: z.boolean().optional() });
export const addSlotsSchema = z.object({ slotType, count: z.number().int().min(1).max(500) });
export const extendSchema = z.object({ addedMinutes: z.number().int().min(1).max(720) });
export const expectedDepartureSchema = z.object({ expectedDeparture: z.coerce.date() });

export const reservationCreateSchema = z.object({
  registration, vehicleType: vehicleType.optional(),
  slotId: z.string().regex(/^[a-f0-9]{24}$/i, 'invalid slot id').optional(),
  areaCode: z.string().trim().min(1).max(40).optional(),
  startTime: z.coerce.date(), endTime: z.coerce.date(),
});

const unit = z.number().min(0).max(1);
const nonNeg = z.number().min(0);
const pos = z.number().positive();
export const configPatchSchema = z.object({
  weights: z.object({ waiting: nonNeg, urgency: nonNeg, demand: nonNeg, duration: nonNeg, reservation: nonNeg, suitability: nonNeg, fairness: nonNeg }).partial().strict().optional(),
  waitingTimeCapMinutes: pos.optional(),
  urgencyScores: z.object({ normal: unit, priority: unit, emergency: unit }).partial().strict().optional(),
  demandThresholds: z.object({ low: nonNeg, medium: nonNeg, high: nonNeg }).partial().strict().optional(),
  demandScores: z.object({ low: unit, medium: unit, high: unit }).partial().strict().optional(),
  durationPolicy: z.enum(['shorter', 'longer']).optional(),
  durationReferenceMinutes: pos.optional(),
  aging: z.object({ graceMinutes: nonNeg, rampMinutes: pos }).partial().strict().optional(),
  starvationThresholdMinutes: nonNeg.optional(),
  emergencyPolicy: z.object({ allowUseOfReservedUnclaimedSlots: z.boolean() }).partial().strict().optional(),
  penalty: z.object({ graceMinutes: nonNeg, ratePerHour: nonNeg, currency: z.string().trim().min(1).max(10), roundingMinutes: nonNeg }).partial().strict().optional(),
  reservation: z.object({ earlyArrivalMinutes: nonNeg, lateArrivalMinutes: nonNeg }).partial().strict().optional(),
  activeAlgorithm: z.enum(['dynamic', 'fcfs']).optional(),
}).strict();

export const analyticsRunSchema = z.object({
  scenario: z.enum(['low_demand', 'normal_demand', 'high_demand', 'emergency_surge', 'capacity_shortage', 'accessibility_pressure']),
  overrides: z.object({
    seed: z.number().int().min(0).max(2_147_483_647),
    arrivalCount: z.number().int().min(1).max(400),
    horizonMinutes: z.number().int().min(60).max(1440),
    emergencyRatio: z.number().min(0).max(0.5),
    priorityRatio: z.number().min(0).max(0.5),
    accessibleNeedRatio: z.number().min(0).max(0.5),
    unavailableSlots: z.number().int().min(0).max(50),
    slotSource: z.enum(['synthetic', 'database']),
    durationMinutes: z.object({ min: z.number().int().min(5).max(600), max: z.number().int().min(5).max(900) }).partial(),
  }).partial().strict().optional(),
});
