# Feature backlog: stubs, half-built and removed features

Features that were removed or left inactive during the AI Studio cleanup, plus what the code looked
like it was trying to do. For each one, decide whether to write real requirements or drop it.

Status key: **Removed** (code deleted; see the commit to recover it) · **Inactive** (code still
present but does nothing useful) · **Partial** (works, but less than the UI promises)

## Accounts and membership

- **Self-service membership tiers** (Removed, security). The profile screen let anyone click
  Standard / Pro / Admin to switch instantly, and registration let you pick Pro. Tier cards are still
  shown, read-only.
  - *Seed of:* a real upgrade path to Pro, most likely a payment flow (e.g. Stripe) where a webhook
    sets the role server-side.
- **Demo personas** (Removed, security). A "Fast Demo" tab logged you in as a fake Admin, Pro or
  Standard user without an account, for trying out each tier.
  - *Seed of:* a guided demo or tour, or seeded test accounts that only exist in a dev/emulator setup.
- **Seeded users in the admin console** (Removed). When the user list was empty, the admin panel wrote
  three fictional users into the real database.
  - *Seed of:* nothing needed in production. Test data belongs in the emulator.
- **Tier limits** (Partial). The UI advertises Standard = "50-mile radius, 5 saved lots" and
  Pro = "150+ mi radius, unlimited watchlist, CSV export, bid notes".
  - Enforced: the radius options above 50 mi and CSV export are locked for non-Pro users, in the
    browser only.
  - Not enforced: the 5-lot watchlist limit doesn't exist in code.
  - *Decide:* what the tiers really are, then enforce limits in Firestore rules or on the server,
    not only in the UI.
- **Admin role bootstrap** (Needs a decision). The hardcoded "this email is always admin" check was
  removed. Admins are now set in the Firebase console (set `role: "admin"` on the user's document) or
  by an existing admin in the Admin Console.
  - *Could become:* a one-off admin script, or Firebase Auth custom claims.

## Search and alerts

- **Search alerts** (Inactive). You can save a keyword with a category, radius, country and an
  on/off switch, but nothing runs them in the background or notifies you. Clicking one just runs a
  normal search, ignoring its radius and country.
  - *Seed of:* scheduled background searches that email or push-notify when new matching lots appear.
    Needs a scheduler (cron or a scheduled Cloud Function) and a record of lots already seen.
- **Preferred search radius** (Inactive). Saved on the profile screen, but the map and filters use
  a separate on-screen radius picker and never read it.
  - *Seed of:* a default radius, plus a "home location" to measure distance from. Today "radius" only
    controls how tightly lots are grouped on the map; there is no "within N miles of me" filter.
- **Fallback search without live streaming** (Removed). The app tried to fall back to a one-shot
  search if live streaming failed, but the fallback could never trigger, so the matching
  `POST /api/auctions/search` endpoint was removed too.
  - *Seed of:* nothing unless streaming turns out to be unreliable on your host.

## Admin

- **Scraper health / telemetry tab** (Removed). The Admin Console showed each source as "Active"
  with latencies, but every value was hardcoded text.
  - *Seed of:* a real status page: record per-source result counts, errors and timings for each
    search, and show recent failures (e.g. "BidSpotter returned 0 lots in the last 10 searches").
- **Announcement on/off switch** (Partial). Announcements have an `active` flag and the banner hides
  inactive ones, but nothing can set it to false; you can only delete.
  - *Seed of:* drafts, scheduled start and end dates, or pausing an announcement.

## Data sources

- **Standalone per-source API endpoints** (Removed). The server exposed nine extra endpoints the app
  never called: `/api/proxy/easylive/lots`, `/easylive/raw`, `/easylive/timed-bid`,
  `/hibid/lots`, `/hibid/lot/:lotId`, `/artisio/lots`, `/artisio/raw`, `/artisio/lot/:uuid` and
  `/api/proxy/sources`. Several passed caller-supplied options straight to the upstream sites.
  - *Seed of:* a public or partner API, a per-lot detail page, or debugging tools. If wanted, rebuild
    behind authentication.
- **BPI homepage auction scraper** (Removed). Scraped the carousel of current auctions (title,
  image, end date, location) from bpiauctions.com; never called.
  - *Seed of:* auction-level events alongside individual lots ("BPI: 3 auctions ending this week").
- **HiBid countdown parser** (Removed). Converted text like "Closes in 2d 4h" into dates; never
  called.
  - *Seed of:* more accurate HiBid end dates, which are currently guessed.
- **Live bid details from Easy Live** (Partial). The server fetches the reserve status (e.g.
  "Reserve met") and the minimum next bid for each Easy Live lot, but the UI never shows them.
  - *Seed of:* richer lot cards: reserve met/not met, next bid amount.
- **Watchlist price tracking** (Partial). A watchlist item stores the price at the moment you saved
  it plus your notes and max bid, but the price never updates.
  - *Seed of:* "outbid"/"price changed" alerts, comparing the current bid with your max bid.

## Planned ideas (not started)

- **Mobile (cellular) proxy for scraper requests.** A mobile proxy subscription is already paid for;
  the service's API and docs haven't been reviewed yet. Idea: route outgoing scraper requests
  through it so sites that block data-centre IPs keep working.
  - *To decide once the docs are read:* which sources actually need it (the JSON/Algolia APIs may
    not), how it plugs into both `fetch` and Puppeteer, IP rotation and sticky sessions, bandwidth
    cost per search, and falling back to a direct connection if the proxy is down. Proxy
    credentials belong in `.env`, never in code.
  - Also worth checking each site's terms of use before relying on it.
