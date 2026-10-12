/**
 * Initial (proposed, NOT experimentally proven) scheduler configuration.
 * Stored in MongoDB (SchedulerConfiguration) and editable by admins.
 * Weights are non-negative and sum to 1.
 */
export const DEFAULT_WEIGHTS = {
  waiting: 0.25, // wW
  urgency: 0.25, // wU
  demand: 0.05, // wD
  duration: 0.1, // wT
  reservation: 0.1, // wR
  suitability: 0.1, // wS
  fairness: 0.15, // wF
};

export const DEFAULT_SCHEDULER_CONFIG = {
  key: 'default',
  // Algorithm the LIVE system uses. FCFS vs dynamic comparison always runs both on copies.
  activeAlgorithm: 'dynamic' as 'dynamic' | 'fcfs',
  weights: DEFAULT_WEIGHTS,
  waitingTimeCapMinutes: 60,
  // Verified urgency category -> normalized score (0..1)
  urgencyScores: { normal: 0.2, priority: 0.6, emergency: 1.0 },
  // Demand = waitingRequests / max(eligibleFreeSlots, 1); mapped via thresholds
  demandThresholds: { low: 0.5, medium: 1.0, high: 2.0 },
  demandScores: { low: 0.2, medium: 0.6, high: 1.0 },
  // 'shorter' => shorter stays score higher (frees slots sooner, improves throughput)
  durationPolicy: 'shorter' as 'shorter' | 'longer',
  durationReferenceMinutes: 480,
  // Aging: F = min(max(wait - graceMinutes, 0) / rampMinutes, 1)
  // The grace period keeps F from duplicating W's early growth.
  aging: { graceMinutes: 15, rampMinutes: 120 },
  starvationThresholdMinutes: 90,
  emergencyPolicy: { allowUseOfReservedUnclaimedSlots: true },
  penalty: { graceMinutes: 10, ratePerHour: 50, currency: 'units', roundingMinutes: 15 },
  reservation: { earlyArrivalMinutes: 15, lateArrivalMinutes: 30 },
};
