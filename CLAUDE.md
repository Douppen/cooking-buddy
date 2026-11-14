# Cooking Buddy

Hackathon project: hands-free recipe steps and answers on **Meta Ray-Ban Display** glasses,
driven by the **Meta Neural Band**. The user is cooking at home with messy hands, glasses on,
phone out of reach (but nearby: the glasses need their paired phone either way).

Live at https://cook.simonnars.com.

## The prototype: "Glance + ask"

Keep the glasses UI simple: plain text lists you scroll, not a phone screen on your face.

- **Home** (`/`): one field at the bottom for a dish or food talk. A fast EU call
  sorts it first (`POST /api/home`), then the app fetches a dish's recipe (`POST
  /api/recipes/generate`), showing "Getting lasagna, 4 servings…" meanwhile. Only a named dish ("lasagna",
  "the second one" after ideas, or "yes, do it" when one dish was offered) fetches a recipe; a kind of dish ("a simple middle
  eastern recipe") is food talk. A dish: the AI finds a real recipe on
  the web, converts it, and cooking starts. Food talk ("ideas for a light dinner", "what can
  I make with rice and eggs?"): a short answer (at most 30 words), read aloud, with up to 3
  dishes as rows ("Get the recipe") that ask for that recipe when pinched. Follow-ups work
  ("the second one"): the last 10 turns go along until a recipe opens. While an answer
  shows, the units switch, servings box and last-recipe row step aside so it fits 600×600.
  Anything not about food: "Let's keep it to food…". There is no recipe picker and no built-in recipes. Above the field, only
  the **most recent recipe** as one row ("Back to your recipe"), so a cook who left cooking
  by accident (system Back) pinches it to return. A new dish simply replaces it on top.
  Older recipes stay saved on the device (for a "previous recipes" list later) but aren't shown.
- **Servings:** a box at the bottom of home, styled like a list row ("‹ 2 servings ›",
  "Swipe left or right to change"), 2 by default each time home opens, 1 to 8. Only while
  it has focus, **swipe right** adds one and **swipe left** takes one away. Saying a number
  with the dish ("lasagna for 4", "yes, for six people") sets the box to it before the recipe
  is fetched, so the cook sees it change. The new recipe is scaled to it (see "Servings are the app's job" below). Focus order on home:
  last recipe, dish field, units switch, voice switch, servings.
- **Voice on or off:** a "Voice" switch next to "Imperial units" (same row, kept on the
  device, on by default). On: answers are read aloud by a British chef voice from
  `POST /api/speak` (MP3, EU). The answer's text waits for its voice (~2 s, "Thinking…"
  meanwhile) and shows the moment it starts, at most 4 s later; if the voice fails, the
  device's own voice (`speechSynthesis`) reads it. Off: answers on home and while cooking
  are text only (`speak()` in `app/src/speech.ts` does nothing).
- **Then cook** (`/cook/:id`): two views side by side. It opens on the **ingredients**
  (title, servings, one line per ingredient). **Swipe right** (`next`) shows **all the
  steps** in one list; swiping right again does nothing. **Swipe left** (`prev`) goes back
  to the ingredients, and no further. Swipe up/down scrolls the list; past its end, focus
  moves to the ask field.
- **Asking (home and cooking, `app/src/AskField.tsx`):** pinch the field to speak (the
  glasses' composer: dictation, handwriting or keyboard). It hands back the whole text with
  no Enter, so focus then moves to the **➤ send button** by itself: pinch to send, or swipe
  left to the field and pinch to say it again. The line above the field says so while
  there's text. Only the index pinch (Enter) and swipes (arrows) reach a web app; the
  middle pinch is the system's Back. The cooking field sits under both views. Questions are about **the whole recipe**, not one step: the
  app sends no `step_index` to `/api/ask`.
- **The answer shows above the ask field** on either view for 15 s and is read aloud.
- **Timers by voice** ("set a timer for 10 minutes", "time the pasta", "start the timer for
  this step", "stop the timer"): `/api/ask` returns `timer` (`{ action: "start", seconds,
  label }` or `{ action: "cancel", label }`), minutes from the cook's words or the step's
  time. The app runs it (`app/src/timers.ts`): one line per timer under the lists, with the
  toolkit's timer icon, counting down every second: "Pasta · 7:58 · done 15:42" (the cook
  asked for a live countdown; `TimerDock.tsx` redraws only that row). At most 3; the
  same label restarts it. When one ends: a short two-tone ping (Web Audio, `app/src/chime.ts`,
  plays even with Voice off), then "Time's up! Pasta timer is done." said, and shown under
  TIMER for 6 s.
  Timers live on the cooking screen only (leaving it stops them). On home, a timer request
  gets "Timers work once a recipe is open…" (not the not-food message).
- **A command ("swap the butter for oil", "leave out the carrots", "make it vegetarian") or
  "I don't have X" edits the recipe**. A question or wish ("can I swap the butter?", "do I
  need eggs?", "I'm watching my blood pressure, can I…") only gets an answer that suggests
  the change; "yes, do it" then makes it (the app sends the last question and answer as
  `previous`). An edit: the AI makes the smallest change, gives swapped-in
  ingredients their own amounts, and rewrites the affected steps (names, amounts, times).
  There's no AI answer then: the app only shows and says "Recipe updated" (~3–8 s; the
  server's `answer` is the change summary, "Swapped butter for olive oil.", for logs and
  clients that want it). "Make it for 6", "double it" or "halve it" changes only the
  recipe's `servings` (1–8, no rewrite, ~1 s), and both lists scale. Both lists show the new recipe; the cook stays on the
  same view.
- **Metric or imperial** (a small "Imperial units" switch on `/` between the dish field and the servings, label and toggle only, no row box; kept on the device): every recipe
  stays stored in metric; the app shows amounts in oz/lb/tsp/tbsp/cups and converts °C,
  g, ml and cm in step text (`app/src/units.ts`). `/api/ask` gets `unit_system` so answers
  match. Small amounts (salt, spices, leaveners, extracts, and any liquid under 50 ml, e.g. 15 ml oil → 1 tbsp) are stored in `tsp`/`tbsp`, or
  `pinch` for 1–2 pinches only, and look the same in both systems: tsp in quarters, tbsp in
  halves, 3+ tsp shown as tbsp, more than 2 pinches as tsp. `spoons()` in `app/src/units.ts`
  and `server/scaling.js` share these rules: change both together.
- **Recipes live on the device** (`localStorage`, see `app/src/recipeStore.ts`), not on the
  server. An edit replaces the saved recipe under the same id.

Nice to have, only once that works: undoing an edit.
Keep them as plain text in the two lists.

App code: `main.tsx` (router), `RecipesContext.tsx` (the recipes saved on this device, kept
across screens), `recipeStore.ts` (device storage), `pages/` (one file per screen),
`Cooking.tsx` (the cooking screen), `cookingState.ts` (view, ask and edit logic, free of
React: the spec for the native port).

## The plan: web app now, native app later

- **Now:** a Meta Ray-Ban Display **Web App** (React + Meta UI Toolkit), the fastest way to
  build for the hackathon.
- **Later:** an agent ports it to a **native app** built on Meta's Wearables Device Access
  Toolkit: an iOS (Swift) / Android (Kotlin) phone app that drives the glasses' display,
  camera, microphone and speakers over Bluetooth. The main reason is camera access, which
  web apps don't get.

Build everything so that port is cheap:

- **Brains on the server, thin client.** Writing and editing recipes (structured JSON),
  scaling servings and AI answers live in `server/` behind plain JSON HTTP endpoints under
  `/api`. The native app will call the same endpoints. The web app only renders the current
  screen, keeps the cook's recipes, and sends user actions. `/api/ask` takes the recipe and
  the question (and optionally a step), and returns a short answer (plus the whole updated
  recipe when it changed it).
- **Design screens for the native display.** Native apps re-send the whole screen on
  every update over Bluetooth (no partial updates), at 600×600, built from text, images,
  buttons, lists and flex boxes. So: two plain views per recipe (ingredients, steps),
  simple layouts, small images, and nothing that updates every second (show "done at 15:42" or update once a minute
  rather than a ticking countdown).
- **Input as actions, not keys.** On the web, `ArrowLeft` / `ArrowRight` / `Enter` map to
  `prev` / `next` / `select` (`ArrowUp` / `ArrowDown` scroll, through the toolkit's focus
  navigation). Native touchpad and Neural Band events will map to the same
  actions. Keep step and state logic in plain TypeScript, free of React and the DOM, so it
  reads like a spec for the Swift/Kotlin version.
- **Voice is text in, text out.** The web app gets text from the glasses' dictation
  composer; the native app will transcribe mic audio on the phone before calling the same
  `/api/ask`. Audio files never go to the AI.
- **No web-only tricks in core flows** (custom animations, canvas UIs, heavy CSS effects).
  They have no native equivalent.
- Record anything web-specific that a port must rethink under "Porting notes" below.

## AI (`/api/ask`, `/api/recipes/generate`)

- **Gemini on Google Cloud, EU only, except recipe search.** One model for everything,
  `gemini-3.5-flash-lite`, the fastest (set `GEMINI_MODEL`; the previous model was
  `gemini-4-hydrogen`, smarter but slower), location `eu` (the EU multi-region
  endpoint `aiplatform.eu.rep.googleapis.com`), reasoning level `LOW` for speed. Project
  `junction-2026-514714`.
- **The exception, on purpose:** finding a recipe on the web uses Gemini's Google Search
  tool, which Google keeps out of its data residency commitment on every endpoint
  ("Supported capabilities" in the Agent Platform docs) and logs for up to 3 days. This is a
  hackathon project, not production, so we accept that for recipe search only: it runs on
  the `global` endpoint (`GEMINI_SEARCH_LOCATION`) with the same model (`GEMINI_SEARCH_MODEL` can
  override it). The prompt names no example website, so it doesn't favour one.
  `/api/ask` and the fallback recipe writer stay in the EU. Don't "fix" this back without a replacement for web search.
- **Auth is a service account key, not an API key.** Agent Platform API keys only reach the
  global endpoint, so they can't keep processing in the EU. The service account is
  `cooking-buddy@junction-2026-514714.iam.gserviceaccount.com` with the "Agent Platform
  User" role. In production its JSON key arrives base64-encoded as `GOOGLE_CREDENTIALS_B64`
  (base64 because Kamal's env files double backslashes and would break the JSON). Locally,
  point `GOOGLE_APPLICATION_CREDENTIALS` at the JSON key file.
- **Request:** `{ recipe, question, step_index?, servings?, unit_system?, image? }`, where `recipe` matches
  `RecipeSchema` in `server/models/domain.js` and `image` is `{ mime_type, data }` with
  base64 data (JPEG/PNG/WebP; shrink photos to about 1 megapixel first). Without
  `step_index` the answer covers the whole recipe; the web app never sends one. **Response:**
  `{ answer, model, ms }`, plus `{ recipe, change_summary }` when the cook's words changed
  the recipe. Answers are 1–2 sentences, plain text, meant to be shown and spoken.
- **The home box, two endpoints:** `POST /api/home` with `{ request, history? }` sorts what
  the cook said (EU, no search, `sortRequest()` in `server/ai/generate.js`): `{ kind:
  "answer", answer, suggestions }` for food talk, or `{ kind: "dish", dish, servings }` for a
  named dish, with the servings the cook said (1–8, or null). The app then sends `{ dish }`
  to `POST /api/recipes/generate`, which returns `{ kind: "recipe", recipe, found_online,
  model, ms }`. Two calls so home can show the dish and servings while the recipe comes. Gemini searches the web, picks one well-reviewed
  recipe and rewrites it in our format ; `recipe.source` is the website it used,
  e.g. `{ name: "seriouseats.com" }`. There's no link: with our JSON output format Google
  returns its search queries but not the pages, so `found_online` means Google reported a
  search. If the search fails, Gemini writes the classic version itself (`found_online:
  false`, `source: null`).
  Requests that aren't about food ("write me a poem", gibberish, inedible things) get `422
  { error, not_a_recipe: true }` from `/api/home`, before any search, and the app shows the server's message. `GET /api/status` shows how the last
  search went. The server stores nothing; the device
  keeps the recipe and sends it to `/api/ask` like any recipe. Edits keep the source.
- **Servings are the app's job, and what the cook says wins:** "lasagna for 3" makes
  `/api/home` return `servings: 3`, and the app sets its servings box to 3 (otherwise the
  box's value is used). The recipe search never gets a number: a new recipe keeps its
  source's servings (`base_servings`). The servings the cook picked on home are saved on the recipe as `servings` (kept through
  edits). The cooking screen scales the ingredient list and the amounts in step text
  (`scaleAmountsInText()`: numbers with a unit or a counted ingredient, not times or sizes)
  with the same tidy rounding as stored amounts (`cleanAmount()`, spoons under 50 ml), in
  `app/src/units.ts` and `server/scaling.js`. `/api/ask` answers for `recipe.servings`.
- **Counts:** counted ingredients (`base_unit: "unit"`) have `whole`: true for things that
  only come whole (eggs, garlic cloves, bay leaves; set by the AI, and always for a fixed
  list), shown as whole numbers, at least 1. Others (lime, onion) round to halves, at
  least ½. Same in the list, scaled step text and answers.
- **Recipe format for the AI:** Gemini writes a "draft" (`RecipeDraftSchema`: no ids or step
  indexes) as structured JSON (`server/ai/recipeFormat.js`), and `toRecipe()` in
  `models/domain.js` turns it into a valid `Recipe`. Ingredients have `optional`; recipes
  have `origin` (`generated`; `library` only on recipes saved before the built-in ones were
  removed) and `edits` (short notes on AI changes). Don't put
  `minItems`/`maxItems` in the Gemini schema: on both lists together Gemini rejects it as
  INVALID_ARGUMENT; Zod enforces list lengths instead.
- Typical times (measured on `gemini-4-hydrogen`; flash-lite should be faster): a question 1.5–2.5 s, an edit 6–8.5 s (Gemini rewrites the whole recipe),
  a new recipe 6–8 s. The server warms up its Google token and connection at startup and
  every 15 minutes, because a cold first call took about 8 s. A backup request
  (`withBackup` in `server/ai/gemini.js`) covers Gemini's occasional stalls: after 10 s for
  `/api/ask`, 15 s for a new recipe.
- **Spoken answers (`POST /api/speak`, `server/ai/speech.js`):** `{ text }` → MP3. The
  voice is a character: Gemini's speech model `gemini-3.8-flash-lite-tts` (`TTS_MODEL`) on
  the EU endpoint, prebuilt voice `Algenib` (`TTS_VOICE`, picked by ear) and a style
  (`TTS_STYLE`): "an energetic, passionate British chef, warm but a bit cheeky, with a deep
  bass voice". The style goes in `speechMetadata.style`, never in the text (the model reads
  the text word for word). No real person's voice: Google only clones a voice with its
  owner's recorded consent. The server streams Gemini's raw PCM (faster than one call:
  ~1.8 s for a 30-word answer) and encodes it to MP3 (`@breezystack/lamejs`, ~25-35 KB).
  If Gemini fails or takes over 6 s, Cloud Text-to-Speech reads it with the plain British
  voice `en-GB-Chirp3-HD-Charon` (`TTS_FALLBACK_VOICE`, `eu-texttospeech.googleapis.com`,
  ~1 s; the Cloud Text-to-Speech API is enabled on the project for this). The response
  header `x-voice` says which (`gemini` or `fallback`); `GET /api/status` shows how the
  last one went (`speech.last`).
- The endpoints are public and every call costs money: `/api/ask` and `/api/home` are
  limited to 30 requests, `/api/speak` to 40, and `/api/recipes/generate` to 20 per minute per client IP (Cloudflare's
  `cf-connecting-ip`).

## Layout

```
app/      Glasses web app: React + Vite + @wearables-ui-toolkit/mrbd. Built to static files.
server/   Node server: serves app/dist, health at /up, API under /api (zod for validation).
          ask.js = /api/ask, home.js = /api/home, generate.js = /api/recipes/generate, speak.js = /api/speak, http.js = shared request
          handling, ai/ = everything that calls Gemini (gemini.js = shared client, warm-up,
          withBackup; one file per task), models/domain.js = recipe schema, scaling.js =
          servings and units, fixtures/ = a test recipe for npm test and npm run ask.
          Stateless, no recipes: the app keeps the cook's recipes (server/README.md).
