-- Documents: quotation and invoice generator.
--
-- Rewritten by hand to be safe to run more than once. Drizzle's generated form
-- has no IF NOT EXISTS anywhere, and this one has to be applied to a live
-- database by hand like the previous two.
--
-- `next_number` is seeded from the numbers already in use, so the first
-- document this system issues does not collide with one the office printed
-- outside it:
--   TNT quotation   037/QUO-TNT/SA/IX/26    -> next 38
--   TNT invoice     01/INV-TNT/MCN/VIII/26  -> next 2
--   HYPE            003/QUO-HYPE             -> next 5
--
-- The HYPE figure is the uncertain one. On paper HYPE's quotation is 003 and
-- its invoice is 04, which is consistent with ONE counter running across both
-- types. It is also consistent with two counters that happen to sit next to
-- each other. 5 is the only value that is safe under either reading: if the
-- counters are shared, 5 is simply correct; if they are separate, one number
-- is skipped, which is harmless and visible.
--
-- If the office knows which it is, correct this in the app afterwards under
-- Documents -> Settings. Going below a number already printed is refused, so a
-- mistake here cannot quietly produce a duplicate.

DO $$ BEGIN
  CREATE TYPE "public"."document_company" AS ENUM('TNT', 'HYPE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."document_status" AS ENUM('DRAFT', 'ISSUED', 'CANCELLED', 'REVISION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."document_type" AS ENUM('QUOTATION', 'INVOICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_items" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"period" text,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_series" (
	"id" text PRIMARY KEY NOT NULL,
	"company" "document_company" NOT NULL,
	"doc_type" "document_type" NOT NULL,
	"format" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"series_id" text NOT NULL,
	"status" "document_status" DEFAULT 'DRAFT' NOT NULL,
	"number" text,
	"revision_of" text,
	"client_name" text NOT NULL,
	"product" "product",
	"issue_date" date,
	"period" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(6, 3),
	"tax_label" text,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"terms" text,
	"number_segment" text,
	"approver_name" text,
	"bank_name" text,
	"bank_account_name" text,
	"bank_account_number" text,
	"bank_branch" text,
	"signatory_name" text,
	"signatory_title" text,
	"template_key" text,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"issued_at" timestamp with time zone,
	"updated_by" text,
	"updated_by_name" text
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_items" ADD CONSTRAINT "document_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_series_id_document_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."document_series"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_items_document_idx" ON "document_items" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_series_company_type_key" ON "document_series" USING btree ("company","doc_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_series_idx" ON "documents" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_issue_date_idx" ON "documents" USING btree ("issue_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_series_number_key" ON "documents" USING btree ("series_id","number");

-- Seed the three series in use. ON CONFLICT DO NOTHING so re-running this file
-- cannot reset a counter the office has already moved.
INSERT INTO "document_series" ("id", "company", "doc_type", "format", "next_number", "label")
VALUES
  ('tnt-quotation', 'TNT',  'QUOTATION', '{seq:3}/{type}-TNT/{seg}/{roman}/{yy}', 38, 'Quotation - Thick and Thin'),
  ('tnt-invoice',   'TNT',  'INVOICE',   '{seq:3}/{type}-TNT/{seg}/{roman}/{yy}', 2,  'Invoice - Thick and Thin'),
  ('hype-quotation','HYPE', 'QUOTATION', '{seq:3}/QUO-HYPE',                        5,  'Quotation - HYPE')
ON CONFLICT DO NOTHING;