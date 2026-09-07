# Space Zero — Technical Architecture

> Status: v2 (pre-implementation). Source of truth for engineering.
> Scope: Hackathon MVP for the AWS Agents for Humans Hackathon.
> Design source of truth: `docs/product/*` and `docs/brand/*`.
> v2 change: collapsed the two-runtime (Next.js + Python/FastAPI) design into a **single TypeScript runtime**. The Strands Agents **TypeScript** SDK (`@strands-agents/sdk`, Node 20+) runs server-side inside Next.js, so the Python service is removed. See §16 for the decision record.

---

## 1. System Overview

Space Zero is **one deployable**: a Next.js application that runs the Strands agent server-side. There is no second service and no cross-language boundary. The Strands TypeScript SDK executes inside Next.js server code; tools, the authority engine, the state machine, persistence, and provider adapters are all TypeScript in the same process.

```text
┌─────────────────────────────────────────────────────────────────┐
│  Client (mobile-first browser)                                    │
│  Next.js App Router · React · Tailwind                            │
└───────────────┬───────────────────────────────────────────────────┘
                │  HTTPS (JSON + SSE stream)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js server (Route Handlers / Server Actions)                 │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  Strands Agent (TypeScript · @strands-agents/sdk)          │  │
│   │  reasoning loop · tool selection · streaming (async iter)  │  │
│   └───────────────┬──────────────────────────────────────────┘  │
│                   │ in-process tool calls (typed, no serialization│
│                   ▼  boundary)                                    │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  Tool layer — Strands tool() functions (TypeScript + Zod)  │  │
│   │  search · build_itinerary · check_authority · booking ...  │  │
│   └───────┬───────────────────┬──────────────────┬────────────┘  │
│           │                   │                  │               │
│   ┌───────▼──────┐   ┌────────▼────────┐  ┌──────▼───────────┐   │
│   │ Authority     │   │ Trip state      │  │ Provider adapters│   │
│   │ engine (TS)   │   │ machine (TS)    │  │ (travel/payment) │   │
│   └───────────────┘   └────────┬────────┘  └──────┬───────────┘   │
│                                │                  │               │
│                        ┌───────▼──────────────────▼───────┐       │
│                        │ Persistence (SQLite/libSQL)       │       │
│                        │ via Drizzle: trips·actions·ledger │       │
│                        └───────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                   │
                   ▼
        Model provider (pluggable): Anthropic API now · OpenAI fallback · Bedrock later
        External services: flight search (real/staged) · payment (staged)
```

**Data direction:** all durable state lives in the app's database, mutated only through the state machine and authority engine. The client never writes trip/authority/ledger state directly — it issues intent to server endpoints, which run the agent and the deterministic engines.

**Key property of the single runtime:** tool results, authority checks, and state transitions all share one TypeScript type system in one process. There is no serialization contract, no internal service token, and no network hop between the agent and the code that enforces money and state rules.

---

## 2. Core Principle

Space Zero is an **autonomous travel operator**, not a chatbot.

Responsibility is divided along a strict line:

| Concern | Owner | Why |
|---|---|---|
| Reasoning, planning, tool selection, natural-language understanding | **Strands agent (LLM)** | This is what the model is good at |
| Authorization, spending limits, state transitions, cost math, audit | **Application code (deterministic TS)** | These must be correct 100% of the time and provable |

**The LLM must never directly control money.** The model may *request* a booking or rebooking. It cannot *authorize* one. Every money-movement path passes through the deterministic authority engine, which the model cannot reach around, reinterpret, or override. If the requested spend exceeds policy, the tool returns a denial — the model does not get to argue with it.

This is the product's trust foundation. It is enforced structurally, not by prompt instruction. The single-runtime design strengthens it: the tool that moves money calls the authority engine as a direct in-process function, not across a network boundary that could fail open.

---

## 3. Model Abstraction

