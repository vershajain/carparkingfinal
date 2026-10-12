# OS-Inspired Smart Parking Resource Scheduler

A full-stack web application that treats **parking as an operating-system scheduling problem**. Drivers submit
real parking requests; the backend scores them with a documented multi-factor priority formula, allocates a
suitable slot automatically, persists everything in MongoDB, and pushes updates to the browser over Socket.IO.
A separate controlled-evaluation facility compares the proposed scheduler against a real FCFS baseline using
measured results only. There is no Play button and no hardcoded data: the layout is seed/initial-setup data in the
database, and every figure on screen is computed from stored state.

## OS concept mapping

| Parking concept | Operating-system concept | Where to see it |
|---|---|---|
| Vehicle | Process | Requests, Queue |
| Parking slot | Resource | Parking Layout |
| Waiting vehicles | Ready queue | Scheduling Queue |
| Dynamic priority queue | Scheduler | Queue, Decisions |
| Parking allocation | Resource allocation | Decisions |
| Parking duration | Resource holding time | Sessions, factor **T** |
| Waiting-time aging | Starvation prevention | factors **W**, **F**, starving tier |
| Vehicle departure | Resource release | Sessions (exit triggers rescheduling) |
| FCFS | Baseline algorithm | Analytics |
| Multi-factor dynamic priority | Proposed algorithm | Queue, Decisions, Analytics |

The Overview page shows this table with live values.

## Technology stack

Frontend: React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui-style components (hand-written in
`frontend/src/components/ui`, built on Radix + class-variance-authority; the shadcn CLI was not used), Lucide icons,
Recharts, React Router, Axios, Socket.IO client, Sonner toasts.
Backend: Node.js + Express + TypeScript, Socket.IO, Zod, Mongoose, JWT auth (bcryptjs), Helmet, express-rate-limit.
Database: MongoDB. Tests: Vitest (+ jsdom/Testing Library for the UI). Quality: ESLint, Prettier.

## Project layout

```
backend/src/
  scheduler/   PURE engine (no DB): eligibility, factors, suitability, dynamic + FCFS, reservation rules
  analytics/   PURE simulator, seeded scenarios, metric definitions, improvement formulas
  services/    allocation (atomic), requests, sessions, reservations(+sync), slots, config, analytics, dashboard
  models/      Mongoose schemas   controllers/ routes/ middleware/ validators/ utils/ config/ scripts/seed.ts
  tests: backend/tests/unit (no DB)   backend/tests/integration (needs MongoDB)
frontend/src/  pages/ (9 pages)  components/  lib/ (api, socket, useLive, auth)   frontend/tests/
```

## Prerequisites

Node.js 20+, npm, and a MongoDB 6/7 server (local install, or `docker run -d -p 27017:27017 mongo:7`).

## Setup

```bash
# 1. install (from the project root)
npm run install:all

# 2. configure the backend
cp backend/.env.example backend/.env      # then edit: set JWT_SECRET (>=16 chars) and SEED_ADMIN_PASSWORD

# 3. create the initial layout, default scheduler configuration and the admin user
npm run seed                               # safe: only creates what is missing
#   npm --prefix backend run seed -- --reset --yes   # wipes THIS database first (both flags required)

# 4. run (two terminals)
npm run dev:backend                        # http://localhost:4000  (API + Socket.IO)
npm run dev:frontend                       # http://localhost:5173  (proxies /api and /socket.io)
```

Open http://localhost:5173. Use **Staff login** (admin / the password from `.env`) to verify priority, manage slots,
sessions and reservations, run comparisons and edit configuration. Anyone can submit parking requests and view data.

### Environment variables (`backend/.env.example`)

