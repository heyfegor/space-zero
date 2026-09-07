# SPACE ZERO — IMPLEMENTATION AUDIT

## 1. Executive Summary

Space Zero has a **complete deterministic domain foundation** (trip state machine, authority engine, booking choke point) and a **working agent integration** (Strands SDK, tool-driven architecture, event streaming). The **landing page is implemented** and **product flow exists as a long single-page component** wired to the real agent.

**Critical gap**: The ten approved design screens do not exist as separate, designed pages. The current product flow (`/app/app/page.tsx`) is a monolithic React component that simulates the screens but does **not implement the design system, component hierarchy, or navigation structure** defined in the design files. The screens exist internally (not built for the real flow), and the design files are reference only.

**Status**: Architecture and domain logic are correct. Frontend implementation is incomplete and does not match the designs.

---

## 2. Architecture Audit

### Current Architecture: Correct Foundational Design

**Flow**:
```
Browser (client) 
  → /api/agent (SSE stream)
    → Agent (Strands SDK)
      → Tools (deterministic domain + store)
        → Domain layer (state, authority, booking)
        → Dev store (in-memory demo)
```

**Strengths**:
1. ✅ **Safety boundary** is correct: `execute_booking` independently enforces authority via `evaluateAuthority()` — the model proposes, deterministic code decides.
2. ✅ **Model isolation**: Agent runs server-side; credentials never reach the browser.
3. ✅ **Event streaming**: Operational events (derived from tool metadata + domain) streamed to browser; no chain-of-thought leakage.
4. ✅ **Staging architecture**: Bookings are STAGED (simulated), with deterministic references for repeatability.
5. ✅ **State machine**: Typed trip status transitions, enforced at the domain layer.

**Verification**:
- `authority.ts`: `evaluateAuthority()` is a pure function, no LLM calls, no network I/O.
- `booking.ts`: `executeStagedBooking()` calls `evaluateAuthority()` INSIDE the tool before any side effect.
- `execute-booking.ts` tool: Re-reads the trip's **stored** allowance (not agent-supplied), enforces authority.
- Tests pass: `authority.test.ts`, `booking.test.ts`, `trip-state.test.ts` all verify the safety invariants.

**Architectural Problems**: None detected. The design is sound.

---

## 3. Screen-by-Screen Audit

### 01 — Landing

**Design Intent**: Marketing entry. Call-to-action to "/app". Recovery board animation. Belief statements, FAQ, hero.

**Current Implementation**: **FULLY IMPLEMENTED** as `/app/page.tsx`
- ✅ Marketing copy
- ✅ Recovery board with animation (JS state machine, Ledger timeline)
- ✅ CTA links to `/app`
- ✅ FAQ with expand/collapse
- ✅ Design system compliance (colors, fonts, spacing)

**What's complete**:
- Animated recovery board plays on scroll
- All copy from design is present
- Responsive design
- Dark/light theme support via CSS variables

**Missing**: Nothing material for this screen.

---

### 02 — Product

**Design Intent**: Home after authentication. "Where are you going?" brief. Trip history sidebar. Account/passkey flow.

**Current Implementation**: **PARTIAL** 
- ✅ Brief textarea exists (but in the product flow, not a dedicated screen)
- ✅ Theme toggle
- ❌ Trips sidebar NOT implemented (stub "Trips" button)
- ❌ Account/passkey flow NOT implemented (design calls for WebAuthn)
- ❌ Not a dedicated page — integrated into the long product flow component

**Route**: No dedicated `/app/product` page. The brief-entry exists in `ProductApp` but is inside the run flow, not positioned as the home screen.

**Problem**: The product flow conflates briefing, planning, execution, and monitoring into one long page with nav buttons. The designed Product screen should be:
- Primary entry point
- Separate from the execution flow
- Hub for trip history + account management
- Clear navigation to start a new trip

**Missing**:
1. Dedicated `/app/product` page (or landing after auth)
2. Trip history sidebar with real persistence
3. Account/passkey screen (WebAuthn integration)
4. Clear "Brief a new trip" → TripPlan flow

---

### 03 — TripPlan

**Design Intent**: User's brief is echoed and parsed into structured form. Journey, money, preferences, hard arrival deadline.

**Current Implementation**: **NONE**

**Missing**:
1. No dedicated page or screen
2. No parsing of brief into structured fields (destination, arrive-by, depart, budget, recovery allowance, cabin, baggage, seat)
3. No editable fields for the user to refine requirements
4. No hard arrival requirement callout
5. No "Review options" CTA

**Backend contract needed**:
- Trip intent parsing (agent does this, but no structured output)
- Persist parsed requirements to trip model

**Current gap**: The agent receives a brief string but there's no structured trip intent object that can be edited and persisted.

---

### 04 — Options

**Design Intent**: Real flight options ranked by recommendation. Total cost, travel time, connections, arrival time vs deadline. Selection + CTA to Funding.

