# Space Zero — Information Architecture

## 1. Product Structure

Space Zero is organized around the user's trips and the agent's activity.

```text
Space Zero
│
├── Home
│   └── Create a trip
│
├── Trip
│   ├── Overview
│   ├── Itinerary
│   ├── Agent activity
│   ├── Bookings
│   └── Authority
│
├── Decisions
│   └── Actions requiring user approval
│
└── Profile
    ├── Traveler details
    ├── Payment methods
    └── Agent preferences
```

---

## 2. Primary Navigation

The MVP uses minimal navigation.

### Home

Starting point for creating and viewing trips.

### Trips

Active and previous trips.

### Decisions

Actions that require the user's attention.

### Profile

Traveler information, payment methods, and agent permissions.

---

## 3. Trip Information Hierarchy

Each trip contains:

```text
Trip
│
├── Status
├── Route
├── Dates
├── Total cost
├── Itinerary
├── Bookings
├── Agent activity
├── Authority
└── Decisions
```

The most important information should appear first:

1. Current trip status
2. Next journey action
3. Itinerary
4. Agent activity
5. Cost
6. Authority
7. Supporting details

---

## 4. Agent Activity

Agent actions should be presented as a chronological timeline.

Example:

```text
10:02  Trip planned
10:04  Flight selected
10:05  Booking confirmed
14:30  Flight delay detected
14:31  Recovery options found
14:32  Alternative within authority
14:33  Rebooking completed
```

This gives the user visibility without requiring them to supervise every action.

---

## 5. Decisions

The Decisions area contains only actions that require human intervention.

Examples:

* Alternative exceeds recovery allowance
* Booking requires additional approval
* Required traveler information is missing
* Provider requires an unsupported action

Routine actions should not appear here.

---

## 6. MVP Navigation Rule

Keep navigation shallow.

The user should be able to reach any important trip action within a few taps.

The product should prioritize the active trip and current decision over secondary information.

---

## 7. Mobile-First Information Rule

On mobile, information should be progressively disclosed.

Show the decision or current trip state first.

Secondary details such as booking references, provider information, and technical transaction details should be available without overwhelming the primary experience.