# Cooking Buddy server

Backend for Cooking Buddy on Meta Ray-Ban Display glasses. It serves the glasses web app
and uses Gemini to write recipes, answer questions about a recipe and edit it on request.
It has no built-in recipes and is stateless: the recipes the AI wrote and the screen state
live in the app (`app/src/recipeStore.ts`, `app/src/cookingState.ts`), which sends the
whole recipe with every request. The glasses app stays thin so a future native
app can call the same endpoints (see the repo's `CLAUDE.md`). For running the whole project
and deploying, see the [root README](../README.md).

Plain Node (`node:http`), ESM, no framework. Validation with Zod. Dependencies: `zod` and
`@google/genai`.

---

## Run it

Needs **Node 24+** (`engines` in `package.json`; the Docker image uses `node:24`). With nvm,
`nvm install && nvm use` in the repo root picks it up from `.nvmrc`.

```sh
npm install
npm start                    # :8787, serves ../app/dist if it's built
npm test                     # unit tests, no server and no Gemini needed
npm run smoke                # HTTP checks against a running server (needs app/dist built)
npm run smoke -- https://cook.simonnars.com
npm run ask                  # real questions through /api/ask (calls Gemini, costs ~nothing)
npm run ask -- --image photo.jpg
```

Without Google credentials the server still starts. Everything works except
`POST /api/ask` and `POST /api/recipes/generate`, which answer 503.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `PUBLIC_DIR` | `../app/dist` | Built glasses app to serve (`/srv/public` in Docker) |
| `GOOGLE_APPLICATION_CREDENTIALS` | none | Local dev: path to the service account JSON key |
| `GOOGLE_CREDENTIALS_B64` | none | Production: base64 of that JSON key (wins if both are set) |
| `GEMINI_MODEL` | `gemini-4-hydrogen` | Fallback model: `gemini-3.8-flash` |
| `GEMINI_LOCATION` | `eu` | Google Cloud location; keep it in the EU |
| `AI_BACKUP_AFTER_MS` | `3500` | When to send the backup request (`withBackup`); for testing only |

---

## Directory tree

```text
server/
├── ai/                # Everything that calls Gemini
│   ├── gemini.js      # Shared client: credentials, EU location, warm-up, /api/status info
│   ├── answer.js      # /api/ask: answer, or edit the recipe when the cook asks
│   ├── generate.js    # /api/recipes/generate: write a classic recipe for a named dish
│   └── recipeFormat.js # Recipe JSON schema and writing rules shared by both
├── models/
│   └── domain.js      # Recipe, ingredient and step schemas (Zod), AI drafts, toRecipe()
├── fixtures/          # A fixed test recipe for npm test and npm run ask (not served)
├── scaling.js         # Pure functions: scale to servings, metric/imperial display amounts
├── ask.js             # POST /api/ask: request schema, then ai/answer.js and toRecipe()
├── generate.js        # POST /api/recipes/generate: request schema, then ai/generate.js
├── http.js            # readJsonRequest(), sendJson, clientIp, per-IP rate limiter
├── server.js          # HTTP server: routes, static app files, /up health check
├── unit.test.js       # npm test: test recipe, scaling, prompts, AI drafts, request validation
├── smoke.js           # npm run smoke: HTTP checks against a running server
├── ask-check.js       # npm run ask: real questions through /api/ask (calls Gemini)
└── package.json
```

---

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /up` | Health check for Kamal and Docker, answers `OK` |
| `GET /api/status` | `{ ok, ai: { configured, model, location, last_warm_up } }`. Free: never calls the model |
| `POST /api/ask` | `{ recipe, question, step_index?, servings?, image? }` → `{ answer, model, ms }`, plus `{ recipe, change_summary }` when it changed the recipe |
| `POST /api/recipes/generate` | `{ request: "carbonara for 4", servings? }` → `{ recipe, model, ms }`: a classic recipe with `origin: "generated"`. Not stored on the server. 10 requests per minute per IP |
| `GET /*` | The built glasses app; unknown paths without an extension get `index.html`, missing assets 404. `/test.html` is a browser page for trying `/api/ask` |

All JSON responses are sent with `cache-control: no-store`. Errors are `{ error }`.

### `POST /api/ask` in detail

- `recipe`: the full recipe object (the client sends it, so the server needs no session).
- `step_index`: optional. Leave it out for a question about the whole recipe; the glasses
  web app always does, since the cook sees all the steps at once. When given, it's 0-based,
  must be less than `recipe.steps.length`, and the answer focuses on that step.
- `question`: 1–500 characters after trimming.
- `servings`: integer from 1 to 100, default `recipe.base_servings`.
- `image`: `{ mime_type: "image/jpeg" | "image/png" | "image/webp", data }`, where `data` is
  plain base64 with no `data:` prefix. Shrink photos to about 1 megapixel first. The body
  limit is 3 MB.

| Status | When |
| --- | --- |
| 200 | `{ answer, model, ms }`: 1–2 plain-text sentences, at most about 30 words. When the cook's words changed the recipe ("I don't have buttermilk"), also `recipe` (the whole updated recipe, same `recipe_id`, the change appended to `edits`) and `change_summary` |
| 400 | Not JSON, or fails validation (`issues: [{ path, message }]`) |
| 405 / 415 / 413 | Not POST / not `application/json` / body over 3 MB |
| 429 | More than 30 requests in a minute from one client IP (`cf-connecting-ip`) |
| 502 | Gemini failed or timed out: each attempt gets 20 s, and a backup request starts after 10 s (an edit takes up to ~8.5 s) or as soon as the first fails |
| 503 | No Google credentials configured |

`POST /api/recipes/generate` answers the same way, with a 16 KB body limit, 10 requests
a minute per IP, and a backup request after 15 s (30 s per attempt).

---

## File responsibilities

### `models/domain.js` (recipe schema)

The **Zod** recipe schema, used for requests and AI output: base metric units
(`g`, `ml`, `unit`), substitutes, optional ingredients, short step instructions, visual
cues, timers, `origin` (`generated`; `library` only on recipes saved before the built-in
recipes were removed) and `edits`. Also `RecipeDraftSchema` (a
recipe as the AI writes it, without ids) and `toRecipe()`, which turns a draft into a valid
Recipe.

### `scaling.js` (servings and units)

Pure functions with no side effects: `scaleIngredients()` multiplies amounts by
servings / base servings, and `convertUnitSystem()` turns them into display amounts in
metric or imperial with practical cooking rounding (oz/lb for grams; tsp, tbsp and
cups in measuring-set fractions for millilitres; counts unchanged), the same rules as
`app/src/units.ts`. The answer prompt uses it with `unit_system` from `/api/ask`. The answer prompt uses it, and so should a future
"scale servings" feature.

### `ai/` (everything that calls Gemini)

One shared client, one file per AI task. Gemini handles both text and images, so camera
step detection and any LLM command parsing would be new files here using the
same client. Speech-to-text is not here: the device transcribes, and the server only gets
text.

- **`gemini.js`**: creates the client from the service account key (EU location, 20 s
  timeout), returns `null` without credentials, warms up the Google token and connection at
  startup and every 15 minutes with the free `countTokens` call (a cold first question took
  about 8 s instead of about 2 s), and reports `aiStatus()` for `/api/status`. Credentials
  and region details are in `CLAUDE.md` under "AI". `withBackup(call)` guards against
  Gemini's occasional 7–18 s stalls: if a call hasn't finished after `backupAfterMs` (3.5 s by
  default; /api/ask uses 10 s and new recipes 15 s, since they write whole recipes) or fails, it
  starts one backup call and uses whichever finishes first. Use it for every user-facing
  AI call.
- **`answer.js`**: `answerQuestion()` builds the prompt (`recipeContext()`: amounts scaled to
  the requested servings with `scaling.js`, substitutes, optional ingredients, earlier edits, all
  steps, the current step marked only when the request has `step_index`, plus the recipe as JSON) and asks Gemini with reasoning level `LOW` for structured
  JSON: a 1–2 sentence `answer`, and, only when the cook asked for a change, a
  `change_summary` and the whole updated recipe as a draft. `ask.js` turns that draft into a
  Recipe with `toRecipe()`, keeping the recipe id and the ids of unchanged ingredients. It
  logs the time and token counts of every answer, so `kamal app logs` shows latency.
- **`generate.js`**: `generateRecipe()` asks Gemini for the classic version of a named dish
  as a draft and returns a Recipe with `origin: "generated"` and a `gen-<slug>-<random>` id.
- **`recipeFormat.js`**: the JSON Schema Gemini writes recipes in, the shared writing rules
  (metric units, at most 15 words a step, timers), and `recipeToDraft()`. No
  `minItems`/`maxItems`: with them on both lists Gemini rejects the schema.

### `ask.js` and `generate.js` (the AI endpoints)

Each holds its request schema (`AskRequestSchema`, `GenerateRequestSchema`), rate limit
and backup timings, reads the request with `readJsonRequest()`, calls its `ai/` file inside
`withBackup()`, and answers 200, 502 or 503. `ask.js` also turns an edited draft into a
Recipe with `toRecipe()`, inside the call, so an invalid edit counts as a failed attempt.

### `http.js` (shared helpers)

`readJsonRequest()` does the front half of every JSON POST endpoint: method, content type,
size, rate limit, parsing and Zod validation, answering 405 / 415 / 413 / 429 / 400 itself.
Also `sendJson()`, `readBody()`, `clientIp()` (Cloudflare's `cf-connecting-ip` first),
`createRateLimiter()` and `failureReason()` for logging failed AI calls.

### `server.js` (HTTP)

Routes `/api/*`, serves the built app (long caching for fingerprinted `/assets/`,
`no-cache` for everything else), falls back to `index.html` for client routes, and shuts
down cleanly on SIGTERM.