config/   Kamal deploy config.   .kamal/secrets reads secrets from the environment.
.github/  Deploy workflow and the pinned SSH host key of the server.
```

## Commands

```sh
cd server && npm install && npm start   # :8787, serves app/dist if built
cd app && npm run dev           # :5173, proxies /api to :8787
cd app && npm run build         # typecheck + production build
cd app && npm test              # unit conversion tests (node --test, no browser)
cd server && npm run smoke      # smoke test; add -- https://cook.simonnars.com for prod
cd server && npm test           # unit tests: scaling, prompts, AI drafts, validation
cd server && npm run ask        # real questions through /api/ask (calls Gemini, costs ~nothing)
                                #   add -- https://cook.simonnars.com, or --image photo.jpg
```

Testing the AI in a browser (also in production): open `/test.html`
(https://cook.simonnars.com/test.html). It's a plain dev page, not glasses UI: write a recipe
or pick one saved in this browser (same storage as the app), ask about the whole recipe or
one step, optionally add a phone photo, and see the answer and timings. `GET /api/status` shows whether Gemini is configured and reachable without
spending anything.

To run `/api/ask` locally: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm start`.

Deploy = push to `main`. It's live in about 75 s. Markdown-only pushes don't deploy.
There is no CI test job: the Docker build fails on a broken app build, and kamal-proxy only
switches over when `/up` is healthy. Run the smoke test locally when you change the server.