The model provider is a **swappable dependency**. AWS account access is pending, so **Bedrock must not be a build- or test-time blocker**. It is not: Bedrock is only the default *if* you construct a `BedrockModel`. We construct an Anthropic (or OpenAI) model instead, and AWS leaves the critical path entirely.

The Strands TypeScript SDK exposes each provider as a separate model class. We wrap them in one factory:

```text
MODEL_PROVIDER (env) ──► getModel() ──► Strands Model instance
                          │
     ┌────────────────────┼────────────────────────┐
     ▼                    ▼                          ▼
 "anthropic"          "openai"                   "bedrock"
 AnthropicModel       OpenAIModel                BedrockModel
 (direct API key)     (OpenAI-compatible)        (when AWS live)
 USE NOW              FALLBACK                    USE LATER
```

Verified provider facts (Strands TS SDK):

- **Anthropic** — `import { AnthropicModel } from '@strands-agents/sdk/models/anthropic'`; companion package `@anthropic-ai/sdk`; key in `ANTHROPIC_API_KEY`. **This is the development and demo default.**
- **OpenAI** — `import { OpenAIModel } from '@strands-agents/sdk/models/openai'`; key in `OPENAI_API_KEY`. Fallback / OpenAI-compatible endpoints.
- **Bedrock** — `BedrockModel` from `@strands-agents/sdk`; requires AWS credentials + model access. Validated later, never depended on.

Rules:

- The **agent construction and tool layer never reference a concrete provider.** They receive a model object from `getModel()`.
- Switching provider is an **environment-variable change plus credentials** — no change to agent or tool code.
- Model id, temperature, and max tokens are env-configured so a provider swap carries the correct model id.

The abstraction boundary is the primary hedge against the pending-AWS risk, and it costs nothing because the SDK already provides parallel provider classes.

---

## 4. Strands Architecture

**Agent.** One primary Strands `Agent` (the "Trip Operator"), constructed with a model (from the factory), the tool set, and the system prompt. It runs the reasoning loop: interpret → select tool → observe result → repeat → respond.

**System prompt.** Encodes the operator persona and hard rules, in the brand voice (calm, factual, no filler):
- You coordinate real travel actions through tools; prefer action over conversation.
- You never move money directly. To spend, you must call the booking tool, which enforces authority.
- If a spend is denied for exceeding authority, escalate to the user — do not retry variations.
- Ground every claim in tool results; never fabricate confirmations, prices, or references.
- Keep user-facing messages short and concrete.

**Tools.** Registered as Strands `tool()` functions with **Zod** input schemas and typed callbacks. The agent sees the schema and the returned result — never the implementation. Because tools are TypeScript, their return types flow directly into the deterministic engines with no serialization step.

**Tool schemas.** Zod schemas give runtime validation + compile-time types. Cost, currency, and authority fields are structured, so deterministic code consumes them without re-parsing model prose.

**Tool execution.** Runs in the Next.js server process. Each tool call: (a) validates inputs via Zod, (b) executes deterministic logic / adapter call, (c) records an `AgentAction` before and after, (d) returns a structured result. Side-effecting tools additionally pass through the authority engine and state machine.

**Agent state.** Reasoning state is per-invocation and ephemeral. **Durable state lives in the database, not the agent context.** The agent rehydrates trip facts (authority, current itinerary) by calling tools rather than trusting carried context. The model is therefore stateless with respect to money and authority.

**Errors.** Tools never throw raw errors to the model. They return `{ ok: false, error_code, message }`. The agent surfaces a calm failure or escalates, and does not loop.

**Retries.** Idempotent read tools (search, monitor) may retry with backoff inside the tool. **Side-effecting tools (booking) never auto-retry** — a failed or ambiguous booking escalates, to avoid double charges. Idempotency keys guard the booking path.

**Observability.** Every tool call emits a structured log line and an `AgentAction` record: tool, inputs (redacted), outputs, duration, decision (permit/deny), correlation id, model provider + id + token usage. This single source powers both the user-facing activity timeline and the audit log.

