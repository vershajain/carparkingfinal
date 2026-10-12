import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorBox, Loading, NeedLogin, PageHeader } from '../components/common';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { Table, TD, TH, THead, TR } from '../components/ui/table';
import { errMsg, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { factorLabels, fmtDate } from '../lib/format';
import { useLive } from '../lib/useLive';

const SLOT_TYPES = ['standard', 'compact', 'large', 'accessible', 'bike'];

function Num({ label, value, onChange, disabled, step = 1 }: { label: string; value: number; onChange: (n: number) => void; disabled: boolean; step?: number }) {
  const id = label.replace(/\W+/g, '-');
  return <div><Label htmlFor={id}>{label}</Label><Input id={id} type="number" step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}

export default function Config() {
  const { data: cfg, error, loading, reload } = useLive<any>('/config');
  const { data: areas, reload: reloadAreas } = useLive<any[]>('/areas');
  const { isAdmin } = useAuth();
  const [d, setD] = useState<any>(null);
  const [audit, setAudit] = useState<any[] | null>(null);
  useEffect(() => { if (cfg && !d) setD(structuredClone(cfg)); }, [cfg, d]);
  useEffect(() => { if (isAdmin) get<any[]>('/audit', { limit: 50 }).then(setAudit).catch(() => setAudit([])); else setAudit(null); }, [isAdmin, cfg]);
  const [area, setArea] = useState<any>({ code: '', prefix: '', name: '', description: '', counts: Object.fromEntries(SLOT_TYPES.map((t) => [t, 0])) });
  const [add, setAdd] = useState<any>({ areaId: '', slotType: 'standard', count: 1 });

  if (loading || !d) return error ? <ErrorBox message={error} /> : <Loading />;
  const e = d.engine;
  const set = (path: string[], v: any) => setD((x: any) => { const c = structuredClone(x); let o = c; path.slice(0, -1).forEach((k) => (o = o[k])); o[path[path.length - 1]] = v; return c; });
  const sum = Object.values(e.weights as Record<string, number>).reduce((a, b) => a + b, 0);
  const sumOk = Math.abs(sum - 1) < 1e-6;
  const dis = !isAdmin;

  const save = async () => {
    try {
      await patch('/config', { ...e, penalty: d.penalty, activeAlgorithm: d.activeAlgorithm });
      toast.success('Configuration saved; the live queue was re-evaluated'); setD(null); reload();
    } catch (err) { toast.error(errMsg(err)); }
  };
  const createArea = async () => {
    try {
      const slots = SLOT_TYPES.filter((t) => area.counts[t] > 0).map((t) => ({ slotType: t, count: Number(area.counts[t]) }));
      await post('/areas', { code: area.code, prefix: area.prefix, name: area.name, description: area.description || undefined, slots }); toast.success('Area created'); reloadAreas();
    } catch (err) { toast.error(errMsg(err)); }
  };
  const addSlots = async () => { try { await post(`/areas/${add.areaId}/slots`, { slotType: add.slotType, count: Number(add.count) }); toast.success('Slots added'); reloadAreas(); } catch (err) { toast.error(errMsg(err)); } };

  return (
    <>
      <PageHeader title="Configuration" subtitle="Scheduler weights, thresholds, penalty rules and the parking layout. Only admins can change them; every change is audited." />
      {dis && <div className="mb-3"><NeedLogin role="admin" /></div>}
      <Card className="mb-4">
        <CardHeader><CardTitle>Priority-score weights</CardTitle><CardDescription>PriorityScore = 100 x (wW*W + wU*U + wD*D + wT*T + wR*R + wS*S + wF*F). These are proposed starting values, not experimentally proven. Weights must be non-negative and sum to 1.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.keys(factorLabels).map((k) => <Num key={k} label={factorLabels[k]} step={0.01} value={e.weights[k]} disabled={dis} onChange={(n) => set(['engine', 'weights', k], n)} />)}
          </div>
          <p role="status" className={`mt-2 text-sm font-medium ${sumOk ? 'text-green-700' : 'text-red-700'}`}>{sumOk ? 'Sum = 1.00 (valid)' : `Sum = ${sum.toFixed(3)} - must equal 1`}</p>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Scoring rules</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
          <Num label="Waiting-time cap (min)" value={e.waitingTimeCapMinutes} disabled={dis} onChange={(n) => set(['engine', 'waitingTimeCapMinutes'], n)} />
          <div><Label htmlFor="dp">Duration policy</Label><Select id="dp" disabled={dis} value={e.durationPolicy} onChange={(ev) => set(['engine', 'durationPolicy'], ev.target.value)}><option value="shorter">Prefer shorter stays</option><option value="longer">Prefer longer stays</option></Select></div>
          <Num label="Duration reference (min)" value={e.durationReferenceMinutes} disabled={dis} onChange={(n) => set(['engine', 'durationReferenceMinutes'], n)} />
          <Num label="Aging grace (min)" value={e.aging.graceMinutes} disabled={dis} onChange={(n) => set(['engine', 'aging', 'graceMinutes'], n)} />
          <Num label="Aging ramp (min)" value={e.aging.rampMinutes} disabled={dis} onChange={(n) => set(['engine', 'aging', 'rampMinutes'], n)} />
          <Num label="Starvation threshold (min)" value={e.starvationThresholdMinutes} disabled={dis} onChange={(n) => set(['engine', 'starvationThresholdMinutes'], n)} />
          {['normal', 'priority', 'emergency'].map((k) => <Num key={k} label={`Urgency score: ${k}`} step={0.05} value={e.urgencyScores[k]} disabled={dis} onChange={(n) => set(['engine', 'urgencyScores', k], n)} />)}
          {['low', 'medium', 'high'].map((k) => <Num key={k} label={`Demand threshold: ${k}`} step={0.1} value={e.demandThresholds[k]} disabled={dis} onChange={(n) => set(['engine', 'demandThresholds', k], n)} />)}
          {['low', 'medium', 'high'].map((k) => <Num key={k} label={`Demand score: ${k}`} step={0.05} value={e.demandScores[k]} disabled={dis} onChange={(n) => set(['engine', 'demandScores', k], n)} />)}
        </CardContent></Card>
        <div className="space-y-4">
          <Card><CardHeader><CardTitle>Policy</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="al">Live scheduler algorithm</Label><Select id="al" disabled={dis} value={d.activeAlgorithm} onChange={(ev) => set(['activeAlgorithm'], ev.target.value)}><option value="dynamic">Dynamic multi-factor priority</option><option value="fcfs">FCFS baseline</option></Select></div>
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" disabled={dis} checked={e.emergencyPolicy.allowUseOfReservedUnclaimedSlots} onChange={(ev) => set(['engine', 'emergencyPolicy', 'allowUseOfReservedUnclaimedSlots'], ev.target.checked)} />Emergencies may use slots with upcoming reservations (last resort)</label>
            <Num label="Reservation: early arrival / hold (min)" value={e.reservation.earlyArrivalMinutes} disabled={dis} onChange={(n) => set(['engine', 'reservation', 'earlyArrivalMinutes'], n)} />
            <Num label="Reservation: no-show deadline (min)" value={e.reservation.lateArrivalMinutes} disabled={dis} onChange={(n) => set(['engine', 'reservation', 'lateArrivalMinutes'], n)} />
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Overstay penalty</CardTitle><CardDescription>overstay - grace, rounded up to blocks, x rate per hour.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
            <Num label="Grace (min)" value={d.penalty.graceMinutes} disabled={dis} onChange={(n) => set(['penalty', 'graceMinutes'], n)} />
            <Num label="Rate per hour" value={d.penalty.ratePerHour} disabled={dis} onChange={(n) => set(['penalty', 'ratePerHour'], n)} />
            <Num label="Rounding block (min, 0 = none)" value={d.penalty.roundingMinutes} disabled={dis} onChange={(n) => set(['penalty', 'roundingMinutes'], n)} />
            <div><Label htmlFor="cu">Currency label</Label><Input id="cu" disabled={dis} value={d.penalty.currency} onChange={(ev) => set(['penalty', 'currency'], ev.target.value)} /></div>
          </CardContent></Card>
          <Button onClick={save} disabled={dis || !sumOk} className="w-full">Save configuration</Button>
        </div>
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Parking layout (admin)</CardTitle><CardDescription>Areas and slot counts live in the database; add more here.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Table><THead><TR><TH>Area</TH><TH>Prefix</TH><TH>Name</TH><TH>Slots</TH><TH>Available</TH></TR></THead><tbody>{areas?.map((a) => <TR key={a._id}><TD>{a.code}</TD><TD className="font-mono">{a.prefix}</TD><TD>{a.name}</TD><TD>{a.slotCount}</TD><TD>{a.availableCount}</TD></TR>)}</tbody></Table>
          {!dis && (
            <div className="grid gap-4 lg:grid-cols-2">
              <form className="space-y-2 rounded-lg border p-3" onSubmit={(ev) => { ev.preventDefault(); createArea(); }}>
                <b className="text-sm">New area</b>
                <div className="grid grid-cols-3 gap-2"><Input aria-label="Area code" placeholder="Area 4" value={area.code} onChange={(ev) => setArea({ ...area, code: ev.target.value })} required /><Input aria-label="Slot prefix" placeholder="P1" value={area.prefix} onChange={(ev) => setArea({ ...area, prefix: ev.target.value })} required /><Input aria-label="Area name" placeholder="Name" value={area.name} onChange={(ev) => setArea({ ...area, name: ev.target.value })} required /></div>
                <div className="grid grid-cols-5 gap-2">{SLOT_TYPES.map((t) => <div key={t}><Label htmlFor={`n-${t}`} className="text-xs">{t}</Label><Input id={`n-${t}`} type="number" min={0} value={area.counts[t]} onChange={(ev) => setArea({ ...area, counts: { ...area.counts, [t]: Number(ev.target.value) } })} /></div>)}</div>
                <Button type="submit" size="sm">Create area</Button>
              </form>
              <form className="space-y-2 rounded-lg border p-3" onSubmit={(ev) => { ev.preventDefault(); addSlots(); }}>
                <b className="text-sm">Add slots to an area</b>
                <div className="grid grid-cols-3 gap-2"><Select aria-label="Area" value={add.areaId} onChange={(ev) => setAdd({ ...add, areaId: ev.target.value })} required><option value="">Area</option>{areas?.map((a) => <option key={a._id} value={a._id}>{a.code}</option>)}</Select>
                  <Select aria-label="Slot type" value={add.slotType} onChange={(ev) => setAdd({ ...add, slotType: ev.target.value })}>{SLOT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
                  <Input aria-label="Count" type="number" min={1} value={add.count} onChange={(ev) => setAdd({ ...add, count: ev.target.value })} /></div>
                <Button type="submit" size="sm">Add slots</Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
      {isAdmin && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Audit trail</CardTitle><CardDescription>Latest 50 administrative and operator actions.</CardDescription></CardHeader>
          <CardContent>{!audit ? <Loading /> : <Table><THead><TR><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Entity</TH></TR></THead><tbody>{audit.map((a) => <TR key={a._id}><TD>{fmtDate(a.createdAt)}</TD><TD>{a.actor}</TD><TD className="font-mono text-xs">{a.action}</TD><TD className="text-xs">{a.entityType} {a.entityId}</TD></TR>)}</tbody></Table>}</CardContent>
        </Card>
      )}
    </>
  );
}
