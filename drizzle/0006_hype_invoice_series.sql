-- The missing HYPE invoice series.
--
-- Only three series were seeded, so the office could not create a HYPE invoice at
-- all - the picker offered Quotation TNT, Invoice TNT and Quotation HYPE, and
-- nothing else.
--
-- The template is not the obvious one. The invoice's own printed number reads
--
--   04/QUO-HYPE
--
-- QUO, not INV. It is an invoice and the prefix still says quotation. That is
-- almost certainly a leftover in whatever they build these in, but it is printed
-- on paper the client holds, so it is reproduced rather than quietly corrected.
-- The prefix is therefore a literal here and NOT the {type} placeholder, which
-- would resolve INVOICE to INV and produce a number that has never existed.
-- Change it to {type} if the office decides to start printing INV.
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
  ('hype-invoice', 'HYPE', 'INVOICE', '{seq:2}/QUO-{company}', 5, 'Invoice - HYPE')
ON CONFLICT DO NOTHING;
