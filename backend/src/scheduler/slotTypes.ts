import type { SlotType, VehicleType } from './types.js';

/** Which vehicle types each slot type physically accepts (HARD compatibility rule). */
export const SLOT_COMPATIBILITY: Record<SlotType, VehicleType[]> = {
  bike: ['bike'],
  compact: ['car', 'bike'],
  standard: ['car', 'suv', 'other'],
  large: ['suv', 'car', 'other'],
  accessible: ['car', 'suv', 'other'],
};
