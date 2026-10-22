# Build log

A running record of the autonomous build that started on 2026-10-15, written
for Alex to catch up from. One entry per slice: what changed, why, and the
one idea to be able to say back. Newest at the bottom.

Everything in this log happened on the fork `dwelch2344/secret-santa-platform`.
The section at the end lists what would move to Alex's repos if we rebalance.

## How to read a slice

Each slice is one pull request into `dev` with a linked issue on the fork.
The PR body follows `.github/pull_request_template.md` and ends with a
"For Alex — say it back" section. If you can say that section back in your
own words, you understand the slice.

## Slices

### 1. Handbook committed and linked — issue #7

- `docs/handbook/` is now in the repo: journey map, personas, 21 annotated
  mockups. CLAUDE.md points at it and lists what in it the hard rules
  overrule.
- **Say it back:** the handbook is what the app should look and feel like;
  the hard rules in CLAUDE.md decide what it may *do*. When they disagree,
  the rules win, and the list in CLAUDE.md says where.

### 2. Design system — issue #8

- One stylesheet, `public/styles.css`: tokens from the handbook (cream,
  deep green, cranberry, amber), two self-hosted variable fonts, the donor
  header shell and the coordinator sidebar shell, and the components every
  later page uses (cards, buttons, pills, tags, notices, fields, folding
  sections, tables, tiles).
- `tests/pages.test.js` reads every page and script and fails if one
  carries an inline style or loads from a host the CSP does not allow.
- **Say it back:** pages never write CSS of their own; they put classes on
  elements and the stylesheet decides the look. That is what lets the
  Content-Security-Policy say "styles only from this site" and mean it.

### 3. Campaign settings — issue #9

- New `campaigns` table with one 2026 row, created by the migration with
  bracketed placeholders; `households.campaign_id` points at it. The seed
  fills in obviously fake contact details for the sandbox.
- `public_campaign` is a **view** that lists only the public columns, so
  anyone can read dates and the contact line but the drop-off address never
  leaves the table. Only the admin reads or updates the table itself.
- `is_admin()` is the one helper every later policy will call.
- `settings.html` is the A5 top half: season, dates, rules. The dates-in-
  order rule is a database check constraint, so a bad save is refused by
  Postgres and the page just shows the message.
- `console.js` holds the sidebar list and the "sign in first" card for
  every coordinator page.
- **Say it back:** RLS hides *rows*; a view hides *columns*. The address
  is a column, so it needed a view, not a policy.

### 4. Referral links — issue #10

- `referral_links` stores a SHA-256 hash of each token, its expiry (seven
  days from creation) and, once used, which household it became. No plain
  token column exists.
- `create_referral_link()` is a `security definer` function: it checks
  `is_admin()` itself, makes 24 random bytes, stores the hash, and returns
  the plain token exactly once. There is no INSERT policy on the table, so
  the function is the only way in.
- `links.html` builds `…/refer.html#t=TOKEN`. The token sits in the URL
  fragment, which browsers never send to a server, so it stays out of logs.
- **Say it back:** the database keeps a fingerprint of the link, not the
  link. A fingerprint can confirm a link is genuine but cannot be turned
  back into one, so a leaked database is not a pile of working links.

### 5. The family referral form — issue #11

- Three new tables: `household_members` (a role from a fixed list and an
  age, never a name), `wish_items` (one row per item, split out of the
  comma lists so a sponsor can tick them later), `household_contacts` (the
  family's email, alone in its own table). None has an INSERT policy.
- `submit_referral(token, json)` is the only way in: one transaction that
  locks the link row, checks it, checks every free-text field for a phone
  number, email or street address, writes everything, and burns the link.
  Two submissions racing on one link queue up on the lock and the second
  finds it used.
- `refer.html` is C1 rewritten for the family. The same three patterns
  warn while typing; a school name warns but does not block, because that
  is a judgement for the coordinator.
- **Say it back:** the form never writes to a table. It hands the database
  one JSON document and one token, and a single function decides whether
  all of it lands or none of it does. "Burn the link" and "save the
  household" cannot come apart.

### 6. The approval queue, properly — issue #12

- `queue.html` is now A2: the waiting list on the left, the selected
  referral on the right as sponsors will see it, automatic checks, a
  private note, and Approve / Reject. Approved and rejected sit below and
  open read-only.
- Through the API only `status` and `admin_note` can change on a
  household. That is a column privilege (`grant update (status,
  admin_note)`), which RLS cannot express — RLS is about rows.
- Rejecting or withdrawing deletes the family's contact row by trigger, so
  no page can forget to.
- "Request changes" is a placeholder: families cannot edit after
  submitting, so the admin emails them instead; the pane shows the address.
- **Say it back:** three different tools guard three different things.
  RLS decides *which rows* the admin can touch. A column grant decides
  *which columns*. A trigger makes a consequence (delete the email) happen
  no matter which page caused the change.

### 7. Dashboard and roster export — issues #13 and #14

- `dashboard.html` is A1: four tiles, the progress bar with both deadlines,
  a needs-attention line, and the roster with a Review/Open link per row.
  Everything is computed in the browser from one fetch of the households.
- `public_counts` is a second public view: two numbers for the landing
  page, both blank when the admin turns the public count off.
- `csv.js` is the roster export, written by hand and unit-tested, because
  the export is the fallback if the app breaks in December. Pending rows
  are included; no contact column exists to leave out.
- `auth.js` now only clears the address bar when it held sign-in
  parameters, so `queue.html?select=…` survives.
- **Say it back:** a few hundred rows is small. Fetch them once and count
  in the browser; six separate count queries would be more code and more
  ways to disagree with each other.

### 8. Activity log and withdraw — issues #15 and #16

- `activity` is written by a trigger on households: every insert and
  every status change, with the actor's role (system, family, admin,
  donor) worked out from the request's JWT. Pages never write to it.
