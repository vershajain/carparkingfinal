import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { API_URL } from './api';

/** One shared connection. The backend is the source of truth; events only tell the UI to refetch. */
export const socket = io(API_URL || window.location.origin, { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });

export function useSocketStatus(): boolean {
  const [up, setUp] = useState(socket.connected);
  useEffect(() => {
    const on = () => setUp(true), off = () => setUp(false);
    socket.on('connect', on); socket.on('disconnect', off); socket.on('connect_error', off);
    return () => { socket.off('connect', on); socket.off('disconnect', off); socket.off('connect_error', off); };
  }, []);
  return up;
}
