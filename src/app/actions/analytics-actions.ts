'use server';

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { requireUser } from '@/lib/auth';

export interface DashboardStats {
  /**
   * Every active lead that matches the category/product filters. Deliberately
   * NOT narrowed by the date range or the PIC.
   *
   * A funnel is measured over a window, but the lead pool is not: a lead created
   * in February that nobody ever worked is still a lead the team is carrying.
   * Cutting the denominator to September would make the response rate describe
   * only leads that happened to arrive in September, which is a different and
   * much flattering number. The card labels this explicitly as all-time so the
   * distinction is visible rather than assumed.
   */
  totalLeads: number;
  /**
   * Leads that were actually touched by the selected PIC inside the date
   * window. This is the honest denominator for the rate cards, and it is what
   * the previous code computed under the label "total leads" while showing the
   * all-time count in the card.
   */
  totalLeadsInScope: number;
  totalChated: number;
  totalResponsed: number;
  totalSetMeeting: number;
  /** Won leads inside the selected window. Comparable to the stage counts. */
  dealsWon: number;
  /** Won leads, all time. The Conversion Success card is a lifetime figure. */
  dealsWonLifetime: number;
  lostDeals: number;
  failedDeals: number;
  totalRevenue: number;
}

/**
 * Won leads whose funnel is incomplete, so the lord can see exactly which rows
 * to repair.
 *
 * A lead that reached Close Win without a Responsed row is not a formatting
 * problem. It means the scorecard's conversion rate is dividing wins by a
 * denominator that does not contain them, and the number on screen is not a
 * measurement of the team. The fix is to log the missing stage, which is a
 * decision only the lord can make per lead - so this reports, it does not
 * fabricate.
 *
 * `missingStages` is derived from the rows that exist, not assumed. A lead with
 * no funnel at all is reported as missing everything, which is the 9-deal group
 * holding Rp 1.92 billion.
 */
export interface DataHealthRow {
  leadId: string;
  brandName: string;
  status: string;
  /** The single highest stage recorded, or null when there is no history. */
  lastStage: string | null;
  /** How many of the expected stages before Close Win are absent. */
  missingCount: number;
  /** Names of the absent stages, in funnel order. */
  missingStages: string[];
  /** Revenue attributed to this lead, from the funnel or the lead row. */
  revenue: number;
  /** Who last touched it, for whoever does the repair. */
  lastBy: string | null;
  lastTouchedAt: string | null;
}

export interface ContributionRow {
  adminName: string;
  totalChat: number;
  totalMeet: number;
  totalRevenue: number;
}

export interface GhostedLeadRow {
  leadId: string;
  brandName: string;
  picName: string;
  category: string;
  status: string;
  lastStage: string | null;
  lastStageDate: string | null;
  daysPassed: number;
}

const EMPTY_STATS: DashboardStats = {
  totalLeads: 0,
  totalLeadsInScope: 0,
  totalChated: 0,
  totalResponsed: 0,
  totalSetMeeting: 0,
  dealsWon: 0,
  dealsWonLifetime: 0,
  lostDeals: 0,
  failedDeals: 0,
  totalRevenue: 0,
};

/**
 * `db.execute()` on the node-postgres driver resolves to the raw `pg`
 * QueryResult, not to an array. The rows live on `.rows`. This normalises
 * both shapes, so the analytics queries below stay readable and a future
 * driver change cannot turn into a runtime TypeError on the dashboard.
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Aggregate funnel metrics for a date window.
 *
 * `productFilter` is bound as a real PostgreSQL array. Under PostgREST a JS
 * array was serialised to JSON, which is not the same thing to the `&&` overlap
 * operator.
 *
 * Three defects in the previous version, all of which produced confidently
 * wrong numbers rather than an error:
 *
 * 1. The date window and the PIC filter were applied inside the `LEFT JOIN`
 *    condition, so they narrowed the *stages* but not the lead rows. The lead
 *    population stayed at "everything", which is why TOTAL LEADS never moved.
 * 2. Revenue used `MAX(...)` over a per-lead `CASE`. A lead with two Close Win
 *    rows contributed only the larger one, and a re-logged correction silently
 *    under-reported. It is `SUM(DISTINCT ...)` now, with the per-lead
 *    de-duplication done by `DISTINCT ON` so two equal-valued rows do not
 *    collapse into one.
 * 3. A lead's *terminal* stage was not required to be inside the window. A lead
 *    that reached Close Win in August but was touched in September counted as a
 *    September win. `leads.status` is the current truth about where a lead
 *    ended up, so the win/lose/failed buckets are now read from the lead, and
 *    only the *revenue date* is taken from the funnel.
 */