**Streaming.** `agent.stream(prompt)` yields events via an async iterator. A Next.js Route Handler pipes those events straight into a `ReadableStream` (`text/event-stream`) response to the client — one hop, no proxy.

---

## 5. Agent Tools

Design decisions that shape this section:

- **Single money choke point.** `execute_booking` is the **only** tool that moves money, used for both initial booking and rebooking — one path to audit and secure. `recover_trip` therefore only *finds and evaluates* options; it does not spend.
- **Authority is a tool AND an internal gate.** `check_authority` is agent-callable (advisory, so it can reason about limits), and the same logic is invoked *inside* `execute_booking` as the real, authoritative enforcement.
- Mapping to `docs/agent-tools.md`: `search_travel`←search_travel_options, `build_itinerary`←compare_itineraries, `check_authority`←get_trip_authority, `execute_booking`←book_travel, `monitor_trip`←get_booking_status, `detect_disruption`←(new, analyzes monitor output), `recover_trip`←find_recovery_options (rebooking routed through `execute_booking`), `record_transaction`←(new, ledger).

| Tool | Deterministic | Side effects | Money | Authorization required |
|---|---|---|---|---|
| `search_travel` | No (adapter I/O) | None (read) | No | No |
| `build_itinerary` | **Yes** | None | No | No |
| `check_authority` | **Yes** | None (read) | No | No |
| `execute_booking` | **Yes** (gate) | **Writes booking + ledger + state** | **Yes** | **Yes** |
| `monitor_trip` | No (adapter I/O) | None (read) | No | No |
| `detect_disruption` | **Yes** | None | No | No |
| `recover_trip` | No (adapter I/O) + Yes (scoring) | None (read) | No | No |
| `record_transaction` | **Yes** | Writes ledger | No (records, not moves) | No |

### `search_travel`
- **Purpose:** Find available travel options for a requested journey segment.
- **Inputs:** `origin`, `destination`, `depart_date`, `arrive_by`, `travelers`, `cabin`, `baggage`, `max_budget`, `preferences`.
- **Outputs:** `options[]` — provider, depart/arrive times, duration, connections, ticket price, baggage cost, total estimate, conditions, `option_id`.
- **Deterministic:** No (external/staged source). **Side effects:** none. **Money:** no. **Auth:** none.

### `build_itinerary`
- **Purpose:** Rank options into complete itineraries against constraints; cost and constraint math is code, not model judgment.
- **Inputs:** `options[]`, `budget`, `arrive_by`, `preferences`, `baggage`, `connection_constraints`.
- **Outputs:** `ranked[]` with `recommended` flag, total cost, total time, connections, arrival, transfers, budget delta, short machine-generated reason.
- **Deterministic:** Yes. **Side effects:** none. **Money:** no. **Auth:** none.

### `check_authority`
- **Purpose:** Given a trip and a proposed spend, return whether it is permitted under policy. Pure function over stored policy.
- **Inputs:** `trip_id`, `proposed_amount`, `currency`, `spend_type` (`initial_booking` | `recovery`).
- **Outputs:** `{ permitted, limit, remaining, reason }`.
- **Deterministic:** Yes. **Side effects:** none. **Money:** no. **Auth:** this *is* the auth read.

### `execute_booking`
- **Purpose:** The sole money-movement tool. Books/rebooks a selected itinerary through a provider adapter after authority passes.
- **Inputs:** `trip_id`, `itinerary_id`/`option_id`, `traveler_ref`, `spend_type`, `amount`, `currency`, `idempotency_key`.
- **Behavior:** internally re-runs authority; denied → returns denial, **does not book**. Permitted → calls provider adapter, writes `Transaction`, advances state machine, records `AgentAction`.
- **Outputs:** `{ ok, booking_reference, provider, amount_charged, currency, itinerary, transaction_id }` or `{ ok:false, error_code, requires_escalation }`.
- **Deterministic:** Yes (gate + ledger; provider call is the only non-deterministic part). **Side effects:** yes. **Money:** yes. **Auth:** required, enforced internally.

