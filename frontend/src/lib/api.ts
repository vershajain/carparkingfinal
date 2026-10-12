import axios from 'axios';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '';
export const http = axios.create({ baseURL: `${API_URL}/api` });
http.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export function errMsg(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data;
    let msg = d?.message ?? e.message;
    if (d?.details) {
      const det = Array.isArray(d.details) ? d.details.join('; ') : Object.entries(d.details).map(([k, v]) => `${k}: ${v}`).join('; ');
      if (det) msg += ` (${det})`;
    }
    return msg;
  }
  return String(e);
}
export const get = async <T = any>(path: string, params?: object) => (await http.get(path, { params })).data.data as T;
export const post = async <T = any>(path: string, body?: unknown) => (await http.post(path, body)).data as { data: T; message: string };
export const put = async <T = any>(path: string, body?: unknown) => (await http.put(path, body)).data as { data: T; message: string };
export const patch = async <T = any>(path: string, body?: unknown) => (await http.patch(path, body)).data as { data: T; message: string };
