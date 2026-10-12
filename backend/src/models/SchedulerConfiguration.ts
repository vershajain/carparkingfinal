import { Schema, model, InferSchemaType } from 'mongoose';

const schedulerConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    weights: {
      waiting: Number,
      urgency: Number,
      demand: Number,
      duration: Number,
      reservation: Number,
      suitability: Number,
      fairness: Number,
    },
    waitingTimeCapMinutes: { type: Number, required: true, min: 1 },
    urgencyScores: { normal: Number, priority: Number, emergency: Number },
    demandThresholds: { low: Number, medium: Number, high: Number },
    demandScores: { low: Number, medium: Number, high: Number },
    durationPolicy: { type: String, enum: ['shorter', 'longer'], required: true },
    durationReferenceMinutes: { type: Number, required: true, min: 1 },
    aging: { graceMinutes: Number, rampMinutes: Number },
    starvationThresholdMinutes: { type: Number, required: true },
    emergencyPolicy: { allowUseOfReservedUnclaimedSlots: Boolean },
    penalty: { graceMinutes: Number, ratePerHour: Number, currency: String, roundingMinutes: Number },
    reservation: { earlyArrivalMinutes: Number, lateArrivalMinutes: Number },
    activeAlgorithm: { type: String, enum: ['dynamic', 'fcfs'], default: 'dynamic' },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

export type SchedulerConfigDoc = InferSchemaType<typeof schedulerConfigSchema>;
export const SchedulerConfiguration = model('SchedulerConfiguration', schedulerConfigSchema);