### `monitor_trip`
- **Purpose:** Read current booking/journey status.
- **Inputs:** `booking_reference`, `provider`.
- **Outputs:** status, departure/arrival status, delay, cancellation, schedule changes, connection impact, notices.
- **Deterministic:** No (adapter I/O). **Side effects:** none. **Money:** no. **Auth:** none.

### `detect_disruption`
- **Purpose:** Deterministically decide whether a monitor result breaks the arrival requirement or a connection.
- **Inputs:** `current_itinerary`, `monitor_result`, `arrive_by`.
- **Outputs:** `{ disrupted, kind (delay|cancellation|missed_connection|schedule_change), severity, broken_constraint }`.
- **Deterministic:** Yes. **Side effects:** none. **Money:** no. **Auth:** none.

### `recover_trip`
- **Purpose:** Find and rank recovery options after a disruption. **Read-only** — does not book. Flags each option's authority status via `check_authority` logic.
- **Inputs:** `current_itinerary`, `disruption`, `destination`, `arrive_by`, `remaining_budget`, `recovery_allowance`, `preferences`.
- **Outputs:** `ranked_recovery[]` with alternative itinerary, additional cost, new arrival, time, connections, trade-offs, `within_authority`.
- **Deterministic:** No (search I/O) + Yes (scoring). **Side effects:** none. **Money:** no. **Auth:** none to read.

### `record_transaction`
- **Purpose:** Append an immutable ledger entry. Records money that moved (or staged movement); never moves money.
- **Inputs:** `trip_id`, `type` (`booking`|`rebooking`|`refund`), `amount`, `currency`, `provider`, `reference`, `staged`.
- **Outputs:** `{ transaction_id }`.
- **Deterministic:** Yes. **Side effects:** writes ledger. **Money:** no. **Auth:** none.

---

## 6. Authority Architecture

Delegated authority is a **deterministic system boundary** — a pure TypeScript function over stored policy. The model has no path around it.

```text
Agent requests spend  ─────►  Authority Engine (TS)  ─────►  permit / deny
                                     │
        proposed_amount  ──────────► │  compare against AuthorityPolicy
        spend_type       ──────────► │  (initial vs recovery bucket)
                                     ▼
     recovery example:  requested 96,  allowed 150   →  PERMIT
     recovery example:  requested 230, allowed 150   →  DENY → ESCALATE
```

Rules:

- Comparison is inclusive at the boundary: `requested <= allowed` → permit. (150 with a 150 allowance → permit; 150.01 → deny.)
- **Initial booking** is checked against `trip_budget` (and requires `automatic_booking` for no-confirmation execution). **Recovery** is checked against `recovery_allowance` (and requires `automatic_recovery`).
- A denial does not end the trip — it creates a `Decision` and moves the trip to `ESCALATED`. The agent does not retry variations to sneak under the limit.
- The engine is called in two places: the `check_authority` tool (advisory) and *inside* `execute_booking` (authoritative — the call that can actually stop money).
- Every evaluation is logged with inputs and outcome for audit.
- Money is stored in minor units with an explicit currency; the demo uses one currency, conversion is post-hackathon.

---

## 7. Trip State Machine

States and the only permitted transitions. Transitions are performed exclusively by application code, never by the model.

```text
DRAFT
  └─► PLANNING
        └─► AWAITING_AUTHORITY
              ├─► AUTHORIZED
              │     └─► EXECUTING
              │           ├─► BOOKED ─► MONITORING
              │           └─► ESCALATED        (booking denied/failed)
              └─► CANCELLED

MONITORING
  ├─► DISRUPTED
  │     └─► RECOVERING
  │           ├─► RESOLVED      (recovery within authority, rebooked)
  │           └─► ESCALATED     (recovery exceeds authority)
  └─► RESOLVED                  (trip completes without disruption)

ESCALATED
  ├─► RECOVERING   (user grants/adjusts authority or picks an option)
  ├─► AUTHORIZED   (user approves initial booking)
  └─► CANCELLED

RESOLVED  ─► (terminal; monitoring may continue until journey end)
CANCELLED ─► (terminal)
```

