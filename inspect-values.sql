-- ============================================================================
-- Enum value check - the last blocker before migrating data
-- ============================================================================
-- Why this matters:
--
-- The new database defines these as Postgres ENUM types, but the live Supabase
-- database reports them as plain `text`. If a row holds a value that is not a
-- valid enum member, the restore fails partway through with
-- "invalid input value for enum".
--
-- Known suspect: scripts/import_missing.cjs and ImportModalClient wrote
-- interest_level = 'Low', which is not one of HOT / WARM / COLD / '-'.
--
-- Read-only. Copy the results and paste them into the chat.
-- ============================================================================

-- 1. leads.status - expect only: Leads, Chated, Responsed, Set Meeting,
--    Hold, Close Win, Close Lost, Failed
SELECT status, count(*) FROM public.leads GROUP BY status ORDER BY 2 DESC;

-- 2. leads.interest_level - expect only: HOT, WARM, COLD, -
--    'Low' here is a known problem.
SELECT interest_level, count(*) FROM public.leads GROUP BY interest_level ORDER BY 2 DESC;

-- 3. users.role - expect only: lord, admin, staff, pending
SELECT role, count(*) FROM public.users GROUP BY role ORDER BY 2 DESC;

-- 4. tasks.priority - expect only: Low, Medium, High
SELECT priority, count(*) FROM public.tasks GROUP BY priority ORDER BY 2 DESC;

-- 5. tasks.status - expect only: Todo, In Progress, Done
--    'To Do' (with a space) is a known problem, written by an old migration.
SELECT status, count(*) FROM public.tasks GROUP BY status ORDER BY 2 DESC;

-- 6. oi_forecasts.status - expect only: WIN, OPEN, LOSE
SELECT status, count(*) FROM public.oi_forecasts GROUP BY status ORDER BY 2 DESC;

-- 7. oi_forecasts.product / oi_targets.product - expect only: MCN, TNT, HYPE
--    'Basemen' may still appear if the rename migration missed a row.
SELECT product, count(*) FROM public.oi_forecasts GROUP BY product ORDER BY 2 DESC;

-- 8. leads.product_offered is an array - list the distinct element counts
SELECT array_length(product_offered, 1) AS len, count(*)
FROM public.leads GROUP BY 1 ORDER BY 1;

-- 9. Row counts, so the data volume is known before the copy
SELECT 'leads' AS tabel, count(*) FROM public.leads
UNION ALL SELECT 'funnel_history', count(*) FROM public.funnel_history
UNION ALL SELECT 'lead_notes',    count(*) FROM public.lead_notes
UNION ALL SELECT 'users',         count(*) FROM public.users
UNION ALL SELECT 'oi_forecasts',  count(*) FROM public.oi_forecasts
UNION ALL SELECT 'tasks',         count(*) FROM public.tasks
UNION ALL SELECT 'edit_requests', count(*) FROM public.edit_requests
ORDER BY 1;

-- 10. Are these columns real enums, or plain text? udt_name is authoritative
--     (data_type reports USER-DEFINED for a real enum, which is not what we
--     saw, so this confirms it either way).
SELECT table_name, column_name, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('status', 'role', 'priority', 'interest_level')
  AND table_name IN ('leads', 'users', 'tasks', 'oi_forecasts', 'edit_requests', 'role_permissions')
ORDER BY table_name, column_name;
