import { Schema, model, InferSchemaType } from 'mongoose';

const allocationRecordSchema = new Schema(
  {
    request: { type: Schema.Types.ObjectId, ref: 'ParkingRequest', required: true, index: true },
    requestId: { type: String, required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    registration: { type: String, required: true },
    slot: { type: Schema.Types.ObjectId, ref: 'ParkingSlot', required: true },
    slotCode: { type: String, required: true },
    session: { type: Schema.Types.ObjectId, ref: 'ParkingSession', default: null },
    allocatedAt: { type: Date, required: true, index: true },
    algorithm: { type: String, enum: ['dynamic', 'fcfs'], required: true },
    priorityScore: { type: Number, default: null }, // VEHICLE priority score
    factors: { type: Schema.Types.Mixed, default: null }, // raw W,U,D,T,R,S,F
    contributions: { type: Schema.Types.Mixed, default: null }, // 100 * weight * value per factor
    slotScore: { type: Number, default: null }, // SLOT suitability score (separate concept)
    vehicleReason: { type: String, required: true },
    slotReason: { type: String, required: true },
    alternativeSlots: { type: [Schema.Types.Mixed], default: [] },
    fcfsComparison: { type: Schema.Types.Mixed, default: null }, // what FCFS would have picked
    configSnapshot: { type: Schema.Types.Mixed, default: null },
    stateSnapshot: { type: Schema.Types.Mixed, default: null },
    decisionTimeMs: { type: Number, default: null },
  },
  { timestamps: true },
);

export type AllocationRecordDoc = InferSchemaType<typeof allocationRecordSchema>;
export const AllocationRecord = model('AllocationRecord', allocationRecordSchema);
