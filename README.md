# Sub for Santa — Platform

The code for a holiday gift-matching drive for a nonprofit. The coordinator
sends referral links; families fill in one form; the coordinator approves;
donors browse anonymised listings, sponsor a household, and drop gifts at a
central point. The design reference is [docs/handbook/](docs/handbook/).

**Requirements don't start here.** They start as Stories in
[secret-santa-product](https://github.com/Alexleop33/secret-santa-product).
During the October 2026 build they were mirrored on this fork so every PR
had an issue to close; [docs/build-log.md](docs/build-log.md) is the
slice-by-slice record and says what would move back upstream.

## Ground rules

- **No family PII.** No names, addresses, or phone numbers for referred
  households — not in the DB, URLs, logs, or CSV exports. A household is a
  reference code and a story. No photos, ever. The one exception, decided
  and dated: the family's email, in its own table, deleted on rejection and
  purged after the season.
- **RLS on every table from the first migration.** Default deny. No table
  ships without a policy and a test proving denial. Where the public may see
  some columns of a row but not others, there is a view.
- **This repo is public on purpose.** Nothing in source control that would
  be embarrassing to a stranger: no real data, no secrets, no prod dumps.
  Seeds are synthetic. Sandbox and prod are separate projects with separate
  keys.
- **Never roll our own auth.** Everyone who signs in signs in with Google.
  Families never sign in; a referral link is a one-time, hashed token that
  opens one form.
- **No payments, ever.** The app never handles money. No Stripe link, no card
  data, no cash — donors buy gifts and drop them off.
- **The app must never be the single point of failure.** If it breaks in
  December, the coordinator falls back to a spreadsheet and gifts still get
  delivered. Roster CSV export is a safety feature, not a report.

## What's here

| Who | Pages | What they do |
|---|---|---|
| Anyone | `/`, `/browse.html`, `/story.html` | The landing page, the public list of live households, one family's story and wish list. No account needed. |
| A family | `/refer.html#t=…` | Opens a one-time link from the coordinator, fills in one form, gets a referral number. |
| A donor | `/signin.html`, `/story.html`, `/confirmed.html`, `/mine.html` | Signs in with Google, claims a household (one atomic claim, capped per sponsor), sees the drop-off details, ticks items, marks delivered, or releases. |
| The coordinator | `/dashboard.html`, `/queue.html`, `/links.html`, `/exceptions.html`, `/settings.html`, `/admins.html` | The console: the whole drive in one look, the approval queue with checks and a private note, referral links, exceptions and the activity log, the season's dates and rules, close-out, and who the admins are. |

Every write a donor or a family makes goes through a database function that
checks the caller; every read goes through row-level security or a view.
The pages are plain HTML, CSS and JavaScript with one stylesheet and no
build step.

## Run it

You need two things installed: **Node 22** and **Docker Desktop** (running).
No Supabase, Google or Cloudflare account.

```
git clone https://github.com/dwelch2344/secret-santa-platform
cd secret-santa-platform
npm install
npm run dev
```

The first run pulls a few Docker images, so give it a couple of minutes.
Then:

1. Open <http://localhost:3000/signin.html> and use **"Email me a sign-in
   link"**. The email doesn't go anywhere — open **Mailpit** at
   <http://127.0.0.1:54324> and click the link there.
2. Make that account the admin: `npm run make-admin -- you@example.test`
   (the same address you just used).
3. Open <http://localhost:3000/dashboard.html>. Three fake households are
   seeded; the queue has them waiting for review.
4. To see the donor side, approve one, sign out, sign in as a different
   `@example.test` address, and browse.

What `npm run dev` does, in order: checks Docker is up → `supabase start`
(Postgres, Auth, REST API, Mailpit, as containers) → `supabase db reset`
(every migration, then `supabase/seed.sql`) → `node server.js`. The database
is wiped and rebuilt on every run — that's deliberate. What you see is always
what the migrations say, and nothing you type locally can leak anywhere.

| Command | What it does |
|---|---|
| `npm run dev` | The whole app, locally. Ctrl-C stops the web server only |
| `npm run db:stop` | Stops the containers |
| `npm run make-admin -- you@example.test` | Makes a local account the admin |
| `npm test` | Unit tests (`node --test`): config routing, CSP rules for every page, CSV escaping |
| `npm run test:db` | RLS and function tests (pgTAP) against the local database — sixteen files, every table in both directions |
| `SUPABASE_TARGET=dev npm start` | Local pages against the **hosted dev** project. The exception, not the default — sign-in is Google there, and the email button won't appear |

The Supabase CLI is a pinned `devDependency`, so there is nothing to install
globally. Sign-in by email exists on the local database **only**; both hosted
projects keep it switched off and use Google.

## Environments

Your laptop runs against a database in Docker. The `dev` branch deploys to a
demo site on the sandbox Supabase project. `main` deploys to the live site
on a separate project that is never seeded and never edited by hand. The
browser picks its database from the page's hostname, and anything it doesn't
recognise goes to dev — never prod. A release is a pull request from `dev`
into `main`, and the deploy itself waits for a named reviewer. Nobody changes
the live database by hand; the one exception is written down in
[docs/break-glass.md](docs/break-glass.md), and the season-end deletion of
contact rows is a reviewed GitHub workflow, not a SQL editor. The full map,
and every console step a human has to do, is in
[docs/environments.md](docs/environments.md).

## How work arrives

```
Story  →  Epic  →  branch  →  PR into dev  →  UAT on the demo site  →  dev into main
```

One **vertical slice** at a time: schema + policy + API + UI + a test, for
ONE user action. Every PR needs a closing keyword or CI fails, and ends with
a "say it back" paragraph written for Alex.

## Stack

Decided 2026-10-11. `CLAUDE.md` carries the reasoning behind each line.

| Layer | Choice | Why |
|---|---|---|
| Front end | Plain HTML, CSS, JavaScript | No framework, no TypeScript — Alex can read every line. One stylesheet, self-hosted fonts, a strict CSP |
| Database | Postgres with row-level security | The database refuses the wrong reader, rather than the app remembering to. Functions check the caller for every write |
| Login | Google sign-in | No passwords stored. The local Docker database also accepts an emailed link, so a fresh clone can sign in. Families have no login |
| Host | Supabase, for now | Carries the session and the RLS bridge; the anon key is public, so RLS is load-bearing |
| Deploy | Cloudflare Pages, uploaded by GitHub Actions | `dev` → demo site, `main` → live site, database migrated first in the same workflow |

## Data model

Everything hangs off `campaigns` — no `organizations` table above it.

| Table | Holds | Who reads it |
|---|---|---|
| `campaigns` | name, year, the four dates, rules, drop-off details, status | public columns through `public_campaign`; the admin reads the table; donors get drop-off details through a function once they hold a claim |
| `households` | ref code, one-line summary, story, consents, status, the admin's private note, an on-behalf submitter's private reference | the admin; the public through `public_households` (live, unclaimed, open drive; story only with consent) |
| `household_members` | role from a fixed list, age, sizes — **no names** | the admin; the public and claimants through views |
| `wish_items` | one row per item, need or would-love, bought-at | same |
| `household_contacts` | email and/or phone, which to try first, and whose they are (the household's own, or the submitter's) | the admin only; deleted on rejection, withdrawal, and by the purge |
| `referral_links` | SHA-256 of the token, expiry, uses against a limit of up to 1000 | the admin; households remember which link they came through |
| `claims` | household, donor (or an offline label), status, timestamps | the admin through `claims_with_sponsor`; a donor's own through `my_claims` |
| `profiles` | role: `admin` or `donor` | each account reads its own row; admins add and remove admins through functions, never the last one |
| `admin_invites` | lower-cased email, who invited, used-at | the admin; a pending invite promotes the matching account on its first sign-in. The first admin is seeded this way by a migration, so no SQL is ever run by hand |
| `activity` | every status change, by role and account id, against a ref code | the admin |

## Deadlines

| Date | Event |
|---|---|
| **Nov 6, 2026** | Nominations close |
| **Nov 30, 2026** | Donor claims close |
| **Dec 14, 2026** | Gifts due |
| **Feb 12, 2027** | Retention purge |
