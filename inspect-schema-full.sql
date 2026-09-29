-- ============================================================================
-- Full schema list as ONE row (no 100-row limit)
-- ============================================================================
-- The SQL Editor only displays 100 rows, which truncates the column list.
-- string_agg collapses everything into a single cell, so the limit does not
-- apply. Read-only: it only SELECTs from the system catalog.
--
-- Copy the whole cell and paste it into the chat.
-- ============================================================================

SELECT string_agg(table_name || '.' || column_name, '
' ORDER BY table_name, ordinal_position) AS "SEMUA KOLOM"
FROM information_schema.columns
WHERE table_schema = 'public';


-- ============================================================================
-- If the cell above looks truncated, run this instead - it splits the list
-- into 3 separate rows, each short enough to display whole.
-- ============================================================================

-- WITH all_cols AS (
--   SELECT table_name || '.' || column_name AS c
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
-- ), numbered AS (
--   SELECT c, row_number() OVER (ORDER BY c) AS rn
--   FROM all_cols
-- )
-- SELECT CASE
--          WHEN rn <= 70 THEN 'BAGIAN 1'
--          WHEN rn <= 140 THEN 'BAGIAN 2'
--          ELSE 'BAGIAN 3'
--        END AS bagian,
--        string_agg(c, ', ' ORDER BY rn) AS "kolom"
-- FROM numbered
-- GROUP BY 1
-- ORDER BY 1;