**Current Implementation**: **NONE**

**Missing**:
1. No page dedicated to options
2. No display of real flight options (no Duffel integration)
3. No ranking/recommendation logic visible in UI
4. No cost comparison
5. No arrival deadline check visualization
6. No option selection UI (radio buttons as designed)

**Backend contract needed**:
- Duffel API integration to search flights
- Options ranking (by cost, time, deadline compliance)
- Store selected option reference in trip

**Current state**: Agent has access to recovery options (mock fixtures), but there is no primary flight search flow.

---

### 05 — Funding

**Design Intent**: Fund the trip before booking. Trip-specific balance. Estimate vs funded amount. Preset buttons. Buffer/shortfall readout.

**Current Implementation**: **NONE**

**Missing**:
1. No dedicated funding screen
2. No funding input (amount picker)
3. No preset buttons (e.g., "Cost only", "£2,500")
4. No buffer/shortfall indication
5. No funding state persistence

**Backend contract needed**:
- Funding model: `trip.fundedAmount`, `trip.fundingStatus`
- Airwallex integration (eventual) for controlled virtual card
- Funding state: UNFUNDED, PROCESSING, FUNDED, INSUFFICIENT

**Critical distinction** (per audit brief):
- **Funding** answers: "Is there money available for this trip?"
- **Authority** answers: "What is Space Zero allowed to do automatically?"
- These MUST remain separate. No recovery controls on the Funding screen.

---

### 06 — Authorization

**Design Intent**: Set delegated limits. Trip budget, recovery allowance, automatic booking, automatic recovery toggles.

**Current Implementation**: **PARTIAL**
- ✅ The product flow shows an Authority screen (internal React component)
- ✅ Budget and recovery allowance editable
- ✅ Toggles for auto-book and auto-recovery
- ❌ Not a dedicated `/app/authorization` page
- ❌ No persistence to trip model (only state)

**Current flow**: The brief input launches the agent immediately with the set allowance. There is no intermediate Funding screen, so the Authority screen runs back-to-back with execution.

**Missing**:
1. Dedicated page after Funding
2. Persistence of authority settings to trip model
3. Clear messaging about the boundary of delegated authority

---

### 07 — Execution

**Design Intent**: Live autonomous activity timeline. Searching, comparing, booking, payment confirmation, monitoring. Meaningful system events.

**Current Implementation**: **PARTIAL**
- ✅ Timeline of stages (Searching, Comparing, Booking, Payment, Monitoring)
- ✅ Visual feedback (spinner for active, checkmark for done, muted for pending)
- ✅ Operational events stream from `/api/agent`
- ❌ Not a dedicated page; embedded in product flow
- ❌ No real live monitoring (static demo)

**Events visible**:
- PLANNING, CHECKING_AUTHORITY, RECOVERY_FOUND, REBOOKING, PERMITTED, REBOOKED, DENIED, RESOLVED

**Missing**:
1. Dedicated page for the execution timeline
2. Live SSE updates during actual booking (not just demo)
3. Payment confirmation step (currently skipped)
4. Monitoring dashboard (next screens after RESOLVED)

---

### 08 — Disruption

**Design Intent**: Live disruption event. Broken connection. Original requirement. Agent reasoning summary. Alternatives. Authority check. Resolution path.

**Current Implementation**: **PARTIAL (demo only)**
- ✅ Disruption event shown (design shows flight delay)
- ✅ Consequence callout ("Connection no longer reachable")
- ✅ What I'm doing timeline (Finding alternatives, Comparing, Checking authority)
- ✅ Best alternative preview
- ❌ Not a real monitoring loop (only runs on explicit agent trigger in demo)
- ❌ No FlightAware integration
- ❌ No live flight tracking

**Hidden reasoning removed?** ✅ Yes — only operational labels shown ("Finding alternatives"), no model reasoning.

**Missing**:
1. Real flight monitoring loop (currently no background monitoring)
2. FlightAware integration for disruption detection
3. Automated triggering when disruption is detected
4. Dedicated page in the product flow

---

### 09 — Resolution

**Design Intent**: Two outcomes — Resolved (auto-recovery within authority) or Escalated (exceeds authority, needs human approval).

**Current Implementation**: **PARTIAL (demo only)**
- ✅ Both paths exist (Resolved vs Escalated)
- ✅ Resolved: Shows before/after legs, new cost, confirmation number
- ✅ Escalated: Shows options, costs relative to allowance, approval buttons
- ❌ No real workflow (only triggered in demo flow)
- ❌ Escalation does not actually block the agent from acting (UI only)

**Problem**: The escalation is a UI representation, not a real state machine. The agent can't actually be blocked from executing an over-limit booking if the demo allowance is increased. The authority engine should refuse it, but the UI needs to match.

**Missing**:
1. Real disruption detection + monitoring
2. Dedicated page in product flow
3. Escalation → human approval → re-authorization flow