| State | Meaning |
|---|---|
| `DRAFT` | Trip intent captured, not yet structured |
| `PLANNING` | Agent extracting constraints, searching, building itineraries |
| `AWAITING_AUTHORITY` | Plan ready; needs user authority/approval |
| `AUTHORIZED` | User granted authority; cleared to execute |
| `EXECUTING` | Booking in progress |
| `BOOKED` | Initial booking confirmed |
| `MONITORING` | Booked trip under active monitoring |
| `DISRUPTED` | A monitor result broke a constraint |
| `RECOVERING` | Searching/evaluating/executing recovery |
| `RESOLVED` | Disruption handled, or trip completed cleanly |
| `ESCALATED` | Decision required from the user |
| `CANCELLED` | Trip terminated |

Invariant: money moves only from `AUTHORIZED`/`EXECUTING` (initial) or `RECOVERING` (recovery). The state machine rejects out-of-state money moves independently of authority.

---

## 8. Data Model

Lean, normalized enough to be correct, no more. IDs are ULIDs. Money is `{ amount:int (minor units), currency }`.

```text
User            id, name, email, created_at
                └─ has many Trip

Trip            id, user_id, status(enum §7), origin, destination,
                depart_date, arrive_by, cabin, baggage, preferences(json),
                created_at, updated_at
                └─ has one AuthorityPolicy
                └─ has many Leg, Itinerary, AgentAction, Disruption,
                   RecoveryAction, Transaction, Decision

Leg             id, trip_id, seq, from, to, provider, depart_at, arrive_at,
                mode(flight|ground)

Itinerary       id, trip_id, status(candidate|selected|booked|superseded),
                total_cost{}, total_duration, arrival_at, connections,
                reason, legs_ref[]

AuthorityPolicy id, trip_id, trip_budget{}, recovery_allowance{},
                automatic_booking:bool, automatic_recovery:bool,
                max_autonomous_spend{}

AgentAction     id, trip_id, ts, tool, inputs(json,redacted),
                output(json), decision(permit|deny|n/a), duration_ms,
                correlation_id            ← powers timeline + audit

Disruption      id, trip_id, detected_at, kind, severity,
                broken_constraint, source_monitor(json)

RecoveryAction  id, trip_id, disruption_id, chosen_itinerary_id,
                additional_cost{}, within_authority:bool, outcome

Transaction     id, trip_id, type(booking|rebooking|refund), amount{},
                provider, reference, staged:bool, created_at   ← immutable ledger

Decision        id, trip_id, kind(approve_booking|approve_recovery|
                provide_info), status(open|resolved), context(json),
                created_at, resolved_at
```

Notes:
- `AgentAction` is append-only and is the single source for both the user timeline and the audit log.
- `Transaction` is append-only; corrections are new rows, never edits.
- `staged` on `Transaction` marks non-real money movement so staged data can never masquerade as a real charge.

---

## 9. API Architecture

