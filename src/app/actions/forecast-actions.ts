'use server';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { funnelHistory, leads, oiForecasts } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { guardAction } from '@/lib/action-guard';
import { FUNNEL_STAGES } from '@/db/enums';

/**
 * `funnel_history.stage` is plain TEXT while `leads.status` is the `lead_status`
 * enum, so re-deriving a status from history has to narrow rather than cast.
 * An unrecognised stage degrades to 'Leads' instead of aborting the write.
 */
function toLeadStatus(stage: string | null | undefined): (typeof FUNNEL_STAGES)[number] {
  return (FUNNEL_STAGES as readonly string[]).includes(stage ?? '')
    ? (stage as (typeof FUNNEL_STAGES)[number])
    : 'Leads';
}

/** A brand may appear once per month, product and campaign. */
function duplicatesIn(
  existing: Array<{ leadId: string; monthYear: string; product: string }>,
  leadIds: string[],
  monthYear: string,
  product: string,
): Set<string> {
  if (!leadIds.length) return new Set();
  const wanted = new Set(leadIds);
  return new Set(
    existing
      .filter(
        (r) => r.monthYear === monthYear && r.product === product && wanted.has(r.leadId),
      )
      .map((r) => r.leadId),
  );
}

/**
 * `db.execute()` on the node-postgres driver resolves to the raw `pg`
 * QueryResult, not to an array - the rows live on `.rows`. This accepts either
 * shape so the query above reads normally.
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const toIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** A `date` column arrives as a Date at UTC midnight; the UI wants YYYY-MM-DD. */
const toDateStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** One step in a lead's funnel trail, as shown in the grid. */
export interface OIMilestone {
  stage: string;
  by: string | null;
  at: string | null;
  note: string | null;
}

export interface OIForecastRow {
  id: string;
  leadId: string;
  brandName: string;
  monthYear: string;
  product: string;
  value: number;
  campaignNumber: number | null;
  budgetAds: number;
  budgetCreator: number;
  grossMargin: number;
  realMargin: number;
  realPayment: number;
  targetGmv: number | null;
  targetCreator: number | null;
  targetVideoAffiliate: number | null;
  targetVideoInternal: number | null;
  targetViews: number | null;
  successRate: number;
  status: string;
  tier: string;
  category: string | null;
  lastFollowUp: string | null;
  noteSales: string | null;
  dateQuotation: string | null;
  picQuotation: string | null;
  dateInvoice: string | null;
  picInvoice: string | null;
  isDeleted: boolean;
  createdAt: string;
  latestStage: string | null;
  latestPic: string | null;
  latestStageDate: string | null;
  /** Who last edited this row, and when - to the minute. */
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  /** The full funnel trail for the lead behind this forecast. */
  milestones: OIMilestone[];
}

