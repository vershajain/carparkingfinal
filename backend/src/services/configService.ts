import { DEFAULT_SCHEDULER_CONFIG } from '../config/defaults.js';
import { SchedulerConfiguration } from '../models/index.js';
import type { SchedulerConfig } from '../scheduler/index.js';
import type { PenaltyConfig } from '../utils/penalty.js';

export interface RuntimeConfig {
  engine: SchedulerConfig;
  penalty: PenaltyConfig;
  activeAlgorithm: 'dynamic' | 'fcfs';
}

export async function ensureConfig() {
  const { key: _k, ...rest } = DEFAULT_SCHEDULER_CONFIG;
  await SchedulerConfiguration.updateOne({ key: 'default' }, { $setOnInsert: rest }, { upsert: true });
}

/** Reads the CURRENT configuration from MongoDB on every call (no stale cache). */
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  let d = await SchedulerConfiguration.findOne({ key: 'default' }).lean();
  if (!d) {
    await ensureConfig();
    d = await SchedulerConfiguration.findOne({ key: 'default' }).lean();
  }
  const c = d as any;
  return {
    engine: {
      weights: { ...c.weights },
      waitingTimeCapMinutes: c.waitingTimeCapMinutes,
      urgencyScores: { ...c.urgencyScores },
      demandThresholds: { ...c.demandThresholds },
      demandScores: { ...c.demandScores },
      durationPolicy: c.durationPolicy,
      durationReferenceMinutes: c.durationReferenceMinutes,
      aging: { ...c.aging },
      starvationThresholdMinutes: c.starvationThresholdMinutes,
      emergencyPolicy: { ...c.emergencyPolicy },
      reservation: { ...c.reservation },
    },
    penalty: { ...c.penalty },
    activeAlgorithm: c.activeAlgorithm ?? 'dynamic',
  };
}
