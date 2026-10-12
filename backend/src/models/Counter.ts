import { Schema, model } from 'mongoose';

// Atomic counters for readable unique IDs (REQ-000001, RSV-000001, SES-000001)
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = model('Counter', counterSchema);

/**
 * Atomic $inc gives each caller a distinct number. Two callers upserting the very FIRST counter
 * document at the same moment can collide on _id (E11000): that is harmless, so we retry.
 */
export async function nextId(prefix: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const c = await Counter.findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, { new: true, upsert: true });
      return `${prefix}-${String(c.seq).padStart(6, '0')}`;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000 || attempt >= 8) throw e;
    }
  }
}
