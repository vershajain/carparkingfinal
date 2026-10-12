// @vitest-environment jsdom
/**
 * Renders the real app in jsdom against a RUNNING backend (set E2E_API=http://localhost:4010) and drives the
 * main flows through the UI. Skipped unless E2E_API is set. The backend must have been seeded (npm run seed)
 * with the default admin, and its CLIENT_ORIGIN must be http://localhost:3000 (the jsdom origin).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Toaster } from 'sonner';
import App from '../src/App';
import { get, post, put } from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';

const run = !!process.env.E2E_API;
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const show = (route: string) => render(<MemoryRouter initialEntries={[route]}><AuthProvider><App /><Toaster /></AuthProvider></MemoryRouter>);
const text = async (t: string | RegExp, timeout = 8000) => screen.findAllByText(t, {}, { timeout });
afterEach(cleanup);

describe.skipIf(!run)('UI against a live backend', () => {
  beforeAll(async () => {
    const { data } = await post('/auth/login', { username: 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'change-me-admin' });
    localStorage.setItem('token', data.token); localStorage.setItem('username', 'admin'); localStorage.setItem('role', 'admin');
    await put('/vehicles/AMBU777', { vehicleType: 'car', priorityCategory: 'emergency' });
    // fill every car-capable slot so later requests must queue
    const slots = await get<any[]>('/slots');
    const carSlots = slots.filter((s) => s.compatibleVehicleTypes.includes('car') && s.status === 'available').length;
    for (let i = 0; i < carSlots; i++) await post('/requests', { registration: `FILL${String(i).padStart(3, '0')}`, vehicleType: 'car', expectedDurationMinutes: 120 });
    await post('/requests', { registration: 'WAIT111', vehicleType: 'car', expectedDurationMinutes: 45 });
    await post('/requests', { registration: 'AMBU777', vehicleType: 'car', expectedDurationMinutes: 30 });
  });

  it('Overview shows live metrics and the OS concept mapping', async () => {
    show('/');
    await text('Total slots'); await text('Operating-system concept mapping');
    await text(/Vehicles = Processes/); await text(/Waiting vehicles = Ready queue/);
    expect(screen.queryByText(/Revenue|Profit|Sales/i)).toBeNull();
  });

  it('Parking Layout renders the database layout with text-labelled statuses and opens slot details', async () => {
    show('/layout');
    await text(/Area 1 - Basement Parking/);
    const tile = (await screen.findAllByRole('button', { name: /Slot B1-S01/ }))[0];
    expect(tile.textContent).toMatch(/Occupied|Available|Reserved|Unavailable/);
    fireEvent.click(tile);
    await text(/Accepts/);
    // occupied slots offer no status change; free ones offer 'Mark unavailable'; out-of-service ones 'Restore'
    await text(/Mark unavailable|Restore to service|cannot be taken out of service/);
  });

  it('Vehicle Requests: submitting the form queues a vehicle and explains the outcome', async () => {
    show('/requests');
    await text('New parking request');
    fireEvent.change(screen.getByLabelText('Registration number'), { target: { value: 'UI-TEST-1' } });
    fireEvent.change(screen.getByLabelText(/Urgency/), { target: { value: 'emergency' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await text(/Waiting in queue|Slot allocated/);
    await text(/not verified; the request is treated as "normal"/); // self-declared emergency is not trusted
    const rows = await screen.findAllByText('UITEST1');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('Scheduling Queue lists waiting vehicles, ranks the verified emergency first and explains the score', async () => {
    show('/queue');
    await text(/Waiting vehicles \(/);
    await text('Who would be scheduled next, and why');
    const body = await screen.findAllByRole('row');
    const order = body.map((r) => r.textContent ?? '').filter((t) => /AMBU777|WAIT111|UITEST1/.test(t));
    expect(order[0]).toMatch(/AMBU777/);
    fireEvent.click(screen.getAllByLabelText('Show score breakdown')[0]);
    await text(/PriorityScore = 100 x sum/);
  });

  it('Allocation Decisions explain a real allocation', async () => {
    show('/decisions');
    await text('Why this vehicle:'); await text('Vehicle priority score'); await text('Slot suitability score');
    await text(/PriorityScore = 100 x sum/);
  });

  it('Reservations and Sessions pages render real records', async () => {
    const slots = await get<any[]>('/slots');
    const free = slots.find((s) => s.status === 'available' && s.compatibleVehicleTypes.includes('suv'));
    if (free) await post('/reservations', { registration: 'RESV999', vehicleType: 'suv', slotId: free._id, startTime: new Date(Date.now() + 3600_000).toISOString(), endTime: new Date(Date.now() + 3 * 3600_000).toISOString() });
    show('/reservations'); await text('All reservations'); if (free) await text(/RSV-0000\d+/);
    cleanup(); show('/sessions'); await text('Parking Sessions'); await text(/SES-0000\d+/);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Exit' }))[0]);
    await text('Vehicle exited; slot released');
  });

  it('Analytics: empty state first, then a UI-triggered comparison fills charts and the metric table', async () => {
    show('/analytics');
    await text('Run a comparison scenario to view results.');
    fireEvent.click(screen.getByRole('button', { name: /Run FCFS vs Dynamic Comparison/ }));
    await text('Metrics, definitions and improvement');
    await text('Emergency allocation time'); await text(/Waiting and emergency allocation times/);
    const table = (await screen.findAllByRole('table')).find((t) => /Improvement/.test(t.textContent ?? ''))!;
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(10);
    expect(screen.queryByText(/30% faster/)).toBeNull();
  });

  it('Configuration shows weights and validates their sum', async () => {
    show('/config');
    await text('Priority-score weights'); await text('Sum = 1.00 (valid)');
    fireEvent.change(screen.getByLabelText('W - Waiting time'), { target: { value: '0.9' } });
    await text(/must equal 1/);
    expect((screen.getByRole('button', { name: 'Save configuration' }) as HTMLButtonElement).disabled).toBe(true);
    await text('Audit trail');
  });
});
