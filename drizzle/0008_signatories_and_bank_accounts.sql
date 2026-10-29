-- Add Calvin Adiputra Triguna as signatory for TNT
INSERT INTO "document_signatories" ("id", "company", "name", "title", "use_count", "is_active")
VALUES
  ('tnt-calvin', 'TNT', 'Calvin Adiputra Triguna', 'Head of Business Operation', 100, true)
ON CONFLICT ("company", upper("name"))
DO UPDATE SET
  "title" = EXCLUDED."title",
  "use_count" = EXCLUDED."use_count",
  "is_active" = true;

-- Add Stevani Adiwijaya as signatory for HYPE
INSERT INTO "document_signatories" ("id", "company", "name", "title", "use_count", "is_active")
VALUES
  ('hype-stevani', 'HYPE', 'Stevani Adiwijaya', 'Direktur', 100, true)
ON CONFLICT ("company", upper("name"))
DO UPDATE SET
  "title" = EXCLUDED."title",
  "use_count" = EXCLUDED."use_count",
  "is_active" = true;

-- Add new bank account for HYPE: HYPE MEDIA INDONESIA CV
INSERT INTO "document_bank_accounts" ("id", "company", "bank_name", "account_name", "account_number", "branch", "use_count", "is_active")
VALUES
  ('hype-bca-media', 'HYPE', 'BCA', 'HYPE MEDIA INDONESIA CV', '8833278078', NULL, 100, true)
ON CONFLICT ("company", upper(coalesce("account_number", '')))
DO UPDATE SET
  "bank_name" = EXCLUDED."bank_name",
  "account_name" = EXCLUDED."account_name",
  "use_count" = EXCLUDED."use_count",
  "is_active" = true;