- The admin can withdraw a live household. That needed a second UPDATE
  policy, which exposed a subtlety: permissive policies OR together, so
  a live row would have passed one policy's row filter and the other's
  new-row check. The allowed transitions now live in one `before update`
  trigger, and the policies only say which rows the admin may touch.
- `exceptions.html` is A3's shell: the activity log with an export, and
  one exception card that exists today (pending more than two days).
- **Say it back:** a policy answers "may this person touch this row?". It
  cannot answer "may this row go from state A to state B?", because the
  check clause never sees the old row. A trigger sees both, so the state
  machine lives there.

### 9. The database door is closed — issue #17

- `.mcp.json` is deleted. It gave an agent arbitrary SQL against the
  sandbox database; CLAUDE.md said it had to go before anyone outside Alex
  and his mum could reach the site. Nothing in this build used it: every
  policy is checked by `supabase test db`.
- **Say it back:** a book (the skills folder) can be read and does
  nothing. A door (a live database connection) does things. We keep the
  book and we have removed the door.

### 10. The public list — issue #19

- Three public **views** (`public_households`, `public_household_members`,
  `public_wish_items`) select only the public columns of live, unclaimed
  households; the story comes through only with the family's consent.
  Anonymous visitors still have no policy on the tables themselves,
  because a policy lets a whole row through and a household row carries
  the admin's note.
- The `claims` table arrives now, schema only: a partial unique index
  allows one active claim per household, which is what makes two donors
  racing for one household safe.
- `index.html` is D1, `browse.html` is D2 and reflows to D10; `signin.html`
  took over the sign-in card; `site.js` fills the header links by role.
- **Say it back:** a row policy says yes or no to a whole row. When the
  public may see some columns of a row but not others, the answer is a
  view that only selects the public ones, and the public reads the view.

### 11. Sponsoring: story, claim, confirmation, my families — issues #20, #21, #22

- Every donor write is a function that checks the caller itself:
  `claim_household`, `mark_delivered`, `release_claim`, `set_item_bought`.
  Donors read their own claims through `my_claims`, `my_household_members`
  and `my_wish_items`, views filtered by `auth.uid()`. No donor policy
  exists on the tables.
- The race is settled by the partial unique index: the second of two
  simultaneous claims fails on it, and the function turns that into
  `already_claimed`, which the story page shows as D9.
- `drop_off_details()` is the only way a donor sees the drop-off address,
  and only while holding a claim. There is no family contact card.
- Releasing clears the previous sponsor's ticks (trigger), returns the
  household to the list (the view), and logs it (trigger).
- A donor's profile row appears on their first claim; it grants nothing.
- **Say it back:** the database does not trust the page. The page asks a
  function to claim; the function checks who is asking, whether the
  household is live, whether claims are open, and the cap; and the unique
  index decides the race. If two people click at once, exactly one wins,
  and no JavaScript had to be clever about it.

### 12. Exceptions and the sponsor column — issue #23

- `exceptions.html` now has its cards: a household released in the last
  two weeks, a claim with no delivery when the deadline is close (with a
  mailto reminder and an admin release), referrals pending more than two
  days, and the offline-sponsor form that calls `admin_manual_claim`.
- The dashboard reads `claims_with_sponsor`: the Sponsored tile, the
  progress bar and the sponsor column are real, and the CSV carries them.
