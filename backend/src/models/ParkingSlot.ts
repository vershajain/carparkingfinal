import { Schema, model, InferSchemaType } from 'mongoose';

export const VEHICLE_TYPES = ['bike', 'car', 'suv', 'other'] as const;
export const SLOT_TYPES = ['bike', 'compact', 'standard', 'large', 'accessible'] as const;
export const SLOT_STATUSES = ['available', 'occupied', 'reserved', 'unavailable'] as const;

const parkingSlotSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true }, // e.g. "B1-S01"
    area: { type: Schema.Types.ObjectId, ref: 'ParkingArea', required: true, index: true },
    areaCode: { type: String, required: true, index: true },
    areaName: { type: String, required: true },
    slotType: { type: String, enum: SLOT_TYPES, required: true },
    // HARD constraint: only these vehicle types may use the slot
    compatibleVehicleTypes: { type: [String], enum: VEHICLE_TYPES, required: true },
    isAccessible: { type: Boolean, default: false },
    status: { type: String, enum: SLOT_STATUSES, default: 'available', index: true },
    currentSession: { type: Schema.Types.ObjectId, ref: 'ParkingSession', default: null },
    currentVehicleRegistration: { type: String, default: null },
    currentReservation: { type: Schema.Types.ObjectId, ref: 'Reservation', default: null },
    unavailableReason: { type: String, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
parkingSlotSchema.index({ status: 1, areaCode: 1 });

export type ParkingSlotDoc = InferSchemaType<typeof parkingSlotSchema>;
export const ParkingSlot = model('ParkingSlot', parkingSlotSchema);
