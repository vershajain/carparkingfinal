import { Schema, model, InferSchemaType } from 'mongoose';
import { VEHICLE_TYPES } from './ParkingSlot.js';

export const PRIORITY_CATEGORIES = ['normal', 'priority', 'emergency'] as const;

const vehicleSchema = new Schema(
  {
    registration: { type: String, required: true, unique: true, uppercase: true, trim: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    // Authorised priority: ONLY an admin/operator can change this (never self-declared)
    priorityCategory: { type: String, enum: PRIORITY_CATEGORIES, default: 'normal' },
    priorityVerifiedBy: { type: String, default: null },
    priorityVerifiedAt: { type: Date, default: null },
    priorityNote: { type: String, default: '' },
    needsAccessibleSlot: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type VehicleDoc = InferSchemaType<typeof vehicleSchema>;
export const Vehicle = model('Vehicle', vehicleSchema);