## Glasses web app rules

- Use the `meta-wearables-webapp` plugin skills (enabled in `.claude/settings.json`):
  `ai-glasses-webapp-build` + `ai-glasses-webapp-ui` for UI work, `ai-glasses-webapp-device`
  for Neural Band and dictation input, `ai-glasses-webapp-test` before handing off.
- Never use `ai-glasses-webapp-publish` or Vercel. Production is our own server.
- Use UI Toolkit components and keep the toolkit structure validator passing.
- The display is additive: black is transparent, so keep the dark window background.

## Deploy and the shared server

- Kamal deploys one container to a Hetzner VPS shared with two other apps, behind one
  shared kamal-proxy that routes by hostname.
- **Never** run `kamal remove`, `kamal setup` or `kamal proxy reboot` from this repo. They
  touch the shared proxy and take the other apps down too.
- Deploys swap the container. Don't deploy during the demo.
- `cook.simonnars.com` must stay **Proxied** in Cloudflare (the server only accepts web
  traffic from Cloudflare), with SSL mode Full (strict).
- Container memory is capped at 256 MB.
- Secrets live only in GitHub repo secrets (`KAMAL_SSH_PRIVATE_KEY`,
  `TLS_CERTIFICATE_PEM`, `TLS_PRIVATE_KEY_PEM`, `GOOGLE_CREDENTIALS_B64`). Never commit
  secrets: Google automatically disables service account keys it finds in public code.

