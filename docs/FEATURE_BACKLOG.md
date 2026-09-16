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
