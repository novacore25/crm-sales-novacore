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