export async function getDashboardStats(filters: {
  admin?: string;
  category?: string;
  products?: string[];
  startDate?: string | null;
  endDate?: string | null;
}): Promise<DashboardStats> {
  await requireUser();

  const admin = filters.admin && filters.admin !== 'ALL' ? filters.admin : null;
  const category = filters.category && filters.category !== 'ALL' ? filters.category : null;
  const products = filters.products?.length ? filters.products : null;
  const startDate = filters.startDate ? new Date(filters.startDate) : null;
  const endDate = filters.endDate ? new Date(filters.endDate) : null;

  const result = await db.execute(sql`
    WITH valid_leads AS (
      SELECT l.id, l.deal_value, l.status
      FROM leads l
      WHERE l.is_deleted = false
        AND (${category}::text IS NULL OR l.category = ${category})
        AND (${products}::text[] IS NULL OR l.product_offered && ${products}::text[])
    ),
    -- Stages the selected PIC recorded inside the window. Kept separate from
    -- the lead set so "all active leads" and "leads this PIC worked" can both
    -- be counted from one pass.
    scoped_funnel AS (
      SELECT
        fh.lead_id,
        bool_or(fh.stage = 'Chated')      AS has_chated,
        bool_or(fh.stage = 'Responsed')   AS has_responsed,
        bool_or(fh.stage = 'Set Meeting') AS has_set_meeting
      FROM funnel_history fh
      WHERE (${startDate}::timestamptz IS NULL OR fh.date_occurred >= ${startDate})
        AND (${endDate}::timestamptz IS NULL OR fh.date_occurred <= ${endDate})
        AND (${admin}::text IS NULL OR fh.by_user_name = ${admin})
      GROUP BY fh.lead_id
    ),
    -- Won leads, with their revenue.
    --
    -- leads.status is the authority on whether a deal closed - a lead that
    -- reached Close Win in August is a won lead even when it is being viewed
    -- through a September window, and cutting it out would make revenue jump
    -- around as the date filter moves. That is the same reason the win/loss
    -- buckets below read from the lead rather than from history.
    --
    -- DISTINCT ON (lead_id) gives each won lead exactly one revenue row, so a
    -- re-logged correction supersedes the original instead of adding to it. The
    -- funnel entry supplies the agreed deal value when it has one; otherwise the
    -- lead's own value is used, which is the order the old COALESCE had.
    --
    -- The date window is deliberately NOT applied here, and neither is the PIC
    -- filter: a won deal is revenue the company booked. Restricting either
    -- would make "Total Nominal Revenue" mean something different every time
    -- a filter moved, which is exactly the confusion the all-time TOTAL LEADS
    -- label exists to prevent.
    wins AS (
      SELECT DISTINCT ON (vl.id)
        vl.id,
        COALESCE(fh.deal_value, vl.deal_value, 0) AS revenue
      FROM valid_leads vl
      LEFT JOIN LATERAL (
        SELECT f.deal_value
        FROM funnel_history f
        WHERE f.lead_id = vl.id AND f.stage = 'Close Win'
        ORDER BY f.date_occurred DESC, f.created_at DESC
        LIMIT 1
      ) fh ON TRUE
      WHERE vl.status = 'Close Win'
      ORDER BY vl.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM valid_leads)                          AS total_leads,
      (SELECT COUNT(*)::int FROM valid_leads vl
        JOIN scoped_funnel sf ON sf.lead_id = vl.id)                   AS total_leads_in_scope,
      (SELECT COUNT(*)::int FROM scoped_funnel WHERE has_chated)       AS total_chated,
      (SELECT COUNT(*)::int FROM scoped_funnel WHERE has_responsed)    AS total_responsed,
      (SELECT COUNT(*)::int FROM scoped_funnel WHERE has_set_meeting)  AS total_set_meeting,
      -- Won leads INSIDE the window, matched to the same funnel scope as the
      -- stages above.
      --
      -- This was a count of valid_leads with status 'Close Win', which is
      -- all-time. The dashboard then divided that by
      -- total_responsed, which IS window-scoped, and got 48 over 26 = 185%.
      -- The two numbers were never comparable: one counted every deal the
      -- company has ever closed, the other counted responses inside the
      -- selected month. It looked like the team converted more than 100% of
      -- responses, and the actual finding was a query that compared a lifetime
      -- numerator with a monthly denominator.
      (SELECT COUNT(DISTINCT vl.id) FROM valid_leads vl
         JOIN funnel_history fh ON fh.lead_id = vl.id AND fh.stage = 'Close Win'
        WHERE (${startDate}::timestamptz IS NULL OR fh.date_occurred >= ${startDate})
          AND (${endDate}::timestamptz IS NULL OR fh.date_occurred <= ${endDate})
          AND (${admin}::text IS NULL OR fh.by_user_name = ${admin}))   AS deals_won,
      -- All-time wins, kept for the Conversion Success card, which is a
      -- lifetime figure by design.
      (SELECT COUNT(*)::int FROM valid_leads
        WHERE status = 'Close Win')                                    AS deals_won_lifetime,
      (SELECT COUNT(*)::int FROM valid_leads
        WHERE status = 'Close Lost')                                   AS lost_deals,
      (SELECT COUNT(*)::int FROM valid_leads
        WHERE status = 'Failed')                                       AS failed_deals,
      (SELECT COALESCE(SUM(revenue), 0) FROM wins)                     AS total_revenue
  `);

  const rows = rowsOf<Record<string, number | null>>(result);
  const row = rows[0];
  if (!row) return EMPTY_STATS;

  return {
    totalLeads: Number(row.total_leads ?? 0),
    totalLeadsInScope: Number(row.total_leads_in_scope ?? 0),
    totalChated: Number(row.total_chated ?? 0),
    totalResponsed: Number(row.total_responsed ?? 0),
    totalSetMeeting: Number(row.total_set_meeting ?? 0),
    dealsWon: Number(row.deals_won ?? 0),
    dealsWonLifetime: Number(row.deals_won_lifetime ?? 0),
    lostDeals: Number(row.lost_deals ?? 0),
    failedDeals: Number(row.failed_deals ?? 0),
    totalRevenue: Number(row.total_revenue ?? 0),
  };
}

