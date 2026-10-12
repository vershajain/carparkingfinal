import { Schema, model, InferSchemaType } from 'mongoose';

const parkingAreaSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true }, // e.g. "Area 1"
    prefix: { type: String, required: true, unique: true, trim: true }, // e.g. "B1" -> slot codes B1-S01
    name: { type: String, required: true, trim: true }, // e.g. "Basement Parking"
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type ParkingAreaDoc = InferSchemaType<typeof parkingAreaSchema>;
export const ParkingArea = model('ParkingArea', parkingAreaSchema);
