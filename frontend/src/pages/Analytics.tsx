import { Play, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Empty, ErrorBox, Loading, NeedLogin, PageHeader } from '../components/common';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { Table, TD, TH, THead, TR } from '../components/ui/table';
import { errMsg, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtNum, fmtPct } from '../lib/format';
import { useLive } from '../lib/useLive';

const COLORS = { fcfs: '#64748b', dynamic: '#4f46e5' };
const TIMELINE = [['waiting', 'Vehicles waiting'], ['utilizationPercent', 'Utilization (%)'], ['served', 'Cumulative vehicles served'], ['avgWaitSoFar', 'Average wait of served so far (min)']] as const;

function BarCard({ title, unit, rows }: { title: string; unit: string; rows: { name: string; FCFS: number | null; Dynamic: number | null }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent><div role="img" aria-label={`${title}: FCFS versus dynamic scheduler`} className="h-64">
        <ResponsiveContainer><BarChart data={rows} margin={{ left: 8, right: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis label={{ value: unit, angle: -90, position: 'insideLeft', fontSize: 11 }} tick={{ fontSize: 11 }} />
          <Tooltip /><Legend /><Bar dataKey="FCFS" fill={COLORS.fcfs} /><Bar dataKey="Dynamic" fill={COLORS.dynamic} />
        </BarChart></ResponsiveContainer></div></CardContent>
    </Card>
  );
}

export default function Analytics() {
  const { canOperate } = useAuth();
  const { data: scenarios } = useLive<any[]>('/analytics/scenarios');
  const [scenarioFilter, setScenarioFilter] = useState('');
  const [range, setRange] = useState('all');
  const { data: runs, error, loading, reload } = useLive<any[]>('/analytics/results', scenarioFilter ? { scenarioId: scenarioFilter } : undefined);
  const { data: live } = useLive<any>('/analytics/live');
  const [sel, setSel] = useState('');
  const [tl, setTl] = useState<string>('waiting');
  const [form, setForm] = useState({ scenario: 'high_demand', seed: 42, arrivalCount: '' });
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 3600_000;
    return (runs ?? []).filter((r) => new Date(r.executedAt).getTime() >= cutoff);
  }, [runs, range]);
  const run = filtered.find((r) => r.runId === sel) ?? filtered[0];

  const runNow = async () => {
    setBusy(true);
    try {
      const overrides: any = { seed: Number(form.seed) };
      if (form.arrivalCount) overrides.arrivalCount = Number(form.arrivalCount);
      const { data } = await post('/analytics/run', { scenario: form.scenario, overrides });
      setSel(data.runId); toast.success('Comparison complete'); reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const m = (k: string) => run?.metrics.find((x: any) => x.key === k);
  const pair = (name: string, k: string) => ({ name, FCFS: m(k)?.fcfs ?? null, Dynamic: m(k)?.dynamic ?? null });
  const timeline = run ? run.fcfs.timeline.map((p: any, i: number) => {
    const d = run.dynamic.timeline[i] ?? {};
    return { minute: p.minute, FCFS: tl === 'avgWaitSoFar' ? p.avgWaitServed : p[tl], Dynamic: tl === 'avgWaitSoFar' ? d.avgWaitServed : d[tl] };
  }) : [];
  const history = [...filtered].reverse().map((r, i) => ({ name: `#${i + 1}`, FCFS: r.fcfs.raw.avgWaitingMinutes, Dynamic: r.dynamic.raw.avgWaitingMinutes, label: `${r.scenarioName} (${fmtDate(r.executedAt)})` }));

  return (
    <>
      <PageHeader title="Analytics & FCFS Comparison" subtitle="Both algorithms are run on identical copies of the same seeded scenario; every number is measured." />
      <Card className="mb-4">
        <CardHeader><CardTitle>Run a controlled comparison</CardTitle><CardDescription>This is an evaluation action, not part of normal parking. Results are simulated minutes produced by the real scheduling engine and stored in MongoDB. The current scheduler configuration is used.</CardDescription></CardHeader>
        <CardContent>
          {!canOperate ? <NeedLogin /> : (
            <div className="flex flex-wrap items-end gap-3">
              <div><Label htmlFor="sc">Scenario</Label><Select id="sc" value={form.scenario} onChange={(e) => setForm({ ...form, scenario: e.target.value })} className="w-60">{scenarios?.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select></div>
              <div><Label htmlFor="sd">Seed</Label><Input id="sd" type="number" min={0} value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) })} className="w-28" /></div>
              <div><Label htmlFor="ac">Arrivals (optional)</Label><Input id="ac" type="number" min={1} max={400} value={form.arrivalCount} onChange={(e) => setForm({ ...form, arrivalCount: e.target.value })} className="w-32" placeholder="preset" /></div>
              <Button onClick={runNow} disabled={busy}><Play className="h-4 w-4" />Run FCFS vs Dynamic Comparison</Button>
            </div>
          )}
          {scenarios && <p className="mt-2 text-xs text-slate-500">{scenarios.find((s) => s.key === form.scenario)?.description}</p>}
        </CardContent>
      </Card>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Scenario filter" value={scenarioFilter} onChange={(e) => setScenarioFilter(e.target.value)} className="w-56"><option value="">All scenarios</option>{scenarios?.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select>
        <Select aria-label="Time range" value={range} onChange={(e) => setRange(e.target.value)} className="w-40"><option value="all">All time</option><option value="1">Last hour</option><option value="24">Last 24 hours</option><option value="168">Last 7 days</option></Select>
        <Select aria-label="Run" value={run?.runId ?? ''} onChange={(e) => setSel(e.target.value)} className="w-80">{filtered.map((r) => <option key={r.runId} value={r.runId}>{r.runId} - {r.scenarioName} - {fmtDate(r.executedAt)}</option>)}</Select>
      </div>

      {loading ? <Loading /> : error ? <ErrorBox message={error} /> : !run ? <Card><Empty>Run a comparison scenario to view results.</Empty></Card> : !run.sufficient ? <Card><Empty>Not enough measurements: one algorithm served no vehicles in this run, so no comparison is shown.</Empty></Card> : (
        <>
          <p className="mb-2 text-sm text-slate-600"><b>{run.scenarioName}</b> - {run.arrivals} arrivals over {run.observationMinutes} simulated minutes, {run.fcfs.raw.usableSlots} usable slots. Input fingerprint <code>{run.arrivalsDigest}</code> is identical for both algorithms; seed {run.spec.seed}.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <BarCard title="Waiting and emergency allocation times" unit="minutes" rows={[pair('Avg wait', 'avgWaitingMinutes'), pair('Emergency alloc.', 'emergencyAllocationMinutes'), pair('95th pct wait', 'p95WaitingMinutes'), pair('Max wait', 'maxWaitingMinutes')]} />
            <BarCard title="Slot utilization" unit="percent" rows={[pair('Utilization', 'utilizationPercent')]} />
            <BarCard title="Throughput" unit="vehicles / hour" rows={[pair('Throughput', 'throughputPerHour')]} />
            <BarCard title="Fairness and starvation" unit="requests" rows={[pair('Over wait threshold', 'exceedingThresholdCount'), pair('Starved', 'starvedCount')]} />
            <BarCard title="Waiting-time distribution" unit="requests" rows={run.fcfs.raw.waitDistribution.map((b: any, i: number) => ({ name: b.label, FCFS: b.count, Dynamic: run.dynamic.raw.waitDistribution[i].count }))} />
            <BarCard title="Slot fit and accessible-slot misuse" unit="slot-minutes / fit x100" rows={[{ name: 'Accessible misuse (slot-min)', FCFS: m('accessibleMisuseSlotMinutes')?.fcfs, Dynamic: m('accessibleMisuseSlotMinutes')?.dynamic }, { name: 'Avg slot fit x100', FCFS: (m('avgSlotFit')?.fcfs ?? 0) * 100, Dynamic: (m('avgSlotFit')?.dynamic ?? 0) * 100 }]} />
          </div>
          <Card className="mt-4">
            <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Performance over the simulated period</CardTitle>
              <Select aria-label="Timeline metric" value={tl} onChange={(e) => setTl(e.target.value)} className="w-72">{TIMELINE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></div></CardHeader>
            <CardContent><div role="img" aria-label="Line chart of the selected metric over simulated time" className="h-72"><ResponsiveContainer><LineChart data={timeline} margin={{ left: 8, right: 16, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="minute" label={{ value: 'Simulated minutes', position: 'insideBottom', offset: -8, fontSize: 11 }} tick={{ fontSize: 11 }} />
              <YAxis label={{ value: TIMELINE.find(([k]) => k === tl)![1], angle: -90, position: 'insideLeft', fontSize: 11 }} tick={{ fontSize: 11 }} /><Tooltip /><Legend />
              <Line type="monotone" dataKey="FCFS" stroke={COLORS.fcfs} dot={false} strokeWidth={2} connectNulls /><Line type="monotone" dataKey="Dynamic" stroke={COLORS.dynamic} dot={false} strokeWidth={2} connectNulls />
            </LineChart></ResponsiveContainer></div></CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader><CardTitle>Metrics, definitions and improvement</CardTitle><CardDescription>Improvement is computed only from the measured values: lower-is-better = (FCFS - Dynamic) / FCFS x 100; higher-is-better = (Dynamic - FCFS) / FCFS x 100. Positive means the dynamic scheduler did better, negative means worse. Undefined results (zero or missing denominators) are shown as n/a.</CardDescription></CardHeader>
            <CardContent>
              <Table><THead><TR><TH>Metric</TH><TH>Better</TH><TH>FCFS</TH><TH>Dynamic</TH><TH>Improvement</TH><TH>What it measures</TH></TR></THead>
                <tbody>{run.metrics.map((x: any) => (
                  <TR key={x.key}><TD className="font-medium">{x.label}</TD><TD>{x.direction === 'lower' ? 'Lower' : 'Higher'}</TD><TD>{fmtNum(x.fcfs, x.unit)}</TD><TD>{fmtNum(x.dynamic, x.unit)}</TD>
                    <TD>{x.improvementPercent === null ? <span title={x.note ?? ''}>n/a</span> : <Badge tone={x.improvementPercent > 0 ? 'green' : x.improvementPercent < 0 ? 'red' : 'slate'}>{x.improvementPercent > 0 ? <TrendingUp className="h-3 w-3" aria-hidden /> : x.improvementPercent < 0 ? <TrendingDown className="h-3 w-3" aria-hidden /> : null}{fmtPct(x.improvementPercent)}{x.improvementPercent > 0 ? ' better' : x.improvementPercent < 0 ? ' worse' : ''}</Badge>}{!x.deterministic && <div className="text-xs text-slate-500">varies per run</div>}</TD>
                    <TD className="max-w-md text-xs text-slate-600">{x.description}</TD></TR>))}</tbody></Table>
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader><CardTitle>Average waiting time across recorded runs</CardTitle><CardDescription>One point per stored run in the current filter (oldest to newest).</CardDescription></CardHeader>
            <CardContent>{history.length < 2 ? <Empty>Run at least two comparisons to see a history.</Empty> : <div role="img" aria-label="Average waiting time per run" className="h-64"><ResponsiveContainer><LineChart data={history} margin={{ left: 8, right: 16, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" label={{ value: 'Run (oldest to newest)', position: 'insideBottom', offset: -8, fontSize: 11 }} /><YAxis label={{ value: 'minutes', angle: -90, position: 'insideLeft', fontSize: 11 }} /><Tooltip labelFormatter={(_l, p) => p?.[0]?.payload?.label ?? ''} /><Legend />
              <Line dataKey="FCFS" stroke={COLORS.fcfs} strokeWidth={2} connectNulls /><Line dataKey="Dynamic" stroke={COLORS.dynamic} strokeWidth={2} connectNulls /></LineChart></ResponsiveContainer></div>}</CardContent>
          </Card>
        </>
      )}
      <Card className="mt-4">
        <CardHeader><CardTitle>Recorded live-system data</CardTitle><CardDescription>Measured from real allocations made by the running application, grouped by the algorithm that made them. The live system uses one algorithm at a time, so use the controlled comparison above for head-to-head results.</CardDescription></CardHeader>
        <CardContent>{!live ? <Loading /> : (
          <Table><THead><TR><TH>Algorithm</TH><TH>Allocations</TH><TH>Avg wait</TH><TH>Max wait</TH><TH>Emergency allocations</TH><TH>Avg emergency allocation</TH><TH>Avg decision time</TH></TR></THead>
            <tbody>{['dynamic', 'fcfs'].map((a) => <TR key={a}><TD className="font-medium">{a === 'dynamic' ? 'Dynamic priority' : 'FCFS'}</TD><TD>{live[a].allocations}</TD><TD>{fmtNum(live[a].avgWaitingMinutes, 'min')}</TD><TD>{fmtNum(live[a].maxWaitingMinutes, 'min')}</TD><TD>{live[a].emergencyAllocations}</TD><TD>{fmtNum(live[a].avgEmergencyAllocationMinutes, 'min')}</TD><TD>{fmtNum(live[a].avgDecisionTimeMs, 'ms', 4)}</TD></TR>)}</tbody></Table>
        )}</CardContent>
      </Card>
    </>
  );
}