---

### 10 — Trips

**Design Intent**: Trip history hub. Active trip with live indicator and decision-needed banner. Past trips with status. Cost breakdown. New trip CTA.

**Current Implementation**: **PARTIAL**
- ✅ Trips list exists as a screen in the product flow
- ✅ Active trip card with live indicator
- ✅ Decision-needed banner
- ✅ Past trips with status
- ❌ No real trip persistence (demo fixture only)
- ❌ No database integration
- ❌ All data is hardcoded

**Missing**:
1. Real trip persistence (Supabase or similar)
2. Query/filter trips by status
3. Dedicated `/app/trips` page
4. Trip detail/history view

---

## 4. Domain/Data Model Gaps

### Exists (verified)
1. ✅ **Trip** — `id`, `status`, `segments`, `tripBudget`, `recoveryAllowance`, `bookingReference`
2. ✅ **TripStatus** — typed union of 10 statuses (DRAFT → RESOLVED)
3. ✅ **Authority engine** — `evaluateAuthority()`, pure deterministic
4. ✅ **Booking execution** — `executeStagedBooking()`, deterministic, STAGED mode
5. ✅ **State machine** — `transition()`, validated transitions, `InvalidTransitionError` thrown on violation

### Needs Modification
1. **Trip** model missing fields:
   - `fundedAmount: number` — how much the user has funded
   - `fundingStatus: "UNFUNDED" | "FUNDED"` — whether funded
   - `parsedIntent?: { destination, arriveBy, depart, budget, recoveryAllowance, cabin, baggage, seat }` — structured trip intent
   - `selectedOptionId?: string` — which flight option was chosen
   - `passengers: Passenger[]` — number of travelers (currently just `checkedBags`)
   - `createdAt, updatedAt: string` — timestamps

2. **Authority** model needs persistence:
   - Currently in-memory in trip object
   - Should be versioned/audited for compliance

### Needs Creation
1. **User** — `id`, `email`, `passkeySeed` (for WebAuthn), `preferredCurrency`, `createdAt`
2. **TripLeg** — more granular than `Segment`; includes carrier, aircraft, confirmation state
3. **FlightOption** — `id`, `tripId`, `segments`, `totalCost`, `travelTime`, `rank`, `selected`
4. **Funding** — `id`, `tripId`, `userId`, `amount`, `status`, `cardReference`, `createdAt`
5. **BookingConfirmation** — `id`, `tripId`, `reference`, `segments`, `cost`, `mode`, `timestamp`
6. **Disruption** — `id`, `tripId`, `flightLegId`, `eventType`, `originalSegment`, `detectedAt`
7. **Recovery** — `id`, `tripId`, `disruptionId`, `optionId`, `selectedOptionId`, `cost`, `appliedAt`
8. **AgentEvent** — `id`, `tripId`, `stage`, `label`, `metadata`, `timestamp`
9. **Passenger** — `id`, `tripId`, `name`, `type` (adult/child), `documentType`, `documentNumber`

---

## 5. API/Backend Contract Gaps

### Exists (verified)
- `GET /api/agent` — health check (provider, key presence)
- `POST /api/agent { brief, scenario, recoveryAllowance }` — SSE stream of operational events

### Server Tools (exist, deterministic, tested)
1. **get_trip** — read trip from store
2. **check_authority** — pure authority evaluation (read-only)
3. **recover_trip** — mock recovery options (fixture-based, no real search)
4. **execute_booking** — STAGED booking (deterministic reference, state machine advancement)

### Missing Endpoints

**Trip Management**:
- `POST /api/trips` — create trip from brief (should parse intent)
- `GET /api/trips/:id` — read trip
- `PATCH /api/trips/:id` — update trip (parsed intent, selected option, funding, authority)
- `GET /api/trips` — list user's trips (requires auth)

**Funding**:
- `POST /api/trips/:id/funding` — allocate funds to trip
- `GET /api/trips/:id/funding` — get funding status
- (Eventually) Airwallex: virtual card provisioning, balance checks

**Flight Search** (Duffel):
- `POST /api/trips/:id/search` — search flights (Duffel API)
- Returns: list of options with cost, duration, connections, arrival time
- Stored in trip or cached temporarily

**Booking** (Duffel):
- `POST /api/trips/:id/book` — real booking confirmation (when not staged)
- Currently only STAGED in `execute_booking`

**Monitoring** (FlightAware):
- `POST /api/trips/:id/monitor` — start monitoring a trip
- Webhook: FlightAware → `/api/webhooks/disruption` — ingest disruption events
- Poll endpoint: `GET /api/trips/:id/status` — live flight status

**User/Auth**:
- `POST /api/auth/register` — passkey registration (WebAuthn)
- `POST /api/auth/login` — passkey sign-in
- `GET /api/auth/me` — current user (requires session)

---

## 6. External Integration Map