`PORT`, `NODE_ENV`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN`, `SEED_ADMIN_USERNAME`,
`SEED_ADMIN_PASSWORD`, `TEST_MONGODB_URI`. Optional: `FRONTEND_DIST`. Frontend: `VITE_API_URL` (only if hosted separately).

### Production build

```bash
npm run build                              # compiles backend/dist and frontend/dist
NODE_ENV=production npm start              # backend serves the React app, API and WebSocket on one port
```

## Tests

```bash
npm test                                   # backend unit tests + frontend unit tests (no database)
npm run test:integration                   # needs MongoDB; uses TEST_MONGODB_URI (db name must end in _test - it is WIPED)
# UI end-to-end (jsdom against a running, seeded backend whose CLIENT_ORIGIN=http://localhost:3000):
E2E_API=http://localhost:4000 npm --prefix frontend test
npm run lint
```

Coverage: priority formula, weight/normalisation validation, emergency rules, reservation validity/hold/expiry,
vehicle-slot compatibility, queue ordering and tie-breaks, aging/starvation, FCFS ordering, double-allocation
prevention under 10 concurrent requests, release on exit, extension/overstay penalty, analytics formulas (with
hand-computed expectations), zero-denominator and empty-data cases, equivalent-scenario comparison, reproducibility.

## Security model (academic scope)

JWT login with two roles. **Operator**: verify priority/accessibility, mark slots unavailable, exit/extend sessions,
create/cancel reservations, cancel requests, run comparisons. **Admin**: everything above plus configuration, layout,
user creation and the audit log. Read-only endpoints and request submission are public. Urgency is **never**
accepted from the request form: it comes from the vehicle record an operator verified (recorded in the audit log).
Requests are validated with Zod; rate limits apply; secrets live in environment variables. This is **not**
production-grade security (see limitations).

## Scheduling

### Decision procedure (`backend/src/scheduler`)

1. **Hard eligibility** (never overridden by a score): slot not occupied/unavailable; vehicle type accepted by the slot;
   accessible-slot need satisfied; reservation hold rules (below).
2. **Vehicle selection** - queue order is: *tier* (0 verified emergency, 1 starving = waited >= threshold, 2 regular)
   -> higher **PriorityScore** -> earlier arrival -> request ID (natural order). Identical inputs give identical
   decisions. A request with no eligible slot is skipped (no head-of-line blocking).
3. **Slot selection** - highest **slot suitability** (type fit 0.40, area match 0.25, own-reservation 0.15 when
   applicable, not wasting accessible slots 0.20), ties by natural slot-code order. A valid slot-specific
   reservation is a hard assignment to that slot.
4. **Atomic persist** and publish (below). If no slot is suitable nothing is forced.

### Priority formula

`PriorityScore = 100 x (wW*W + wU*U + wD*D + wT*T + wR*R + wS*S + wF*F)`, all factors in [0,1], weights >= 0, sum = 1.

| Factor | Definition |
|---|---|
| W waiting | `min(waitMinutes / waitingTimeCap, 1)` |
| U urgency | configured score for the **verified** category (normal 0.2, priority 0.6, emergency 1.0) |
| D demand | `waitingRequests / max(eligibleSlotsForThisRequest,1)` mapped through configured thresholds/scores |
| T duration | `1 - min(duration/reference,1)` (policy *shorter*, default: short stays free slots sooner, like shortest-job-first; *longer* is selectable) |
| R reservation | 1 only for a reservation that is active, owned by the vehicle, and inside its claim window; else 0 |
| S suitability | best suitability among the request's eligible slots |
| F fairness/aging | `min(max(wait - graceMinutes, 0) / rampMinutes, 1)` - the grace period avoids double-counting W early on |

Default weights (waiting .25, urgency .25, demand .05, duration .10, reservation .10, suitability .10, fairness .15)
are **proposed starting values, not experimentally proven or tuned**. Edit them on the Configuration page.

### Reserved-capacity policy

A slot reservation **holds** its slot from `start - earlyArrival` (default 15 min) until claimed, cancelled, or the
no-show deadline `start + lateArrival` (default 30 min) / end time passes. Before the hold opens, any vehicle whose
stay ends before it may use the slot; a verified emergency may use it as a last resort if the policy flag allows; during
the hold only the holder may. Extensions that would run into the next hold are rejected. Area reservations give the
valid-reservation benefit and an area preference but do not hold a specific slot.

### Allocation safety

Allocation uses atomic conditional updates (claim the slot only if still in the expected status, claim the request only
if still `waiting`, create the session guarded by a unique sparse index, roll back on any failure). Runs are serialised
in-process. Transactions are **not** used, so it works on a standalone MongoDB. Every allocation stores the score,
factor values, weighted contributions, slot score, explanations, alternatives, what FCFS would have chosen, a
configuration snapshot and the decision time.

### Parking sessions

Allocation creates a session (entry, expected departure). Supported: exit, early departure, `+N` min extension, setting
the expected departure, live overstay detection, history. Penalty = `max(0, overstay - grace)` rounded **up** to
`roundingMinutes` blocks x `ratePerHour/60`; every parameter is configurable and the calculation is shown in the UI.

## Analytics methodology (`backend/src/analytics`)

`POST /api/analytics/run` runs a **seeded discrete-event simulation** twice with the **real** scheduling engine
(`decideDynamic`, `decideFcfs`): each algorithm gets its own copy of the same initial slots and the same arrival list
(an FNV fingerprint of the arrivals is stored to prove it). Results are measured, stored as `PerformanceResult`, and
re-runs with the same seed reproduce identical measurements (except machine-dependent decision time).

| Metric | Definition |
|---|---|
| Average waiting time | sum of waits of served vehicles / served (served = allocated within the period) |
| Emergency allocation time | allocation time - request time, averaged over served verified emergencies |
| Utilization | occupied slot-time / usable slot-time x 100 (unavailable slots excluded) |
| Unnecessary idle time | free usable slot-time while a waiting request was eligible for it |
| Throughput | served / observation period (per hour) |
| Fairness | max wait, p50/p90/p95, distribution, requests over the starvation threshold, starved (unserved and over threshold) |
| Decision time | wall-clock of one decision: ordering + vehicle + slot choice, no database access; varies per machine |
| Slot fit, accessible-slot misuse | mean slot suitability of allocations; accessible-slot time used by vehicles that do not need it |

Improvement % = `(FCFS - Dynamic)/FCFS x 100` (lower is better) or `(Dynamic - FCFS)/FCFS x 100` (higher is better);
zero or missing denominators yield `n/a`, never a made-up number. With no runs the page shows
"Run a comparison scenario to view results." `GET /api/analytics/live` summarises recorded real allocations.

**Example measured output** (default weights, seed 42; reproduce with the Analytics page; numbers change if you change weights):
`high_demand` - emergency allocation 234.1 -> 6.4 min, average wait 122.0 -> 95.5 min, throughput 7.13 -> 8.38 veh/h,
utilization 96.2% vs 96.2% (equal), **max wait 293.6 -> 421.1 min (worse)**. `low_demand` - average wait 0.60 -> 0.72 min
(slightly worse). The proposed scheduler clearly helps verified emergencies and slot fit; it does **not** improve
utilization and, with default weights, it worsens maximum waiting time because it favours short stays. These are real
measurements from the harness, reported as they came out.

## API summary (all under `/api`, JSON `{success, message, data}`)

Public: `GET health, dashboard, queue, config, areas, slots(/:id), allocations(/:id), sessions, requests(/:id), reservations,
scheduler/status, analytics/{scenarios,results,results/:runId,live}`; `POST requests` (rate-limited), `POST auth/login`.
Operator: `PUT vehicles/:registration`, `GET vehicles`, `PATCH slots/:id/status`, `POST requests/:id/cancel`,
`POST sessions/:id/{exit,extend}`, `PATCH sessions/:id/expected-departure`, `POST reservations`,
`POST reservations/:id/cancel`, `POST scheduler/run`, `POST analytics/run`.
Admin: `PATCH config`, `GET audit`, `POST areas`, `PATCH areas/:id`, `POST areas/:id/slots`, `POST auth/users`.
Socket.IO events: `request:created, queue:updated, slot:allocated, slot:updated, session:{entered,exited,extended},
reservation:changed, config:updated, analytics:updated, state:changed`. The UI refetches on events and polls if the socket drops.

## Collections

ParkingArea, ParkingSlot, Vehicle, ParkingRequest, Reservation, ParkingSession, AllocationRecord,
SchedulerConfiguration, PerformanceResult, plus **User**, **AuditLog**, **Counter** (readable IDs: REQ-, RSV-, SES-, RUN-).
Uniqueness guards: slot code, registration, request ID, one waiting request per vehicle and one active session per slot
(unique sparse indexes on fields that exist only while active).

## Known limitations (please read)

- **Database coverage:** the automated integration/e2e runs in development were executed against FerretDB (a
  MongoDB-compatible server on SQLite), not a real MongoDB, because real MongoDB could not be installed there. Run
  `npm run test:integration` against your MongoDB before relying on the concurrency guarantees.
- **UI verification:** the interface was verified by type-checking, a production build and a jsdom end-to-end test that
  drives all nine pages against a live backend. It was not inspected in a real browser or on real devices; layout polish,
  keyboard order and colour contrast should be reviewed manually. The JS bundle is not code-split (~825 kB).
- **Simulation scope:** simulated minutes, no reservations modelled, and both schedulers are work-conserving, so
  "unnecessary idle time" is 0 by construction (a non-zero value would signal a defect). Results depend on the scenario
  generator and untuned weights; they are evidence for these scenarios, not general proof.
- **Fairness trade-off:** with default weights the dynamic scheduler has a longer maximum wait than FCFS in every preset;
  the starving tier limits but does not eliminate this. Emergency vehicles can still starve ordinary ones under constant
  emergency load.
- **Reservations:** an emergency using a slot under the last-resort rule can displace the holder (no automatic
  relocation); area reservations hold no capacity.
- **Security:** academic-grade. Public read endpoints, unauthenticated Socket.IO, no refresh tokens or password reset,
  tokens kept in localStorage, in-process rate limits. Change the seeded admin password.
- **Scale:** one backend process is assumed for the scheduler mutex (database guards remain as the second line of defence);
  a 30-second tick re-evaluates the queue; slot and request lists are capped at 500 rows per call.
- Overstay "currency" is only a label; no financial reporting is implemented by design.