## Porting notes

- Timers count down every second on the web (`TimerDock.tsx`), the one exception to "nothing
  that updates every second". Native re-sends the whole screen per update over Bluetooth:
  measure whether 1 s ticks are affordable there, else tick every 5–10 s or once a minute,
  keeping "done 15:42" as the exact time.
- The ask field (`AskField.tsx`): the web app gets no microphone, only the system composer,
  so sending is a separate ➤ target that takes focus once the text is in. Native (with the
  phone's speech recognition) can make it one record button: pinch to record, pinch to send.
- Home (`app/src/pages/HomePage.tsx`, 2026-11-14) is built to fit 600×600 with no scrolling:
  last recipe row, dish field, units switch, servings box. The toolkit's slider `ListItem`
  hides its title, so the servings box is a toolkit `Container` that takes left/right
  itself while focused. Native: a focusable row that handles left/right swipes. The units
  and voice switches are toolkit `Switch`es in `Container`s whose surface only shows when
  focused. Speech is MP3 from `/api/speak` in an `<audio>` element, falling back to the
  browser's `speechSynthesis`; native plays the same MP3 (fallback: the phone's TTS).
- The cooking screen (since 2026-11-14) is two views: ingredients, then all steps, each a
  vertical list. On the web, the toolkit `Pager` slides between them and its focus
  navigation scrolls a focused `ScrollView` about 60 px per up/down swipe, then moves focus
  to the ask field. Native: two screens switched by swipe left/right, each a scrolling list
  (check how far the native list scrolls per swipe); the slide is optional. The earlier
  one-step HUD with a step counter is in commit `cbecf34` (`app/src/cookingState.ts`).
- Built-in library recipes (`server/recipes/*.json`, `GET /api/recipes[/:id]`, the "Your
  version" label) were removed on 2026-11-14: every recipe is AI-written and kept on the
  device. To bring back a curated library, start from `git show cbecf34:server/recipes.js`.

- A WebSocket relay with rooms (glasses ↔ phone camera page) was removed on 2026-11-14:
  the native phone app makes it unnecessary. If a live demo screen for judges or a remote
  debug console is ever needed, restore it from git history: `git log -- app/src/relay.ts` (last version in commit `ff8963c`).
- Server-side step state was removed on 2026-11-14, since the app owns the step index
  (`app/src/cookingState.ts`): `server/session.js` (sessions, pub/sub, auto-advance after 2
  confident camera frames), `RecipeEngine` in `server/engine.js`, and the unused schemas
  `models/protocol.js` and `models/vision.js` (camera frame → step classification). For
  camera step detection in the native app, start from `git show 441e5ea:server/session.js`
  and `git show 441e5ea:server/models/vision.js`.
