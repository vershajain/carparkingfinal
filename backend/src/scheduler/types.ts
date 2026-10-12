/** Pure data types used by the scheduling engine. No database or Express imports here. */
export type VehicleType = 'bike' | 'car' | 'suv' | 'other';
export type Urgency = 'normal' | 'priority' | 'emergency';
export type SlotType = 'bike' | 'compact' | 'standard' | 'large' | 'accessible';
export type SlotStatus = 'available' | 'occupied' | 'reserved' | 'unavailable';

export interface ReservationView {
  reservationId: string;
  registration: string;
  slotId: string | null; // specific slot, OR
  areaCode: string | null; // area-level reservation
  startTime: Date;
  endTime: Date;
  status: 'active' | 'used' | 'cancelled' | 'expired';
}

export interface SlotView {
  id: string;
  code: string;
  areaCode: string;
  slotType: SlotType;
  compatibleVehicleTypes: VehicleType[];
  isAccessible: boolean;
  status: SlotStatus;
  reservation: ReservationView | null; // reservation holding this slot (status 'reserved')
}

export interface RequestView {
  id: string;
  requestId: string;
  registration: string;
  vehicleType: VehicleType;
  arrivalTime: Date;
  expectedDurationMinutes: number;
  urgency: Urgency; // VERIFIED urgency (never self-declared)
  preferredAreaCode: string | null;
  requiresAccessibleSlot: boolean;
  reservation: ReservationView | null;
}

export interface FactorWeights {
  waiting: number;
  urgency: number;
  demand: number;
  duration: number;
  reservation: number;
  suitability: number;
  fairness: number;
}
export type FactorValues = FactorWeights; // same keys: W,U,D,T,R,S,F values in [0,1]
export const FACTOR_KEYS = [
  'waiting', 'urgency', 'demand', 'duration', 'reservation', 'suitability', 'fairness',
] as const;

export interface SchedulerConfig {
  weights: FactorWeights;
  waitingTimeCapMinutes: number;
  urgencyScores: { normal: number; priority: number; emergency: number };
  demandThresholds: { low: number; medium: number; high: number };
  demandScores: { low: number; medium: number; high: number };
  durationPolicy: 'shorter' | 'longer';
  durationReferenceMinutes: number;
  aging: { graceMinutes: number; rampMinutes: number };
  starvationThresholdMinutes: number;
  emergencyPolicy: { allowUseOfReservedUnclaimedSlots: boolean };
  reservation: { earlyArrivalMinutes: number; lateArrivalMinutes: number };
}

export interface ScoreBreakdown {
  factors: FactorValues; // normalized values W,U,D,T,R,S,F
  weights: FactorWeights;
  contributions: FactorValues; // 100 * weight * value, per factor
  priorityScore: number; // sum of contributions (0..100)
}

export type Tier = 0 | 1 | 2;
export const TIER_NAMES: Record<Tier, string> = {
  0: 'verified emergency',
  1: 'starving (waited past starvation threshold)',
  2: 'regular',
};

export interface SlotCandidate {
  slotId: string;
  code: string;
  areaCode: string;
  slotScore: number; // slot suitability score (0..1) - distinct from the vehicle priority score
  ownReservation: boolean; // this is the vehicle's own validly-reserved slot
  components: Record<string, number>;
  notes: string[];
}

export interface RankedRequest {
  request: RequestView;
  position: number; // 1-based
  tier: Tier;
  waitingMinutes: number;
  score: ScoreBreakdown;
  eligibleSlotCount: number;
  schedulable: boolean; // has at least one eligible slot right now
}

export interface Decision {
  algorithm: 'dynamic' | 'fcfs';
  request: RequestView;
  slot: SlotCandidate;
  vehicleScore: ScoreBreakdown | null; // null for FCFS (no scoring)
  tier: Tier | null;
  ranking: RankedRequest[] | null;
  alternatives: SlotCandidate[];
  vehicleReason: string;
  slotReason: string;
  fcfs: { requestId: string; slotCode: string; differs: boolean; explanation: string } | null;
  decisionTimeMs: number;
}
