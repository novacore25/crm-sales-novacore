/**
 * The funnel ordering rule, asserted.
 *
 * The office rule: chat first, then responsed, then meeting, then close, and no
 * stage may be dated before the one that leads into it. This exists because the
 * modal checked that the earlier stages had dates but never checked their order,
 * so a deal could be closed with a chat that happened afterwards.
 *
 * The dates here are the ones from the real report: a lead chated, responsed and
 * met on 4 October and closed on 5 October, which must pass.
 */
import {
  effectiveStageDate,
  validateFunnelOrder,
  FUNNEL_PRECEDING_STAGES,
} from '../src/lib/funnel-order';

let failed = 0;

// `cond` is unknown rather than boolean so an assertion like
// `typed?.toISOString().startsWith(...)` can be passed straight in without every
// call site wrapping it in Boolean() to satisfy the checker.
function ok(label: string, cond: unknown, detail = '') {
  const passed = Boolean(cond);
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}`);
  if (!passed) {
    failed++;
    if (detail) console.log(`       ${detail}`);
  }
}

function expectError(label: string, input: Parameters<typeof validateFunnelOrder>[0]) {
  const msg = validateFunnelOrder(input);
  ok(label, msg !== null, 'diharapkan ditolak, tapi diterima');
  if (msg) console.log(`       -> ${msg}`);
  return msg ?? '';
}

function expectOk(label: string, input: Parameters<typeof validateFunnelOrder>[0]) {
  const msg = validateFunnelOrder(input);
  ok(label, msg === null, `d-harap lolos, tapi: ${msg ?? ''}`);
}

console.log('urutan yang benar');
expectOk('chat, respon, meeting, close - semua sama hari lalu close besok', {
  chated: '2026-10-04',
  responded: '2026-10-04',
  setMeeting: '2026-10-04',
  closing: '2026-10-05',
});
expectOk('bertahap naik', {
  chated: '2026-10-01',
  responded: '2026-10-02',
  setMeeting: '2026-10-03',
  closing: '2026-10-04',
});
expectOk('hanya close yang diisi', {
  closing: '2026-10-04',
});
expectOk('hanya chat dan close', {
  chated: '2026-10-01',
  closing: '2026-10-04',
});
expectOk('tanggal sama persis dianggap berurutan', {
  chated: '2026-10-04',
  responded: '2026-10-04',
  setMeeting: '2026-10-04',
  closing: '2026-10-04',
});

console.log('\nurutan yang salah');
const backdated = expectError('close sebelum chat', {
  chated: '2026-10-04',
  responded: '2026-10-04',
  setMeeting: '2026-10-04',
  closing: '2026-10-03',
});
// It reports the FIRST place the order breaks, not the widest gap. With every
// stage on 4 October and the close on 3 October, the earliest break is where the
// close meets the stage before it - which is the pair a rep can actually fix.
ok('pesan menyebut dua tahap yang benar', /Set Meeting/.test(backdated) && /Close Win/.test(backdated), backdated);
ok('pesan menyebut tanggalnya', /4 Oktober 2026/.test(backdated) && /3 Oktober 2026/.test(backdated), backdated);

expectError('meeting sebelum respon', {
  chated: '2026-10-01',
  responded: '2026-10-05',
  setMeeting: '2026-10-03',
  closing: '2026-10-06',
});
expectError('close lost juga harus berurutan', {
  chated: '2026-10-09',
  responded: '2026-10-02',
  setMeeting: '2026-10-03',
  closing: '2026-10-04',
  closingStage: 'Close Lost',
});

console.log('\ntahap tanpa tanggal tidak dianggap salah urutan');
expectOk('responsed kosong, sisanya berurutan', {
  chated: '2026-10-01',
  responded: null,
  setMeeting: '2026-10-03',
  closing: '2026-10-04',
});

console.log('\neffectiveStageDate - sumber tanggal');
const history = [
  { stage: 'Chated', dateOccurred: '2026-08-01' },
  { stage: 'Chated', dateOccurred: '2026-09-02' },
];
const typed = effectiveStageDate({ stage: 'Chated', history, pending: '2026-10-01' });
ok('yang diketik rep menang', typed?.toISOString().startsWith('2026-10-01'), String(typed));

const fromHistory = effectiveStageDate({ stage: 'Chated', history });
ok('tanpa input, yang terbaru dari history', fromHistory?.toISOString().startsWith('2026-09-02'), String(fromHistory));

const fromColumn = effectiveStageDate({
  stage: 'Chated',
  leadColumn: '2026-10-03',
  history,
});
ok('kolom lead menang dari history', fromColumn?.toISOString().startsWith('2026-10-03'), String(fromColumn));

const absent = effectiveStageDate({ stage: 'Set Meeting', history });
ok('tahap yang tidak ada tidak dikarang jadi hari ini', absent === null, String(absent));

console.log('\nketidakrobustan');
expectOk('tanggal tidak valid tidak dianggap error', {
  chated: 'bukan tanggal',
  closing: '2026-10-04',
});
ok('daftar tahap tetap 3', FUNNEL_PRECEDING_STAGES.length === 3, String(FUNNEL_PRECEDING_STAGES));

console.log();
if (failed) {
  console.log(`${failed} assertion gagal.`);
  process.exit(1);
}
console.log('Semua lulus.');