### Strands (Agent Orchestration)
**Current Status**: ✅ **Integrated and working**
- Version: `@strands-agents/sdk@1.16.0`
- Location: `src/agent/agent.ts`, `src/server/tools/`
- Tools wired: `get_trip`, `check_authority`, `recover_trip`, `execute_booking`
- Model provider: Anthropic (via `getModel()`)

**Tested**: ✅ Agent-API tests pass; recovery demo runs correctly

**What's left**: Nothing for this integration; it is complete and proven.

---

### Duffel (Flight Search & Booking)
**Current Status**: ❌ **Not integrated**
- No SDK installed
- No credentials in environment
- No real flight data

**Required Role**:
1. Search flights (POST to Duffel `/api/instant_quotes` or search endpoint)
2. Hold fares while user authorizes
3. Create booking order (POST `/api/orders`)
4. Retrieve order (GET `/api/orders/:id`)
5. Update order (change passenger names, add extras)
6. Cancel order (if needed)

**Integration Points**:
1. `POST /api/trips/:id/search` — query Duffel, store options, display on Options screen
2. `POST /api/trips/:id/book` — real booking (will replace STAGED when live)
3. Agent tool: `execute_booking` calls Duffel when mode != STAGED

**Dependencies**: 
- Duffel API credentials
- Real payment info (handled via Airwallex)
- Passenger data from user

**Risks**:
- Duffel's API is real-time; fare holds expire
- Must persist selected option + hold reference
- Error handling for expired fares, unavailable segments

---

### FlightAware (Flight Monitoring & Disruption Detection)
**Current Status**: ❌ **Not integrated**
- No SDK installed
- No credentials
- No monitoring loop

**Required Role**:
1. Subscribe to flight updates (push via webhook)
2. Receive disruption events (delays, cancellations, gate changes)
3. Correlate disruption with trip legs
4. Trigger recovery flow (auto or escalate based on authority)

**Integration Points**:
1. Webhook endpoint: `POST /api/webhooks/disruption` — receive FlightAware events
2. Background job: Poll active trips' flights every 5 min (fallback)
3. Agent triggered: `recover_trip` checks FlightAware for current status

**Dependencies**: 
- FlightAware API key + webhook configuration
- Webhook infrastructure (secure signature verification)
- Trip ↔ flight leg mapping (carrier + flight number)