export async function getOIForecasts(): Promise<OIForecastRow[]> {
  await requireUser();

  // The three "latest action" columns come from ONE lateral join, and a second
  // lateral aggregates the whole milestone trail for the row.
  //
  // The previous version wrote three identical correlated subqueries, each with
  // its own ORDER BY ... LIMIT 1, so resolving the latest funnel row per
  // forecast cost three index walks instead of one. A LATERAL join lets
  // Postgres scan that index once and return all three columns from the row it
  // settled on. Semantics are identical - ORDER BY date_occurred DESC,
  // created_at DESC in both.
  //
  // `milestones` carries the whole journey, not just where it ended, so the
  // grid can show "Close Win 15 Sep oleh Budi" next to "Responsed 3 Sep oleh
  // Budi" - who moved the deal, and when, at each step.
  const rows = await db.execute(sql`
    SELECT
      f.*,
      l.brand_name,
      latest.stage         AS latest_stage,
      latest.by_user_name  AS latest_pic,
      latest.date_occurred AS latest_stage_date,
      (
        SELECT json_agg(
                 json_build_object(
                   'stage', fh.stage,
                   'by',    fh.by_user_name,
                   'at',    fh.date_occurred,
                   'note',  fh.note
                 )
                 ORDER BY fh.date_occurred, fh.created_at
               )
        FROM funnel_history fh
        WHERE fh.lead_id = f.lead_id
      ) AS milestones
    FROM oi_forecasts f
    LEFT JOIN leads l ON l.id = f.lead_id
    LEFT JOIN LATERAL (
      SELECT fh.stage, fh.by_user_name, fh.date_occurred
      FROM funnel_history fh
      WHERE fh.lead_id = f.lead_id
      ORDER BY fh.date_occurred DESC, fh.created_at DESC
      LIMIT 1
    ) latest ON TRUE
  `);

  return rowsOf<Record<string, unknown>>(rows).map((r) => ({
    id: String(r.id),
    leadId: String(r.lead_id),
    brandName: (r.brand_name as string | null) ?? '-',
    monthYear: String(r.month_year),
    product: String(r.product),
    value: num(r.value),
    campaignNumber: (r.campaign_number as number | null) ?? null,
    budgetAds: num(r.budget_ads),
    budgetCreator: num(r.budget_creator),
    grossMargin: num(r.gross_margin),
    realMargin: num(r.real_margin),
    realPayment: num(r.real_payment),
    targetGmv: r.target_gmv === null || r.target_gmv === undefined ? null : num(r.target_gmv),
    targetCreator:
      r.target_creator === null || r.target_creator === undefined ? null : num(r.target_creator),
    targetVideoAffiliate: (r.target_video_affiliate as number | null) ?? null,
    targetVideoInternal: (r.target_video_internal as number | null) ?? null,
    targetViews: (r.target_views as number | null) ?? null,
    successRate: num(r.success_rate),
    status: (r.status as string | null) ?? 'OPEN',
    tier: (r.tier as string | null) ?? '-',
    category: (r.category as string | null) ?? null,
    lastFollowUp: toIso(r.last_follow_up),
    noteSales: (r.note_sales as string | null) ?? null,
    dateQuotation: toDateStr(r.date_quotation),
    picQuotation: (r.pic_quotation as string | null) ?? null,
    dateInvoice: toDateStr(r.date_invoice),
    picInvoice: (r.pic_invoice as string | null) ?? null,
    isDeleted: r.is_deleted === true || r.is_deleted === 't',
    createdAt: toIso(r.created_at) ?? '',
    latestStage: (r.latest_stage as string | null) ?? null,
    latestPic: (r.latest_pic as string | null) ?? null,
    latestStageDate: toIso(r.latest_stage_date),
    updatedBy: (r.updated_by as string | null) ?? null,
    updatedByName: (r.updated_by_name as string | null) ?? null,
    updatedAt: toIso(r.updated_at),
    milestones: toMilestones(r.milestones),
  }));
}

/**
 * Normalise the json_agg result. pg returns json as a string unless parsed, so
 * accept both shapes.
 */
function toMilestones(raw: unknown): OIMilestone[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  return value.map((m) => {
    const o = (m ?? {}) as Record<string, unknown>;
    return {
      stage: String(o.stage ?? ''),
      by: (o.by as string | null) ?? null,
      at: toIso(o.at),
      note: (o.note as string | null) ?? null,
    };
  });
}

const forecastSchema = z.object({
  leadId: z.string().min(1),
  monthYear: z.string().regex(/^\d{4}-\d{2}$/),
  product: z.string().min(1),
  value: z.number().default(0),
  campaignNumber: z.number().int().min(1).optional().nullable(),
  budgetAds: z.number().default(0),
  budgetCreator: z.number().default(0),
  category: z.string().optional().nullable(),
  /**
   * 50 matches the scenario the grid shows for a brand nobody has judged yet
   * ("Realistic"). The server previously stored 0 while the client optimistically
   * rendered 50, so a newly added row silently jumped from Realistic to Worst
   * Case on the next reload.
   */
  successRate: z.number().min(0).max(100).default(50),
});

export async function createOIForecast(
  input: z.infer<typeof forecastSchema>,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const user = await requireUser();

  const parsed = forecastSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message };
  const data = parsed.data;

  // Dedupe server-side. The grid also checks, but that check only sees the rows
  // already in the browser: two open tabs, or a lead added by someone else in
  // between, would both pass it and insert a duplicate. A unique index backs
  // this up, so the database is the real guarantee.
  const existing = await db
    .select({ leadId: oiForecasts.leadId, monthYear: oiForecasts.monthYear, product: oiForecasts.product })
    .from(oiForecasts)
    .where(
      and(
        eq(oiForecasts.monthYear, data.monthYear),
        eq(oiForecasts.product, data.product),
        inArray(oiForecasts.leadId, [data.leadId]),
      ),
    );

  if (duplicatesIn(existing, [data.leadId], data.monthYear, data.product).size > 0) {
    return {
      success: false,
      error: 'Brand ini sudah ada di forecast bulan ini untuk produk tersebut.',
    };
  }

  const id = crypto.randomUUID();
  const now = new Date();

  // gross_margin mirrors the grid's derivation: value minus the two budgets,
  // floored at zero. Computed here so the stored value matches what the cell
  // showed the moment the row appeared.
  const grossMargin = Math.max(0, data.value - data.budgetAds - data.budgetCreator);

  try {
    await db.insert(oiForecasts).values({
      id,
      leadId: data.leadId,
      monthYear: data.monthYear,
      product: data.product,
      value: String(data.value || 0),
      campaignNumber: data.campaignNumber ?? null,
      budgetAds: String(data.budgetAds || 0),
      budgetCreator: String(data.budgetCreator || 0),
      grossMargin: String(grossMargin),
      successRate: String(data.successRate),
      status: 'OPEN',
      tier: '-',
      category: data.category ?? null,
      createdAt: now,
      updatedAt: now,
      // The row is born attributed: whoever added the brand owns it until
      // someone else edits it.
      updatedBy: user.id,
      updatedByName: user.name,
    });
  } catch (error) {
    // The unique index is the authoritative guard; translate its violation into
    // the same message the pre-check would have produced.
    if (isUniqueViolation(error)) {
      return {
        success: false,
        error: 'Brand ini sudah ada di forecast bulan ini untuk produk tersebut.',
      };
    }
    throw error;
  }

  revalidatePath('/oi_forecast');
  return { success: true, id };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** Numeric columns the OI grid is allowed to edit. */
