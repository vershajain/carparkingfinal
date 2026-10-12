import { Schema, model, InferSchemaType } from 'mongoose';

export const RESERVATION_STATUSES = ['active', 'used', 'cancelled', 'expired'] as const;

const reservationSchema = new Schema(
  {
    reservationId: { type: String, required: true, unique: true }, // e.g. RSV-000045
    vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    registration: { type: String, required: true, index: true },
    slot: { type: Schema.Types.ObjectId, ref: 'ParkingSlot', default: null }, // a specific slot, OR
    areaCode: { type: String, default: null }, // an area-level reservation
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    status: { type: String, enum: RESERVATION_STATUSES, default: 'active', index: true },
    createdBy: { type: String, default: null },
  },
  { timestamps: true },
);
reservationSchema.index({ status: 1, endTime: 1 });
reservationSchema.pre('validate', function (next) {
  if (this.endTime && this.startTime && this.endTime <= this.startTime) {
    return next(new Error('Reservation endTime must be after startTime'));
  }
  if (!this.slot && !this.areaCode) {
    return next(new Error('Reservation needs a slot or an area'));
  }
  next();
});

export type ReservationDoc = InferSchemaType<typeof reservationSchema>;
export const Reservation = model('Reservation', reservationSchema);
