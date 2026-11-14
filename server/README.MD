# CookbookOS Backend Server

Runtime backend and state synchronization engine for CookbookOS on Meta Smart Glasses. Coordinates multimodal ingestion, deterministic scaling, in-memory live session state, and multimodal event streams (VLM/Voice).

---

## Directory Tree

```text
server/
├── models/
│   ├── domain.js      # Core domain entities & recipe schema validation (Zod)
│   ├── view.js        # HUD projection & view-state contracts (Zod)
│   ├── vision.js      # VLM frame ingestion & phase prediction contracts (Zod)
│   └── index.js       # Barrel export for models
├── engine.js          # Pure math: deterministic unit conversions & scaling
├── session.js         # Stateful session manager, pub/sub, & VLM debounce gate
├── server.js          # Express HTTP API & WebSocket/SSE streaming gateway
├── smoke.js           # End-to-end integration & verification test harness
└── package.json       # Node ESM dependencies & runner scripts
```

---

## File Responsibilities & Architecture

### 1. `models/` (Data Contracts & Invariants)

Defines strict runtime boundary schemas using **Zod**. Every payload entering or leaving the backend is validated here.

- **`models/domain.js`**: Validates normalized recipe ingestion format: base metric units (`g`, `ml`, `unit`), substitutions, structured instructions, and computer vision visual cues.
- **`models/view.js`**: Defines the hydrated HUD view delivered to the glasses display (active step, scaled servings, formatted ingredient strings, completion flags).
- **`models/vision.js`**: Defines contracts for VLM frame evaluation payloads (`completed`, `confidence`, `rationale`).
- **`models/index.js`**: Central barrel export exposing schemas and inferred types.

### 2. `engine.js` (Stateless Computation Engine)

Pure functional transforms with zero side effects. Given identical inputs, it always yields identical outputs.

- **Quantity Scaling**: Scales ingredient amounts linearly based on dynamic `scaleFactor`.
- **Unit System Conversions**: Converts normalized base metric values (`g`, `ml`) to localized culinary units (`imperial` vs. `metric`) with practical cooking rounding.
- **No external dependencies**: Pure JavaScript math operations.

### 3. `session.js` (Active Session State Machine)

Stateful runtime coordinator managing the live cooking session lifecycle.

- **Ephemeral State Store**: Holds `currentStepIndex`, active `scaleFactor`, `unitSystem`, completed steps, and recent VLM detections.
- **Reactive Hydration**: Invokes `engine.js` on demand via `getView()` to produce a real-time HUD view payload.
- **VLM Debounce Gate**: Enforces multi-frame hysteresis (requires 2 consecutive frames with confidence >= 0.8) before triggering an auto-advance, preventing visual jitter.
- **Pub/Sub Broker**: Dispatches immediate state diffs to attached WebSocket or SSE client subscribers whenever state mutates.
- **TTL Reaper**: Sweeps inactive sessions after 4 hours to prevent memory leaks.

### 4. `server.js` (Gateway & Network Transports)

Handles external I/O, route dispatching, and downstream AI integration.

- **REST Endpoints**: Exposes routes for recipe ingestion, session pairing, step navigation, and configuration toggles.
- **Real-time Push (WebSocket / SSE)**: Subscribes to `session.js` events and pushes instantaneous updates down to the Meta Glasses HUD.
- **AI Integration**: Dispatches glasses camera frames to the VLM (Gemini vision) and feeds structured results into `session.recordVlmResult()`; maps voice transcript intents to navigation and scaling actions.

### 5. `smoke.js` (Integration Harness)

Verification pipeline validating the critical runtime loop without requiring hardware attached:

1. Ingests mock raw recipe JSON through schema validation.
2. Creates an active in-memory session.
3. Tests dynamic scaling and imperial/metric unit toggling.
4. Simulates high-confidence camera frames to verify step auto-advancement.

---

## Data Flow Pipeline

```text
[Camera / Mic / HUD Tap]
           │
           ▼
     `server.js` (HTTP / WebSocket Transport)
           │
           ▼
     `session.js` (State Machine & VLM Debounce)
      ┌────┴────────────────────────┐
      ▼                             ▼
 `engine.js` (Math)          `models/` (Validation)
      └────┬────────────────────────┘
           │
           ▼
[WebSocket Broadcast to Meta Glasses HUD]
```
