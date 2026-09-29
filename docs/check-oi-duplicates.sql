-- ============================================================================
-- OI Forecast integrity: report duplicates before the unique index is added
-- ============================================================================
-- The new unique index on (lead_id, month_year, product, campaign_number)
-- will FAIL to apply if the table already contains duplicates - which is
-- likely, because the old dedupe check only ran in the browser.
--
-- Run this FIRST. If it returns rows, do NOT add the index yet; send the
-- output over so the duplicates can be reviewed. Deleting forecast rows by
-- hand would change performance reporting, so that decision is not automated.
-- ============================================================================

SELECT
  lead_id,
  month_year,
  product,
  COALESCE(campaign_number, 1) AS campaign,
  COUNT(*) AS jumlah,
  string_agg(id, ' | ' ORDER BY created_at) AS forecast_ids,
  string_agg(status, ' | ' ORDER BY created_at) AS status,
  string_agg(value::text, ' | ' ORDER BY created_at) AS nilai
FROM oi_forecasts
GROUP BY lead_id, month_year, product, COALESCE(campaign_number, 1)
HAVING COUNT(*) > 1
ORDER BY jumlah DESC, month_year DESC;


-- ============================================================================
-- Same report, but grouped by lead so you can see which brands are affected
-- ============================================================================

-- SELECT l.brand_name, d.*
-- FROM (
--   SELECT lead_id, month_year, product,
--          COALESCE(campaign_number, 1) AS campaign,
--          COUNT(*) AS jumlah
--   FROM oi_forecasts
--   GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
-- ) d
-- JOIN leads l ON l.id = d.lead_id
-- ORDER BY d.jumlah DESC, d.month_year DESC;


-- ============================================================================
-- Sanity: how the forecast table looks overall
-- ============================================================================

-- SELECT product, status, COUNT(*) AS baris, SUM(value) AS total
-- FROM oi_forecasts
-- GROUP BY product, status
-- ORDER BY product, status;


-- ============================================================================
-- Leads referenced by a forecast that no longer exist
-- (the FK is ON DELETE CASCADE, so this should be empty - worth confirming)
-- ============================================================================

-- SELECT f.id, f.lead_id, f.month_year, f.product
-- FROM oi_forecasts f
-- LEFT JOIN leads l ON l.id = f.lead_id
-- WHERE l.id IS NULL;


-- ============================================================================
-- How many forecast rows have a campaign number
-- (the unique index uses COALESCE(campaign_number, 1))
-- ============================================================================

-- SELECT
--   COUNT(*) FILTER (WHERE campaign_number IS NULL) AS tanpa_campaign,
--   COUNT(*) FILTER (WHERE campaign_number IS NOT NULL) AS dengan_campaign,
--   COUNT(*) AS total
-- FROM oi_forecasts;
