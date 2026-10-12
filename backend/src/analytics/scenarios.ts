import { SLOT_COMPATIBILITY, type RequestView, type SlotType, type SlotView, type Urgency, type VehicleType } from '../scheduler/index.js';

/** Small seeded PRNG (mulberry32): the same seed always yields the same scenario. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScenarioSpec {
  key: string;
  name: string;
  description: string;
  seed: number;
  horizonMinutes: number; // observation period (identical for both algorithms)
  arrivalWindowFraction: number; // arrivals occur in [0, horizon * fraction]
  arrivalCount: number;
  emergencyRatio: number; // fraction of VERIFIED emergency vehicles
  priorityRatio: number;
  accessibleNeedRatio: number; // fraction of car/suv that need an accessible slot
  vehicleMix: Record<VehicleType, number>;
  durationMinutes: { min: number; max: number };
  layout: { slotType: SlotType; count: number }[];
  unavailableSlots: number; // slots out of service for the whole period
  slotSource: 'synthetic' | 'database';
}

export interface SimArrival {
  id: string; // SIM-0001 ... (natural order == arrival order)
  arrivalMinute: number;
  vehicleType: VehicleType;
  durationMinutes: number;
  urgency: Urgency;
  requiresAccessibleSlot: boolean;
}

export const SIM_EPOCH = Date.parse('2026-01-05T08:00:00Z'); // virtual clock origin (labelled "simulated")

const BASE: Omit<ScenarioSpec, 'key' | 'name' | 'description'> = {
  seed: 42, horizonMinutes: 480, arrivalWindowFraction: 0.75, arrivalCount: 55,
  emergencyRatio: 0.05, priorityRatio: 0.1, accessibleNeedRatio: 0.05,
  vehicleMix: { bike: 0.2, car: 0.5, suv: 0.2, other: 0.1 },
  durationMinutes: { min: 30, max: 180 },
  layout: [
    { slotType: 'standard', count: 5 }, { slotType: 'compact', count: 2 }, { slotType: 'large', count: 2 },
    { slotType: 'accessible', count: 1 }, { slotType: 'bike', count: 2 },
  ],
  unavailableSlots: 0, slotSource: 'synthetic',
};

export const PRESETS: Record<string, ScenarioSpec> = {
  low_demand: { ...BASE, key: 'low_demand', name: 'Low demand', description: 'Arrivals well below capacity: queues rarely form.', arrivalCount: 25 },
  normal_demand: { ...BASE, key: 'normal_demand', name: 'Normal demand', description: 'Arrivals roughly match capacity.', arrivalCount: 55 },
  high_demand: { ...BASE, key: 'high_demand', name: 'High demand (overload)', description: 'More arrivals than capacity: a long queue builds.', arrivalCount: 120 },
  emergency_surge: { ...BASE, key: 'emergency_surge', name: 'Emergency surge', description: 'High demand with many verified emergency vehicles.', arrivalCount: 90, emergencyRatio: 0.15, priorityRatio: 0.15 },
  capacity_shortage: { ...BASE, key: 'capacity_shortage', name: 'Capacity shortage', description: 'Half of the slots are out of service.', arrivalCount: 70, unavailableSlots: 6 },
  accessibility_pressure: { ...BASE, key: 'accessibility_pressure', name: 'Accessibility pressure', description: 'Many vehicles need the single accessible slot.', arrivalCount: 80, accessibleNeedRatio: 0.2 },
};

export type SpecOverrides = Partial<Omit<ScenarioSpec, 'key' | 'name' | 'description' | 'durationMinutes'>> & {
  durationMinutes?: Partial<{ min: number; max: number }>;
};

export function resolveSpec(key: string, overrides: SpecOverrides = {}): ScenarioSpec {
  const base = PRESETS[key];
  if (!base) throw new Error(`Unknown scenario "${key}"`);
  return {
    ...base, ...overrides,
    durationMinutes: { ...base.durationMinutes, ...(overrides.durationMinutes ?? {}) },
    key: base.key, name: base.name, description: base.description,
  } as ScenarioSpec;
}

/** Equivalent initial parking state: a fresh copy is built for each algorithm. */
export function buildSlots(spec: ScenarioSpec, dbSlots?: SlotView[]): SlotView[] {
  let slots: SlotView[];
  if (spec.slotSource === 'database' && dbSlots) {
    slots = dbSlots.map((s) => ({ ...s, status: s.status === 'unavailable' ? 'unavailable' : 'available', reservation: null }));
  } else {
    slots = [];
    for (const l of spec.layout) {
      for (let i = 0; i < l.count; i++) {
        const n = slots.length + 1;
        slots.push({
          id: `sim-slot-${n}`, code: `S-${String(n).padStart(2, '0')}`, areaCode: 'Area 1', slotType: l.slotType,
          compatibleVehicleTypes: [...SLOT_COMPATIBILITY[l.slotType]], isAccessible: l.slotType === 'accessible',
          status: 'available', reservation: null,
        });
      }
    }
  }
  // the LAST n slots are out of service (deterministic)
  for (let i = 0; i < Math.min(spec.unavailableSlots, slots.length); i++) slots[slots.length - 1 - i].status = 'unavailable';
  return slots;
}

/** Random draws happen in a FIXED order per vehicle, so changing one ratio does not reshuffle the others. */
export function generateArrivals(spec: ScenarioSpec): SimArrival[] {
  const rng = mulberry32(spec.seed);
  const window = spec.horizonMinutes * spec.arrivalWindowFraction;
  const mix = spec.vehicleMix;
  const total = mix.bike + mix.car + mix.suv + mix.other;
  const raw = Array.from({ length: spec.arrivalCount }, () => {
    const arrival = Math.floor(rng() * window * 10) / 10;
    const rType = rng() * total;
    const type: VehicleType = rType < mix.bike ? 'bike' : rType < mix.bike + mix.car ? 'car' : rType < mix.bike + mix.car + mix.suv ? 'suv' : 'other';
    const { min, max } = spec.durationMinutes;
    const duration = Math.max(1, Math.round((min + rng() * (max - min)) / 5) * 5);
    const rUrg = rng();
    const urgency: Urgency = rUrg < spec.emergencyRatio ? 'emergency' : rUrg < spec.emergencyRatio + spec.priorityRatio ? 'priority' : 'normal';
    const rAcc = rng();
    return { arrival, type, duration, urgency, accessible: (type === 'car' || type === 'suv') && rAcc < spec.accessibleNeedRatio };
  });
  raw.sort((a, b) => a.arrival - b.arrival);
  return raw.map((r, i) => ({
    id: `SIM-${String(i + 1).padStart(4, '0')}`, arrivalMinute: r.arrival, vehicleType: r.type,
    durationMinutes: r.duration, urgency: r.urgency, requiresAccessibleSlot: r.accessible,
  }));
}

/** FNV-1a hash of the arrival list: proves both algorithms (and re-runs) saw identical input. */
export function arrivalsDigest(arrivals: SimArrival[]): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(arrivals)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const toRequestView = (a: SimArrival): RequestView => ({
  id: a.id, requestId: a.id, registration: a.id, vehicleType: a.vehicleType,
  arrivalTime: new Date(SIM_EPOCH + a.arrivalMinute * 60_000), expectedDurationMinutes: a.durationMinutes,
  urgency: a.urgency, preferredAreaCode: null, requiresAccessibleSlot: a.requiresAccessibleSlot, reservation: null,
});
