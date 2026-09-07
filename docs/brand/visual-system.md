# Space Zero — Visual System

## 1. Design Objective

Space Zero should look like a serious autonomous travel operator, not a generic AI chatbot or travel booking marketplace.

The interface should communicate:

**Clarity + Control + Movement + Trust**

The design must work exceptionally well on mobile first.

---

## 2. Design Principles

### Clarity over decoration

Every visual element should help the user understand the trip, the agent's actions, or a decision.

### Information has hierarchy

Important information should be immediately visible.

Secondary information should be progressively disclosed.

### Calm autonomy

The interface should feel active without feeling noisy.

The agent can perform many actions in the background while the UI remains calm.

### Human control

Users should always understand:

* What Space Zero can do
* What it has done
* What it is about to do
* When it needs permission

---

## 3. Color Direction

Use a restrained, high-contrast palette.

### Base

* Deep near-black / charcoal for primary surfaces
* Warm off-white for light surfaces
* Neutral grays for secondary information

### Accent

Use **one distinctive accent color** to represent Space Zero and important interactive states.

The accent should be used sparingly.

Do not use gradients.

Do not use purple as the default AI accent.

---

## 4. Typography

Typography should feel editorial, precise, and highly legible.

Prioritize:

* Strong display typography for major trip information
* Highly readable body text
* Clear numeric typography for prices, times, and dates
* Consistent hierarchy

Avoid typography that feels playful or overly technical.

---

## 5. Layout

Use a mobile-first layout.

Primary content should generally follow:

```text
Screen edge
    ↓
Context
    ↓
Primary information
    ↓
Primary action
    ↓
Supporting information
```

Avoid unnecessarily dense dashboards.

Do not default to three-column layouts.

Desktop layouts may introduce additional horizontal space, but the mobile information hierarchy remains the source of truth.

---

## 6. Components

The MVP should prioritize a small component vocabulary:

* Navigation
* Trip header
* Itinerary
* Flight / transport segment
* Price summary
* Authority indicator
* Agent activity timeline
* Decision card
* Primary action
* Secondary action
* Status indicator
* Confirmation state

Do not create components merely for visual variety.

---

## 7. Agent States

The interface should clearly communicate the agent's state.

### Planning

```text
Planning your journey
```

### Executing

```text
Booking your journey
```

### Monitoring

```text
Monitoring your trip
```

### Acting

```text
Resolving a disruption
```

### Waiting for user

```text
Your decision is needed
```

### Completed

```text
Resolved
```

Use visual state changes rather than excessive animation.

---

## 8. Status Semantics

Status should never rely on color alone.

Use:

* Text
* Icons where appropriate
* Position
* Visual hierarchy

Example:

```text
✓ Booking confirmed
! Your decision is needed
× Booking failed
```

---

## 9. Cards and Surfaces

Cards should be used to group meaningful information, not as decoration.

Avoid:

* Endless card stacks
* Excessive rounded containers
* Floating glass panels
* Decorative shadows
* Nested cards inside cards

Prefer strong spacing and typography to create hierarchy.

---

## 10. Motion

Motion should communicate state or progress.

Appropriate:

* Loading/progress states
* Itinerary updates
* Agent activity
* Transition into a decision state

Avoid:

* Decorative animations
* Excessive page transitions
* Constant movement
* Animation that delays user actions

---

## 11. Rejection List

Space Zero should not use:

* Purple gradients
* Gradient text
* Neon cyberpunk aesthetics
* Glassmorphism
* Generic AI robot imagery
* Excessive airplane imagery
* Emoji as primary UI icons
* Three-column feature grids
* Giant "Transform your travel" hero copy
* Generic SaaS dashboard patterns
* Excessive rounded cards
* Decorative UI without product purpose

---

## 12. Quality Bar

Before approving a design, ask:

1. Does this look like Space Zero rather than a generic AI product?
2. Can a user understand the current trip state immediately?
3. Is the most important action obvious?
4. Does the interface work naturally on a phone?
5. Does the design communicate autonomous action without creating anxiety?
6. Is there unnecessary decoration?
7. Could anything be removed without reducing clarity?

If the answer to the final question is yes, remove it.