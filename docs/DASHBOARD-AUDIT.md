# Executive Dashboard — Audit

Scope: the scorecard, rate cards, Leads Pipeline table, Individual Target
Contribution, and Ghosted Lead Alert. Read 2026-09-29 against the live
production data.

Every finding below produced a **plausible number rather than an error**. That
is why they survived the migration unquestioned: nothing in the UI looked
broken.

---

## Fixed

### 1. The date window never reached the funnel

`getDashboardStats` applied `startDate`/`endDate` inside the `LEFT JOIN`
condition on `funnel_history`, not to the lead set. `valid_leads` carried no
date predicate at all, so `total_leads` was structurally incapable of changing
when a date range was selected.

The screenshot that prompted this audit shows it: a 1–29 September window
selected, and `TOTAL LEADS` reading a flat `6400`.

**Decision:** `totalLeads` stays all-time, on purpose. A funnel is measured over
a window, but the lead pool is not — a lead from February nobody ever worked is
still a lead the team carries. Narrowing the denominator to September would make
the response rate describe only the leads that happened to arrive in September,
which is a much more flattering number.

The card now says **"Semua periode · tidak ikut filter tanggal"**, and when any
filter is active a line under the cards states what the funnel cards *are*
scoped to and how many leads that covered.

`totalLeadsInScope` is new and carries the count the rate cards actually
divide by.

### 2. The last seven hours of the closing day were discarded

```ts
endDate: endOfDay(new Date(filterEnd)).toISOString()
```

`new Date('2026-09-29')` parses as **UTC midnight** = 07:00 WIB. `endOfDay`
then added 23:59:59.999 of *browser-local* time to that instant. For a reader in
WIB the range ended at 16:59 UTC, so everything after 16:00 WIB on the final day
never counted. Evening entries stayed invisible until the next day.

Worse, the two ends of the range were built in different timezones and compared
in UTC, so changing a device's timezone changed the report.

Replaced with `wibDayStartIso` / `wibDayEndIso`, which read the input as
calendar text and resolve both bounds in a fixed WIB offset. The end is the last
millisecond of the day, not midnight of the next, so a 23:59:59.500 write still
counts.

### 3. Revenue used MAX where it needed a de-duplicated total

```sql
MAX(CASE WHEN fh.stage = 'Close Win' THEN ... END)
```

A lead with two Close Win rows contributed only the larger one, and a re-logged
correction silently under-reported. Now `DISTINCT ON (lead_id)` picks one entry
per won deal — most recent wins, so a re-log supersedes rather than adds.

**Verified against production** before shipping:

| Check | Result |
|---|---|
| SQL executes | 9 aggregates returned |
| No double-count | `rows 48 = distinct leads 48` |
| Per-rep total = company total | both `3,975,247,156` |

#### Which `deal_value` is authoritative

`funnel_history.deal_value` and `leads.deal_value` disagree on exactly one won
lead: **KAHF**, `3,000,000` on the lead versus `150,000,000` in the funnel. That
`Rp 147,000,000` gap is the whole difference between the two revenue figures.

`funnel_history` wins. A brand campaign closing at Rp 3 juta is not a real
number — average won deal in this business runs Rp 55–95 juta — and the ratio is
50×, which is a negotiation, not a typo (a mistyped digit would be 10× or 100×).
The lead row is holding the figure the brand was first entered with; the funnel
row holds the figure the deal actually closed at.

This is also why the revenue `COALESCE` order is funnel-then-lead, and it is worth
keeping in mind: **`leads.deal_value` is stale wherever a deal was renegotiated.**
Only KAHF is affected today.

### 4. A deal could be attributed to two reps

`getIndividualContributions` de-duplicated per `(rep, lead, stage)` but summed
revenue from every rep who touched the deal. A handover made the team total
exceed the company total, and the contribution panel stopped reconciling with
the Conversion Success card. Revenue is now owned by exactly one rep — whoever
logged the win, falling back to the last person to touch the lead.

### 5. Rates could exceed 100%, and one read 100.0%

Stages are counted independently from the lead's history, so a lead that
responded inside the window and set a meeting outside it produces
`meeting > responsed`. The dashboard was showing `INTEREST RATE 100.0%` from a
26-of-26 split.

A conversion rate over 100% is not a success story, it is a broken funnel, and
printing it as a number hides that. Rates are clamped to 100, and a zero
denominator now renders `—` rather than `0%`, because "0% of nothing responded"
and "nobody has been chated yet" are different statements.

**Confirmed against production data, not inferred.** Unfiltered:

```
chated 737   responsed 133   set_meeting 137
```

137 meetings from 133 responses is **103%** — without the clamp the dashboard
would print `103.0%` and present it as a result. The underlying inconsistency is
in how stages are logged (a lead responded in one period and met in another, or
a meeting is recorded without a response), and that is worth a conversation with
the team. Clamping surfaces it honestly rather than hiding it.

The response rate's denominator is now `totalLeadsInScope` (leads the PIC
actually worked in the window) rather than the all-time count.

### 6. The pipeline table filtered after paginating