MVP endpoints only — all served by **Next.js Route Handlers / Server Actions** in the single runtime. No out-of-scope endpoints, no internal service-to-service API (there is no second service).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/trips` | Create a trip from a natural-language objective (→ DRAFT/PLANNING) |
| `POST` | `/api/trips/:id/plan` | Run the planning loop (agent: search + build_itinerary), streamed |
| `GET` | `/api/trips/:id` | Trip overview: status, itinerary, cost, authority, next decision |
| `GET` | `/api/trips/:id/activity` | Agent activity timeline (from `AgentAction`); SSE for live updates |
| `POST` | `/api/trips/:id/authority` | Set/adjust `AuthorityPolicy`, grant authority (→ AUTHORIZED) |
| `POST` | `/api/trips/:id/execute` | Run the booking loop under authority, streamed |
| `GET` | `/api/trips/:id/decisions` | Open decisions requiring the user |
| `POST` | `/api/decisions/:id/resolve` | Resolve an escalation (approve/deny/provide info) |
| `POST` | `/api/trips/:id/simulate-disruption` | **Demo control**: inject the staged disruption → runs detect + recovery loop |

Agent-driven endpoints (`plan`, `execute`, `simulate-disruption`) return an SSE stream produced directly from `agent.stream(...)`, so the client timeline updates live without the user camping on a screen.

---

## 10. Demo Architecture

The five-minute demonstration, with a hard line between **real agent behavior** and **staged external data**.

```text
1. User types objective         REAL   — "In London before 10am Fri, under $1,200,
                                          economy, 1 bag, +$150 if something breaks"
2. Agent extracts constraints   REAL   — Strands (TS) reasoning → structured Trip
3. Agent plans                  REAL agent · STAGED option data
                                       — search_travel returns a curated realistic
                                         dataset; build_itinerary ranks it (real code)
4. User grants authority        REAL   — AuthorityPolicy persisted
5. Agent executes booking       REAL agent + REAL authority gate · STAGED provider
                                       — execute_booking passes authority; provider
                                         adapter returns a STAGED confirmation
                                         (Transaction.staged = true)
6. Monitoring begins            REAL   — state → MONITORING
7. Disruption occurs            STAGED trigger — /simulate-disruption injects a
                                         3-hour delay (controllable, not left to chance)
8. Agent detects disruption     REAL   — detect_disruption (deterministic) → DISRUPTED
9. Agent searches recovery      REAL agent · STAGED options — recover_trip
10. Authority check             REAL   — +$96 vs $150 allowance → PERMIT (real code)
11. Recovery executed           REAL agent + REAL gate · STAGED provider
                                       — execute_booking(spend_type=recovery)
12. Resolved                    REAL   — state → RESOLVED, concise report to user
```

**Honesty rules for the demo:**
- Every staged booking/payment is flagged `staged: true` and is never described in the UI or by the agent as a real charge.
- Flight *search* data may be real (a live flight API) or staged; either way the agent's reasoning over it is real.
- The authority decision ($96 ≤ $150) is genuine deterministic code, not a scripted outcome. Judges can re-run with a >$150 alternative and watch it escalate.
- The disruption trigger is staged and operator-controlled purely so the demo is reliable — the agent's *response* is fully real.

---

## 11. Security

- **API keys / secrets:** model provider keys and adapter keys live only in **server-side** env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, adapter keys). Never in `NEXT_PUBLIC_*`, never shipped to the client bundle. In the single runtime, keys are read only inside Route Handlers / server modules, which never reach the browser.
- **Environment variables:** typed config module; startup fails fast if a required secret is missing. `.env.example` documents names, never values. `.env` git-ignored.
- **Authorization:** two independent layers — (1) user/session auth at the request boundary; (2) the deterministic authority engine for all spend. Passing session auth never implies spend authority.
- **Payment authorization:** all money movement goes through `execute_booking` → authority engine → provider adapter. No other path. Idempotency keys prevent double charges; side-effecting calls never auto-retry.
- **Tool permissions:** tools are partitioned into read-only and side-effecting. Side-effecting tools validate state (state machine) and authority before acting. The model cannot invoke a raw provider call — only the wrapped tool.
- **Server/client boundary:** all agent logic, tools, secrets, provider adapters, and state mutation are server-side (Next.js server). The client only renders state and issues intent. Guard against accidental client import of server modules (e.g. `server-only` marker on agent/tool/secret modules).
- **Prompt injection from tool data:** external travel/provider results are **data, not instructions.** They enter the model context as clearly delimited, typed tool results, never as system/user instructions. The system prompt states that tool content cannot change rules or authority. Authority and state decisions are made by code that never reads model prose, so a maliciously crafted provider "notice" cannot authorize a spend or move state. Free-text provider fields are length-capped and sanitized before storage/render.
- **Audit logging:** `AgentAction` (append-only) + `Transaction` (append-only) give a complete, immutable record of what the agent did, what it was permitted to do, and what money (real or staged) moved. Correlation ids tie a user request to every downstream tool call.

---

## 12. Mobile-First Considerations

- Design and build at **~375px width first**; desktop is an expansion, not the source layout.
- **No horizontal overflow at 375px** — wide content (itineraries, timelines, cost tables) scrolls within its own container, never the page body.
- Single-column information hierarchy per `information-architecture.md`: status → next action → itinerary → activity → cost → authority → detail.
- Progressive disclosure: booking references, provider detail, and staged-transaction internals available but not surfaced by default.
- Live agent activity via SSE (streamed straight from `agent.stream`) so the phone reflects background work without staying on-screen.
- Touch targets, system font stack, reduced-motion respect per the visual system (motion communicates state only).

---

## 13. Deployment

Leanest possible: **one deployable**.

```text
App:       Next.js (client + server + Strands agent) — one build, one host
Database:  SQLite via Drizzle
             · Persistent Node host (Railway / Render / Fly): local SQLite file
               through better-sqlite3  ← leanest, zero external DB  (RECOMMENDED)
             · Vercel: libSQL/Turso connection string (serverless fs is ephemeral,
               so a local file will not persist there)
