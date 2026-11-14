# Cooking Buddy server

Backend for Cooking Buddy on Meta Ray-Ban Display glasses. It serves the glasses web app,
holds the recipes and the recipe logic (scaling, unit conversion, step state), and answers
questions about the current step with Gemini. The glasses app stays thin so a future native
app can call the same endpoints (see the repo's `CLAUDE.md`).

Plain Node (`node:http`), ESM, no framework. Validation with Zod.

---

## Directory tree

```text
server/
├── models/
│   ├── domain.js      # Recipe, ingredient and step schemas (Zod)
│   ├── protocol.js    # HUD sync / control message schemas (Zod)
│   ├── vision.js      # Step classification result schema for camera frames (Zod, not used yet)
│   └── index.js       # Barrel export for models
├── recipes/           # Recipe JSON files, validated against RecipeSchema at startup
├── engine.js          # Pure math: scaling, unit conversion, HUD formatting
├── session.js         # In-memory cooking session state machine + pub/sub
├── recipes.js         # Loads recipes/, GET /api/recipes and /api/recipes/:id
├── ask.js             # POST /api/ask: Gemini answers, plus the AI status and warm-up
├── server.js          # HTTP server: routes, static app files, /up health check
├── unit.test.js       # npm test: engine, session, recipes and request validation
├── smoke.js           # npm run smoke: HTTP checks against a running server
├── ask-check.js       # npm run ask: real questions through /api/ask (calls Gemini)
└── package.json
```

---

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /up` | Health check for Kamal and Docker |
| `GET /api/status` | Whether the AI is configured, model, region, last warm-up (free) |
| `GET /api/recipes` | List of recipes |
| `GET /api/recipes/:id` | One recipe (matches `RecipeSchema`) |
| `POST /api/ask` | `{ recipe, step_index, question, servings?, image? }` → `{ answer, model, ms }` |
| `GET /*` | The built glasses app (`app/dist`); `/test.html` is a browser page for trying `/api/ask` |

---

## File responsibilities

### `models/` (data contracts)

Runtime schemas in **Zod** for payloads entering or leaving the backend.

- **`domain.js`**: normalized recipes: base metric units (`g`, `ml`, `unit`), substitutions,
  short step instructions, visual cues and timers.
- **`protocol.js`**: HUD sync and control message shapes.
- **`vision.js`**: result shape for classifying a camera frame into a recipe step (for the
  native app, which gets camera access).

### `engine.js` (stateless computation)

Pure functions with no side effects: `scaleIngredients()` and `convertUnitSystem()` (metric
or imperial, with practical cooking rounding), plus `RecipeEngine`, which wraps a recipe
with servings, units and the active step and produces the HUD state.

### `session.js` (session state machine)

In-memory cooking sessions: current step, scale factor, unit system, completed steps and
recent camera classifications. `getView()` builds the HUD view with `engine.js`. A debounce
gate auto-advances only after 2 consecutive frames with confidence >= 0.8. Subscribers are
notified on every change, and idle sessions are removed after 4 hours. Not wired to any
endpoint yet.

### `ask.js` (AI answers)

Validates the request, builds a prompt from the recipe (amounts scaled to the requested
servings, substitutes, the current step marked) and asks Gemini 4 Hydrogen on Google
Cloud's EU region. Rate-limited to 30 requests per minute per IP. Credentials and region
details are in `CLAUDE.md` under "AI".

### `server.js` (HTTP)

Routes `/api/*`, serves the built app with long caching for fingerprinted assets, and falls
back to `index.html` for client routes.
