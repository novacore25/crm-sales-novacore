-- 0007_scraped_leads.sql
-- Tabel penampungan sementara (staging) untuk data scraping (misal: TikTok Shop Partner Center)
-- Terpisah 100% dari tabel leads utama agar pipeline sales tetap bersih.
-- Idempotent, aman dijalankan berulang.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scraped_lead_status') THEN
    CREATE TYPE "scraped_lead_status" AS ENUM ('pending', 'promoted', 'ignored');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "scraped_leads" (
  "id" text PRIMARY KEY,
  "brand_name" text NOT NULL,
  "contact" text NOT NULL,
  "email" text,
  "product_name" text,
  "category" text,
  "lead_source" text DEFAULT 'TikTok Shop' NOT NULL,
  "status" "scraped_lead_status" DEFAULT 'pending' NOT NULL,
  "scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
  "scraped_by" text,
  "promoted_to_lead_id" text REFERENCES "leads"("id") ON DELETE SET NULL,
  "promoted_at" timestamp with time zone,
  "promoted_by" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "scraped_leads_status_idx" ON "scraped_leads" ("status");
CREATE INDEX IF NOT EXISTS "scraped_leads_brand_name_idx" ON "scraped_leads" ("brand_name");
CREATE INDEX IF NOT EXISTS "scraped_leads_contact_idx" ON "scraped_leads" ("contact");
CREATE INDEX IF NOT EXISTS "scraped_leads_scraped_at_idx" ON "scraped_leads" ("scraped_at");
