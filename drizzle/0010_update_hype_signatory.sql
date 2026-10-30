-- Update HYPE signatory name from 'Stevani Adiwijaya' to 'Stevani'
DELETE FROM "document_signatories" WHERE "company" = 'HYPE' AND upper("name") = 'STEVANI ADIWIJAYA' AND "id" != 'hype-stevani';

UPDATE "document_signatories"
SET "name" = 'Stevani'
WHERE "id" = 'hype-stevani' OR upper("name") = 'STEVANI ADIWIJAYA';

UPDATE "documents"
SET "signatory_name" = 'Stevani'
WHERE "signatory_name" = 'Stevani Adiwijaya';