const EDITABLE_NUMERIC_FIELDS = new Set([
  'value',
  'campaignNumber',
  'budgetAds',
  'budgetCreator',
  'realMargin',
  'realPayment',
  'targetGmv',
  'targetCreator',
  'targetVideoAffiliate',
  'targetVideoInternal',
  'targetViews',
  'successRate',
]);

const EDITABLE_TEXT_FIELDS = new Set([
  'tier',
  'category',
  'noteSales',
  'picQuotation',
  'picInvoice',
  'lastFollowUp',
  'dateQuotation',
  'dateInvoice',
]);

/* Wrapped so a database rejection reaches the user as a readable
   message. See src/lib/action-guard.ts for why. */
export const updateOIForecastField = guardAction('updateOIForecastField', updateOIForecastFieldImpl);

/**
 * Update one cell of a forecast row.
 *
 * Field names are whitelisted against the two sets above. The legacy handler
 * built its column name from a `fieldMap` that was missing `campaignNumber`, so
 * the "Camp. Ke" cell wrote to a column that does not exist and silently did
 * nothing. An explicit allowlist makes that class of bug impossible: anything
 * not in the sets is rejected before it reaches SQL.
 */
async function updateOIForecastFieldImpl(input: {
  id: string;
  field: string;
  value: string | number | null;
}): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  const { id, field } = input;
  const raw = input.value;

  // Every cell edit is attributed. Without this the grid could only say a row
  // changed at some point, which is not enough to settle a disputed number.
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: user.id,
    updatedByName: user.name,
  };

  if (EDITABLE_NUMERIC_FIELDS.has(field)) {
    if (field === 'campaignNumber') {
      patch[field] = raw === null || raw === '' ? null : Math.trunc(Number(raw));
    } else if (field === 'targetVideoAffiliate' || field === 'targetVideoInternal' || field === 'targetViews') {
      patch[field] = raw === null || raw === '' ? null : Math.trunc(Number(raw));
    } else {
      patch[field] = String(Number(raw) || 0);
    }
  } else if (EDITABLE_TEXT_FIELDS.has(field)) {
    if (field === 'lastFollowUp') {
      patch[field] = raw ? new Date(String(raw)) : null;
    } else if (field === 'dateQuotation' || field === 'dateInvoice') {
      patch[field] = raw ? String(raw).slice(0, 10) : null;
    } else {
      patch[field] = raw === null || raw === '' ? null : String(raw);
    }
  } else {
    return { success: false, error: `Field tidak dapat diubah: ${field}` };
  }

  const updated = await db
    .update(oiForecasts)
    .set(patch)
    .where(eq(oiForecasts.id, id))
    .returning({ id: oiForecasts.id });

  if (!updated[0]) return { success: false, error: 'Forecast tidak ditemukan' };

  // Keep gross_margin consistent whenever the inputs to it change.
  if (field === 'value' || field === 'budgetAds' || field === 'budgetCreator') {
    await db.execute(sql`
      UPDATE oi_forecasts
      SET gross_margin = GREATEST(0, ${oiForecasts.value} - ${oiForecasts.budgetAds} - ${oiForecasts.budgetCreator})
      WHERE id = ${id}
    `);
  }

  revalidatePath('/oi_forecast');
  return { success: true };
}

