import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDb(uri: string = env.MONGODB_URI): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('[db] connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
