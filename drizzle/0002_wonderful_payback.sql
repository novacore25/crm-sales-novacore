-- Attribution for the OI forecast grid.
--
-- Added after the grid shipped, so every existing row has NULL here. That is
-- meaningful, not missing data: it means the row was migrated or last edited
-- before we started recording who. The UI labels those rows as such instead of
-- showing a blank, which would read as "never touched".
--
-- `updated_by_name` is denormalised for the same reason funnel_history keeps
-- `by_user_name`: the grid stays readable after a user is removed, and
-- `updated_by` is ON DELETE SET NULL.
--
-- IF NOT EXISTS keeps this safe to re-run by hand on production.
ALTER TABLE "oi_forecasts" ADD COLUMN IF NOT EXISTS "updated_by" text;--> statement-breakpoint
ALTER TABLE "oi_forecasts" ADD COLUMN IF NOT EXISTS "updated_by_name" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oi_forecasts_updated_by_users_id_fk'
  ) THEN
    ALTER TABLE "oi_forecasts" ADD CONSTRAINT "oi_forecasts_updated_by_users_id_fk"
      FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
