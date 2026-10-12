import { SchedulerConfiguration } from '../models/index.js';
import { validateConfig, type SchedulerConfig } from '../scheduler/index.js';
import { audit } from '../utils/audit.js';
import { badRequest } from '../utils/errors.js';
import { publish } from '../utils/socket.js';
import { runScheduler } from './allocationService.js';
import { getRuntimeConfig } from './configService.js';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function merge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(out[k]) ? merge(out[k], v) : v;
  return out as T;
}

/** Validates the MERGED configuration with the engine's own validator (weights sum to 1, etc.). */
export async function updateConfig(patch: Record<string, unknown>, actor: string) {
  const before = await getRuntimeConfig();
  const { penalty: penaltyPatch, activeAlgorithm, ...enginePatch } = patch;
  const engine = merge<SchedulerConfig>(before.engine, enginePatch);
  const errors = validateConfig(engine);
  if (errors.length) throw badRequest('Invalid scheduler configuration', errors);
  const penalty = merge(before.penalty, penaltyPatch);
  const algo = (activeAlgorithm as 'dynamic' | 'fcfs' | undefined) ?? before.activeAlgorithm;
  await SchedulerConfiguration.updateOne({ key: 'default' }, { $set: { ...engine, penalty, activeAlgorithm: algo, updatedBy: actor } });
  const after = await getRuntimeConfig();
  await audit(actor, 'config.update', 'SchedulerConfiguration', 'default', { patch, before, after });
  publish('config:updated', {});
  await runScheduler('config-changed'); // new weights apply to the live queue immediately
  return after;
}
