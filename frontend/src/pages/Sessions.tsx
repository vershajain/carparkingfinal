import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { Empty, ErrorBox, Loading, PageHeader } from '../components/common';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Input, Label, Select } from '../components/ui/input';
import { Table, TD, TH, THead, TR } from '../components/ui/table';
import { errMsg, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtMinutes, toLocalInput } from '../lib/format';
import { useLive } from '../lib/useLive';

export default function Sessions() {
  const [status, setStatus] = useState('active');
  const { data: list, error, loading, reload } = useLive<any[]>('/sessions', { status }, { pollMs: 10000 });
  const { canOperate } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [when, setWhen] = useState('');

  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast.success(ok); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const calc = (s: any) => s.projectedPenalty ?? s.penalty;

  return (
    <>
      <PageHeader title="Parking Sessions" subtitle="Entry, extension, exit and overstay penalties - all from recorded timestamps."
        actions={<Select aria-label="Session status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="active">Active</option><option value="completed">Completed (history)</option></Select>} />
      <Card><CardContent className="pt-4">
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : !list?.length ? <Empty>No {status} sessions.</Empty> : (
          <Table>
            <THead><TR><TH /><TH>Session</TH><TH>Vehicle</TH><TH>Slot</TH><TH>Entered</TH><TH>Expected exit</TH><TH>{status === 'active' ? 'State' : 'Actual exit'}</TH><TH>{status === 'active' ? 'Extensions' : 'Duration'}</TH><TH>Penalty</TH>{canOperate && status === 'active' && <TH />}</TR></THead>
            <tbody>
              {list.map((s) => (
                <Fragment key={s._id}>
                  <TR>
                    <TD>{calc(s) && <button aria-label="Show penalty calculation" aria-expanded={open === s._id} onClick={() => setOpen(open === s._id ? null : s._id)}>{open === s._id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>}</TD>
                    <TD className="font-mono">{s.sessionId}</TD><TD className="font-mono">{s.registration}</TD><TD className="font-mono">{s.slotCode}</TD><TD>{fmtDate(s.entryTime)}</TD><TD>{fmtDate(s.expectedDeparture)}</TD>
                    <TD>{status === 'active' ? (s.overstaying ? <Badge tone="red"><AlertTriangle className="h-3 w-3" aria-hidden />Overstaying</Badge> : <Badge tone="green">On time</Badge>) : <>{fmtDate(s.actualExit)}{s.penalty?.earlyDeparture && <div className="text-xs text-slate-500">early by {fmtMinutes(s.penalty.earlyByMinutes)}</div>}</>}</TD>
                    <TD>{status === 'active' ? s.extensions.length : fmtMinutes(s.finalDurationMinutes)}</TD>
                    <TD>{calc(s) ? `${calc(s).amount} ${calc(s).currency}${s.overstaying ? ' (if leaving now)' : ''}` : '-'}</TD>
                    {canOperate && status === 'active' && (
                      <TD><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => act(() => post(`/sessions/${s._id}/extend`, { addedMinutes: 30 }), 'Extended by 30 min')}>+30 min</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEdit(s); setWhen(toLocalInput(new Date(s.expectedDeparture))); }}>Set exit</Button>
                        <Button size="sm" onClick={() => act(() => post(`/sessions/${s._id}/exit`), 'Vehicle exited; slot released')}>Exit</Button></div></TD>)}
                  </TR>
                  {open === s._id && calc(s) && <tr><td colSpan={10} className="bg-slate-50 p-3 text-sm"><b>Penalty calculation:</b> {calc(s).formula}<div className="text-xs text-slate-500">Grace {calc(s).graceMinutes} min, {calc(s).roundingMinutes}-min blocks, {calc(s).ratePerHour} {calc(s).currency}/h (all configurable).</div></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent></Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && (
          <DialogContent title={`Expected departure - ${edit.registration}`} description="Extensions cannot run into the next reservation hold on this slot.">
            <Label htmlFor="dep">New expected departure</Label><Input id="dep" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <Button className="mt-3" onClick={() => act(() => patch(`/sessions/${edit._id}/expected-departure`, { expectedDeparture: new Date(when).toISOString() }), 'Expected departure updated').then(() => setEdit(null))}>Save</Button>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
