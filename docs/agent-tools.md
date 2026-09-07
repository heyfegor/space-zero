# Space Zero — Agent Tools

## Purpose

Space Zero is an autonomous AI travel agent that coordinates a user's journey, executes permitted travel actions, monitors the itinerary, and resolves disruptions within rules and spending limits defined by the user.

The agent should use tools to perform real-world work rather than merely provide recommendations.

---

## Tool 1 — `search_travel_options`

### Purpose

Search available travel options for a user's requested journey.

The tool may search flights, ground transport, and other required journey segments.

### Inputs

- Origin
- Destination
- Departure date
- Required arrival time
- Number of travelers
- Cabin class
- Baggage requirements
- Maximum budget
- User preferences

### Outputs

A structured list of available options containing, where available:

- Provider
- Departure time
- Arrival time
- Duration
- Connections
- Ticket price
- Baggage cost
- Total estimated cost
- Booking conditions

### Money movement

**No.**

This is a read-only operation.

### User approval

**No.**

The agent can search autonomously.

---

## Tool 2 — `compare_itineraries`

### Purpose

Compare available travel options and determine the best itinerary according to the user's requirements.

The comparison should consider the complete journey rather than ticket price alone.

### Inputs

- Search results
- User budget
- Required arrival time
- Travel preferences
- Baggage requirements
- Connection constraints

### Outputs

A ranked set of itineraries containing:

- Recommended itinerary
- Total journey cost
- Total travel time
- Connections
- Arrival time
- Transfer requirements
- Reasons for recommendation
- Budget difference

### Money movement

**No.**

This operation performs analysis only.

### User approval

**No.**

The agent can compare options autonomously.

### Implementation note

Cost calculations and constraint checks should be deterministic code where possible rather than delegated to the language model.

---

## Tool 3 — `get_trip_authority`

### Purpose

Retrieve the permissions and spending limits the user has granted Space Zero for a specific trip.

This defines what the agent is allowed to execute without asking the user.

### Inputs

- Trip ID
- User ID

### Outputs

Example:

```text
Trip budget: $1,200
Emergency allowance: $150
Automatic booking: Enabled
Automatic rebooking: Enabled
Maximum autonomous spend: $1,350
```

### Money movement

**No.**

This is a read-only operation.

### User approval

**No.**

The agent can read trip authority autonomously.

---

## Tool 4 — `book_travel`

### Purpose

Purchase an approved travel option.

This executes a real booking with the selected travel provider.

### Inputs

- Selected itinerary
- Traveler details
- Payment authorization
- Trip authority

### Outputs

- Booking confirmation
- Booking reference
- Provider
- Amount charged
- Currency
- Travel details
- Transaction/reference ID

### Money movement

**Yes.**

This tool can execute a real purchase.

### User approval

**Normally yes.**

The agent must obtain user approval before the initial purchase unless the user has explicitly granted automatic booking authority.

### Safety rule

The booking must not exceed the user's authorized spending limit.

---

## Tool 5 — `get_booking_status`

### Purpose

Check the current status of a confirmed travel booking.

This allows Space Zero to monitor the itinerary after booking.

### Inputs

- Booking reference
- Provider

### Outputs

- Current booking status
- Departure status
- Arrival status
- Delay information
- Cancellation information
- Schedule changes
- Connection impact
- Relevant provider notices

### Money movement

**No.**

This is a read-only operation.

### User approval

**No.**

The agent can monitor bookings autonomously.

---

## Tool 6 — `find_recovery_options`

### Purpose

Find alternative travel options when a disruption affects the user's itinerary.

Examples:

- Flight delay
- Flight cancellation
- Missed connection
- Schedule change

### Inputs

- Current itinerary
- Disruption details
- Destination
- Required arrival time
- Remaining budget
- Emergency allowance
- Traveler preferences

### Outputs

A ranked list of recovery options containing:

- Alternative itinerary
- Additional cost
- New arrival time
- Travel time
- Connections
- Trade-offs
- Whether the option falls within the user's authority

### Money movement

**No.**

This tool only searches and evaluates alternatives.

### User approval

**No.**

The agent can search recovery options autonomously.

---

## Tool 7 — `rebook_travel`

### Purpose

Execute a permitted recovery action after a travel disruption.

### Inputs

- Selected recovery option
- Existing booking
- Trip authority
- Traveler details
- Payment authorization

### Outputs

- New booking confirmation
- New booking reference
- Amount charged
- Additional cost
- New itinerary
- Transaction/reference ID
- Cancellation/refund status of the previous booking where applicable

### Money movement

**Yes.**

This tool can execute a real rebooking and payment.

### User approval

**Depends on authority.**

If the additional cost is within the user's predefined autonomous recovery allowance, Space Zero can execute the rebooking without asking.

If the action exceeds the user's authority, Space Zero must stop and request approval.

### Example

```text
Emergency allowance: $150
Alternative cost:     $96
$96 <= $150  →  Agent may rebook autonomously.

Emergency allowance: $150
Alternative cost:     $230
$230 > $150  →  Agent must ask the user.
```