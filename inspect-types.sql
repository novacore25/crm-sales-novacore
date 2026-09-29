-- ============================================================================
-- Column DATA TYPES, for the Supabase -> PostgreSQL migration
-- ============================================================================
-- The column-name check confirmed the shape. This checks the types, which
-- decide whether a pg_dump restore will actually succeed.
--
-- Read-only. Copy the single cell and paste it into the chat.
-- ============================================================================

SELECT string_agg(
         table_name || '.' || column_name || ' = ' || data_type,
         E'\n' ORDER BY table_name, ordinal_position) AS "SEMUA TIPE"
FROM information_schema.columns
WHERE table_schema = 'public';


-- ============================================================================
-- FALLBACK - if the editor truncates the long cell, this returns one row per
-- 60 columns instead.
-- ============================================================================

-- WITH t AS (
--   SELECT table_name || '.' || column_name || ' = ' || data_type AS c
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
-- ), n AS (
--   SELECT c, row_number() OVER (ORDER BY c) AS rn FROM t
-- )
-- SELECT ((rn - 1) / 60) + 1 AS bagian,
--        string_agg(c, E'\n' ORDER BY rn) AS tipe
-- FROM n GROUP BY 1 ORDER BY 1;


-- ============================================================================
-- ROW COUNTS - how much data is moving
-- ============================================================================

-- SELECT 'leads' AS tabel, count(*) FROM public.leads
-- UNION ALL SELECT 'funnel_history', count(*) FROM public.funnel_history
-- UNION ALL SELECT 'lead_notes',    count(*) FROM public.lead_notes
-- UNION ALL SELECT 'users',         count(*) FROM public.users
-- UNION ALL SELECT 'oi_forecasts',  count(*) FROM public.oi_forecasts
-- UNION ALL SELECT 'tasks',         count(*) FROM public.tasks
-- UNION ALL SELECT 'edit_requests', count(*) FROM public.edit_requests
-- ORDER BY 1;
