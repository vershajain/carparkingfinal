import { AuditLog } from '../models/index.js';

export async function audit(actor: string, action: string, entityType: string, entityId: string | null, details: object = {}) {
  await AuditLog.create({ actor, action, entityType, entityId, details });
}