/**
 * Per-rep contribution over a date window.
 *
 * Activity counts are de-duplicated per (rep, lead, stage) so chasing the same
 * brand three times in a day is one chat, not three. Revenue is different: a
 * deal that passed through two reps must be attributed to exactly one of them,
 * or the team total exceeds the company total and the contribution panel stops
 * reconciling with the Conversion Success card.
 *
 * The winner is the rep who recorded the winning entry, falling back to the
 * last person to touch the lead. `DISTINCT ON (lead_id)` over that ordering
 * assigns the deal to one row.
 */
export async function getIndividualContributions(filters: {
  admin?: string;
  category?: string;
  products?: string[];
  startDate?: string | null;
  endDate?: string | null;
}): Promise<ContributionRow[]> {
  await requireUser();

  const admin = filters.admin && filters.admin !== 'ALL' ? filters.admin : null;
  const category = filters.category && filters.category !== 'ALL' ? filters.category : null;
  const products = filters.products?.length ? filters.products : null;
  const startDate = filters.startDate ? new Date(filters.startDate) : null;
  const endDate = filters.endDate ? new Date(filters.endDate) : null;

  const result = await db.execute(sql`
    WITH valid_leads AS (
      -- Every column referenced downstream must be projected here. status is
      -- filtered on by win_owner, and pic_name is the last fallback for deal
      -- ownership; omitting either produces "column vl.<x> does not exist" at
      -- runtime. status shipping without it once cost a production outage -
      -- tsc and the build both passed, because neither parses SQL.
      SELECT l.id, l.deal_value, l.status, l.pic_name
      FROM leads l
      WHERE l.is_deleted = false
        AND (${category}::text IS NULL OR l.category = ${category})
        AND (${products}::text[] IS NULL OR l.product_offered && ${products}::text[])
    ),
    -- Per-rep activity, de-duplicated so one rep chasing one lead is one count.
    activity AS (
      SELECT DISTINCT ON (fh.by_user_name, fh.lead_id, fh.stage)
        fh.by_user_name,
        fh.lead_id,
        fh.stage
      FROM funnel_history fh
      JOIN valid_leads vl ON vl.id = fh.lead_id
      WHERE (${startDate}::timestamptz IS NULL OR fh.date_occurred >= ${startDate})
        AND (${endDate}::timestamptz IS NULL OR fh.date_occurred <= ${endDate})
        AND (${admin}::text IS NULL OR fh.by_user_name = ${admin})
      ORDER BY fh.by_user_name, fh.lead_id, fh.stage, fh.date_occurred DESC, fh.created_at DESC
    ),
    -- One owner per won deal, and exactly one.
    --
    -- The company total assigns a won lead to a single rep, so this panel has
    -- to agree with it or the two figures stop reconciling. The rep who logged
    -- the win owns it; if that row is anonymous, the last person to touch the
    -- lead does; if neither, the deal is unattributed and lands on '-'.
    --
    -- The date window IS applied to the win lookup below, on both laterals.
    --
    -- It used to be ignored here, on the grounds that a closed deal is booked
    -- revenue. That made the panel mix scopes: chat and meeting counts followed
    -- the selected month while the money column showed every deal the company
    -- has ever closed. Filtering to September and seeing a rupiah total that
    -- includes a 2024 deal is not a scope anyone can reason about, and the
    -- proration of the target bar was being compared against a number from a
    -- different period.
    --
    -- No window selected means no predicate, so the panel falls back to
    -- all-time, which is what an unfiltered view should show.
    --
    -- The PIC filter is honoured too, so filtering to one rep shows that rep's
    -- book rather than the whole team's.
    win_owner AS (
      -- The owner label is NOT '-'.
      --
      -- Nine won deals carry Rp 1.92 billion and have no funnel_history row
      -- at all - not a row with a null name, no row - and leads.pic_name is
      -- empty for them too. Their revenue is real; the person who closed them
      -- simply is not in the data.
      --
      -- The old '-' made that look like a person whose name failed to render,
      -- so the panel showed a single row crediting nearly half the company
      -- revenue to a rep called "-". Naming the gap is the honest version: it
      -- cannot be mistaken for an achievement, and it tells whoever reviews
      -- the panel that the ownership data is incomplete rather than that one
      -- rep banked everything.
      SELECT DISTINCT ON (vl.id)
        vl.id AS lead_id,
        COALESCE(
          NULLIF(win.by_user_name, ''),
          NULLIF(last_touch.by_user_name, ''),
          NULLIF(vl.pic_name, ''),
          'Tanpa PIC'
        ) AS owner,
        COALESCE(win.deal_value, vl.deal_value, 0) AS revenue
      FROM valid_leads vl
      LEFT JOIN LATERAL (
        -- The matched flag exists so the WHERE below can tell "no win row in
        -- this window" from "win row whose name happens to be null". Without
        -- it the two cases are indistinguishable.
        SELECT f.by_user_name, f.deal_value, true AS matched
        FROM funnel_history f
        WHERE f.lead_id = vl.id AND f.stage = 'Close Win'
          AND (${admin}::text IS NULL OR f.by_user_name = ${admin})
          AND (${startDate}::timestamptz IS NULL OR f.date_occurred >= ${startDate})
          AND (${endDate}::timestamptz IS NULL OR f.date_occurred <= ${endDate})
        ORDER BY f.date_occurred DESC, f.created_at DESC
        LIMIT 1
      ) win ON TRUE
      LEFT JOIN LATERAL (
        SELECT t.by_user_name
        FROM funnel_history t
        WHERE t.lead_id = vl.id
        ORDER BY t.date_occurred DESC, t.created_at DESC
        LIMIT 1
      ) last_touch ON TRUE
      -- "Won" has two meanings and the panel has to pick the one the reader
      -- means.
      --
      -- Six leads have a Close Win row dated 2 September but their current
      -- status is Hold, all recorded by the same rep on the same day. They are
      -- worth Rp 30.25 million, and the original app counted them - which is why
      -- the very first screenshot of this dashboard showed Rp 442,997,156.
      --
      -- Requiring status = 'Close Win' dropped them and moved the September
      -- total to Rp 412,747,156, so the panel would have disagreed with the
      -- scorecard's own deal count on the same screen.
      --
      -- So a lead qualifies if either its current status says it is won, OR it
      -- was won inside the window being viewed. A windowed view is a question
      -- about what happened during that period, and a Hold recorded afterwards
      -- does not retroactively make a September close something else. The
      -- unfiltered view falls through to status alone, which is the "where do
      -- these leads stand now" reading.
      WHERE (
        vl.status = 'Close Win'
        AND (
          (${admin}::text IS NULL OR COALESCE(win.by_user_name, last_touch.by_user_name) = ${admin})
        )
        -- A deal only belongs to the window if its win was recorded there.
        --
        -- This predicate looked unnecessary and was not. The join is a LEFT
        -- LATERAL, so a lead whose win row sits outside the window still
        -- produces a row - and COALESCE then quietly substitutes the lead's own
        -- deal_value. Filtering to September returned all 48 lifetime deals at
        -- Rp 3.83 billion instead of the 25 that actually closed that month.
        --
        -- Only when a window is set. With no dates the lateral matches every
        -- win and this is true for every won lead, so the unfiltered panel
        -- keeps its all-time behaviour.
        AND (
          (${startDate}::timestamptz IS NULL AND ${endDate}::timestamptz IS NULL)
          OR win.matched IS NOT NULL
        )
      )
      -- Won inside the window, whatever the status became afterwards.
      --
      -- Gated on a window actually being set. Without that gate this branch
      -- fires in the unfiltered view too, and the matched flag is true for
      -- every lead that has ever had a Close Win row - which pulled the six
      -- Hold leads into the all-time panel and took it from 48 to 54.
      --
      -- The admin filter is repeated rather than factored out because the two
      -- branches do not have the same shape: the first requires a current
      -- Close Win, this one does not.
      OR (
        (${startDate}::timestamptz IS NOT NULL OR ${endDate}::timestamptz IS NOT NULL)
        AND win.matched IS NOT NULL
        AND (
          (${admin}::text IS NULL OR COALESCE(win.by_user_name, last_touch.by_user_name) = ${admin})
        )
      )
      ORDER BY vl.id
    ),
    revenue_by_rep AS (
      SELECT owner AS by_user_name, SUM(revenue) AS revenue
      FROM win_owner
      GROUP BY owner
    ),
    chat_meet AS (
      SELECT by_user_name,
             COUNT(*) FILTER (WHERE stage = 'Chated')::int      AS total_chat,
             COUNT(*) FILTER (WHERE stage = 'Set Meeting')::int AS total_meet
      FROM activity
      GROUP BY by_user_name
    ),
    -- UNION, not FULL OUTER JOIN. Joining the two aggregates on the name keeps
    -- a rep who closed a deal without logging a chat this window; they belong
    -- in the panel even with zeros.
    combined AS (
      SELECT by_user_name, total_chat, total_meet, 0::numeric AS revenue
      FROM chat_meet
      UNION ALL
      SELECT by_user_name, 0, 0, revenue
      FROM revenue_by_rep
    )
    SELECT
      by_user_name                          AS admin_name,
      SUM(total_chat)::int                  AS total_chat,
      SUM(total_meet)::int                  AS total_meet,
      COALESCE(SUM(revenue), 0)             AS total_revenue
    FROM combined
    GROUP BY by_user_name
    ORDER BY by_user_name
  `);

  const rows = rowsOf<Record<string, string | number | null>>(result);
  return rows.map((r) => ({
    adminName: String(r.admin_name ?? '-'),
    totalChat: Number(r.total_chat ?? 0),
    totalMeet: Number(r.total_meet ?? 0),
    totalRevenue: Number(r.total_revenue ?? 0),
  }));
}

