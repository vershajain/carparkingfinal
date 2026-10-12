import { createContext, ReactNode, useContext, useState } from 'react';
import { post } from './api';

type Role = 'admin' | 'operator';
interface AuthState { username: string | null; role: Role | null }
interface AuthCtx extends AuthState {
  login: (u: string, p: string) => Promise<void>;
  logout: () => void;
  canOperate: boolean;
  isAdmin: boolean;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
const read = (): AuthState => ({ username: localStorage.getItem('username'), role: localStorage.getItem('role') as Role | null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AuthState>(read);
  const login = async (username: string, password: string) => {
    const { data } = await post('/auth/login', { username, password });
    localStorage.setItem('token', data.token); localStorage.setItem('username', data.username); localStorage.setItem('role', data.role);
    setS({ username: data.username, role: data.role });
  };
  const logout = () => { ['token', 'username', 'role'].forEach((k) => localStorage.removeItem(k)); setS({ username: null, role: null }); };
  return <Ctx.Provider value={{ ...s, login, logout, canOperate: !!s.role, isAdmin: s.role === 'admin' }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
