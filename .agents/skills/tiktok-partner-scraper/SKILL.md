---
name: tiktok-partner-scraper
description: Scrapes brand names, product titles, unmasked WhatsApp numbers, and seller emails from TikTok Shop Partner Center (Product Marketplace). Handles auto-scroll, duplicate prevention, popup cleanup, and staging integration in CRM Sales NovaCore.
---

# TikTok Shop Partner Center Lead Scraper & CRM Staging

## Overview
This skill provides the domain knowledge, DOM selectors, unmasking techniques, auto-scroll mechanics, and CRM integration workflows to extract merchant contact leads from TikTok Shop Partner Center (`https://partner.tiktokshop.com/affiliate-product-management/product-marketplace`).

## Architecture & Workflows

1. **Client-Side Bookmarklet Execution:**
   - Runs in the user's active session inside `partner.tiktokshop.com`.
   - **Category Validation:** Automatically checks filter category (`[data-tid="m4b_cascader"]`). Hovers to unmask tooltip text and extracts Level-1 category (e.g. `Beauty & Personal Care`), stripping subcategories. If no category is selected, halts execution with an alert prompt.
   - Prompts for target number of leads (e.g. 50, 100).
   - Stamps processed cards with `data-tnt-scraped="true"` to prevent reprocessing.
   - Automatically scrolls down (`window.scrollBy`) when cards run out until the target count is satisfied.
   - Hides/cleans up all contact popovers (`display: none !important`) so the screen remains clean without lingering overlays.
   - Sends batch JSON payload to `https://crm-sales.banzilla.my.id/api/scraped-leads` via CORS with extracted category.

2. **Server-Side Staging (`scraped_leads` Table):**
   - Completely isolated from the main `leads` table.
   - **Deduplication Rule (Triple-Match):** Duplicate ONLY if `(brand_name, contact, email)` all match. If contact is the same (e.g. holding company) but brand is different, it is saved.
   - Compares incoming leads with active records in `leads`:
     - Highlights similarity: `⚠️ Mirip: "[Lead Name]" (PIC: [PIC Name])`.

3. **Multi-Contact Promotion & Merging:**
   - **Promote as New Lead:** Creates a new row in `leads`, seeds `funnelHistory` stage 'Leads', and marks staging record as 'promoted'.
   - **Merge into Existing Lead:** Appends new phone number (`contact1 / contact2`), updates empty email, and appends a detailed log into `lead_notes` (`[Kontak Tambahan dari TikTok Shop]`). No existing contact data is lost.

## Code References
- Complete documentation: [docs/TIKTOK-PARTNER-SCRAPER.md](file:///c:/Users/Banzilla/Documents/DEV/crm-sales-novacore-vps/docs/TIKTOK-PARTNER-SCRAPER.md)
- Server actions: [src/app/actions/scraped-lead-actions.ts](file:///c:/Users/Banzilla/Documents/DEV/crm-sales-novacore-vps/src/app/actions/scraped-lead-actions.ts)
- API endpoint: [src/app/api/scraped-leads/route.ts](file:///c:/Users/Banzilla/Documents/DEV/crm-sales-novacore-vps/src/app/api/scraped-leads/route.ts)
- Staging UI: [src/components/ScrapedLeadsClient.tsx](file:///c:/Users/Banzilla/Documents/DEV/crm-sales-novacore-vps/src/components/ScrapedLeadsClient.tsx)
