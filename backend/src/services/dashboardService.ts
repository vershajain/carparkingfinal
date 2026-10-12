import { ParkingRequest, ParkingSession, ParkingSlot } from '../models/index.js';
import { getSchedulerStatus } from './allocationService.js';
import { getRuntimeConfig } from './configService.js';

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/** Every figure is computed from MongoDB right now; "null" means "no data yet" (never a made-up number). */
export async function getDashboard() {
  const [slots, waiting, emergencyWaiting, parked, completed, allocated] = await Promise.all([
    ParkingSlot.find({}, { status: 1 }).lean(),
    ParkingRequest.countDocuments({ status: 'waiting' }),
    ParkingRequest.countDocuments({ status: 'waiting', urgency: 'emergency' }),
    ParkingSession.countDocuments({ status: 'active' }),
    ParkingSession.countDocuments({ status: 'completed' }),
    ParkingRequest.find({ status: 'allocated', allocatedAt: { $ne: null } }, { arrivalTime: 1, allocatedAt: 1, urgency: 1 }).sort({ allocatedAt: -1 }).limit(5000).lean(),
  ]);
  const count = (st: string) => slots.filter((s) => s.status === st).length;
  const total = slots.length;
  const unavailable = count('unavailable');
  const occupied = count('occupied');
  const usable = total - unavailable;
  const waits = allocated.map((r: any) => (r.allocatedAt.getTime() - r.arrivalTime.getTime()) / 60000);
  const emWaits = allocated.filter((r: any) => r.urgency === 'emergency').map((r: any) => (r.allocatedAt.getTime() - r.arrivalTime.getTime()) / 60000);
  const cfg = await getRuntimeConfig();
  return {
    totalSlots: total, availableSlots: count('available'), occupiedSlots: occupied,
    reservedSlots: count('reserved'), unavailableSlots: unavailable,
    // Utilization = occupied / usable slots (usable = total - unavailable; reserved slots count as usable but idle)
    utilizationPercent: usable > 0 ? Math.round((occupied / usable) * 10000) / 100 : null,
    waitingVehicles: waiting, emergencyWaiting: emergencyWaiting, parkedVehicles: parked,
    completedSessions: completed,
    averageWaitingMinutes: avg(waits), averageEmergencyAllocationMinutes: avg(emWaits),
    scheduler: { ...getSchedulerStatus(), algorithm: cfg.activeAlgorithm },
    computedAt: new Date().toISOString(),
  };
}
