import { useState } from 'react';
import { FactorTable } from '../components/FactorTable';
import { Empty, ErrorBox, Loading, PageHeader } from '../components/common';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TD, TH, THead, TR } from '../components/ui/table';
import { fmtDate } from '../lib/format';
import { cn } from '../lib/utils';
import { useLive } from '../lib/useLive';

export default function Decisions() {
  const { data: list, error, loading } = useLive<any[]>('/allocations');
  const [sel, setSel] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !list) return <ErrorBox message={error ?? 'No data'} />;
  const a = list.find((x) => x._id === sel) ?? list[0];
  return (
    <>
      <PageHeader title="Allocation Decisions" subtitle="Every allocation is explained from the data the scheduling engine recorded when it decided." />
      {list.length === 0 ? <Card><Empty>No allocations yet. Submit a parking request to see a decision explained here.</Empty></Card> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="max-h-[75vh] overflow-y-auto lg:col-span-1">
            <CardHeader><CardTitle>Allocations</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {list.map((x) => (
                <button key={x._id} onClick={() => setSel(x._id)} className={cn('w-full rounded-md border p-2 text-left text-sm hover:bg-slate-50', a._id === x._id && 'border-indigo-500 bg-indigo-50')}>
                  <div className="flex justify-between"><span className="font-mono font-semibold">{x.registration}</span><Badge tone={x.algorithm === 'dynamic' ? 'indigo' : 'slate'}>{x.algorithm}</Badge></div>
                  <div className="text-xs text-slate-600">{x.requestId} to {x.slotCode}</div><div className="text-xs text-slate-500">{fmtDate(x.allocatedAt)}</div>
                </button>
              ))}
            </CardContent>
          </Card>
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader><CardTitle>{a.registration} to slot {a.slotCode}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-slate-500">{a.requestId} - allocated {fmtDate(a.allocatedAt)} by <b>{a.algorithm === 'dynamic' ? 'dynamic multi-factor priority' : 'FCFS'}</b> - decision took {a.decisionTimeMs !== null ? `${a.decisionTimeMs.toFixed(3)} ms` : 'n/a'} (ordering + vehicle + slot choice, no database time)</p>
                <div><b>Why this vehicle:</b> {a.vehicleReason}</div>
                <div><b>Why this slot:</b> {a.slotReason}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border p-3"><div className="text-xs uppercase text-slate-500">Vehicle priority score</div><div className="text-2xl font-semibold">{a.priorityScore !== null ? a.priorityScore.toFixed(2) : 'n/a'}</div><div className="text-xs text-slate-500">{a.priorityScore !== null ? 'out of 100' : 'FCFS does not score vehicles'}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs uppercase text-slate-500">Slot suitability score</div><div className="text-2xl font-semibold">{a.slotScore?.toFixed(3)}</div><div className="text-xs text-slate-500">out of 1 (separate from priority)</div></div>
                </div>
              </CardContent>
            </Card>
            {a.factors && <Card><CardHeader><CardTitle>Priority score breakdown</CardTitle></CardHeader><CardContent><FactorTable factors={a.factors} weights={a.configSnapshot.weights} contributions={a.contributions} total={a.priorityScore} /></CardContent></Card>}
            <Card>
              <CardHeader><CardTitle>Slot selection</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><b>Selected {a.slotCode}:</b> {Object.entries(a.stateSnapshot?.slotComponents ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}</div>
                {a.alternativeSlots?.length > 0 ? (<>
                  <b>Alternative eligible slots</b>
                  <Table><THead><TR><TH>Slot</TH><TH>Suitability</TH><TH>Notes</TH></TR></THead><tbody>{a.alternativeSlots.map((s: any) => <TR key={s.code}><TD className="font-mono">{s.code}</TD><TD>{s.slotScore}</TD><TD className="text-xs">{s.notes.slice(1).join('; ')}</TD></TR>)}</tbody></Table>
                </>) : <p className="text-slate-500">No alternative eligible slots were recorded.</p>}
              </CardContent>
            </Card>
            {a.fcfsComparison && (
              <Card><CardHeader><CardTitle>Compared with FCFS (same state)</CardTitle></CardHeader>
                <CardContent className="text-sm"><Badge tone={a.fcfsComparison.differs ? 'amber' : 'green'}>{a.fcfsComparison.differs ? 'Different decision' : 'Same decision'}</Badge><p className="mt-2">{a.fcfsComparison.explanation}</p></CardContent></Card>
            )}
            {a.stateSnapshot?.ranking?.length > 0 && (
              <Card><CardHeader><CardTitle>Queue at decision time (top {a.stateSnapshot.ranking.length} of {a.stateSnapshot.queueLength})</CardTitle></CardHeader>
                <CardContent><Table><THead><TR><TH>Pos</TH><TH>Request</TH><TH>Tier</TH><TH>Score</TH><TH>Had eligible slot</TH></TR></THead>
                  <tbody>{a.stateSnapshot.ranking.map((r: any) => <TR key={r.requestId} className={r.requestId === a.requestId ? 'bg-indigo-50' : ''}><TD>{r.position}</TD><TD className="font-mono">{r.requestId}</TD><TD>{r.tier}</TD><TD>{r.score.toFixed(2)}</TD><TD>{r.schedulable ? 'yes' : 'no'}</TD></TR>)}</tbody></Table></CardContent></Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