`getLeadsPage` returned a page of 50; the browser then dropped rows whose
funnel history fell outside the PIC or date filter. Two failures at once:

- The page could hold 4 matching rows out of 50 while the pager read "Page 1 of
  128", because `totalFilteredLeads` came from the server and knew nothing about
  the client filter.
- A page whose 50 rows were all filtered away rendered as an empty table with
  the pager still offering 127 more pages — which reads as "no leads match" when
  it means "none of these 50 match".

The scope moved to the server as an `EXISTS` on the lead row, and the same
window now also scopes the history attached to each row so the stage chips
describe the period the row was included for. Notes stay unscoped: they are
commentary, not funnel movement.

### 7. "Status Global" could not disagree with "Status"

That column exists to show where a lead really sits next to where the selected
rep last had it. Once history arrived pre-scoped, the client only had filtered
rows and fell back to the same value for both, so the two columns agreed by
construction and the override warning never fired.

`LeadRow.latestGlobal` is new: the unscoped latest funnel entry, resolved server
side with `DISTINCT ON` in one index walk. The related bug where the status
badge showed a scoped stage next to an unscoped `by {name}` is fixed too — the
attribution now comes from the entry the badge actually displays.

### 8. Target progress was divided by 4, silently

```ts
pChat = (adminChat / Math.round(tChat / 4)) * 100;
```

A monthly target of 80 was measured against 20. A hardcoded divisor with no
label is not a business rule, and it made every rep's bar wrong by a factor of
four while looking entirely plausible.

Replaced with a real proration: the monthly target is scaled by the fraction of
days actually being viewed, so a three-day view does not measure against a full
month.

Separately, any activity above zero reported **100%** when no target existed. A
rep with one chat and no target showed a full bar, which reads as "target met".
It is not — the target is unknown. Those now show 0 beside the "belum diset"
label that was already there.

### 9. Ghosted leads missed exactly the leads it existed to find

Three classes were structurally invisible:

- `INNER JOIN latest` dropped every lead with **no funnel row at all** — a brand
  that arrived and was never contacted, the most stuck lead there is. Now a
  `LEFT JOIN`, with staleness measured from `created_at` for those.
- `EXTRACT(DAY FROM (NOW() - date_occurred))` returns NULL when the timestamp is
  NULL, and `NULL >= minDays` is NULL, not true — so those leads were filtered
  away rather than shown.
- Staleness is now measured from `GREATEST(last funnel move, leads.updated_at,
  created_at)`. Editing a lead is movement; treating it as inactivity listed
  leads a rep had plainly just handled.
- The PIC filter compared "whoever moved it last", so a lead handed over and
  abandoned belonged to the old rep. `leads.pic_name` is now an owner match too.

### 10. The alert threshold was not the threshold on the badge

`GHOSTED_MIN_DAYS` is 14, but the red "30+ Days!" badge only fires at 30 and the
panel was headed "Ghosted Lead Alert" with no number. A 20-day lead rendered in
amber with no explanation. The panel now states the real trigger and the badge
boundary, and reports when it is truncating at 50 of N.

### 11. Funnel win/lose was read from history, not from the lead

`has_close_win` came from "this lead has a Close Win row *anywhere*". A lead that
won in August but was touched in September counted as a September win.

`leads.status` is the current truth about where a lead ended up, so the
win/lost/failed buckets now read from the lead. Only the *revenue date* is
taken from the funnel, and a win outside the window still contributes its
revenue — the deal is real even if it closed before the period under review.

---

## Deliberately unchanged

- **`totalLeads` is all-time.** See finding 1 — this is a decision, not an
  oversight, and it is now labelled as such.
- **Ghosted leads ignore the date filter.** Staleness is measured against
  "now". Narrowing it to a selected window would hide precisely the leads that
  need chasing.
- **`gross_margin` semantics.** Unrelated to this module; see
  `docs/OI-FORECAST-AUDIT.md`.
- **Milestone scope stays global, not PIC-filtered.** Company-versus-target is a
  different question from per-rep targets.

---

## Still fragile

- **No optimistic locking.** Two reps editing one lead is last-write-wins. The
  attribution added in the OI grid tells you *who* changed something, not
  whether they were looking at the same value.
- **`leads.pic_name` is largely NULL after migration.** The ghosted and pipeline
  owner fallbacks lean on `funnel_history.by_user_name`, which is derived and
  correct, but any row with neither has no real owner to show.
- **`leads.deal_value` goes stale when a deal is renegotiated.** KAHF is the one
  live case: the lead says Rp 3 juta, the deal closed at Rp 150 juta. The
  dashboard reads the funnel value, so it is correct, but anything reading
  `leads.deal_value` directly is not. Writing the closed value back to the lead
  on Close Win would close the gap permanently.
- **Meetings are logged without a matching response** (137 > 133). Clamped, but
  the underlying logging habit is a process issue, not a code one.
- **`interest_level` holds 2 legacy `'-'` values**, normalised during migration.
  The dashboard does not currently read that column, so nothing depends on it
  yet.
