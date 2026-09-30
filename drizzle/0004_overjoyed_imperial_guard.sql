-- Bank accounts and signatories for the document generator.
--
-- Both are scoped by company. That is not tidiness: the office pays from
-- PT TNT KREATIF DIGITAL AL for TNT work and PT SYNERA KREATIF GRUP for HYPE
-- work, and a shared list would let a HYPE invoice print with the TNT account.
-- Nothing downstream would catch it - the number is valid and the name is valid,
-- only the pairing is wrong, and the money is already gone by then.
--
-- These tables grow by use. The office changes them a couple of times a year, so
-- a settings screen nobody opens would be the wrong tool; anything typed that
-- does not already exist is saved here for next time.
--
-- Idempotent, like the two before it. The DROP NOT NULL lines at the end belong
-- to the "type the number yourself" change and have to run here because
-- migration 0003 was applied before that edit.

DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS "document_bank_accounts" (
    "id" text PRIMARY KEY NOT NULL,
    "company" "document_company" NOT NULL,
    "bank_name" text,
    "account_name" text NOT NULL,
    "account_number" text,
    "branch" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "use_count" integer DEFAULT 0 NOT NULL,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS "document_signatories" (
    "id" text PRIMARY KEY NOT NULL,
    "company" "document_company" NOT NULL,
    "name" text NOT NULL,
    "title" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "use_count" integer DEFAULT 0 NOT NULL,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Case-insensitive on purpose. "pt tnt" and "PT TNT" are the same company and
-- would otherwise both be saved, giving one wrong account two entries in the
-- list and two chances to pick the wrong one.
CREATE UNIQUE INDEX IF NOT EXISTS "document_bank_accounts_company_number_key"
  ON "document_bank_accounts" USING btree ("company", upper(coalesce("account_number", '')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_bank_accounts_company_idx"
  ON "document_bank_accounts" USING btree ("company");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_signatories_company_name_key"
  ON "document_signatories" USING btree ("company", upper("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_signatories_company_idx"
  ON "document_signatories" USING btree ("company");--> statement-breakpoint

-- Numbering became typed rather than generated, so these are advisory hints and
-- both have to be nullable. 0003 was applied before that change, so the NOT NULL
-- and the default are still on the live table.
ALTER TABLE "document_series" ALTER COLUMN "format" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document_series" ALTER COLUMN "next_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document_series" ALTER COLUMN "next_number" DROP DEFAULT;

-- Seed with the accounts and signatories already visible on the office's paper.
-- These are on documents that are already out, so they are known-good and there
-- is no reason to make anyone type them once before they can be selected.
-- ON CONFLICT DO NOTHING so re-running cannot disturb a correction.
INSERT INTO "document_bank_accounts"
  ("id", "company", "bank_name", "account_name", "account_number", "branch")
VALUES
  ('tnt-bca-karawaci', 'TNT',  'BCA',  'PT TNT KREATIF DIGITAL AL', '7613472888', 'KARAWACI'),
  ('hype-bca',         'HYPE', 'BCA',  'PT SYNERA KREATIF GRUP',    '8832372730', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO "document_signatories" ("id", "company", "name", "title")
VALUES
  ('tnt-ruben',   'TNT',  'RUBEN ARIANTO', 'DIREKTUR'),
  ('tnt-david',   'TNT',  'DAVID SUKANTO', 'DIREKTUR'),
  ('hype-ruben',  'HYPE', 'RUBEN ARIANTO', 'General Manager')
ON CONFLICT DO NOTHING;
