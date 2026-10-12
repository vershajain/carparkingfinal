import { useState } from 'react';
import { toast } from 'sonner';
import { Empty, ErrorBox, Loading, NeedLogin, PageHeader } from '../components/common';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { Table, TD, TH, THead, TR } from '../components/ui/table';
import { errMsg, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, toLocalInput } from '../lib/format';
import { useLive } from '../lib/useLive';

const TONE: Record<string, any> = { active: 'amber', used: 'green', cancelled: 'slate', expired: 'gray' };

export default function Reservations() {
  const { data: list, error, loading, reload } = useLive<any[]>('/reservations');
  const { data: slots } = useLive<any[]>('/slots');
  const { data: areas } = useLive<any[]>('/areas');
  const { data: cfg } = useLive<any>('/config');
  const { canOperate } = useAuth();
  const now = new Date();
  const [f, setF] = useState<any>({ registration: '', vehicleType: 'car', target: 'slot', slotId: '', areaCode: '', start: toLocalInput(new Date(now.getTime() + 30 * 60_000)), end: toLocalInput(new Date(now.getTime() + 150 * 60_000)) });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  const create = async () => {
    try {
      const body: any = { registration: f.registration, vehicleType: f.vehicleType, startTime: new Date(f.start).toISOString(), endTime: new Date(f.end).toISOString() };
      if (f.target === 'slot') body.slotId = f.slotId; else body.areaCode = f.areaCode;
      const { message } = await post('/reservations', body);
      toast.success(message); reload();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const cancel = async (id: string) => { try { await post(`/reservations/${id}/cancel`); toast.success('Reservation cancelled'); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const early = cfg?.engine.reservation.earlyArrivalMinutes, late = cfg?.engine.reservation.lateArrivalMinutes;

  return (
    <>
      <PageHeader title="Reservations" subtitle="Validity is always checked on the server against status, owner and time window." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Create reservation</CardTitle>
            <CardDescription>A slot reservation holds that slot from {early ?? '...'} min before the start; ordinary vehicles may use it only if they leave before the hold opens. It expires {late ?? '...'} min after the start if unclaimed. An area reservation gives the valid-reservation benefit but holds no specific slot.</CardDescription></CardHeader>
          <CardContent>
            {!canOperate ? <NeedLogin /> : (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create(); }}>
                <div><Label htmlFor="rr">Registration</Label><Input id="rr" value={f.registration} onChange={(e) => set('registration', e.target.value)} required /></div>
                <div><Label htmlFor="rt">Vehicle type</Label><Select id="rt" value={f.vehicleType} onChange={(e) => set('vehicleType', e.target.value)}>{['bike', 'car', 'suv', 'other'].map((t) => <option key={t}>{t}</option>)}</Select></div>
                <div><Label htmlFor="rk">Reserve</Label><Select id="rk" value={f.target} onChange={(e) => set('target', e.target.value)}><option value="slot">A specific slot</option><option value="area">Any slot in an area</option></Select></div>
                {f.target === 'slot'
                  ? <div><Label htmlFor="rs">Slot</Label><Select id="rs" value={f.slotId} onChange={(e) => set('slotId', e.target.value)} required><option value="">Choose a slot</option>{slots?.filter((s) => s.status !== 'unavailable').map((s) => <option key={s._id} value={s._id}>{s.code} ({s.slotType})</option>)}</Select></div>
                  : <div><Label htmlFor="ra">Area</Label><Select id="ra" value={f.areaCode} onChange={(e) => set('areaCode', e.target.value)} required><option value="">Choose an area</option>{areas?.map((a) => <option key={a._id} value={a.code}>{a.code} - {a.name}</option>)}</Select></div>}
                <div><Label htmlFor="r1">Start</Label><Input id="r1" type="datetime-local" value={f.start} onChange={(e) => set('start', e.target.value)} required /></div>
                <div><Label htmlFor="r2">End</Label><Input id="r2" type="datetime-local" value={f.end} onChange={(e) => set('end', e.target.value)} required /></div>
                <Button type="submit" className="w-full">Create reservation</Button>
              </form>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>All reservations</CardTitle></CardHeader>
          <CardContent>
            {loading ? <Loading /> : error ? <ErrorBox message={error} /> : !list?.length ? <Empty>No reservations yet.</Empty> : (
              <Table><THead><TR><TH>ID</TH><TH>Vehicle</TH><TH>Target</TH><TH>Window</TH><TH>Status</TH>{canOperate && <TH />}</TR></THead>
                <tbody>{list.map((r) => (
                  <TR key={r._id}><TD className="font-mono">{r.reservationId}</TD><TD className="font-mono">{r.registration}</TD><TD>{r.slotCode ? `Slot ${r.slotCode}` : `Area ${r.areaCode}`}</TD>
                    <TD className="text-xs">{fmtDate(r.startTime)}<br />to {fmtDate(r.endTime)}</TD><TD><Badge tone={TONE[r.status]}>{r.status}</Badge></TD>
                    {canOperate && <TD>{r.status === 'active' && <Button size="sm" variant="outline" onClick={() => cancel(r._id)}>Cancel</Button>}</TD>}</TR>))}</tbody></Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
