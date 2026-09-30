-- The missing HYPE invoice series.
--
-- Only three series were seeded, so the office could not create a HYPE invoice at
-- all - the picker offered Quotation TNT, Invoice TNT and Quotation HYPE, and
-- nothing else.
--
-- The template is not the obvious one, and it is now {type} rather than a
-- literal.
--
-- This originally shipped the prefix as a literal QUO, because the office's
-- HYPE invoice was printed as 04/QUO-HYPE - an invoice carrying the quotation
-- prefix. That was reproduced faithfully, on the reasoning that a number already
-- on paper the client holds should not be quietly changed.
--
-- The office has since said the prefix should follow the document type: an
-- invoice is INV, a quotation is QUO. That is right, and it is what the TNT
-- series has always done. The prefix is now the {type} placeholder, which
-- resolves INVOICE to INV.
--
-- The UPDATE below repairs the row if 0006 was already applied with the old
-- literal, because the INSERT's ON CONFLICT DO NOTHING would leave it alone.
-- Guarded on the exact old value so it cannot touch a row the office has since
-- edited by hand.
--
-- Two digits, not three. The HYPE quotation is 003/QUO-HYPE and the invoice is
-- 04/QUO-HYPE, which is the same 3-then-2 split the TNT series already uses
-- between its quotation (037) and its invoice (01).
--
-- No {code} segment, matching the reference: there is no letter code in either
-- HYPE number.
--
-- next_number is 5 for both HYPE series, because HYPE appears to run one counter
-- across both document types - the quotation took 003 and the invoice took 004,
-- so 005 is next for either. It is only ever a pre-filled suggestion; the office
-- types the number by hand, and the unique index on (series_id, number) is what
-- actually stops a duplicate.
--
-- Idempotent, like the five before it. ON CONFLICT DO NOTHING with no target, so
-- it cannot fail on either the primary key or the (company, doc_type) unique
-- index.

INSERT INTO "document_series" ("id", "company", "doc_type", "format", "next_number", "label")
VALUES
  ('hype-invoice', 'HYPE', 'INVOICE', '{seq:2}/{type}-{company}', 5, 'Invoice - HYPE')
ON CONFLICT DO NOTHING;

UPDATE "document_series" SET "format" = '{seq:2}/{type}-{company}'
  WHERE "id" = 'hype-invoice' AND "format" = '{seq:2}/QUO-{company}';

