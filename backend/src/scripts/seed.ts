import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { ParkingArea, User } from '../models/index.js';
import * as models from '../models/index.js';
import { ensureConfig } from '../services/configService.js';
import { createArea } from '../services/slotService.js';

/** INITIAL SETUP DATA (not fake results): default layout, default config, admin user.
 *  Safe by default: it only creates what is missing.
 *  `npm run seed -- --reset --yes` wipes this database first (explicit double confirmation). */
const INITIAL_LAYOUT = [
  { code: 'Area 1', prefix: 'B1', name: 'Basement Parking', description: 'Covered basement with accessible bays', slots: [
    { slotType: 'standard' as const, count: 6 }, { slotType: 'compact' as const, count: 2 },
    { slotType: 'large' as const, count: 2 }, { slotType: 'accessible' as const, count: 2 } ] },
  { code: 'Area 2', prefix: 'G1', name: 'Ground Floor Parking', description: 'Main visitor parking', slots: [
    { slotType: 'standard' as const, count: 6 }, { slotType: 'compact' as const, count: 2 }, { slotType: 'bike' as const, count: 4 } ] },
  { code: 'Area 3', prefix: 'R1', name: 'Rooftop Parking', description: 'Open-air upper deck', slots: [
    { slotType: 'standard' as const, count: 4 }, { slotType: 'large' as const, count: 2 }, { slotType: 'bike' as const, count: 2 } ] },
];

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset && !process.argv.includes('--yes')) {
    console.error('Refusing to reset: add --yes to confirm that ALL data in this database will be deleted.');
    process.exit(1);
  }
  await connectDb();
  if (reset) {
    await mongoose.connection.dropDatabase();
    console.log(`[seed] dropped database "${mongoose.connection.name}"`);
  }
  for (const m of Object.values(models)) if (typeof (m as any)?.syncIndexes === 'function') await (m as any).syncIndexes();
  await ensureConfig();
  if (!(await User.exists({ username: env.SEED_ADMIN_USERNAME }))) {
    await User.create({ username: env.SEED_ADMIN_USERNAME, passwordHash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10), role: 'admin' });
    console.log(`[seed] created admin user "${env.SEED_ADMIN_USERNAME}"`);
  }
  if ((await ParkingArea.countDocuments()) === 0) {
    for (const a of INITIAL_LAYOUT) await createArea(a, 'seed');
    console.log('[seed] created initial parking layout (editable by admins)');
  } else console.log('[seed] areas already exist - layout left untouched');
  await disconnectDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
