import { DEFAULT_SCHEDULER_CONFIG } from '../../src/config/defaults.js';
import type { RequestView, ReservationView, SchedulerConfig, SlotView } from '../../src/scheduler/types.js';

export const NOW = new Date('2026-10-12T10:00:00Z');
export const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
export const minsFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000);

export const cfg = (over: Partial<SchedulerConfig> = {}): SchedulerConfig =>
  structuredClone({ ...DEFAULT_SCHEDULER_CONFIG, ...over }) as SchedulerConfig;

export const slot = (code: string, over: Partial<SlotView> = {}): SlotView => ({
  id: `id-${code}`, code, areaCode: 'Area 1', slotType: 'standard',
  compatibleVehicleTypes: ['car', 'suv', 'other'], isAccessible: false,
  status: 'available', reservation: null, ...over,
});

let n = 0;
export const req = (id: string, over: Partial<RequestView> = {}): RequestView => ({
  id, requestId: id, registration: `REG-${id}`, vehicleType: 'car', arrivalTime: minsAgo(5),
  expectedDurationMinutes: 120, urgency: 'normal', preferredAreaCode: null,
  requiresAccessibleSlot: false, reservation: null, ...over, ...(n++, {}),
});

export const reservation = (over: Partial<ReservationView> = {}): ReservationView => ({
  reservationId: 'RSV-1', registration: 'REG-X', slotId: null, areaCode: 'Area 1',
  startTime: minsAgo(5), endTime: minsFromNow(120), status: 'active', ...over,
});
