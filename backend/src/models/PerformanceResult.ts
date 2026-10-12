import { Schema, model, InferSchemaType } from 'mongoose';

const performanceResultSchema = new Schema(
  {
    scenarioId: { type: String, required: true, index: true },
    scenarioName: { type: String, required: true },
    runId: { type: String, required: true, index: true }, // links the FCFS + dynamic rows of one comparison
    algorithm: { type: String, enum: ['dynamic', 'fcfs'], required: true },
    scenarioMetadata: { type: Schema.Types.Mixed, default: {} },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    metrics: { type: Schema.Types.Mixed, required: true },
    timeline: { type: [Schema.Types.Mixed], default: [] },
    executedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
performanceResultSchema.index({ runId: 1, algorithm: 1 }, { unique: true });

export type PerformanceResultDoc = InferSchemaType<typeof performanceResultSchema>;
export const PerformanceResult = model('PerformanceResult', performanceResultSchema);
