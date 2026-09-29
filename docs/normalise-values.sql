-- ============================================================================
-- Normalise values that would break the ENUM restore
-- ============================================================================
-- Run each statement in the Supabase SQL Editor, one at a time.
--
-- Run them in this order. Step 1 is a backup - do not skip it, even though
-- the changes are small and reversible.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1 - BACKUP (read-only, run first, save the output)
-- ────────────────────────────────────────────────────────────────────────────
-- Only 55 rows are affected in total. Save this result somewhere, or simply
-- keep it in the conversation history - it is the reversal data for step 2.

SELECT id, brand_name, status AS status_sekarang
FROM public.leads
WHERE status = 'Input'
ORDER BY brand_name;

SELECT id, brand_name, interest_level AS level_sekarang
FROM public.leads
WHERE interest_level = 'Low'
ORDER BY brand_name;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2 - NORMALISE
-- ────────────────────────────────────────────────────────────────────────────
-- 'Input' and 'Leads' mean the same thing: the brand is in the database but
-- nobody has contacted it yet. The next stage, 'Chated', means the first
-- contact happened. So 'Input' becomes 'Leads'.
--
-- Note this also improves the OLD app: 'Input' was never in its stage list,
-- so those 53 rows were already rendering oddly there.

UPDATE public.leads
SET status = 'Leads'
WHERE status = 'Input';

-- 'Low' is not a valid interest level. The valid set is HOT / WARM / COLD / '-',
-- and 'Low' was written by an import script that used the wrong vocabulary
-- (Low/Medium/High is the task *priority* scale, not the interest scale).
-- These two rows carry no usable signal, so they become '-' (unset), which is
-- what the other 6,176 rows overwhelmingly are.

UPDATE public.leads
SET interest_level = '-'
WHERE interest_level = 'Low';


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 3 - VERIFY (read-only)
-- ────────────────────────────────────────────────────────────────────────────
-- Both should now come back empty.

SELECT status, count(*) FROM public.leads
WHERE status NOT IN ('Leads','Chated','Responsed','Set Meeting','Hold','Close Win','Close Lost','Failed')
GROUP BY status;

SELECT interest_level, count(*) FROM public.leads
WHERE interest_level NOT IN ('HOT','WARM','COLD','-')
GROUP BY interest_level;

-- Expected distribution after the change:
--   Leads     2793 + 53 = 2846
--   Chated    2961
--   Responsed  399
--   Set Meeting 57
--   Hold        43
--   Close Lost  46
--   Close Win   47
--   total      6399
SELECT status, count(*) FROM public.leads GROUP BY status ORDER BY 2 DESC;