/**
 * Mark a forecast as won or lost, and sync the parent lead only when the
 * transition actually implies a closing stage.
 *
 * Forecast status and lead status are NOT the same thing. A forecast sits at
 * OPEN for as long as the deal is in play; the lead behind it can be at Chated,
 * Responsed, Set Meeting or Hold. So:
 *
 *   WIN   -> the deal closed successfully. Lead moves to Close Win and gets a
 *            date_closed.
 *   LOSE  -> the deal closed unsuccessfully. Lead moves to Close Lost and also
 *            gets a date_closed, matching how addFunnelHistory treats both
 *            closing stages.
 *   OPEN  -> nothing was concluded. The lead is left exactly as it is.
 *
 * The previous version mapped OPEN to 'Leads', so opening the status modal for
 * a lead sitting at Set Meeting and saving silently threw away its whole funnel
 * progress. It also never cleared date_closed, so a lead reverted from WIN kept
 * a closing date that no longer meant anything.
 */
/* Wrapped so a database rejection reaches the user as a readable
   message. See src/lib/action-guard.ts for why. */
export const setOIForecastStatus = guardAction('setOIForecastStatus', setOIForecastStatusImpl);

async function setOIForecastStatusImpl(input: {
  id: string;
  status: 'WIN' | 'LOSE' | 'OPEN';
  dealValue?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  const rows = await db
    .select()
    .from(oiForecasts)
    .where(eq(oiForecasts.id, input.id))
    .limit(1);
  const forecast = rows[0];
  if (!forecast) return { success: false, error: 'Forecast tidak ditemukan' };

  const now = new Date();
  const isWin = input.status === 'WIN';
  const isLose = input.status === 'LOSE';
  const isRevert = input.status === 'OPEN';

  await db.transaction(async (tx) => {
    await tx
      .update(oiForecasts)
      .set({
        status: input.status,
        updatedAt: now,
        updatedBy: user.id,
        updatedByName: user.name,
      })
      .where(eq(oiForecasts.id, forecast.id));

    if (isRevert) {
      // Un-concluding a deal: release the lead from its closing stage so the
      // funnel is not left claiming the lead was closed. The exact stage the
      // lead should return to is whatever the surviving funnel history says.
      const latest = await tx
        .select({ stage: funnelHistory.stage })
        .from(funnelHistory)
        .where(eq(funnelHistory.leadId, forecast.leadId))
        .orderBy(desc(funnelHistory.createdAt))
        .limit(1);

      const restored = toLeadStatus(latest[0]?.stage);
      await tx
        .update(leads)
        .set({ status: restored, dateClosed: null, updatedAt: now })
        .where(eq(leads.id, forecast.leadId));
      return;
    }

    await tx
      .update(leads)
      .set({
        status: (isWin ? 'Close Win' : 'Close Lost') as never,
        dateClosed: now,
        ...(input.dealValue != null ? { dealValue: String(input.dealValue) } : {}),
        updatedAt: now,
      })
      .where(eq(leads.id, forecast.leadId));

    if (isWin && input.dealValue != null) {
      await tx
        .update(funnelHistory)
        .set({ dealValue: String(input.dealValue) })
        .where(
          and(
            eq(funnelHistory.leadId, forecast.leadId),
            eq(funnelHistory.stage, 'Close Win'),
            eq(funnelHistory.campaignNumber, forecast.campaignNumber ?? 1),
          ),
        );
    }
  });

  revalidatePath('/');
  revalidatePath('/oi_forecast');
  revalidatePath(`/lead/${forecast.leadId}`);
  return { success: true };
}

/**
 * Delete a forecast row only. The lead and its funnel trail are untouched -
 * deleting a monitoring row must never destroy the underlying lead record.
 */
export async function deleteOIForecast(id: string): Promise<{ success: boolean; error?: string }> {
  await requireUser();
  const deleted = await db
    .delete(oiForecasts)
    .where(eq(oiForecasts.id, id))
    .returning({ id: oiForecasts.id });

  if (!deleted[0]) return { success: false, error: 'Forecast tidak ditemukan' };

  revalidatePath('/oi_forecast');
  return { success: true };
}

/** Leads eligible to be added to the OI forecast for a given month. */
export async function getForecastableLeads(monthYear?: string): Promise<
  Array<{ id: string; brandName: string; status: string; category: string }>
> {
  await requireUser();

  const rows = await db
    .select({
      id: leads.id,
      brandName: leads.brandName,
      status: leads.status,
      category: leads.category,
    })
    .from(leads)
    .where(eq(leads.isDeleted, false));

  return rows.map((r) => ({
    id: r.id,
    brandName: r.brandName,
    status: r.status,
    category: r.category,
  }));
}
