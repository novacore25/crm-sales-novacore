'use server';

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { requireUser } from '@/lib/auth';

export interface DashboardStats {
  totalLeads: number;
  totalChated: number;
  totalResponsed: number;
  totalSetMeeting: number;
  dealsWon: number;
  lostDeals: number;
  failedDeals: number;
  totalRevenue: number;
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
  totalChated: 0,
  totalResponsed: 0,
  totalSetMeeting: 0,
  dealsWon: 0,
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
 * This is the SQL that used to live in the `get_dashboard_stats` Postgres
 * function. Keeping it server-side is the important part: the legacy version
 * also recomputed these same numbers in JavaScript inside DashboardClient, and
 * the two implementations drifted.
 *
 * `productFilter` is bound as a real PostgreSQL array. Under PostgREST a JS
 * array was serialised to JSON, which is not the same thing to the `&&` overlap
 * operator.
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
    scoped AS (
      SELECT
        vl.id,
        vl.deal_value,
        COALESCE(bool_or(fh.stage = 'Chated'), false)      AS has_chated,
        COALESCE(bool_or(fh.stage = 'Responsed'), false)   AS has_responsed,
        COALESCE(bool_or(fh.stage = 'Set Meeting'), false) AS has_set_meeting,
        COALESCE(bool_or(fh.stage = 'Close Win'), false)   AS has_close_win,
        COALESCE(bool_or(fh.stage = 'Close Lost'), false)  AS has_close_lost,
        COALESCE(bool_or(fh.stage = 'Failed'), false)      AS has_failed,
        MAX(
          CASE WHEN fh.stage = 'Close Win'
               THEN COALESCE(fh.deal_value, vl.deal_value)
               ELSE 0 END
        ) AS win_revenue
      FROM valid_leads vl
      LEFT JOIN funnel_history fh ON fh.lead_id = vl.id
        AND (${startDate}::timestamptz IS NULL OR fh.date_occurred >= ${startDate})
        AND (${endDate}::timestamptz IS NULL OR fh.date_occurred <= ${endDate})
        AND (${admin}::text IS NULL OR fh.by_user_name = ${admin})
      GROUP BY vl.id, vl.deal_value
    )
    SELECT
      COUNT(*)::int                                        AS total_leads,
      COUNT(*) FILTER (WHERE has_chated)::int               AS total_chated,
      COUNT(*) FILTER (WHERE has_responsed)::int            AS total_responsed,
      COUNT(*) FILTER (WHERE has_set_meeting)::int          AS total_set_meeting,
      COUNT(*) FILTER (WHERE has_close_win)::int            AS deals_won,
      COUNT(*) FILTER (WHERE has_close_lost)::int           AS lost_deals,
      COUNT(*) FILTER (WHERE has_failed)::int               AS failed_deals,
      COALESCE(SUM(win_revenue), 0)                        AS total_revenue
    FROM scoped
  `);

  const rows = rowsOf<Record<string, number | null>>(result);
  const row = rows[0];
  if (!row) return EMPTY_STATS;

  return {
    totalLeads: Number(row.total_leads ?? 0),
    totalChated: Number(row.total_chated ?? 0),
    totalResponsed: Number(row.total_responsed ?? 0),
    totalSetMeeting: Number(row.total_set_meeting ?? 0),
    dealsWon: Number(row.deals_won ?? 0),
    lostDeals: Number(row.lost_deals ?? 0),
    failedDeals: Number(row.failed_deals ?? 0),
    totalRevenue: Number(row.total_revenue ?? 0),
  };
}

/** Per-rep contribution over a date window (was `get_individual_contributions`). */
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
      SELECT l.id, l.deal_value
      FROM leads l
      WHERE l.is_deleted = false
        AND (${category}::text IS NULL OR l.category = ${category})
        AND (${products}::text[] IS NULL OR l.product_offered && ${products}::text[])
    ),
    ranked AS (
      SELECT
        fh.by_user_name,
        fh.lead_id,
        fh.stage,
        COALESCE(fh.deal_value, vl.deal_value, 0) AS deal_value,
        ROW_NUMBER() OVER (
          PARTITION BY fh.by_user_name, fh.lead_id, fh.stage
          ORDER BY fh.date_occurred DESC, fh.created_at DESC
        ) AS rn
      FROM funnel_history fh
      JOIN valid_leads vl ON vl.id = fh.lead_id
      WHERE (${startDate}::timestamptz IS NULL OR fh.date_occurred >= ${startDate})
        AND (${endDate}::timestamptz IS NULL OR fh.date_occurred <= ${endDate})
        AND (${admin}::text IS NULL OR fh.by_user_name = ${admin})
    )
    SELECT
      by_user_name                                          AS admin_name,
      COUNT(*) FILTER (WHERE stage = 'Chated')::int         AS total_chat,
      COUNT(*) FILTER (WHERE stage = 'Set Meeting')::int    AS total_meet,
      COALESCE(SUM(deal_value) FILTER (WHERE stage = 'Close Win'), 0) AS total_revenue
    FROM ranked
    WHERE rn = 1
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
 * Open leads with no funnel movement for 10+ days (was `get_ghosted_leads`).
 *
 * The original function returned `lead_id UUID` and selected `leads.pic_name`,
 * neither of which matched the TEXT-keyed schema, so it could not have
 * executed. This version reads the real columns.
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
      latest.date_occurred        AS last_stage_date,
      EXTRACT(DAY FROM (NOW() - latest.date_occurred))::int AS days_passed
    FROM leads l
    JOIN latest ON latest.lead_id = l.id
    WHERE l.is_deleted = false
      AND l.status NOT IN ('Close Win', 'Close Lost', 'Failed')
      AND EXTRACT(DAY FROM (NOW() - latest.date_occurred)) >= ${minDays}
      AND (${category}::text IS NULL OR l.category = ${category})
      AND (${products}::text[] IS NULL OR l.product_offered && ${products}::text[])
      AND (${admin}::text IS NULL OR latest.by_user_name = ${admin})
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
