import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Enum definitions.
 *
 * Values are preserved verbatim from the legacy Supabase schema so that
 * migrated rows keep working without a data rewrite. Product values were
 * renamed Basemen -> MCN (migration 20260916000000_rename_basemen_to_mcn.sql),
 * which is a data-level rename, not an enum change.
 */
export const userRoleEnum = pgEnum('user_role', ['lord', 'admin', 'staff', 'pending']);

export const leadStatusEnum = pgEnum('lead_status', [
  'Leads',
  'Chated',
  'Responsed',
  'Set Meeting',
  'Hold',
  'Close Win',
  'Close Lost',
  'Failed',
]);

export const interestLevelEnum = pgEnum('interest_level', ['HOT', 'WARM', 'COLD', '-']);

export const taskPriorityEnum = pgEnum('task_priority', ['Low', 'Medium', 'High']);

export const taskStatusEnum = pgEnum('task_status', ['Todo', 'In Progress', 'Done']);

export const editRequestStatusEnum = pgEnum('edit_request_status', [
  'pending',
  'approved',
  'rejected',
]);

export const forecastStatusEnum = pgEnum('forecast_status', ['WIN', 'OPEN', 'LOSE']);

export const productEnum = pgEnum('product', ['MCN', 'TNT', 'HYPE']);

// ---------------------------------------------------------------------------
// Documents (quotation / invoice)
// ---------------------------------------------------------------------------

/**
 * Document lifecycle.
 *
 * DRAFT   - still being typed. Fully editable, and it may already hold a number:
 *           the office types the number first, then instantiates the document, so
 *           forbidding a number on a draft broke their real order of work.
 * ISSUED  - a real document. The number is assigned and the record is locked,
 *           because a number that has left the office cannot change meaning.
 * CANCELLED - the number is spent and is never reused, even though no document
 *           stands behind it. That is deliberate: a gap in the sequence is
 *           visible and explainable, a reused number is not.
 * REVISION - a replacement for an ISSUED document, carrying the same base number
 *           with an /R1 suffix. The original stays in the archive untouched.
 */
export const documentStatusEnum = pgEnum('document_status', [
  'DRAFT',
  'ISSUED',
  'CANCELLED',
  'REVISION',
]);

/**
 * Which company a document is issued under.
 *
 * Not the same as `productEnum`. MCN is a product sold through the Thick and
 * Thin letterhead, so "which logo goes on top" and "which product is this" are
 * genuinely different questions. A company maps to a template; the product does
 * not.
 */
export const documentCompanyEnum = pgEnum('document_company', ['TNT', 'HYPE']);

/** Quotation or invoice. */
export const documentTypeEnum = pgEnum('document_type', ['QUOTATION', 'INVOICE']);

/** Funnel stages, in pipeline order. Mirrors the STAGES array in the UI. */
export const FUNNEL_STAGES = [
  'Leads',
  'Chated',
  'Responsed',
  'Set Meeting',
  'Hold',
  'Close Win',
  'Close Lost',
  'Failed',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];