Secrets:   platform env vars (never committed)
```

- **Recommended:** deploy the Next.js app as a long-running Node server on Railway/Render/Fly with a local SQLite file. One host, one process, one file, no external database — best fit for `rejection-list.md` ("no unnecessary databases").
- **If Vercel is preferred** for Next.js DX: use Turso (libSQL) — SQLite semantics behind one connection string, serverless-safe. Also note Vercel's per-plan streaming/timeout limits; the persistent-host option avoids them for long agent streams.
- The database choice sits behind Drizzle's data-access layer, so it does not affect application code — decide at deploy time.
- Deployment is validated **early** with a smoke path (plan → authorize → book-staged) against the deployed environment, well before demo day.

---

## 14. AWS Integration

AWS/Bedrock is an **optional model-provider integration**, not a dependency.

- Development and the hackathon demo run on the **Anthropic direct API** via the model factory (`MODEL_PROVIDER=anthropic`). Nothing about building, testing, or demoing requires AWS. OpenAI is a same-shape fallback.
- When the AWS account clears, `MODEL_PROVIDER=bedrock` plus Bedrock credentials switches the provider with **no change to agent or tool code** (the SDK ships `BedrockModel` in the same package).
- We genuinely use the **Strands Agents SDK** for orchestration — the SDK is the requirement, Bedrock is not. Strands' provider-agnostic model interface is exactly what lets us honor "must use Strands" while "AWS is pending."
- **AgentCore (post-hackathon, honest note):** Bedrock AgentCore can host a containerized agent of any language, but its SDK ergonomics and examples are Python-first, and it requires AWS. It is out of scope for the hackathon and off the blocked-AWS path. If deep AgentCore integration becomes a goal later, porting 8 well-specified tools + one system prompt from TS Strands to Python Strands is a bounded, low-risk task because the two SDKs mirror each other. This is the one real tradeoff of choosing TypeScript, and it does not affect the hackathon.

---

## 15. MVP Boundary

### BUILD NOW
- Single Next.js runtime with server-side Strands (TS) agent.
- Model factory with the Anthropic provider working end to end (OpenAI fallback wired).
- Strands agent + the eight tools (§5) with Zod schemas.
- Deterministic authority engine (§6) and trip state machine (§7).
- Lean data model (§8) via Drizzle on SQLite.
- MVP API endpoints (§9), including `/simulate-disruption` demo control and SSE streaming.
- The full autonomous loop (§10) with staged provider adapters (flagged `staged`).
- Mobile-first UI: create trip, review plan, grant authority, watch execution, see resolution/escalation.
- Deployed to one host with the smoke path validated.

### AFTER HACKATHON
- Bedrock provider flip (validated, not depended on).
- Real payment/booking provider integrations replacing staged adapters.
- Live flight monitoring loop (replacing the staged disruption trigger).
- Multi-leg journeys, ground transport, hotels, transfers.
- Currency conversion, refunds/cancellations, multiple travelers, loyalty.
- User notifications, richer profile, multi-user accounts.
- Managed Postgres, deeper observability, AgentCore evaluation, hardening beyond demo needs.

**Anti-scope-creep rule (from `rejection-list.md`):** if a feature, endpoint, entity, or component does not make Space Zero clearer, more trustworthy, or more useful *for the core autonomous loop demo*, it is AFTER HACKATHON. No exceptions during the build.

---

## 16. Decision Record — Single TypeScript Runtime (supersedes v1's two-runtime design)

**Context.** v1 assumed Strands was Python-only and therefore required Next.js → FastAPI → Python. That assumption is false: Strands ships a first-class **TypeScript** SDK (`@strands-agents/sdk`, Node 20+) that runs server-side inside Next.js.

**Evaluation (ruthless, against the hackathon priorities of speed + reliability):**

1. **All MVP Strands features in TS?** Yes — agent create/invoke, streaming (async iterators), structured output (Zod), custom tools (`tool()`), Anthropic/OpenAI/Bedrock/custom providers. No MVP feature is missing. (An early Feb-2026 article claimed structured output/multi-agent were TS gaps; current official docs list them as available, and our MVP needs neither multi-agent nor Python-only callback handlers.)
2. **Custom travel tools clean in TS `tool()`?** Yes, and cleaner for us than Python: Zod gives runtime validation + inferred types, and tools call the authority engine / state machine **in-process, same language**, with no serialization boundary.
3. **Anthropic / OpenAI fallback while Bedrock is down?** Yes. `AnthropicModel` (+`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`) is the default; `OpenAIModel` is the fallback. Bedrock is only the default if you choose `BedrockModel`. AWS is fully off the critical path.
4. **Streaming from a Next.js route vs FastAPI→Next.js SSE proxy?** Far simpler: `agent.stream()` async iterator → `ReadableStream` in a Route Handler, one hop. The two-runtime design needed FastAPI SSE → Next.js relay → client: two hops, two connection lifecycles, a service-token boundary in the streaming path.
5. **Any Python-only feature genuinely required?** No. Python Strands is more mature and some advanced multi-agent/integration features landed there first, but our MVP is one agent, eight tools, one provider, streaming, deterministic gates — none of it Python-only.
6. **Does single-runtime reduce deployment risk?** Substantially: one deployable instead of two, one host instead of Vercel+Railway, no internal service token, no cross-service network path, no cross-language contract, no version drift between services. Directly improves the "deployed and accessible" success criterion.
7. **AgentCore later?** AgentCore is container-runtime-agnostic but Python-favored in ergonomics and requires AWS. It is post-hackathon and on the blocked path. Choosing TS does not close the door; porting well-specified tools to Python Strands later is bounded and low-risk.

**Decision.** Remove FastAPI and Python from the architecture. Build the MVP as a **single TypeScript/Next.js runtime** with server-side Strands.

**Complexity removed vs v1:** the entire FastAPI service; the Python runtime and its dependency set; the internal service token and inter-service auth; the FastAPI→Next.js SSE proxy hop; the cross-language serialization contract for tool results; the second deployment target and its config; the `/agent/*` internal endpoints; and the risk of the two services drifting.

**Accepted tradeoff:** if deep Bedrock AgentCore integration becomes a priority post-hackathon, Python would have been the smoother long-term host. Judged not worth carrying a second runtime through the hackathon build.
