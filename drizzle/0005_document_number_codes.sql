-- Letter codes for document numbers, and real templates for the series.
--
-- `document_series.format` held a free-text example - the literal string
-- "contoh: 037/QUO-TNT/SA/IX/26". That is documentation, not configuration: a
-- program cannot tell which part is the running sequence, which is the letter
-- code, and which is just the month. So the form asked for the whole number,
-- including the four parts that were already known.
--
-- It now holds a template:
--
--   {seq:3}/{type}-{company}/{code}/{roman}/{yy}
--
-- Only {seq} and {code} are ever asked for. {roman} and {yy} come from the
-- document's own date and {type} and {company} from the series, so changing the
-- date updates the printed number on its own - which is the point, because a
-- stale month in a number is the kind of error nobody spots on a printed page.
--
-- The padding width is in the template rather than fixed at 3, because the office
-- prints 037 on a quotation and 01 on an invoice. Assuming one width for both
-- turns 01 into 001 and silently creates a second, different number.
--
-- The three templates come from numbers that were really issued, read off the
-- office's own PDFs:
--
--   037/QUO-TNT/SA/IX/26     quotation TNT
--   01/INV-TNT/MCN/VIII/26   invoice TNT
--   003/QUO-HYPE             quotation HYPE - no code, no month, no year
--
-- That last one is why this is not hardcoded per company. HYPE's number has a
-- different shape, and any rule of the form "TNT gets a code segment" would put
-- a field on a HYPE document that has no place to put a value.
--
-- The codes table follows document_bank_accounts and document_signatories: it
-- grows by use, and anything typed that is not already listed is saved for next
-- time. Scoped by series rather than by company, because the letter code is a
-- property of the kind of document - SA on TNT quotations, MCN on TNT invoices -
-- and a shared list would let a quotation print with the invoice's code.
--
-- Idempotent, like the three before it.

DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS "document_number_codes" (
    "id" text PRIMARY KEY NOT NULL,
    "series_id" text NOT NULL,
    "code" text NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "use_count" integer DEFAULT 0 NOT NULL,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_number_codes"
    ADD CONSTRAINT "document_number_codes_series_id_series_id_fk"
    FOREIGN KEY ("series_id") REFERENCES "public"."document_series"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Case-insensitive, for the same reason as the other two learned lists: "sa" and
-- "SA" are one code, and saving both gives the same code two entries and two
-- chances to pick the wrong one.
CREATE UNIQUE INDEX IF NOT EXISTS "document_number_codes_series_code_key"
  ON "document_number_codes" USING btree ("series_id", upper("code"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_number_codes_series_idx"
  ON "document_number_codes" USING btree ("series_id");

-- Turn the example strings into templates. Guarded on the old shape still being
-- there, so re-running after the office has edited a template does not stomp
-- their change back to ours. The pattern is `contoh:%` and not `contoh:037%`
-- because the seeded value has a space after the colon - "contoh: 037/QUO-TNT".
UPDATE "document_series" SET "format" = '{seq:3}/{type}-{company}/{code}/{roman}/{yy}'
  WHERE "id" = 'tnt-quotation' AND "format" LIKE 'contoh:%QUO-TNT%';--> statement-breakpoint
UPDATE "document_series" SET "format" = '{seq:2}/{type}-{company}/{code}/{roman}/{yy}'
  WHERE "id" = 'tnt-invoice' AND "format" LIKE 'contoh:%INV-TNT%';--> statement-breakpoint
UPDATE "document_series" SET "format" = '{seq:3}/{type}-{company}'
  WHERE "id" = 'hype-quotation' AND "format" LIKE 'contoh:%QUO-HYPE%';--> statement-breakpoint

-- Seed the codes already visible on the office's paper. ON CONFLICT DO NOTHING so
-- re-running cannot disturb a correction.
INSERT INTO "document_number_codes" ("id", "series_id", "code")
VALUES
  ('tnt-quo-sa',  'tnt-quotation', 'SA'),
  ('tnt-inv-mcn', 'tnt-invoice',   'MCN')
ON CONFLICT DO NOTHING;
