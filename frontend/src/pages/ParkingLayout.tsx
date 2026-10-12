import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Empty, ErrorBox, Loading, NeedLogin, PageHeader, SLOT_STATUS, StatusBadge } from '../components/common';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Input, Label, Select } from '../components/ui/input';
import { errMsg, patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { socket } from '../lib/socket';
import { cn } from '../lib/utils';
import { useLive } from '../lib/useLive';

export default function ParkingLayout() {
  const { data: slots, error, loading, reload } = useLive<any[]>('/slots');
  const { canOperate } = useAuth();
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [fresh, setFresh] = useState<Record<string, number>>({}); // slot code -> expiry timestamp

  // highlight slots that were just allocated (pushed by the server over Socket.IO)
  useEffect(() => {
    const h = (p: { slotCode: string }) => {
      setFresh((f) => ({ ...f, [p.slotCode]: Date.now() + 10_000 }));
      setTimeout(() => setFresh((f) => ({ ...f })), 10_200);
    };
    socket.on('slot:allocated', h);
    return () => { socket.off('slot:allocated', h); };
  }, []);
  const isNew = (s: any) => (fresh[s.code] ?? 0) > Date.now() || (s.session && Date.now() - new Date(s.session.entryTime).getTime() < 15_000);

  if (loading) return <Loading />;
  if (error || !slots) return <ErrorBox message={error ?? 'No data'} />;
  const shown = slots.filter((s) => !filter || s.status === filter);
  const areas = [...new Set(slots.map((s) => s.areaCode))].sort();
  const cur = slots.find((s) => s._id === sel);

  const setStatus = async (status: 'available' | 'unavailable') => {
    try { await patch(`/slots/${cur._id}/status`, { status, reason: reason || undefined }); toast.success(`Slot ${cur.code} is now ${status}`); setSel(null); setReason(''); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <>
      <PageHeader title="Parking Layout" subtitle="Loaded from the database; changes appear without reloading."
        actions={<Select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40"><option value="">All statuses</option>{Object.entries(SLOT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>} />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Legend">
        {Object.keys(SLOT_STATUS).map((k) => <StatusBadge key={k} status={k} />)}
        <Badge tone="indigo"><Sparkles className="h-3 w-3" aria-hidden />Newly allocated (outlined)</Badge>
      </div>
      {areas.map((code) => {
        const inArea = shown.filter((s) => s.areaCode === code);
        const all = slots.filter((s) => s.areaCode === code);
        return (
          <section key={code} className="mb-6" aria-labelledby={`a-${code}`}>
            <h2 id={`a-${code}`} className="mb-2 text-lg font-semibold">{code} - {all[0]?.areaName} <span className="text-sm font-normal text-slate-500">({all.filter((s) => s.status === 'available').length}/{all.length} free)</span></h2>
            {inArea.length === 0 ? <Empty>No slots match the filter.</Empty> : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {inArea.map((s) => {
                  const st = SLOT_STATUS[s.status];
                  return (
                    <button key={s._id} onClick={() => setSel(s._id)} aria-label={`Slot ${s.code}, ${st.label}${s.currentVehicleRegistration ? `, vehicle ${s.currentVehicleRegistration}` : ''}${isNew(s) ? ', newly allocated' : ''}`}
                      className={cn('rounded-lg border-2 p-2 text-left text-sm transition', st.tile, isNew(s) && 'ring-4 ring-indigo-500')}>
                      <div className="flex items-center justify-between"><span className="font-mono font-semibold">{s.code}</span>{isNew(s) && <span className="flex items-center gap-0.5 text-xs font-bold text-indigo-700"><Sparkles className="h-3 w-3" aria-hidden />NEW</span>}</div>
                      <div className="mt-1 flex items-center gap-1 text-xs font-medium"><st.Icon className="h-3 w-3" aria-hidden />{st.label}</div>
                      <div className="text-xs text-slate-600">{s.slotType}{s.isAccessible ? ' (accessible)' : ''}</div>
                      <div className="truncate text-xs">{s.currentVehicleRegistration ?? s.reservation?.registration ?? '\u00a0'}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      <Dialog open={!!cur} onOpenChange={(o) => !o && setSel(null)}>
        {cur && (
          <DialogContent title={`Slot ${cur.code}`} description={`${cur.areaCode} - ${cur.areaName}`}>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-slate-500">Status</dt><dd className="col-span-2"><StatusBadge status={cur.status} /></dd>
              <dt className="text-slate-500">Type</dt><dd className="col-span-2">{cur.slotType}{cur.isAccessible && ' (accessible)'}</dd>
              <dt className="text-slate-500">Accepts</dt><dd className="col-span-2">{cur.compatibleVehicleTypes.join(', ')}</dd>
              {cur.unavailableReason && (<><dt className="text-slate-500">Reason</dt><dd className="col-span-2">{cur.unavailableReason}</dd></>)}
              {cur.session && (<>
                <dt className="text-slate-500">Vehicle</dt><dd className="col-span-2 font-mono">{cur.session.registration}</dd>
                <dt className="text-slate-500">Session</dt><dd className="col-span-2">{cur.session.sessionId}</dd>
                <dt className="text-slate-500">Entered</dt><dd className="col-span-2">{fmtDate(cur.session.entryTime)}</dd>
                <dt className="text-slate-500">Expected exit</dt><dd className="col-span-2">{fmtDate(cur.session.expectedDeparture)}</dd>
              </>)}
              {cur.reservation && (<>
                <dt className="text-slate-500">Reservation</dt><dd className="col-span-2">{cur.reservation.reservationId} for {cur.reservation.registration}</dd>
                <dt className="text-slate-500">Window</dt><dd className="col-span-2">{fmtDate(cur.reservation.startTime)} - {fmtDate(cur.reservation.endTime)}</dd>
              </>)}
            </dl>
            <div className="mt-4 border-t pt-3">
              {!canOperate ? <NeedLogin /> : cur.status === 'available' ? (
                <div className="space-y-2"><Label htmlFor="why">Reason (optional)</Label><Input id="why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. maintenance" />
                  <Button variant="destructive" onClick={() => setStatus('unavailable')}>Mark unavailable</Button></div>
              ) : cur.status === 'unavailable' ? <Button onClick={() => setStatus('available')}>Restore to service</Button>
                : <p className="text-sm text-slate-500">Occupied or reserved slots cannot be taken out of service. Use Parking Sessions / Reservations first.</p>}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
