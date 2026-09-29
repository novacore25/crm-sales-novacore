'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { funnelHistory, leads, oiForecasts } from '@/db/schema';
import { requireUser } from '@/lib/auth';

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
  updatedAt: string;
  latestStage: string | null;
  latestPic: string | null;
  latestStageDate: string | null;
}

export async function getOIForecasts(): Promise<OIForecastRow[]> {
  await requireUser();

  // The "most recent action" columns are computed with a lateral join rather
  // than embedding funnel_history(*) and sorting in JS, so the response size
  // stays flat regardless of how many leads are in the table.
  const rows = await db
    .select({
      forecast: oiForecasts,
      brandName: leads.brandName,
      latestStage: sql<string | null>`(
        SELECT fh.stage FROM funnel_history fh
        WHERE fh.lead_id = ${oiForecasts.leadId}
        ORDER BY fh.date_occurred DESC, fh.created_at DESC
        LIMIT 1
      )`,
      latestPic: sql<string | null>`(
        SELECT fh.by_user_name FROM funnel_history fh
        WHERE fh.lead_id = ${oiForecasts.leadId}
        ORDER BY fh.date_occurred DESC, fh.created_at DESC
        LIMIT 1
      )`,
      latestStageDate: sql<string | null>`(
        SELECT fh.date_occurred FROM funnel_history fh
        WHERE fh.lead_id = ${oiForecasts.leadId}
        ORDER BY fh.date_occurred DESC, fh.created_at DESC
        LIMIT 1
      )`,
    })
    .from(oiForecasts)
    .leftJoin(leads, eq(oiForecasts.leadId, leads.id));

  return rows.map((r) => ({
    id: r.forecast.id,
    leadId: r.forecast.leadId,
    brandName: r.brandName ?? '-',
    monthYear: r.forecast.monthYear,
    product: r.forecast.product,
    value: Number(r.forecast.value ?? 0),
    campaignNumber: r.forecast.campaignNumber,
    budgetAds: Number(r.forecast.budgetAds ?? 0),
    budgetCreator: Number(r.forecast.budgetCreator ?? 0),
    grossMargin: Number(r.forecast.grossMargin ?? 0),
    realMargin: Number(r.forecast.realMargin ?? 0),
    realPayment: Number(r.forecast.realPayment ?? 0),
    targetGmv: r.forecast.targetGmv === null ? null : Number(r.forecast.targetGmv),
    targetCreator: r.forecast.targetCreator === null ? null : Number(r.forecast.targetCreator),
    targetVideoAffiliate: r.forecast.targetVideoAffiliate,
    targetVideoInternal: r.forecast.targetVideoInternal,
    targetViews: r.forecast.targetViews,
    successRate: Number(r.forecast.successRate ?? 0),
    status: r.forecast.status ?? 'OPEN',
    tier: r.forecast.tier ?? '-',
    category: r.forecast.category,
    lastFollowUp: r.forecast.lastFollowUp?.toISOString() ?? null,
    noteSales: r.forecast.noteSales,
    dateQuotation: r.forecast.dateQuotation,
    picQuotation: r.forecast.picQuotation,
    dateInvoice: r.forecast.dateInvoice,
    picInvoice: r.forecast.picInvoice,
    isDeleted: r.forecast.isDeleted ?? false,
    createdAt: r.forecast.createdAt?.toISOString() ?? '',
    updatedAt: r.forecast.updatedAt?.toISOString() ?? '',
    latestStage: r.latestStage,
    latestPic: r.latestPic,
    latestStageDate: r.latestStageDate
      ? new Date(r.latestStageDate).toISOString()
      : null,
  }));
}

const forecastSchema = z.object({
  leadId: z.string().min(1),
  monthYear: z.string().regex(/^\d{4}-\d{2}$/),
  product: z.string().min(1),
  value: z.number().default(0),
  campaignNumber: z.number().int().optional().nullable(),
  budgetAds: z.number().default(0),
  budgetCreator: z.number().default(0),
  category: z.string().optional().nullable(),
});

export async function createOIForecast(
  input: z.infer<typeof forecastSchema>,
): Promise<{ success: boolean; id?: string; error?: string }> {
  await requireUser();

  const parsed = forecastSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message };
  const data = parsed.data;

  const id = crypto.randomUUID();
  const now = new Date();
  const value = String(data.value || 0);

  // gross_margin mirrors the UI's derived margin: value minus the ad and
  // creator budgets, floored at zero.
  const grossMargin = Math.max(0, data.value - data.budgetAds - data.budgetCreator);

  await db.insert(oiForecasts).values({
    id,
    leadId: data.leadId,
    monthYear: data.monthYear,
    product: data.product,
    value,
    campaignNumber: data.campaignNumber ?? null,
    budgetAds: String(data.budgetAds || 0),
    budgetCreator: String(data.budgetCreator || 0),
    grossMargin: String(grossMargin),
    successRate: '0',
    status: 'OPEN',
    tier: '-',
    category: data.category ?? null,
    createdAt: now,
    updatedAt: now,
  });

  revalidatePath('/oi_forecast');
  return { success: true, id };
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

/**
 * Update one cell of a forecast row.
 *
 * Field names are whitelisted against the two sets above. The legacy handler
 * built its column name from a `fieldMap` that was missing `campaignNumber`, so
 * the "Camp. Ke" cell wrote to a column that does not exist and silently did
 * nothing. An explicit allowlist makes that class of bug impossible: anything
 * not in the sets is rejected before it reaches SQL.
 */
export async function updateOIForecastField(input: {
  id: string;
  field: string;
  value: string | number | null;
}): Promise<{ success: boolean; error?: string }> {
  await requireUser();

  const { id, field } = input;
  const raw = input.value;

  const patch: Record<string, unknown> = { updatedAt: new Date() };

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
 * Mark a forecast as won or lost and sync the parent lead.
 *
 * The legacy code issued four separate requests (forecast update, lead status
 * update, funnel value update, lead deal value update) with no transaction, so a
 * failure midway left the three tables disagreeing.
 */
export async function setOIForecastStatus(input: {
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
  const leadStatus = isWin ? 'Close Win' : input.status === 'LOSE' ? 'Close Lost' : 'Leads';

  await db.transaction(async (tx) => {
    await tx
      .update(oiForecasts)
      .set({ status: input.status, updatedAt: now })
      .where(eq(oiForecasts.id, forecast.id));

    await tx
      .update(leads)
      .set({
        status: leadStatus as never,
        ...(isWin ? { dateClosed: now } : {}),
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