- **Say it back:** "sponsored" is not a household status. A household is
  live; a claim on it is what makes it sponsored. Keeping those apart is
  why releasing a claim puts the household straight back on the list
  without anyone editing the household.

### 13. Close-out and the retention purge — issue #25

- Closing the drive is a status on the campaign row. The public views
  check it, so the list empties; the claim function checks it, so claims
  stop. Nothing is deleted by closing. Reopening is allowed.
- `purge_retained_contacts()` deletes the family contact rows of a
  *closed* drive and logs the count. No API role can call it: the only
  caller is `.github/workflows/retention-purge.yml`, run by hand, gated by
  the production environment's reviewers, and it requires typing "purge".
- `season_totals` is an admin-only view for the close-out card.
- **Say it back:** closing and purging are two separate, deliberate acts.
  The purge refuses to run on an open drive, so the order cannot be
  skipped, and it runs through an approved workflow, so it is always on
  the record and never typed into a SQL editor.

### 14. Hardening — issue #26

- The consent gate is now a database rule: the transition trigger refuses
  pending → live unless the wish-list consent is true. Seven older test
  fixtures had been approving households without it, and broke, which is
  the gate working.
- `hardening.sql` is the sweep: a signed-in donor reads zero rows directly
  from every table that is not theirs, whatever views sit on top.
- README rewritten for the app as built; CLAUDE.md's data-model sketch
  points at it; the retention purge is in the environments checklist.
- **Say it back:** a disabled button is a courtesy; a trigger is a rule.
  The approval page already refused to approve without consent, but only
  the database can refuse every page and every tool at once.

### 15. CSV formula guard — from the security review

- The release PR's security review found one thing: a household summary
  starting with `=` would be a formula once the roster CSV is opened in a
  spreadsheet, and summaries are typed by strangers. `csv.js` now prefixes
  such cells with an apostrophe and quotes them; two unit tests cover it.
- **Say it back:** a spreadsheet is a program. Text that a stranger typed
  must reach it as text, the same way it reaches the browser as text.

### 16. A new dev Supabase project — issue #18 groundwork

- The old dev project belonged to Alex's Supabase account, which blocked
  the demo site. David created `sub-for-santa-dev` in his own org. Four
  files name the project: `public/config.js` (URL and publishable key),
  `public/_headers` (the CSP host), `tests/pages.test.js` (the allowed
  host), `docs/environments.md`. The GitHub variable was changed by the
  setup session. Nothing else moves.
- **Say it back:** the browser only ever knows a project by its URL and
  its publishable key, both public by design. Swapping projects is
  changing those two strings and the CSP host that lets the browser talk
  to it; RLS on the new project is what protects the data, exactly as
  before.

### 17. The demo site is live — issue #18

- https://dev.sub-for-santa.pages.dev, deployed by Deploy dev from `dev`:
  migrations first, then the upload. It runs on `sub-for-santa-dev`, a
  Supabase project in David's own org, because the original dev project
  belonged to Alex's account and nobody else could set its secrets.
- Verified over HTTP: the CSP names the new project; the public views
  answer the publishable key; every private table returns nothing to the
  anonymous key, which is RLS doing on the hosted project exactly what the
  pgTAP files prove locally.
- Cloudflare serves clean URLs: `/queue.html` answers with a redirect to
  `/queue`, query string kept. Links keep the `.html` so the local server
  still works; `public/paths.js` compares pages without it.
- The hosted project starts empty. The three fake households were seeded
  by hand in the dev SQL editor (dev is not prod; fake rows are fine there).
- **Say it back:** the same migrations, the same policies, the same tests
  — on a laptop in Docker and on the hosted project. The deploy applies
  nothing a developer has not already run locally.

### 18. Prod exists, under David's accounts for now — issue #24

- The live Supabase project `sub-for-santa-prod` (ref
  `drmbknjbaigfvhxobpav`) sits in a new org under David's accounts, so the
  setup could happen before Alex was available. Transferable to Alex; the
  product repo's `decisions.md` carries the line. The docs that said
  "Alex only" now say "one person: David for now".
