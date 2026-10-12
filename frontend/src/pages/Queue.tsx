import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { FactorTable } from '../components/FactorTable';
import { Empty, ErrorBox, Loading, PageHeader, UrgencyBadge } from '../components/common';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TD, TH, THead, TR } from '../components/ui/table';
import { errMsg, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtMinutes } from '../lib/format';
import { useLive } from '../lib/useLive';

export default function Queue() {
  const { data: q, error, loading, reload } = useLive<any>('/queue', undefined, { pollMs: 5000 });
  const { canOperate } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !q) return <ErrorBox message={error ?? 'No data'} />;
  const cancel = async (id: string) => {
    try { await post(`/requests/${id}/cancel`); toast.success('Request cancelled'); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const n = q.nextSelection;
  return (
    <>
      <PageHeader title="Scheduling Queue" subtitle="The ready queue, ordered by the active scheduling policy. Scores are recomputed live."
        actions={<Badge tone="indigo">Active: {q.activeAlgorithm === 'dynamic' ? 'Dynamic priority' : 'FCFS (queue order below is the dynamic ranking for comparison)'}</Badge>} />
      <Card className="mb-4">
        <CardHeader><CardTitle>Who would be scheduled next, and why</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {n ? (<>
            <p><b>{n.requestId}</b> would be placed into slot <b className="font-mono">{n.slotCode}</b> (slot suitability {n.slotScore}).</p>
            <p className="mt-1"><b>Vehicle choice:</b> {n.vehicleReason}</p><p className="mt-1"><b>Slot choice:</b> {n.slotReason}</p>
            {n.fcfs && <p className="mt-1 rounded bg-slate-100 p-2"><b>vs FCFS:</b> {n.fcfs.explanation}</p>}
          </>) : <p className="text-slate-600">Nothing can be scheduled right now (the queue is empty or no waiting vehicle has an eligible free slot).</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Waiting vehicles ({q.rows.length})</CardTitle>
          <CardDescription className="flex items-start gap-1"><Info className="mt-0.5 h-4 w-4 shrink-0" />Order = tier (verified emergency, then starving, then regular) &gt; higher priority score &gt; earlier arrival &gt; request ID, so identical inputs always give identical decisions. <b>Priority score</b> ranks vehicles; the <b>slot suitability score</b> (shown with the decision) ranks slots for the chosen vehicle.</CardDescription></CardHeader>
        <CardContent>
          {q.rows.length === 0 ? <Empty>The queue is empty - every request has been allocated.</Empty> : (
            <Table>
              <THead><TR><TH /><TH>Pos</TH><TH>FCFS pos</TH><TH>Vehicle</TH><TH>Arrived</TH><TH>Waiting</TH><TH>Urgency</TH><TH>Duration</TH><TH>Reservation</TH><TH>Requirements</TH><TH>Priority score</TH><TH>Status</TH>{canOperate && <TH />}</TR></THead>
              <tbody>
                {q.rows.map((r: any) => (
                  <Fragment key={r.requestId}>
                    <TR className={r.position === 1 ? 'bg-indigo-50/50' : ''}>
                      <TD><button aria-label="Show score breakdown" aria-expanded={open === r.requestId} onClick={() => setOpen(open === r.requestId ? null : r.requestId)}>{open === r.requestId ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></TD>
                      <TD className="font-bold">{r.position}</TD><TD>{r.fcfsPosition}</TD>
                      <TD><div className="font-mono">{r.registration}</div><div className="text-xs text-slate-500">{r.requestId} - {r.vehicleType}</div></TD>
                      <TD>{fmtDate(r.arrivalTime)}</TD><TD>{fmtMinutes(r.waitingMinutes)}</TD><TD><UrgencyBadge urgency={r.urgency} /><div className="text-xs text-slate-500">{r.tierName}</div></TD>
                      <TD>{r.expectedDurationMinutes} min</TD>
                      <TD>{r.reservationId ? <Badge tone={r.reservationValid ? 'green' : 'red'}>{r.reservationId}: {r.reservationValid ? 'valid' : 'invalid'}</Badge> : '-'}</TD>
                      <TD className="text-xs">{[r.requiresAccessibleSlot && 'accessible slot', r.preferredAreaCode && `prefers ${r.preferredAreaCode}`, `compatible slots: ${r.eligibleSlotCount}`].filter(Boolean).join(', ')}</TD>
                      <TD className="font-mono font-semibold">{r.priorityScore.toFixed(2)}</TD>
                      <TD><Badge tone={r.eligibleSlotCount ? 'green' : 'amber'}>{r.status}</Badge></TD>
                      {canOperate && <TD><Button size="sm" variant="outline" onClick={() => cancel(r.id)}>Cancel</Button></TD>}
                    </TR>
                    {open === r.requestId && <tr><td colSpan={13} className="bg-slate-50 p-3"><FactorTable factors={r.factors} weights={q.weights} contributions={r.contributions} total={r.priorityScore} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-2 text-xs text-slate-500">Computed {fmtDate(q.computedAt)}. Tie-break rule: {q.tieBreakRule}.</p>
        </CardContent>
      </Card>
    </>
  );
}
