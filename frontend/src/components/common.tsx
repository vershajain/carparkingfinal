import { Ban, CalendarClock, CheckCircle2, CarFront, Loader2, Inbox, type LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { tzLabel } from '../lib/format';

/** Status is always conveyed by icon + text, never by colour alone. */
export const SLOT_STATUS: Record<string, { label: string; tone: 'green' | 'red' | 'amber' | 'gray'; Icon: LucideIcon; tile: string }> = {
  available: { label: 'Available', tone: 'green', Icon: CheckCircle2, tile: 'border-green-400 bg-green-50 hover:bg-green-100' },
  occupied: { label: 'Occupied', tone: 'red', Icon: CarFront, tile: 'border-red-400 bg-red-50 hover:bg-red-100' },
  reserved: { label: 'Reserved', tone: 'amber', Icon: CalendarClock, tile: 'border-amber-400 bg-amber-50 hover:bg-amber-100' },
  unavailable: { label: 'Unavailable', tone: 'gray', Icon: Ban, tile: 'border-gray-400 bg-gray-200 hover:bg-gray-300' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = SLOT_STATUS[status];
  if (!s) return <Badge>{status}</Badge>;
  return <Badge tone={s.tone}><s.Icon className="h-3 w-3" aria-hidden />{s.label}</Badge>;
}

const URGENCY_TONE: Record<string, 'slate' | 'amber' | 'red'> = { normal: 'slate', priority: 'amber', emergency: 'red' };
export const UrgencyBadge = ({ urgency }: { urgency: string }) => <Badge tone={URGENCY_TONE[urgency] ?? 'slate'}>{urgency === 'emergency' ? 'Emergency (verified)' : urgency === 'priority' ? 'Priority (verified)' : 'Normal'}</Badge>;

export function StatCard({ label, value, hint, Icon, tone = 'slate' }: { label: string; value: ReactNode; hint?: string; Icon: LucideIcon; tone?: 'slate' | 'green' | 'red' | 'amber' | 'gray' | 'indigo' }) {
  const bg = { slate: 'bg-slate-100 text-slate-700', green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-800', gray: 'bg-gray-200 text-gray-700', indigo: 'bg-indigo-100 text-indigo-700' }[tone];
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className={`rounded-lg p-2 ${bg}`}><Icon className="h-5 w-5" aria-hidden /></div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="truncate text-xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </Card>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}<span className="text-xs text-slate-400">Times in {tzLabel()}</span></div>
    </div>
  );
}

export const Loading = () => <div className="flex items-center gap-2 p-6 text-slate-500" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading...</div>;
export const ErrorBox = ({ message }: { message: string }) => <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{message}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-500"><Inbox className="h-6 w-6" aria-hidden />{children}</div>;
export const NeedLogin = ({ role = 'operator' }: { role?: string }) => <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">Log in as {role} (top right) to use this action.</p>;
