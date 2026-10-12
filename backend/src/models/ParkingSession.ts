import { Schema, model, InferSchemaType } from 'mongoose';

const extensionSchema = new Schema(
  {
    at: { type: Date, required: true },
    addedMinutes: { type: Number, required: true },
    previousExpectedDeparture: { type: Date, required: true },
    newExpectedDeparture: { type: Date, required: true },
    by: { type: String, default: null },
  },
  { _id: false },
);

const parkingSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    registration: { type: String, required: true },
    request: { type: Schema.Types.ObjectId, ref: 'ParkingRequest', required: true },
    slot: { type: Schema.Types.ObjectId, ref: 'ParkingSlot', required: true, index: true },
    slotCode: { type: String, required: true },
    entryTime: { type: Date, required: true },
    expectedDeparture: { type: Date, required: true },
    actualExit: { type: Date, default: null },
    extensions: { type: [extensionSchema], default: [] },
    finalDurationMinutes: { type: Number, default: null },
    overstayMinutes: { type: Number, default: 0 },
    // Full calculation breakdown (rate, grace, rounding, result) so it can be displayed
    penalty: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['active', 'completed'], default: 'active', index: true },
    // Present ONLY while the session is active (removed on exit). Unique+sparse => at most one active session per slot.
    activeSlot: { type: Schema.Types.ObjectId, default: undefined },
  },
  { timestamps: true, optimisticConcurrency: true },
);
// Database-level guard against double allocation (portable: no partial index needed)
parkingSessionSchema.index({ activeSlot: 1 }, { unique: true, sparse: true, name: 'one_active_session_per_slot' });

export type ParkingSessionDoc = InferSchemaType<typeof parkingSessionSchema>;
export const ParkingSession = model('ParkingSession', parkingSessionSchema);
