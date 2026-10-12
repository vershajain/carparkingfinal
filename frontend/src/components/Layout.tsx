import { BarChart3, CalendarClock, CarFront, ListOrdered, LayoutDashboard, LogIn, LogOut, Menu, ParkingSquare, Scale, Settings, Timer, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useSocketStatus } from '../lib/socket';
import { cn } from '../lib/utils';
import { LoginDialog } from './LoginDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const NAV = [
  { to: '/', label: 'Overview', Icon: LayoutDashboard },
  { to: '/layout', label: 'Parking Layout', Icon: ParkingSquare },
  { to: '/requests', label: 'Vehicle Requests', Icon: CarFront },
  { to: '/queue', label: 'Scheduling Queue', Icon: ListOrdered },
  { to: '/decisions', label: 'Allocation Decisions', Icon: Scale },
  { to: '/reservations', label: 'Reservations', Icon: CalendarClock },
  { to: '/sessions', label: 'Parking Sessions', Icon: Timer },
  { to: '/analytics', label: 'Analytics & FCFS Comparison', Icon: BarChart3 },
  { to: '/config', label: 'Configuration', Icon: Settings },
];

export default function Layout() {
  const { username, role, logout } = useAuth();
  const live = useSocketStatus();
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className={cn('fixed inset-y-0 left-0 z-30 w-64 transform border-r bg-white p-3 transition-transform md:static md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="mb-4 px-2">
          <p className="text-sm font-bold leading-tight">OS-Inspired Smart Parking Resource Scheduler</p>
          <p className="text-xs text-slate-500">Vehicles = processes, slots = resources</p>
        </div>
        <nav aria-label="Main" className="space-y-1">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}
              className={({ isActive }) => cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm', isActive ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700 hover:bg-slate-100')}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-white/90 px-4 py-2 backdrop-blur">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle navigation"><Menu className="h-5 w-5" /></Button>
          <div className="ml-auto flex items-center gap-3">
            <Badge tone={live ? 'green' : 'amber'} title={live ? 'Receiving live updates' : 'Live connection lost: refreshing periodically'}>
              {live ? <Wifi className="h-3 w-3" aria-hidden /> : <WifiOff className="h-3 w-3" aria-hidden />}{live ? 'Live' : 'Reconnecting (polling)'}
            </Badge>
            {username ? (
              <>
                <span className="text-sm">{username} <Badge tone="indigo">{role}</Badge></span>
                <Button variant="outline" size="sm" onClick={logout}><LogOut className="h-4 w-4" />Log out</Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setLogin(true)}><LogIn className="h-4 w-4" />Staff login</Button>
            )}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6"><Outlet /></main>
      </div>
      <LoginDialog open={login} onOpenChange={setLogin} />
    </div>
  );
}
