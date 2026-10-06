/**
 * The OI grid with the pinned scrollbar and pinned left columns.
 *
 * The trickiest part is the mirror scrollbar staying in step in both directions
 * without ping-ponging, and the pin offsets landing on the real rendered widths
 * rather than on the widths the classes suggest. Both are checked here in a real
 * browser against a grid that is far wider than the viewport and tall enough that
 * the old behaviour - scrollbar at the foot of a thousand rows - is the one being
 * replaced.
 */
import OIGrid from '../src/components/OIForecast/OIGrid';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { writeFileSync, copyFileSync, mkdirSync } from 'node:fs';

const OUT = 'C:/Users/Banzilla/AppData/Local/Temp/opencode/oigrid';
mkdirSync(`${OUT}/documents`, { recursive: true });
for (const f of [
  'tnt-quotation.svg', 'tnt-invoice.svg', 'hype-header.svg', 'logo-tnt-mark.png',
]) {
  copyFileSync(`public/documents/${f}`, `${OUT}/documents/${f}`);
}

// Long names on purpose: the pin offsets are measured, and a name that overflows
// its column is exactly the case where hardcoded offsets would have overlapped.
const NAMES = [
  'Northwood Coffee',
  'Bebek Bengil Rekso Industry',
  'Ayam Keprabon',
  'Glamritz Aesthetic Clinic',
  'PIKAPARA Coffee',
  'Ayam Goreng Suharti Laksono',
  'Bebek Boedjang',
];
const OTHER = [
  'Value', 'Budget Ads', 'Budget Creator', 'Gross Margin', 'Real Payment',
  'T. GMV', 'T. Creator', 'T. Vid Aff', 'T. Vid Int', 'Success %',
  'Status', 'Tier', 'Category', 'Quotation', 'Invoice', 'Internal Update',
];

const forecasts = Array.from({ length: 60 }, (_, i) => {
  const n = NAMES[i % NAMES.length]!;
  const f: Record<string, unknown> = {
    id: `fc${i}`,
    leadId: `ld${i}`,
    monthYear: '2026-10',
    product: 'HYPE',
    value: 50_000_000 + i * 1_000_000,
    campaignNumber: (i % 3) + 1,
    budgetAds: 10_000_000,
    budgetCreator: 5_000_000,
    grossMargin: 35_000_000,
    realMargin: 20_000_000,
    realPayment: 0,
    targetGmv: 0,
    targetCreator: 0,
    targetVideoAffiliate: 0,
    targetVideoInternal: 0,
    targetViews: 0,
    status: i % 5 === 0 ? 'WIN' : 'OPEN',
    tier: '-',
    category: 'HYPE Campaign',
    // Read straight off the forecast row, not looked up in `leads` - omitting it
    // rendered "Unknown Brand" and made the screenshot useless.
    brandName: NAMES[i % NAMES.length]!,
    milestones: [],
    updatedAt: new Date(2026, 9, 1, 9, i).toISOString(),
    updatedByName: 'Jeff',
  };
  return f;
});

// One lead option per forecast row, so the Brand Name column resolves for every
// row. A fixture that only covered the first few names rendered "Unknown Brand"
// and made the screenshot useless for judging the pinned column.
const leads = forecasts.map((f, i) => ({
  id: f.leadId as string,
  brandName: NAMES[i % NAMES.length]!,
}));

const user = {
  id: 'u1', name: 'Jeff', email: 'j@x.com', role: 'staff',
  permissions: {}, authId: 'a1', status: 'active',
} as never;

/*
 * Rendered as an element rather than called directly: the grid is a real
 * component with hooks, and calling it as a function trips "invalid hook call".
 *
 * The output is static markup, so nothing runs in the browser and the
 * useLayoutEffect that measures the pin offsets never fires. The Playwright check
 * therefore reproduces that measurement itself and drives the scrollbar the same
 * way the component does, which is what makes it a test of the technique rather
 * than of React's plumbing.
 */
const html = renderToStaticMarkup(
  createElement(OIGrid, {
    forecasts,
    selectedMonthYear: '2026-10',
    activeTab: 'HYPE',
    leads,
    user,
    users: [user],
    onAddForecast: () => {},
    onUpdateForecast: () => {},
    onDeleteForecast: () => {},
  } as never),
);

const css = `body{margin:0;background:#f8fafc;font-family:Inter,system-ui,sans-serif}
/* The card the grid renders as. In the real page it sits in a height-bounded
   column, which is what makes bottom:0 mean "at the foot of the visible grid"
   rather than "after the last of a thousand rows". The harness has to reproduce
   that or the pinned scrollbar lands 6000px down and the test passes for the
   wrong reason. */
.grid-shell{padding:16px}
.grid-shell > div{height:520px;display:flex;flex-direction:column;min-height:0}
.grid-shell > div > div.relative{flex:1 1 0%;min-height:0}`;

writeFileSync(
  `${OUT}/index.html`,
  `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="./app.css">
<style>${css}</style>
<div class="grid-shell">${html}</div>`,
);

console.log(`ok  ${OTHER.length} kolom, ${forecasts.length} baris`);