- `config.js` and `_headers` carry the prod project (#59). Nothing is
  reachable until the first Deploy prod is approved at the production
  environment gate, which also needs the three production secrets.
- Prod is on the free plan for now; the auto-pause risk is written down.
- **Say it back:** the rule was never "Alex"; the rule is "one named
  person, never an agent, every exception dated". The name changed, the
  rule did not.

### 19. Admins add and remove admins — issue #63

- Four functions, each insisting on `is_admin()`: `add_admin(email)`
  promotes an existing account at once (a donor row becomes an admin row)
  or records an invite; `remove_admin(user)` refuses to remove the last
  admin, including yourself; `revoke_invite(email)`; `list_admins()`.
- An invite fires on first sign-in: a trigger on `auth.users` promotes a
  new account whose lower-cased email matches a pending invite, once, and
  marks the invite used. Invites can only be created by admins, so every
  path to admin rights starts with an admin.
- Every call logs to the activity table with the email in `detail`.
- Break-glass stays for the very first admin only.
- **Say it back:** the dangerous question is not "can an admin add an
  admin?" but "can the last admin be removed, and can an invite be forged?"
  The database answers both: no, and only an admin can write an invite.

### 20. The bootstrap admin is part of the platform — issue #66

- David ruled out the hand-run break-glass statement for the first admin.
  A migration now seeds an invite for the bootstrap address; the existing
  invite trigger promotes it on first sign-in. On a database where the
  account already exists (dev), the migration promotes it directly.
- "First person to sign in becomes admin" was rejected again, for the
  same reason as before: open sign-up makes it a race. An invite bound to
  one address has nothing to race. Break-glass is now the fallback for a
  mistyped or lost bootstrap address.
- **Say it back:** the platform knows one email in advance. That email's
  first sign-in is the only thing that can create the first admin; every
  admin after that is created by an admin.

### 21. Multi-use links, email or phone, and a private reference — issue #69

- A referral link now carries a limit (1–1000) and a use count; `used_at`
  means exhausted. Households remember which link they came through, so
  the links page lists every referral a link produced.
- The contact is an email, a phone, or both, with a preferred channel, and
  it belongs either to the household or to the person submitting on their
  behalf. A household's own phone number is new and changes the 2026-10-10
  "email only" decision at David's instruction; it lives in the same
  private table, admin-only, deleted on rejection.
- On-behalf submissions may carry a private reference ("Alpha"). The form
  warns when it reads like a name; the queue flags it again.
- The story section says it will be shown to sponsors; the consent starts
  ticked and unticking keeps it for the coordinator.
- **Say it back:** a link is now a counter, not a switch. Every refusal
  (bad phone, no contact, identifying text) leaves the counter alone, so
  a mistake never costs a family their place.

### 22. Alex's PR, and the contact fields locked — issues #74, #77

- Alex's PR #73 merged as written: per-link expiry (1–90 days), "donor"
  wording on the family form, a private note to the coordinator. A
  follow-up wired the note into the database; the form had collected it
  without sending it.
- On the 2026-10-21 call David and Alex locked the contact fields: first
  name, email and/or phone, who referred them. A single checkbox, "I am not
  the parent or guardian of this household", replaces the
  who-is-filling-this-in choice, so a therapist or social worker uses the
  same form. The "Alpha/Beta" private reference is gone from the form.
- Story consent is now opt-in: "Yes, I'm okay with sharing my story on the
  donor page", unticked by default. The consent was kept on purpose.
- **Say it back:** decide the fields once, write them down, and stop
  reacting to each new screen. The form, the database and CLAUDE.md now
  say the same four things.

### 23. Final form copy — S4S Nominations 2026 doc

- From the stakeholder doc: the story section says "The story will be
  shared with potential donors"; "Who referred you?" moves into its own
  Provider section; the not-a-guardian checkbox and the "never donors"
  and "no photos" lines are gone.
- Consent is two required boxes: "I am the parent/guardian of the children
  listed" (unticked, must be ticked) and "By submitting this form I agree
  to share my story and information with potential donors (names
  removed)" (ticked by default, must stay ticked). The database refuses a
  submission without either.
- This reverses #78's opt-in story and closes the on-behalf path: a
  therapist or social worker can no longer submit for a family.
- **Say it back:** a required checkbox is only a rule if the database
  checks it too. Both attestations are checked in `submit_referral`.

## Rebalancing into Alex's repos later

Stories normally live in `Alexleop33/secret-santa-product` and PRs close
them cross-repo. During this run everything was filed on the fork so the
`Require linked issue` check had something to close without write access to
Alex's repos.

| Fork issue | Would become |
|---|---|
| #7, #8, #27 | product Story "The app looks like the handbook" |
| #9–#18, #28 | product Stories under an Epic "Referral chain and console" ( #10 mirrors product #6 ) |
| #19–#24, #29 | product Stories under an Epic "Donor side" |
| #25, #26, #30 | product Stories under an Epic "Close-out" |

To move one: open the Story upstream with the same body, then edit the fork
PR description's `Closes #N` to `Closes Alexleop33/secret-santa-product#N`.
Nothing in the code references issue numbers.
