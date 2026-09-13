# Space Zero

**An autonomous travel operator.** You hand it the objective — *"be in Sydney before 9am
Sunday, under £1,200, and handle disruptions up to £150 without asking me"* — and it plans
the trip, books it, monitors every leg, and recovers it when reality changes, acting only
inside the authority you granted.

> Space Zero is a **hackathon prototype**. It is not a regulated financial, custody, or
> payment product and makes no such claim. Bookings run against **Duffel test mode** and
> payments against the **Airwallex sandbox** — see [Known limitations](#known-limitations).

---

## 1. What it is

Space Zero is a single [Next.js](https://nextjs.org) application that runs a
[Strands Agents](https://github.com/strands-agents) TypeScript agent server-side. The agent
turns a plain-language brief into a booked, monitored trip and autonomously recovers it
after disruptions — bounded by a deterministic authority engine it cannot override.

## 2. The problem it solves

Most travellers still search, book, and pay for flights by hand — and then, when a flight
is delayed or cancelled, scramble to rebook under stress. Space Zero takes the objective
and the limits, and owns the journey end-to-end: it does the searching, booking, watching,
and fixing, and only comes back to you when a fix would exceed the authority you set.

## 3. Autonomous operator, not a chatbot

A chatbot answers questions and hands the work back to you. Space Zero **takes
responsibility for the outcome**:

- It **acts** — it books and rebooks through real provider integrations, it doesn't just suggest.
- It **operates in the background** — it monitors every segment and reacts to disruptions without you watching.
- It is **bounded by enforced rules**, not by prompt etiquette — a deterministic authority engine (plain code) decides what it may spend, and a single execution choke point re-checks every action server-side. The language model proposes; it never gets to authorize a spend or move money on its own.

## 4. User → agent → tools → authority → provider

```
User (browser)
  → Next.js route handler (server; keys never reach the browser)
    → Strands Agent (reasoning loop; model = Gemini today)
      → typed tools (get_trip, search_flights, recover_trip, execute_booking, …)
        → Deterministic Authority Engine   ← pure code; the model cannot bypass it
          → Execution choke point: execute_booking / payment-service
            → Providers: Supabase · Duffel · FlightAware · Airwallex
```

See [`docs/architecture.md`](docs/architecture.md) and the diagram
[`docs/architecture.svg`](docs/architecture.svg). The agent **proposes**; the authority
engine and the `execute_booking` choke point **decide and act**.

## 5–11. The stack, honestly

| Piece | Role | Status |
|---|---|---|
| **Strands Agents SDK** | Runs the agent's reasoning loop, tool selection, and streaming, server-side inside Next.js (`src/agent/agent.ts`). | Real. |
| **Google Gemini** | The current LLM behind the agent (`MODEL_PROVIDER=google`, `src/agent/model.ts`). Providers are pluggable via `getModel()` — an env change, no code change. | Real, but subject to account **quota**: on a 429/unavailable the app returns an honest `PROVIDER_UNAVAILABLE` — never a fabricated result. |
| **Amazon Bedrock** | Supported as a `getModel()` provider option for later. | **Not operational here** — AWS account/model entitlement is still pending verification, so `MODEL_PROVIDER=bedrock` cannot be used today. |
| **Supabase (Postgres)** | Authoritative persistence: trips, options, funding, disruptions, recoveries, payment audit (`supabase/migrations/0001–0007`). | Real. Falls back to an in-memory store when unset (tests/local dev). |
| **Duffel** | Real flight **search** and real **order** creation (`src/providers/duffel.ts`). | Real API in **TEST mode**: real test orders (order id + PNR) settle from the Duffel test balance. **Not a live booking; no real money moves.** |
| **FlightAware AeroAPI** | Flight-status monitoring feeding deterministic disruption detection (`src/providers/flight-status.ts`). | Real status lookups. Because a live API can't produce a chosen disruption on cue, the demo disruption is a **clearly-labelled fixture** run through the identical pipeline — never presented as a live FlightAware event. |
| **Airwallex** | Payment boundary for funding and authorized recovery charges (`src/server/payments/payment-service.ts`). | **Sandbox only.** Real sandbox auth + a real payment *intent* is created, but the sandbox account is provisioned for Balances/Transfers (no active payment method), so a charge **cannot reach SUCCEEDED**. Space Zero never claims a settled payment; a non-SUCCEEDED result stops the flow honestly. |

## 12. Deterministic authority engine

`src/domain/authority.ts` is a pure, server-side, LLM-free function. Its rule is simply
`requestedAmount ≤ recoveryAllowance` (inclusive), and it fails closed on invalid input.
It is the single source of truth for "is this spend permitted?", and **every** money path
routes through it. The model may request an amount; it can never decide authorization.

## 13. Recovery workflow

When monitoring detects a threatening disruption, the trip moves to `AT_RISK` and the
recovery workflow (`src/server/recovery/`) runs: load context → search alternatives →
`evaluateRecovery()` (arrival requirement, connection feasibility, funding, budget, and the
recovery allowance — all deterministic) → if the best option is within authority, book it
through the `execute_booking` choke point; otherwise **escalate** to the traveller. Nothing
is ever recorded as recovered without a provider-confirmed order.

## 14. Permitted scenario — £96 recovery / £150 allowance

A disruption's best alternative costs **£96** extra. `evaluateAuthority(96, 150)` → permitted
(£96 ≤ £150) → `execute_booking` runs → the trip resolves. Proven deterministically by the
test suite (`src/server/recovery/lifecycle.test.ts`, *"£96 recovery is permitted and
resolves the demo trip"*).

## 15. Escalation scenario — £181 recovery / £150 allowance

The best alternative costs **£181** extra. `evaluateAuthority(181, 150)` → denied (£181 > £150)
→ **no payment, no booking, no RESOLVED** → the trip stays `AT_RISK` and is escalated for the
traveller's decision. Proven by the tests (£181 leaves the trip `AT_RISK`; 0 payment
attempts, 0 booking attempts).

## 16. Security & safety boundaries

- All provider/model keys are **server-only**; the browser receives only user-safe operational events — never model reasoning or secrets.
- Errors map to fixed, vetted strings (`toUserSafeError`) — no stack traces, no secrets, no provider internals reach the UI.
- The authority engine and the `execute_booking` / payment-service choke points are the only places spend is authorized; the agent cannot bypass them, and `execute_booking` re-derives cost/limits from the store rather than trusting the model.
- Payments are gated (authority + funding), **idempotency-protected** (a retry never double-charges), and reconciled to the provider's honest status.

## 17. Real integrations vs simulated/demo paths

- **Real:** trip creation & persistence (Supabase), flight search & booking (Duffel test mode), funding state, authority persistence, Gemini-driven orchestration.
- **Simulated / clearly labelled:** the disruption event and the exact £96/£181 recovery options are deterministic fixtures (the UI labels staged runs, e.g. *"· staged"*, *"Demo: simulate a disruption"*). The passkey/account flow is visual-only. These exercise the **real** application logic downstream — they are never dressed up as live provider events.

---

## Getting started

### Prerequisites

- **Node.js 20+** (developed against Node 24) and npm
- A **Supabase** project (optional locally — omit and it uses the in-memory store)
- **Duffel** test-mode API key (optional; without it flight search/booking report an honest "unavailable" state)
- A **model provider** key — Gemini (`GEMINI_API_KEY`) or Anthropic (`ANTHROPIC_API_KEY`) — for the agent to run
- Optional: **FlightAware AeroAPI** key, **Airwallex** sandbox credentials

### Environment variables

Copy the template and fill in your own values — **never commit real keys**:

```bash
cp .env.example .env.local
```

`.env.example` documents every variable. Summary:

| Variable | Purpose |
|---|---|
| `MODEL_PROVIDER` | `anthropic` \| `openai` \| `google` \| `bedrock` (selects `getModel()`) |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` | Model credentials (only the selected provider's is needed) |
| `MODEL_ID`, `MODEL_MAX_TOKENS` | Provider-specific model + generation config (optional) |
| `AWS_REGION` | Only for `MODEL_PROVIDER=bedrock` (not operational here) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-side persistence (omit → in-memory fallback). Server-only; never `NEXT_PUBLIC_` |
| `DUFFEL_API_KEY`, `DUFFEL_API_VERSION` | Flight search & test-mode booking (use a `duffel_test_...` key) |
| `FLIGHTAWARE_API_KEY` | Flight-status monitoring |
| `AIRWALLEX_BASE_URL`, `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` | Payment sandbox |

> Use a **Duffel TEST** key and the **Airwallex sandbox** base URL. Do not point this
> prototype at live financial credentials.

### Installation

```bash
npm install
```

If using Supabase, apply the migrations in `supabase/migrations/` in order (`0001` → `0007`)
to your project.

### Development

```bash
npm run dev          # http://localhost:3000
```

### Testing

```bash
npm test             # deterministic unit/integration suite (no keys, no network)
npm run typecheck    # tsc --noEmit
```

Optional live provider verifications (require the relevant key; make real test-mode calls):

```bash
node --env-file=.env.local --import tsx scripts/verify-duffel.ts        # Duffel search
node --env-file=.env.local --import tsx scripts/verify-flightaware.ts   # FlightAware
node --env-file=.env.local --import tsx scripts/verify-airwallex.ts     # Airwallex sandbox
node --import tsx scripts/demo-disruption.ts cancelled                  # deterministic recovery pipeline
```

### Production build

```bash
npm run build        # next build (the command Vercel runs)
npm run start        # serve the production build
```

---

## Architecture overview

Single Next.js deployable; the Strands agent runs in server route handlers. Full detail and
the diagram are in [`docs/architecture.md`](docs/architecture.md) /
[`docs/architecture.svg`](docs/architecture.svg). The two enforcement invariants:

1. **Deterministic authority** — a pure function decides every spend; the model cannot.
2. **Single execution choke point** — `execute_booking` re-validates and performs the only booking/money side effect, server-side, against store data.

## Demo instructions

**Prerequisite:** a model provider with live quota (the agent orchestrates search, booking,
and recovery). If Gemini quota is exhausted, set `ANTHROPIC_API_KEY` and
`MODEL_PROVIDER=anthropic` in `.env.local` — an env change, no code change.

1. Open `/app`, type a brief (e.g. *"Be in Sydney before 9am Sunday, under £1,200, handle disruptions up to £150."*) → **Brief Space Zero**.
2. **Trip plan** → review the structured intent → **Review options**.
3. **Options** → real Duffel fares → select one → **Select this itinerary**.
4. **Funding** → **Fund** the trip.
5. **Authorization** → set **Recovery allowance = £150** → **Give Space Zero authority**.
6. **Execution** → the agent books the trip (real Duffel test order).
7. **Recovery + safety case** (clearly-labelled staged path):
   - `/app/execution?scenario=recovery` → best alternative **+£96** ≤ £150 → **permitted → rebooked → Resolved**.
   - `/app/execution?scenario=over_limit` → best alternative **+£181** > £150 → **denied → stopped → escalation** (no payment, no booking).

The deterministic £96/£181 authority guarantees are also proven by `npm test` independent of the LLM.

## Known limitations

- **Airwallex (sandbox):** authenticates and creates a payment *intent*, but the sandbox account cannot settle a charge (no active Online-Payments method), so no payment reaches SUCCEEDED. No real or sandbox payment is presented as settled.
- **Amazon Bedrock:** not operational — AWS account/model entitlement pending verification.
- **Duffel:** test mode only — orders are real test orders, not live bookings; no real money moves.
- **FlightAware:** live status is real, but the demo *disruption* is a labelled fixture (a live API can't produce a specific disruption on cue).
- **Model quota:** the agent depends on the configured LLM's quota; on 429/unavailable the app fails honestly (`PROVIDER_UNAVAILABLE`) rather than faking a result.
- **Identity:** account/passkey is a visual-only demo; no real WebAuthn or per-user auth yet.
- Space Zero is a prototype, not a regulated financial/custody product.
