import { Server } from 'socket.io';

let io: Server | null = null;
export const setIo = (s: Server) => {
  io = s;
};

export type StateEvent =
  | 'request:created'
  | 'queue:updated'
  | 'slot:allocated'
  | 'slot:updated'
  | 'session:entered'
  | 'session:exited'
  | 'session:extended'
  | 'reservation:changed'
  | 'config:updated'
  | 'analytics:updated';

/** The backend is the source of truth; clients refetch when they receive these signals. */
export function publish(event: StateEvent, payload: unknown = {}) {
  io?.emit(event, payload);
  io?.emit('state:changed', { event, at: new Date().toISOString() });
}
