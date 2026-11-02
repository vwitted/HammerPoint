# HammerPoint

Auction aggregator: an Express server scrapes UK/US auction sites and streams results to a React
(Vite) frontend. Firebase provides auth and Firestore (profiles, watchlists, alerts, announcements).

## Commands

- `npm run dev`: dev server with Vite (port from `PORT`, default 3000)
- `npm run lint`: type check (`tsc --noEmit`)
- `npm test`: unit and fixture tests; offline, no browser needed
- `npm run test:rules`: Firestore security rules tests in the emulator (needs Java)
- `npm run test:update-snapshots`: rewrite provider snapshots after an intended output change
- `npm run build` / `npm start`: production build (client to `dist/`, server to `build/`)
- `docker build -t hammerpoint .`: production image incl. Chrome; see `docs/DEPLOYMENT.md`

Before finishing any change: `npm run lint && npm test`. If you touched `firestore.rules`, also
`npm run test:rules`.

## Layout

- `server.ts`: entry point only (loads env, serves the frontend, listens)
- `server/app.ts`: `createApp()`, middleware and rate limits
- `server/routes/`: `auctions.ts` (starter lots, SSE search stream), `imageProxy.ts`
- `server/providers/`: one file per auction source
- `server/lib/`: shared helpers (`categories`, `geo`, `prices`, `text`, `cancel`, `dates`, `http2`,
  `sourceHealth`)
- `server/searchCache.ts`: per-query result cache; `server/safeFetch.ts`: SSRF-safe fetch
- `src/`: React app; pure display logic lives in `src/utils/` so it can be tested
- `tests/fixtures/providers/`: real responses recorded from each site
- `docs/FEATURE_BACKLOG.md`: removed/inactive features and planned ideas
- `docs/DEPLOYMENT.md`: Docker image and hosting notes

## Rules

Data honesty
- Never invent data. No mock or placeholder listings, and when a site doesn't give a price, date or
  location, store `null`/unknown rather than a guess. Existing guesses (default end dates, default map
  points) are known debt; don't add more.
- Prices are positive numbers or `null`, never `0`.
- Lot ids must be stable across searches (derived from the site's own lot id or URL, never the time).

Scrapers
- Every provider takes an optional `cancelSignal` and must honour it: pass it to every `fetch` via
  `withCancel`, skip Chrome fallbacks once aborted, and close browsers with `closeBrowserOnCancel`.
- Every network call needs a timeout. Providers return `[]` on failure rather than throwing.
- When a call is blocked, times out or fails, also note it with `lib/sourceHealth.ts` (`noteResponse`,
  `noteFailure`, `noteChallengePage`) so the search shows why a source came back empty. If a fallback
  then succeeds, don't report the first attempt.
- Don't add a provider-level cache; results are cached in `SearchCache` in the routes.
- Easy Live's bid endpoint answers HTTP/1.1 (Node's `fetch`) with a Cloudflare challenge but serves
  HTTP/2, so bid lookups fall back to `lib/http2.ts` when they see `cf-mitigated: challenge`.
- Classification and location matching use whole words (see `lib/categories.ts`, `lib/geo.ts`),
  never `includes()` on substrings.

Tests
- Any parser or normalizer change needs a fixture test in `tests/providers.test.ts` (or
  `atg.test.ts`). Tests must import the real code; never copy logic into a test.
- If snapshots change, check the diff is what you intended before running
  `npm run test:update-snapshots`, and say in the commit what changed.
- Known bugs are recorded as `{ todo: "..." }` tests. When you fix one, remove the `todo`.
- New fixtures: record real responses, trim them, and confirm the trimmed version produces the same
  lots as the full recording. Tests must never reach the network or launch Chrome.

Security
- Users can never change their own `role`. Roles are set by admins only; enforce it in
  `firestore.rules` and cover it in `tests/rules/`, not just in the UI.
- Any server-side fetch of a user-supplied URL goes through `fetchPublicUrl` (`safeFetch.ts`).
- New expensive routes (anything that scrapes) get a rate limiter.
- Secrets go in `.env` (see `.env.example`); never in code. The Maps key is public by design.

Scope
- Don't remove features or add new ones beyond the request. If you find dead or half-built code,
  note it in `docs/FEATURE_BACKLOG.md` instead of deleting or "finishing" it.
- The map is due to be redesigned; avoid investing in map-specific code.
