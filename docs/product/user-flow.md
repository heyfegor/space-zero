# Space Zero — User Flow

## 1. Core Flow

Space Zero is designed around one primary journey:

```text
Describe trip
    ↓
Review plan
    ↓
Approve / delegate authority
    ↓
Agent executes
    ↓
Agent monitors
    ↓
Disruption
    ↓
Agent resolves within authority
    ↓
User receives outcome
```

---

## 2. Screen Flow

### Screen 1 — Home

The user describes what they need in natural language.

Example:

> Get me to London before 10am Friday. Keep the trip under $1,200. Economy, one checked bag. You can spend another $150 if something goes wrong.

**Primary action:** Plan my trip

---

### Screen 2 — Trip Plan

Space Zero converts the request into a structured plan.

Shows:

* Route
* Dates
* Arrival requirement
* Budget
* Travel preferences
* Emergency allowance
* Agent permissions

The user can edit requirements before proceeding.

**Primary action:** Review options

---

### Screen 3 — Options

Space Zero presents the best available itineraries.

Each option shows:

* Total journey cost
* Travel time
* Connections
* Arrival time
* Key trade-offs

The recommended option is clearly identified.

**Primary action:** Select itinerary

---

### Screen 4 — Authorization

The user decides what Space Zero is allowed to do.

Example:

```text
Trip budget          $1,200
Recovery allowance   $150
Automatic booking    ON
Automatic recovery   ON
```

**Primary action:** Give Space Zero authority

---

### Screen 5 — Execution

Space Zero executes the approved actions.

The user sees a live activity timeline:

```text
Searching flights       ✓
Comparing options       ✓
Booking flight          ✓
Monitoring trip         ✓
```

The user does not need to remain on this screen.

---

### Screen 6 — Trip

The active trip shows:

* Current itinerary
* Booking status
* Journey timeline
* Total cost
* Agent authority
* Recent agent actions

Space Zero continues monitoring in the background.

---

### Screen 7 — Disruption

When a disruption occurs, Space Zero evaluates the situation.

```text
Flight delayed 3 hours
        ↓
Connection affected
        ↓
Find alternatives
        ↓
Compare options
        ↓
Check authority
```

If the solution is within the user's authority, the agent acts automatically.

---

### Screen 8 — Resolution

If Space Zero resolves the disruption:

> **Resolved**
>
> Your connection was no longer possible after a 3-hour delay.
>
> I rebooked you on an alternative flight for $96 more. This was within your $150 recovery allowance.
>
> New arrival: 08:40 Friday.

If the solution exceeds the user's authority:

> **Your decision is needed**
>
> The best alternative costs $230 more.
>
> Your recovery allowance is $150.
>
> Review options

---

## 3. Core Interaction Principle

The user should interact heavily during **planning and authorization**, then lightly during execution.

```text
High user involvement
        ↓
Plan → Authorize
        ↓
Low user involvement
        ↓
Execute → Monitor
        ↓
Only interrupt when necessary
        ↓
Resolve or escalate
```

---

## 4. Mobile-First Rule

The primary experience is designed for mobile.

Every core action must work comfortably on a phone without requiring a desktop layout.

Desktop is an expanded version of the mobile experience, not the starting point.