**Risks**:
- Disruption detection latency (webhook + agent startup time)
- False positives (minor delays don't always break connections)
- Coordinate with Duffel for real booking reference ↔ flight mapping

---

### Airwallex (Payment & Controlled Spending)
**Current Status**: ❌ **Not integrated**
- No SDK
- No credentials
- No payment infrastructure

**Required Role**:
1. Create virtual card for trip
2. Set transaction limits (trip budget + recovery allowance)
3. Approve charges within limit (deterministic)
4. Decline charges over limit
5. Refunds for cancellations

**Integration Points**:
1. `POST /api/trips/:id/funding` — create virtual card, allocate funds
2. `execute_booking` tool — charge card within authority
3. Webhook: Airwallex → `/api/webhooks/payment` — payment confirmations

**Dependencies**:
- Airwallex API credentials + webhook secret
- Business account (Space Zero is not a bank; do not misrepresent)
- KYC/AML for the platform (Airwallex requires business verification)

**Risks**:
- **Critical**: Do NOT present Space Zero as holding user funds in a consumer account. The product description must be clear that funds are held for the specific trip and used only for that booking. Regulatory risk if misrepresented.
- Chargeback / decline scenarios must have clear UX
- Refund flow for cancelled trips

---

### Supabase (Persistence)
**Current Status**: ❌ **Not integrated**
- No schema
- No credentials
- Using dev-store (in-memory, ephemeral)

**Required Role**:
1. Users table (email, passkey seed, preferences)
2. Trips table (all trip fields)
3. Trip_legs, Flights, Options, Bookings (normalized)
4. Disruptions, Recoveries (event log)
5. Payments, Funding (financial audit trail)
6. Agent_events (operational log)

**Database Schema** (essential tables):
```sql
users (id, email, passkey_seed, preferred_currency, created_at)
trips (id, user_id, status, origin, destination, budget, recovery_allowance, funded_amount, funding_status, created_at, updated_at)
trip_legs (id, trip_id, from, to, depart_at, arrive_at, flight_number, carrier, status, booked_reference)
flight_options (id, trip_id, segments, total_cost, travel_time, rank, selected, created_at)
funding (id, trip_id, user_id, amount, status, card_reference, created_at)
bookings (id, trip_id, reference, mode, cost, status, timestamp)
disruptions (id, trip_id, flight_leg_id, event_type, severity, detected_at)
recoveries (id, trip_id, disruption_id, option_id, cost, applied_at)
agent_events (id, trip_id, stage, label, metadata, timestamp)
```

**Integration Points**:
1. All trip reads/writes → Supabase
2. Session/auth → Supabase (or external auth provider)
3. Historical audit log → agent_events table

**Risks**:
- Schema must be carefully designed for financial audit trail
- Row-level security (RLS) to prevent users seeing other trips
- Eventual consistency if caching is added

---

## 7. Autonomous Safety Audit

### ✅ **Model Output Cannot Directly Authorize Spending**

**Verification**:
- `execute_booking` tool receives `amount` (agent-proposed) and `recoveryAllowance` (fetched from stored trip)
- Inside the tool: `executeStagedBooking({ amount, recoveryAllowance: trip.recoveryAllowance, ... })`
- `evaluateAuthority()` is pure: `permitted = requestedAmount <= recoveryAllowance`
- Result: PERMITTED or DENIED, enforced before any booking side effect

**Passed**: ✅

---

### ✅ **Model Output Cannot Bypass the Authority Engine**

**Verification**:
- The only booking tool is `execute_booking`
- It calls `evaluateAuthority()` inside the tool, not before
- If denied, it returns `{ ok: false }` and mutates nothing
- State machine in `advanceAfterBooking()` only advances on `result.ok && result.bookingReference`

**Attack**: What if the agent tries to call a non-existent tool or modify trip state directly?
- Answer: Tools are defined in `src/server/tools/index.ts`; only registered tools are callable
- Answer: No tool provides direct state mutation (only `execute_booking` and `recover_trip`, both safe)
- Answer: Dev store is in-memory; no direct DB access from browser

**Passed**: ✅

---

### ✅ **execute_booking Independently Verifies Authority**

**Code path**:
```typescript
// In execute-booking.ts tool callback:
const trip = getTripById(tripId);  // Fetch STORED trip
const result = executeStagedBooking({
  tripId,
  amount: args.amount,  // Agent-proposed
  recoveryAllowance: trip.recoveryAllowance,  // STORED, not agent-supplied
  currency: trip.currency,
  description,
});
// Only if result.ok does state advance:
if (result.ok && result.bookingReference) {
  putTrip(advanceAfterBooking(booked));
}
```

**Key**: The allowance is fetched from the stored trip, never from the agent's input.

**Passed**: ✅

---

### ✅ **Recovery Allowance Is Deterministic**

**Verification**:
- Set by user on Authority screen → `applyUserAuthority(tripId, recoveryAllowance)`
- Stored in trip object: `trip.recoveryAllowance`
- Read by `execute_booking` directly from trip (not agent parameter)
- Input validation: `ALLOWANCE_MIN=0, ALLOWANCE_MAX=500` (enforced in request parsing)

**Risk**: User can change allowance between requests → **MITIGATED** by applying it up-front:
```typescript
resetDemoTrip(tripId);
applyUserAuthority(tripId, recoveryAllowance);  // Set once per request
```

**Passed**: ✅

---

### ✅ **Funding State Is Separate From Authority State**

**Verification**:
- Authority controls: `tripBudget`, `recoveryAllowance`, `autoRebook`, `autoRecovery`
- Funding controls: (currently none in Trip model, but design calls for it)
- These are separate concepts in the design

**Current state**: Funding is NOT yet modeled in the Trip. The design shows a separate Funding screen, but there's no `fundedAmount` or `fundingStatus` field.

**Gap**: When funding is added, it must NOT be conflated with authority.

**Assessment**: ⚠️ **Design requires separation, currently incomplete**

---

### ✅ **Booking State Is Deterministic**

**Verification**:
- Booking reference: `stagedBookingReference()` — deterministic hash of `tripId:amount`
- Same inputs → same reference (reproducible demo)
- State advancement: Only via `transition()` with validated transitions
- State test: `trip-state.test.ts` verifies all paths

**Booking outcome**: 
- PERMITTED: `{ ok: true, bookingReference: 'SZ-4471' }`
- DENIED: `{ ok: false }` (no reference, no state change)

**Passed**: ✅

---

### ✅ **Denied Recovery Cannot Execute**

**Verification**:
- `executeStagedBooking()` checks `authority.permitted`
- If `false`: return `{ ok: false, authority, reason: '...' }`
- State advancement ONLY on `result.ok` → no state change
- UI must surface the denial (operationally reflected in events)

**Test**: `booking.test.ts` covers both permitted and denied paths

**Passed**: ✅

---

### ✅ **UI Cannot Falsely Report Unconfirmed Booking As Completed**

**Verification**:
- Trip status is authoritative (stored on backend)
- Only `execute_booking` changes status (via `advanceAfterBooking()`)
- On denied execution: status remains unchanged (e.g., RECOVERING)
- UI reads status from `tripSummary` (derived from trip store)

**Risk**: Browser could fake a booking locally in state
- Answer: The trip status is fetched from `getTripById()` on every request
- Answer: Next agent action would see the real status, not the faked one
- Answer: Events are server-derived, not browser-derived

**Passed**: ✅

---

### ✅ **Provider Failures Cannot Be Interpreted As Successful Actions**

**Verification**:
- Tool results include explicit `ok: boolean` flag
- Events derived only from tool results (not assumptions)
- No implicit "if no error, assume success"

**Example**:
```typescript
// In execute_booking tool:
const result = executeStagedBooking(...);
// Tool returns: result (including ok flag)
// State only changes if result.ok === true
```

**Risk**: What if Duffel API fails?
- Currently: `recover_trip` fixture-based (no real API)
- Future: Must return error explicitly, and tool must handle it
- Agent prompt: "Never claim an action happened unless a tool result confirms it"

**Passed**: ✅

---

### ✅ **Agent Activity Does Not Expose Chain-of-Thought**

**Verification**:
- Operational events are derived in `eventsForToolCall()` — reads only tool name, input, trip state
- Never includes model reasoning, token counts, or internal deliberation
- Events sent to browser: only `{ stage, label, ... metadata }`
- Example event:
  ```typescript
  { stage: "CHECKING_AUTHORITY", label: "Checking delegated authority", requestedAmount: 96, recoveryAllowance: 150, permitted: true }
  ```

**Risk**: Verbose agent response?
- Answer: `buildAgentPrompt()` tells agent: "Communicate like a capable operator: short, factual, no filler"
- Answer: Only the final text response is sent (not intermediate reasoning)
- Answer: Tests ensure events don't leak reasoning

**Passed**: ✅

---

## 8. UI Component Gap Analysis

### Reusable Components Needed (Avoid Over-Componentization)

**Core Data Inputs**:
1. **MoneyInput** — editable amount with +/- buttons, presets, formatting
   - Used in: Funding, Authority (budget/allowance editing)
   - Includes: number formatting, input validation, unit symbol (£/$)

2. **CurrencyBadge** — display formatted amount (£1,234)
   - Used everywhere money is shown
   - Trivial but ensures consistency

3. **EditableField** — text/number field that toggles between view and edit mode
   - Used in: TripPlan (journey, preferences)
   - On click: becomes input; on blur: commits
   - Includes: pencil icon, input focus management

4. **OptionCard** — flight/recovery option card
   - Shows: cost, duration, route, arrival time, selection state
   - Includes: recommended badge, radio button, hover state

5. **TimelineStep** — step in a progress timeline
   - State: done (checkmark), active (spinner), pending (dot)
   - Used in: Execution, Disruption, Resolution

6. **AuthorityToggle** — on/off switch for auto-booking, auto-recovery
   - Styled as designed (rounded track, knob animation)

7. **PageHeader** — sticky top bar (Space Zero logo, controls, back button)
   - Reused on every screen

8. **PageFooter** — sticky bottom bar (CTA button or next button)
   - Reused on every screen

**Suggested Minimal Set**: 
- `MoneyInput`, `OptionCard`, `TimelineStep`, `PageHeader`, `PageFooter`
- Others can be inline styles initially; extract only if repeated 3+ times
- Do NOT over-componentize; a 40-line inline component is fine

---

## 9. Critical Risks

### **P0 — Blocks Core Demo**

1. **No real flight search integration**
   - Current: recovery options are fixtures only
   - Impact: Demo cannot show real-world flight options
   - Blocker: Options screen implementation depends on Duffel search
   - Fix: Integrate Duffel in Options API

2. **No disruption detection**
   - Current: disruption is manually triggered in demo
   - Impact: Monitoring + recovery flow is not end-to-end
   - Blocker: Disruption screen has no real data source
   - Fix: Integrate FlightAware or mock a delayed flight

3. **No persistent storage**
   - Current: dev-store (in-memory, ephemeral)
   - Impact: Trip data is lost on restart; cannot demo multi-trip experience
   - Blocker: Trips screen shows hardcoded fixtures
   - Fix: Wire Supabase (or any persistent DB)

4. **Screens not separated into pages**
   - Current: all in one long ProductApp component
   - Impact: Design screens don't correspond to routes; hard to navigate, test, iterate
   - Blocker: Every screen change requires re-compiling the entire flow
   - Fix: Break into `/app/brief`, `/app/options`, `/app/funding`, etc.

---

### **P1 — Important**

1. **WebAuthn (passkey) not implemented**
   - Design calls for passkey sign-up and sign-in on Product screen
   - Impact: Account persistence and trip history cannot work without auth
   - Status: Stub button exists; no actual flow
   - Fix: Integrate WebAuthn library (e.g., `@web-authn/sdk`)

2. **Funding model not in Trip domain**
   - Design has a separate Funding screen
   - Impact: No way to track "how much the user has allocated to this trip"
   - Status: Authority (recovery allowance) is modeled; Funding is not
   - Fix: Add `fundedAmount`, `fundingStatus` to Trip; implement `/api/trips/:id/funding`

3. **Payment infrastructure missing**
   - Design assumes virtual card (Airwallex)
   - Impact: Bookings are STAGED; cannot show real payment flow
   - Status: Airwallex not integrated
   - Fix: Add Airwallex integration for controlled spending

4. **No real booking integration**
   - Current: STAGED bookings only (deterministic refs)
   - Impact: Booking confirmation is not real
   - Status: Tests and demo confirm staging is safe
   - Fix: Add Duffel booking endpoint; gate real mode on configuration

5. **Trip parsing not exposed to UI**
   - Agent parses brief internally, but no structured intent is returned
   - Impact: TripPlan screen cannot display/edit parsed fields
   - Status: Agent knows the intent, but it's not persisted
   - Fix: Add structured trip intent to agent response; persist to trip model

---

### **P2 — Polish**

1. **No mobile responsiveness testing**
   - Designs are mobile-first
   - Status: Layout should be responsive but untested on real devices
   - Fix: Test on iOS Safari, Android Chrome

2. **Dark/light theme untested in some screens**
   - Status: CSS variables are defined; Product screen uses them
   - Fix: Test all screens in both themes

3. **Accessibility (a11y) not addressed**
   - Status: No ARIA labels, focus management, or keyboard navigation tests
   - Fix: Add semantic HTML, ARIA labels, keyboard shortcuts

4. **Error handling incomplete**
   - Example: Duffel API timeout, Airwallex card declined
   - Status: Agent has error recovery; UI doesn't show all error states
   - Fix: Add error screens for each integration failure mode

---

## 10. Recommended Build Order

**Dependency graph**: (earlier items unblock later ones)

### **Phase 1: Persistence + Auth** (Foundation)
1. ✅ **Domain layer already done** (trip state machine, authority, booking)
2. **Supabase schema + integration**
   - Create `users`, `trips`, `trip_legs` tables
   - Implement `getTripById()`, `putTrip()` against real DB (not dev-store)
   - **Blocker resolved**: Multi-trip experience, data survival across restarts
3. **WebAuthn + session management**
   - Sign-up, sign-in, session token
   - **Blocker resolved**: User-specific trip history

### **Phase 2: Frontend Architecture** (Separate Screens)
4. **Break ProductApp into pages**
   - `/app/brief` — Brief input (from Product design)
   - `/app/trip-plan` — Structured trip intent (TripPlan design)
   - `/app/options` — Flight options (Options design)
   - `/app/funding` — Funding allocation (Funding design)
   - `/app/authorization` — Authority settings (Authorization design)
   - `/app/execution` — Live timeline (Execution design)
   - `/app/trips` — Trip history (Trips design)
   - Each page imports real design components (not stubs)
5. **Add Layout component** — PageHeader, PageFooter on every page

### **Phase 3: Real Flight Data** (Options Screen)
6. **Duffel integration**
   - `POST /api/trips/:id/search` endpoint
   - Search flights → return options with cost, duration, arrival
   - Store selected option reference in trip
   - **Blocker resolved**: Options screen shows real data

### **Phase 4: Funding** (Funding Screen)
7. **Extend Trip model**
   - Add `fundedAmount`, `fundingStatus` fields
   - Add `/api/trips/:id/funding` endpoint
   - Update Authorization screen to show funded amount vs. budget
   - (Defer Airwallex; can mock funding for demo)

### **Phase 5: Booking** (Execution Screen)
8. **Duffel booking integration**
   - Real booking in `execute_booking` tool (toggle STAGED/REAL mode)
   - Handle booking failures, reversions
   - Store booking reference in trip

### **Phase 6: Monitoring + Recovery** (Disruption → Resolution)
9. **FlightAware (or mock) disruption**
   - Background monitoring of active trips
   - Webhook or poll endpoint for disruption events
   - Trigger recovery flow in agent
10. **Recovery flow**
    - `recover_trip` → real Duffel search for alternatives
    - Authority check (designed into agent prompt)
    - `execute_booking` → real rebook

### **Phase 7: Payment** (Real Spending)
11. **Airwallex integration**
    - Virtual card provisioning
    - Transaction controls (enforce trip budget + recovery allowance)
    - Charge on booking → real payment (not STAGED)

### **Phase 8: Polish + Testing**
12. **End-to-end testing**
    - Real multi-trip flow
    - Disruption recovery (with real FlightAware data or convincing mock)
    - Payment success and failure scenarios
13. **Responsive design**
    - Mobile, tablet, desktop testing
    - Dark/light theme verification
14. **Accessibility**
    - Semantic HTML, ARIA, keyboard navigation
15. **README + architecture docs**
    - How to configure providers (Duffel, FlightAware, Airwallex, Anthropic)
    - Demo scenario walkthrough
    - Safety audit summary

---

## 11. Definition of Done

Space Zero is implementation-complete when:

1. ✅ **Domain safety verified** (already true)
   - Authority engine is deterministic, independent, enforced
   - Booking choke point is real
   - State machine is typed and validated
   - Tests pass

2. ✅ **Screens match designs** (frontend structure)
   - All 10 screens exist as pages (routes)
   - Visual hierarchy matches design files (fonts, colors, spacing, animations)
   - Mobile-first, responsive
   - Dark/light theme support

3. ✅ **Navigation works end-to-end**
   - Landing → Product → TripPlan → Options → Funding → Authorization → Execution
   - (if disruption) → Disruption → Resolution
   - Trips history is accessible
   - "New trip" flow works

4. ✅ **Real data sources connected**
   - Duffel: Flight search + booking
   - FlightAware: Disruption detection + monitoring
   - Supabase: User, trip, booking persistence
   - WebAuthn: User sign-up and sign-in

5. ✅ **Agent flow end-to-end**
   - User briefs a trip
   - Agent parses intent (TripPlan screen shows parsed fields)
   - Agent searches flights (Options screen shows real options)
   - User selects and funds trip
   - User sets authority
   - Agent books within authority
   - Agent monitors
   - (if disrupted) Agent detects, finds recovery, books within authority (or escalates)
   - Trip history shows resolved outcome

6. ✅ **Payment flows**
   - Funding screen allocates money to trip (via virtual card or custody model)
   - Booking charges within trip budget
   - Recovery spending charges within recovery allowance
   - Over-limit spending is denied and escalated

7. ✅ **Error handling**
   - Duffel API timeout → user-safe error message
   - FlightAware webhook down → fallback to polling
   - Booking failure → escalate to user
   - Payment decline → clear reason, re-authorization flow

8. ✅ **Documentation**
   - README with quick-start (ANTHROPIC_API_KEY, DUFFEL_API_KEY, etc.)
   - Architecture.md explaining domain + agent + tools
   - Safety audit summary
   - Demo scenario (LHR → SIN → SYD with disruption recovery)

9. ✅ **Demo repeatable**
   - Same input → same output (due to deterministic booking refs)
   - Run demo without real payment (STAGED mode, or test Duffel credentials)
   - Show recovery scenario (disruption, alternative found, booked within authority)
   - Show escalation scenario (alternative exceeds allowance, human approval)

---

## 12. Files That Should Be Touched First

### **Phase 1 Start: Supabase Setup**

**Create new files**:
1. `src/db/schema.ts` — TypeScript types mirroring Supabase schema
2. `src/db/migrations/001_initial_schema.sql` — Create users, trips, trip_legs, flights, bookings, etc.
3. `src/server/db.ts` — Supabase client initialization
4. `src/server/user-store.ts` — User CRUD (to replace hardcoded)

**Modify**:
1. `src/server/tools/dev-store.ts` — Replace with real DB calls (or keep as fixture for demo)
2. `src/domain/trip.ts` — Add `fundedAmount`, `fundingStatus`, `parsedIntent`
3. `app/layout.tsx` — Add session/auth provider (if using server sessions)

### **Phase 2 Start: Page Separation**

**Create new files**:
1. `app/app/(auth)/layout.tsx` — Auth guard
2. `app/app/(product)/brief/page.tsx` — Brief input page (from Product design)
3. `app/app/(product)/trip-plan/page.tsx` — Structured trip intent (TripPlan design)
4. `app/app/(product)/options/page.tsx` — Flight options (Options design)
5. `app/app/(product)/funding/page.tsx` — Funding allocation (Funding design)
6. `app/app/(product)/authorization/page.tsx` — Authority settings (Authorization design)
7. `app/app/(product)/execution/page.tsx` — Live timeline (Execution design)
8. `app/app/(product)/trips/page.tsx` — Trip history (Trips design)
9. `app/components/PageHeader.tsx` — Reusable header
10. `app/components/PageFooter.tsx` — Reusable footer

**Delete**:
1. `app/app/page.tsx` (old monolithic product flow) — migrate content to separate pages

**Modify**:
1. `app/api/agent/route.ts` — Update to use new DB layer

### **Phase 3 Start: Duffel Integration**

**Create**:
1. `src/providers/duffel.ts` — Duffel API client
2. `src/server/search.ts` — Flight search logic
3. `app/api/trips/[id]/search/route.ts` — Search endpoint

**Modify**:
1. `src/domain/trip.ts` — Add `selectedFlightOptionId`
2. `src/server/tools/execute-booking.ts` — Call Duffel when mode=REAL

---

## Conclusion

**Status**: Space Zero has a **sound safety architecture and proven agent integration**. The **landing page is complete**. The **deterministic domain layer is correct and tested**.

**Work Remaining**: Frontend implementation (screens as separate pages per design), real provider integrations (Duffel, FlightAware, Airwallex, Supabase), and end-to-end user flows.

**Risk Level**: Low (domain layer is safe; remaining work is implementation, not rearchitecture).

**Recommended Next Task**: Start Phase 1 (Supabase setup) + Phase 2 (page separation) in parallel. This unblocks all downstream screens.
