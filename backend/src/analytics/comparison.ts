import type { SimMetrics } from './simulator.js';

export type Direction = 'lower' | 'higher';
export interface MetricDef {
  key: string; label: string; unit: string; direction: Direction; deterministic: boolean;
  description: string; pick: (m: SimMetrics) => number | null;
}

/** What each metric measures, its unit, and which direction is desirable (shown in the UI). */
export const METRICS: MetricDef[] = [
  { key: 'avgWaitingMinutes', label: 'Average waiting time', unit: 'min', direction: 'lower', deterministic: true,
    description: 'Sum of waiting times of served vehicles / number of served vehicles. Lower is better.', pick: (m) => m.avgWaitingMinutes },
  { key: 'emergencyAllocationMinutes', label: 'Emergency allocation time', unit: 'min', direction: 'lower', deterministic: true,
    description: 'Allocation timestamp - request timestamp, averaged over served VERIFIED emergency requests. Lower is better. (This is a time, not a priority score.)', pick: (m) => m.emergencyAllocationMinutes },
  { key: 'utilizationPercent', label: 'Slot utilization', unit: '%', direction: 'higher', deterministic: true,
    description: 'Occupied slot-time / total usable slot-time x 100 over the same period. Unavailable slots are excluded from usable time. Higher is better.', pick: (m) => m.utilizationPercent },
  { key: 'idleEligibleSlotMinutes', label: 'Unnecessary idle slot time', unit: 'slot-min', direction: 'lower', deterministic: true,
    description: 'Free usable slot-time while at least one waiting request was eligible for that slot. Both schedulers allocate immediately, so 0 is expected; a non-zero value would indicate a scheduling defect.', pick: (m) => m.idleEligibleSlotMinutes },
  { key: 'throughputPerHour', label: 'Throughput', unit: 'veh/h', direction: 'higher', deterministic: true,
    description: 'Vehicles served (allocated a slot) / observation period in hours. Higher is better.', pick: (m) => m.throughputPerHour },
  { key: 'maxWaitingMinutes', label: 'Maximum waiting time', unit: 'min', direction: 'lower', deterministic: true,
    description: 'Longest wait of any arrived vehicle; vehicles still waiting count up to the end of the period. Lower is better (fairness).', pick: (m) => m.maxWaitingMinutes },
  { key: 'p95WaitingMinutes', label: '95th percentile waiting time', unit: 'min', direction: 'lower', deterministic: true,
    description: '95% of vehicles waited this long or less (incl. still-waiting vehicles). Lower is better.', pick: (m) => m.p95WaitingMinutes },
  { key: 'exceedingThresholdCount', label: 'Requests over wait threshold', unit: 'requests', direction: 'lower', deterministic: true,
    description: 'Requests whose wait exceeded the configured starvation threshold. Lower is better.', pick: (m) => m.exceedingThresholdCount },
  { key: 'starvedCount', label: 'Starved requests', unit: 'requests', direction: 'lower', deterministic: true,
    description: 'Requests never served within the period AND waiting longer than the threshold (starvation indicator). Lower is better.', pick: (m) => m.starvedCount },
  { key: 'avgSlotFit', label: 'Average slot fit', unit: '0-1', direction: 'higher', deterministic: true,
    description: 'Mean slot-suitability score of the allocations (type fit, area, not wasting accessible slots), computed identically for both algorithms. Higher is better.', pick: (m) => m.avgSlotFit },
  { key: 'accessibleMisuseSlotMinutes', label: 'Accessible-slot misuse', unit: 'slot-min', direction: 'lower', deterministic: true,
    description: 'Slot-time during which an accessible slot was occupied by a vehicle that does not need it. Lower is better.', pick: (m) => m.accessibleMisuseSlotMinutes },
  { key: 'decisionTimeMs', label: 'Scheduler decision time (mean)', unit: 'ms', direction: 'lower', deterministic: false,
    description: 'Mean wall-clock time of one decision: ranking/ordering the waiting requests, choosing the vehicle and its slot (no database access). Machine-dependent, so it varies between runs.', pick: (m) => m.decisionTime.meanMs },
];

export interface Improvement { percent: number | null; note?: string }

/** Lower-is-better: (FCFS - Dynamic)/FCFS*100.  Higher-is-better: (Dynamic - FCFS)/FCFS*100.  Positive = dynamic better. */
export function improvement(fcfs: number | null, dynamic: number | null, direction: Direction): Improvement {
  if (fcfs === null || dynamic === null) return { percent: null, note: 'insufficient data' };
  if (fcfs === 0) return dynamic === 0 ? { percent: 0, note: 'both values are 0' } : { percent: null, note: 'FCFS value is 0: percentage undefined' };
  const raw = direction === 'lower' ? ((fcfs - dynamic) / fcfs) * 100 : ((dynamic - fcfs) / fcfs) * 100;
  return { percent: Math.round(raw * 100) / 100 };
}

export function compareMetrics(fcfs: SimMetrics, dynamic: SimMetrics) {
  return METRICS.map((d) => {
    const f = d.pick(fcfs), y = d.pick(dynamic);
    const imp = improvement(f, y, d.direction);
    return { key: d.key, label: d.label, unit: d.unit, direction: d.direction, deterministic: d.deterministic, description: d.description,
      fcfs: f, dynamic: y, improvementPercent: imp.percent, note: imp.note ?? null };
  });
}