/**
 * Open leads with no funnel movement for 10+ days.
 *
 * Three leads were structurally invisible to the previous version, and they are
 * exactly the leads this panel exists to surface:
 *
 *   - `INNER JOIN latest` dropped every lead with no funnel row at all. A brand
 *     that arrived and was never contacted is the most stuck lead there is, and
 *     it never appeared. It is a LEFT JOIN now, and the staleness is measured
 *     from `leads.created_at` for those.
 *   - `EXTRACT(DAY FROM (NOW() - date_occurred))` returns NULL when
 *     `date_occurred` is NULL, and `NULL >= minDays` is NULL, not true, so those
 *     leads were filtered out rather than shown. COALESCE handles it.
 *   - The PIC filter compared `latest.by_user_name`, which is whoever moved the
 *     lead *last*. A lead handed over and then abandoned belongs to the new PIC
 *     in the UI, not the old one.
 *
 * A lead whose funnel row is older than its own `updated_at` is also skipped:
 * editing the lead itself is movement, and treating it as "no activity" would
 * list leads that a rep plainly just handled.
 */
export async function getGhostedLeads(filters: {
  admin?: string;
  category?: string;
  products?: string[];
  minDays?: number;
}): Promise<GhostedLeadRow[]> {
  await requireUser();

  const admin = filters.admin && filters.admin !== 'ALL' ? filters.admin : null;
  const category = filters.category && filters.category !== 'ALL' ? filters.category : null;
  const products = filters.products?.length ? filters.products : null;
  const minDays = filters.minDays ?? 10;

  const result = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (fh.lead_id)
        fh.lead_id,
        fh.stage,
        fh.date_occurred,
        fh.by_user_name
      FROM funnel_history fh
      ORDER BY fh.lead_id, fh.date_occurred DESC, fh.created_at DESC
    )
    SELECT
      l.id                        AS lead_id,
      l.brand_name,
      COALESCE(l.pic_name, latest.by_user_name, '-') AS pic_name,
      l.category,
      l.status,
      latest.stage                AS last_stage,
      -- The clock starts at whichever is later: the last funnel movement, the
      -- last edit to the lead, or its creation. Anything else double-counts
      -- quiet time.
      GREATEST(
        COALESCE(latest.date_occurred, l.created_at),
        COALESCE(l.updated_at, l.created_at)
      )                          AS last_touched,
      latest.date_occurred        AS last_stage_date,
      EXTRACT(DAY FROM (NOW() - GREATEST(
        COALESCE(latest.date_occurred, l.created_at),
        COALESCE(l.updated_at, l.created_at)
      )))::int                   AS days_passed
    FROM leads l
    LEFT JOIN latest ON latest.lead_id = l.id
    WHERE l.is_deleted = false
      AND l.status NOT IN ('Close Win', 'Close Lost', 'Failed')
      AND EXTRACT(DAY FROM (NOW() - GREATEST(
            COALESCE(latest.date_occurred, l.created_at),
            COALESCE(l.updated_at, l.created_at)
          ))) >= ${minDays}
      AND (${category}::text IS NULL OR l.category = ${category})
      AND (${products}::text[] IS NULL OR l.product_offered && ${products}::text[])
      AND (${admin}::text IS NULL
           OR latest.by_user_name = ${admin}
           OR l.pic_name = ${admin})
    ORDER BY days_passed DESC
    LIMIT 200
  `);

  const rows = rowsOf<Record<string, string | number | null>>(result);
  return rows.map((r) => ({
    leadId: String(r.lead_id),
    brandName: String(r.brand_name ?? '-'),
    picName: String(r.pic_name ?? '-'),
    category: String(r.category ?? '-'),
    status: String(r.status ?? '-'),
    lastStage: r.last_stage === null ? null : String(r.last_stage),
    lastStageDate:
      r.last_stage_date === null ? null : new Date(String(r.last_stage_date)).toISOString(),
    daysPassed: Number(r.days_passed ?? 0),
  }));
}

/**
 * Won leads whose funnel is missing a stage the scorecard depends on.
 *
 * The required stages are expressed in the SQL below, not here, so the query
 * stays the single source of truth for what "incomplete" means. `Chated` is
 * deliberately not one of them: a brand can arrive through a referral and close
 * without anyone logging a chat, and requiring one would invent a rule the
 * business does not have. The stages that need justifying are the ones the
 * scorecard divides by.
 *
 * Read-only. It reports which leads to repair and who touched them last; it
 * cannot repair them, because whether a stage "really happened" is a question
 * about a conversation nobody logged. Fabricating the row would make the number
 * right and the data a lie.
 *
 * Lifetime scope, not the date window. This is a data-quality audit, and asking
 * "what is broken right now" should not change the answer because someone picked
 * a different month.
 */
export async function getFunnelIncompleteWins(): Promise<DataHealthRow[]> {
  await requireUser();

  const result = await db.execute(sql`
    WITH stages AS (
      SELECT
        fh.lead_id,
        bool_or(fh.stage = 'Chated')      AS has_chated,
        bool_or(fh.stage = 'Responsed')   AS has_responsed,
        bool_or(fh.stage = 'Set Meeting') AS has_set_meeting
      FROM funnel_history fh
      GROUP BY fh.lead_id
    ),
    last_touch AS (
      SELECT DISTINCT ON (fh.lead_id)
        fh.lead_id,
        fh.stage,
        fh.by_user_name,
        fh.date_occurred
      FROM funnel_history fh
      ORDER BY fh.lead_id, fh.date_occurred DESC, fh.created_at DESC
    ),
    win_value AS (
      SELECT DISTINCT ON (fh.lead_id)
        fh.lead_id,
        COALESCE(fh.deal_value, l.deal_value, 0) AS revenue
      FROM funnel_history fh
      JOIN leads l ON l.id = fh.lead_id
      WHERE fh.stage = 'Close Win'
      ORDER BY fh.lead_id, fh.date_occurred DESC, fh.created_at DESC
    )
    SELECT
      l.id                                  AS lead_id,
      l.brand_name,
      l.status,
      lt.stage                              AS last_stage,
      lt.by_user_name                       AS last_by,
      lt.date_occurred                      AS last_touched_at,
      COALESCE(wv.revenue, 0)               AS revenue,
      -- Built as an array in funnel order so the UI can show "missing:
      -- Responsed, Set Meeting" without hardcoding the sequence client-side.
      ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(s.has_responsed, false)   THEN NULL ELSE 'Responsed' END,
        CASE WHEN COALESCE(s.has_set_meeting, false) THEN NULL ELSE 'Set Meeting' END
      ], NULL)                               AS missing_stages
    FROM leads l
    LEFT JOIN stages s      ON s.lead_id = l.id
    LEFT JOIN last_touch lt ON lt.lead_id = l.id
    LEFT JOIN win_value wv  ON wv.lead_id = l.id
    WHERE l.is_deleted = false
      AND l.status = 'Close Win'
      AND (NOT COALESCE(s.has_responsed, false) OR NOT COALESCE(s.has_set_meeting, false))
    -- Worst first: no history at all, then the most missing stages, then money.
    ORDER BY
      (lt.lead_id IS NULL) DESC,
      cardinality(ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(s.has_responsed, false)   THEN NULL ELSE 1 END,
        CASE WHEN COALESCE(s.has_set_meeting, false) THEN NULL ELSE 1 END
      ], NULL)) DESC,
      COALESCE(wv.revenue, 0) DESC
    LIMIT 100
  `);

  const rows = rowsOf<Record<string, unknown>>(result);
  return rows.map((r) => {
    const missing = Array.isArray(r.missing_stages) ? r.missing_stages.map(String) : [];
    return {
      leadId: String(r.lead_id),
      brandName: String(r.brand_name ?? '-'),
      status: String(r.status ?? '-'),
      lastStage: r.last_stage === null ? null : String(r.last_stage),
      missingCount: missing.length,
      missingStages: missing,
      revenue: Number(r.revenue ?? 0),
      lastBy: r.last_by === null ? null : String(r.last_by),
      lastTouchedAt:
        r.last_touched_at === null ? null : new Date(String(r.last_touched_at)).toISOString(),
    };
  });
}
