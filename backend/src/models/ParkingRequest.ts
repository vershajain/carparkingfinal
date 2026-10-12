import { Schema, model, InferSchemaType } from 'mongoose';
import { VEHICLE_TYPES } from './ParkingSlot.js';

export const REQUEST_STATUSES = ['waiting', 'allocated', 'cancelled', 'rejected'] as const;

const parkingRequestSchema = new Schema(
  {
    requestId: { type: String, required: true, unique: true }, // e.g. REQ-000123
    vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    registration: { type: String, required: true, index: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    arrivalTime: { type: Date, required: true, default: () => new Date(), index: true },
    expectedDurationMinutes: { type: Number, required: true, min: 1 },
    // Snapshot of VERIFIED urgency (taken from Vehicle, never from the form)
    urgency: { type: String, enum: ['normal', 'priority', 'emergency'], default: 'normal' },
    reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', default: null },
    reservationValid: { type: Boolean, default: false }, // verified server-side
    preferredAreaCode: { type: String, default: null },
    requiresAccessibleSlot: { type: Boolean, default: false },
    specialRequirements: { type: String, default: '' },
    status: { type: String, enum: REQUEST_STATUSES, default: 'waiting', index: true },
    // Present ONLY while status is 'waiting'. Unique+sparse => one waiting request per vehicle.
    activeRegistration: { type: String, default: undefined },
    priorityScore: { type: Number, default: null },
    scoreBreakdown: { type: Schema.Types.Mixed, default: null },
    allocation: { type: Schema.Types.ObjectId, ref: 'AllocationRecord', default: null },
    allocatedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
// Duplicate-request protection (portable: no partial index needed)
parkingRequestSchema.index({ activeRegistration: 1 }, { unique: true, sparse: true, name: 'one_waiting_per_vehicle' });

export type ParkingRequestDoc = InferSchemaType<typeof parkingRequestSchema>;
export const ParkingRequest = model('ParkingRequest', parkingRequestSchema);
