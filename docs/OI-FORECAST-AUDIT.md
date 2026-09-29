# OI Forecast — Audit

Scope: the Operational Income forecast as it stands after the Supabase →
self-hosted PostgreSQL migration. Reviewed: `forecast-actions.ts`, `schema.ts`,
`OIForecastClient.tsx`, `OIGrid.tsx`, `OISummaryCards.tsx`, `OIMilestone.tsx`,
and the `StatusModalClient` handoff.

This system is what sales performance is read from, so the bar is higher than
"it renders". The findings below are ordered by the damage they cause.

---

## Fixed in this pass

### 1. Saving a mid-pipeline status wiped the lead's funnel

`setOIForecastStatus` mapped every non-win, non-lose status to `'Leads'`:

```ts
const leadStatus = isWin ? 'Close Win' : input.status === 'LOSE' ? 'Close Lost' : 'Leads';
```

The status modal is also reachable from the OI grid, and its `onSaved` handler
sent `OPEN` for any stage that was not a closing one. So opening the modal for
a lead sitting at **Set Meeting** and saving silently reset the lead to
`Leads` — the whole funnel progress gone, from what looked like a harmless save.

Forecast status and lead status are different things. A forecast is `OPEN` for
as long as the deal is in play; the lead behind it can be at Chated, Responsed,
Set Meeting or Hold. `OPEN` now means "nothing was concluded" and leaves the
lead alone.

### 2. A reverted deal kept its closing date

`dateClosed` was set on WIN and never cleared, so a lead moved back to `OPEN`
still carried a `date_closed` that no longer meant anything. It is now cleared,
and the lead returns to whatever stage its surviving funnel history says.

### 3. Duplicates were only prevented in the browser

The grid checked `forecasts.some((f) => f.leadId === selectedLeadId)` before
inserting. That check only sees rows already in the page. Two open tabs, or a
colleague adding the same brand in between, both pass it and write a second
row — which then inflates WIN totals and milestone percentages.

There is now a unique index on `(lead_id, month_year, product,
coalesce(campaign_number, 1))`, plus a server-side pre-check that returns the
same message. The COALESCE matters: under a plain unique index two NULL
campaign numbers do not compare equal, so rows with no campaign set would
still duplicate freely.

### 4. Every keystroke was a query

All 16 editable cells fired `onChange` → server action → `UPDATE`. Typing
`15000000` into Value was eight statements against Postgres.

Edits are now debounced 600 ms with a per-cell timer keyed by `rowId:field`, so
two cells edited back to back both land — a single shared timer would have
dropped the first. The local value writes immediately, so typing stays
responsive; only the server call waits.

### 5. `successRate` default disagreed between client and server

The client optimistically rendered a new row at `50` ("Realistic") while the
server stored `0`. After a refresh the row silently moved to "Worst Case". The
server now defaults to 50 and accepts the value explicitly.

### 6. Three identical subqueries per forecast row

`latestStage`, `latestPic` and `latestStageDate` were three correlated
subqueries, each with its own `ORDER BY ... LIMIT 1` over the same funnel rows
— three index walks where one would do. Replaced with a single `LEFT JOIN
LATERAL`. Same ordering, same result.

### 7. MCN rows were labelled "Custom Campaign"

```ts
activeTab === 'TNT' ? 'TNT Campaign' : activeTab === 'HYPE' ? 'HYPE Campaign' : 'Custom Campaign'
```

MCN fell into the `else`. Every MCN forecast was mislabelled in the Category
column and grouped wrongly in the milestone view.

### 8. The summary cards hid a misleading comparison

The cards show `valueWin / target` where `target` is the **company-wide**
figure. With the grid filtered to one rep, that divided a single rep's
achievement by the whole team's target — understated by roughly the size of the
sales team, with nothing on screen to say so. The cards now show whose numbers
they are, and label the target accordingly when filtered.

---

## Open questions, deliberately not changed

These need a decision from the business, not from me.

### Milestone scope

`OIMilestone` still receives every forecast for the year, not the PIC-filtered
subset. I left it that way on purpose: a milestone is "the company against its
target", and a per-rep target is a different question. Per-rep targets already
live in `individual_targets` (which was empty before this migration — the old
admin screen was writing staff KPIs into the wrong table). The header now shows
which month the grid is on, so moving between tabs does not look like the app
lost its place.

If you want a per-rep milestone view instead, that is a real feature and I would
build it properly rather than reuse the company numbers.

### Scenario bands

`getScenarioInfo` splits at 80 and 50 percent, and the comment above the sort
says "Base Case (100-80), Realistic (79-50), Worst Case (<50)". The bands are
hardcoded in the component, not configurable, and `successRate` is entered by
hand per row. There is no link between it and the lead's actual funnel stage.
Left alone — changing the thresholds would silently reclassify every forecast
already in the database.

---

## Row attribution (added after the first audit pass)

The grid could not answer "who changed this number?". `updated_at` recorded that
*something* changed at a time, but not who, and a disputed figure had to be
settled by asking the room.

`oi_forecasts` gained `updated_by` (FK to `users`, `ON DELETE SET NULL`) and
`updated_by_name`. Every write path sets them: `createOIForecast`,
`updateOIForecastField`, and `setOIForecastStatus`. Migration:
`drizzle/0002_wonderful_payback.sql`, idempotent.

`getOIForecasts` now also returns `milestones` — the lead's whole funnel trail,
aggregated with `json_agg` in a second `LEFT JOIN LATERAL` alongside the
existing latest-stage lookup. The grid renders the four most recent as chips
("Close Win · 15 Sep, 14:32 · Budi → ...") plus a "+N tahap sebelumnya" marker;
the full trail stays on the lead page, where there is room for it.

Timestamps are rendered with `Intl.DateTimeFormat('id-ID')` in the browser's
timezone. The server stores UTC, so a rep's own 14:00 WIB entry would display as
07:00 if formatted server-side — the minute is included because 14:03 and 14:58
are different events when two reps are asked who was in the row.

Rows that predate the migration have `NULL` for both columns. The grid says
"belum tercatat (sebelum pencatatan update)" rather than showing a blank, so a
missing value is never mistaken for "never updated".

---

## Known limitations

- **`successRate` is manual.** Nothing derives it from funnel position. A lead
  at Set Meeting and a lead at Leads can both sit at 50.
- **`gross_margin` is a formula, not a margin.** It is
  `value - budget_ads - budget_creator`, floored at zero. It excludes platform
  fees, commission, and tax. Fine as "contribution after ad spend", misleading
  if read as accounting margin.
- **`real_margin` and `real_payment` are never used in any total.** They are
  editable and displayed, but no summary or milestone reads them.
- **Editing a cell does not refresh the server data.** With the debounce, the
  local value is what you see until you reload. Acceptable for a spreadsheet,
  but it means two reps editing the same row will not see each other's change
  live.
- **No optimistic locking.** Two reps editing one cell is last-write-wins. The
  unique index protects against duplicate rows, not against lost updates.

---

## Data safety during the migration

- The unique index is added in `drizzle/0001_oi_forecast_integrity.sql`, which
  **checks for duplicates first** and aborts with a readable message rather than
  failing on a constraint name. Removing a forecast row changes a performance
  number, so that is not automated.
- Run `docs/check-oi-duplicates.sql` before applying. If it returns rows, review
  them before deciding what to keep.
- `docs/MIGRATION.md` step 6 covers what to verify after cutover; the OI items
  are the forecast count per product, and that no row appears twice for the
  same brand, month and campaign.
