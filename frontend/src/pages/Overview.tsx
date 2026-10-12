import { Activity, Ban, CalendarClock, CarFront, CheckCircle2, CircleParking, Clock, Gauge, ListOrdered, Siren, Timer, Cpu, Flag } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ErrorBox, Loading, PageHeader, StatCard } from '../components/common';
import { Table, TD, TH, THead, TR } from '../components/ui/table';
import { fmtDate, fmtMinutes, fmtNum } from '../lib/format';
import { useLive } from '../lib/useLive';

export default function Overview() {
  const { data: d, error, loading } = useLive<any>('/dashboard');
  const { data: cfg } = useLive<any>('/config');
  if (loading) return <Loading />;
  if (error || !d) return <ErrorBox message={error ?? 'No data'} />;
  const s = d.scheduler;
  const mapping = [
    ['Vehicles = Processes', `${d.parkedVehicles + d.waitingVehicles} active (${d.parkedVehicles} running, ${d.waitingVehicles} ready)`],
    ['Parking slots = Resources', `${d.totalSlots} total, ${d.availableSlots} free`],
    ['Waiting vehicles = Ready queue', `${d.waitingVehicles} waiting (${d.emergencyWaiting} emergency)`],
    ['Dynamic priority queue = Scheduler', `${s.algorithm === 'dynamic' ? 'Multi-factor dynamic priority (active)' : 'FCFS baseline (active)'}`],
    ['Parking allocation = Resource allocation', `${s.totalAllocationsSinceStart} since server start`],
    ['Parking duration = Resource holding time', 'Expected duration is a scheduling factor (T)'],
    ['Waiting-time aging = Starvation prevention', cfg ? `Aging after ${cfg.engine.aging.graceMinutes} min; starving tier after ${cfg.engine.starvationThresholdMinutes} min` : '...'],
    ['Vehicle departure = Resource release', `${d.completedSessions} sessions completed`],
    ['FCFS = Baseline algorithm', 'Compared on the Analytics page'],
  ];
  return (
    <>
      <PageHeader title="Overview" subtitle="Live figures computed from the database; updated automatically." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total slots" value={d.totalSlots} Icon={CircleParking} />
        <StatCard label="Available" value={d.availableSlots} Icon={CheckCircle2} tone="green" />
        <StatCard label="Occupied" value={d.occupiedSlots} Icon={CarFront} tone="red" />
        <StatCard label="Reserved" value={d.reservedSlots} Icon={CalendarClock} tone="amber" />
        <StatCard label="Unavailable" value={d.unavailableSlots} Icon={Ban} tone="gray" />
        <StatCard label="Utilization" value={d.utilizationPercent === null ? 'No usable slots' : `${d.utilizationPercent}%`} hint="Occupied / usable slots" Icon={Gauge} tone="indigo" />
        <StatCard label="Waiting in queue" value={d.waitingVehicles} Icon={ListOrdered} tone="amber" />
        <StatCard label="Emergency waiting" value={d.emergencyWaiting} Icon={Siren} tone={d.emergencyWaiting ? 'red' : 'slate'} />
        <StatCard label="Currently parked" value={d.parkedVehicles} Icon={CarFront} />
        <StatCard label="Completed sessions" value={d.completedSessions} Icon={Flag} />
        <StatCard label="Average waiting time" value={fmtMinutes(d.averageWaitingMinutes)} hint="Allocated requests" Icon={Clock} />
        <StatCard label="Avg emergency allocation" value={fmtMinutes(d.averageEmergencyAllocationMinutes)} hint="Verified emergencies" Icon={Timer} />
        <StatCard label="Scheduler" value={s.algorithm === 'dynamic' ? 'Dynamic priority' : 'FCFS'} hint={s.lastRunAt ? `Last run ${fmtDate(s.lastRunAt)} (${s.lastTrigger})` : 'Not run since start'} Icon={s.running ? Activity : Cpu} tone="indigo" />
      </div>
      <Card className="mt-5">
        <CardHeader><CardTitle>Operating-system concept mapping</CardTitle><CardDescription>Each parking concept and its live value.</CardDescription></CardHeader>
        <CardContent>
          <Table><THead><TR><TH>Concept</TH><TH>Live value</TH></TR></THead>
            <tbody>{mapping.map(([a, b]) => <TR key={a}><TD className="font-medium">{a}</TD><TD>{b}</TD></TR>)}</tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">Utilization = occupied slots / usable slots (unavailable slots excluded; reserved slots count as usable but idle). {fmtNum(null)} means no data yet.</p>
        </CardContent>
      </Card>
    </>
  );
}
