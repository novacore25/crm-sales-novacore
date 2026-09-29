-- ============================================================================
-- Schema inspection query for the Supabase -> PostgreSQL migration
-- ============================================================================
-- Paste this into Supabase -> SQL Editor -> New query, then press Run.
--
-- It is read-only: it only SELECTs from the system catalog, so it cannot
-- modify your data.
--
-- The result is one column of "table.column" text, sorted. That format is
-- designed to be copied straight into a chat.
-- ============================================================================

SELECT table_name || '.' || column_name AS "kolom"
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;


-- ============================================================================
-- OPTIONAL - run this second, only if you want to see the database functions
-- (the RPCs the dashboard used to call)
-- ============================================================================

-- SELECT routine_name AS "fungsi"
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
-- ORDER BY routine_name;


-- ============================================================================
-- OPTIONAL - row counts, to sanity-check the data before migrating it
-- ============================================================================

-- SELECT 'leads' AS tabel, count(*) FROM public.leads
-- UNION ALL SELECT 'funnel_history', count(*) FROM public.funnel_history
-- UNION ALL SELECT 'lead_notes',    count(*) FROM public.lead_notes
-- UNION ALL SELECT 'users',         count(*) FROM public.users
-- UNION ALL SELECT 'oi_forecasts',  count(*) FROM public.oi_forecasts
-- ORDER BY 1;
