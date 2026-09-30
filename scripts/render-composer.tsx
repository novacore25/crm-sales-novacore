// Renders the number composer for each series, so its layout can be looked at
// rather than assumed. The date and series are fixed so a change in the output
// means a change in the code.
import { NumberComposer } from '../src/components/documents/NumberComposer';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';

const SERIES = [
  {
    slug: 'tnt-quo',
    label: 'Quotation TNT - template with code, month and year',
    format: '{seq:3}/{type}-{company}/{code}/{roman}/{yy}',
    docType: 'QUOTATION',
    company: 'TNT',
    date: '2026-09-14',
    seq: '37',
    code: 'SA',
  },
  {
    slug: 'tnt-inv',
    label: 'Invoice TNT - two-digit sequence, four-letter month',
    format: '{seq:2}/{type}-{company}/{code}/{roman}/{yy}',
    docType: 'INVOICE',
    company: 'TNT',
    date: '2026-08-04',
    seq: '1',
    code: 'MCN',
  },
  {
    slug: 'hype-quo',
    label: 'Quotation HYPE - no code, no month, no year',
    format: '{seq:3}/{type}-{company}',
    docType: 'QUOTATION',
    company: 'HYPE',
    date: '2026-09-29',
    seq: '3',
    code: '',
  },
  {
    slug: 'no-date',
    label: 'TNT with no date yet - the month and year cannot be filled',
    format: '{seq:3}/{type}-{company}/{code}/{roman}/{yy}',
    docType: 'QUOTATION',
    company: 'TNT',
    date: null,
    seq: '38',
    code: 'SA',
  },
];

const noop = () => {};

const body = SERIES.map((s) => {
  // Must be real JSX, not a direct call: the component uses hooks, and calling
  // it as a function runs them outside React's renderer.
  const html = renderToStaticMarkup(
    <NumberComposer
      format={s.format}
      docType={s.docType}
      company={s.company}
      date={s.date}
      seq={s.seq}
      code={s.code}
      onSeqChange={noop}
      onCodeChange={noop}
      codes={[
        { id: 'a', code: 'SA' },
        { id: 'b', code: 'ADM' },
      ]}
      manual={false}
      manualValue=""
      onManualValueChange={noop}
      onSetManual={noop}
    />,
  );
  return `
    <section class="case">
      <h3>${s.label}</h3>
      <p class="meta">format: <code>${s.format}</code> &middot; date: ${s.date ?? '(none)'}</p>
      <div class="sheet">${html}</div>
    </section>`;
}).join('');

writeFileSync(
  'C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/composer.html',
  `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="./app.css">
<style>
  body{background:#f1f5f9;font-family:Inter,system-ui,sans-serif;padding:24px}
  .case{background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;border:1px solid #e2e8f0}
  h3{font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#6366f1;margin:0 0 4px}
  .meta{font-size:11px;color:#94a3b8;margin:0 0 14px}
  .sheet{border:1px dashed #cbd5e1;border-radius:10px;padding:14px}
</style>
${body}`,
);
console.log('composer harness written');
