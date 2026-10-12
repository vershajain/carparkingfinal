import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg, get } from './api';
import { socket } from './socket';

/**
 * Fetches data from the backend and keeps it fresh:
 *  - refetches (debounced) whenever the server pushes a "state:changed" Socket.IO event
 *  - FALLBACK: polls every `fallbackMs` while the socket is disconnected
 *  - optional constant polling (`pollMs`), e.g. so waiting times on the queue keep advancing
 */
export function useLive<T = any>(path: string, params?: object, opts: { pollMs?: number; fallbackMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = path + JSON.stringify(params ?? {});
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const load = useCallback(async () => {
    try {
      setData(await get<T>(path, paramsRef.current));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setLoading(true);
    load();
    let timer: ReturnType<typeof setTimeout>;
    const onChange = () => { clearTimeout(timer); timer = setTimeout(load, 150); };
    socket.on('state:changed', onChange);
    const poll = setInterval(() => { if (opts.pollMs || !socket.connected) load(); }, opts.pollMs ?? opts.fallbackMs ?? 10_000);
    return () => { socket.off('state:changed', onChange); clearInterval(poll); clearTimeout(timer); };
  }, [load, opts.pollMs, opts.fallbackMs]);

  return { data, error, loading, reload: load };
}
