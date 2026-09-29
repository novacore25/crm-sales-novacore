-- ============================================================================
-- OI Forecast integrity: stop duplicate rows per brand/month/product/campaign
-- ============================================================================
-- The application already refused a duplicate before inserting, but that check
-- only saw rows already loaded into the browser. Two open tabs, or a lead added
-- by a colleague in between, both passed it and wrote a second row - which then
-- inflated the WIN totals and the milestone percentages that sales performance
-- is read from.
--
-- A plain CREATE UNIQUE INDEX would abort the whole migration the moment it hit
-- an existing duplicate, with an error naming a constraint rather than the
-- offending data. This version checks first and explains what is in the way, so
-- the duplicates can be reviewed deliberately - removing a forecast row changes
-- a performance number, and that is not a decision to automate.
-- ============================================================================

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT 1
    FROM oi_forecasts
    GROUP BY lead_id, month_year, product, COALESCE(campaign_number, 1)
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add the unique index: % duplicate (lead, month, product, campaign) group(s) already exist in oi_forecasts. Run docs/check-oi-duplicates.sql to list them, decide which row to keep, delete the rest, then re-run this migration.',
      dup_count;
  END IF;
END $$;

-- COALESCE(campaign_number, 1) matters: under a plain unique index two NULL
-- campaign numbers do not compare equal, so rows with no campaign set would
-- still be able to duplicate each other.
CREATE UNIQUE INDEX "oi_forecasts_lead_month_product_campaign_key"
  ON "oi_forecasts" USING btree (
    "lead_id",
    "month_year",
    "product",
    coalesce("campaign_number", 1)
  );
