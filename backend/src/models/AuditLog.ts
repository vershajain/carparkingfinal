import { Schema, model } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actor: { type: String, required: true },
    action: { type: String, required: true, index: true }, // e.g. "slot.markUnavailable"
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AuditLog = model('AuditLog', auditLogSchema);
