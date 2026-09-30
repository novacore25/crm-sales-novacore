/**
 * Checks the number composition against the three series the office actually
 * uses, using the numbers from their own PDFs as the expected output.
 *
 * The PDFs are the specification here: 037/QUO-TNT/SA/IX/26 is a quotation that
 * was really issued, so if the composer cannot reproduce it, the composer is
 * wrong regardless of what the code looks like.
 */
import { composeNumber, parseTemplate, describeTemplate, padSequence, extractCode, extractSegment } from '../src/lib/document-number';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  // Structural comparison. `===` on two arrays with equal contents is false,
  // which made this report three passes as failures.
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) console.log(`         dapat   : ${JSON.stringify(actual)}\n         expect : ${JSON.stringify(expected)}`);
}

const TNT_QUO = '{seq:3}/{type}-{company}/{code}/{roman}/{yy}';
const TNT_INV = '{seq:2}/{type}-{company}/{code}/{roman}/{yy}';
const HYPE_QUO = '{seq:3}/{type}-{company}';
/*
 * QUO is a literal, not {type}. The office's HYPE invoice really is printed as
 * 04/QUO-HYPE - an invoice carrying the quotation prefix. Using {type} here would
 * produce INV-HYPE, a number that has never existed on any of their paper.
 */
const HYPE_INV = '{seq:2}/QUO-{company}';

console.log('\n--- reproducing numbers taken from the office PDFs ---');

// Quotation TNT, 14 September 2026, letter code SA, sequence 37.
check(
  'quotation TNT 037/QUO-TNT/SA/IX/26',
  composeNumber({
    format: TNT_QUO, seq: 37, code: 'sa', docType: 'QUOTATION',
    company: 'TNT', date: '2026-09-14',
  }).value,
  '037/QUO-TNT/SA/IX/26',
);

// Invoice TNT, 4 August 2026, letter code MCN, sequence 1. Note the two-digit
// sequence and the four-letter roman month - VIII, not VIIII.
check(
  'invoice TNT 01/INV-TNT/MCN/VIII/26',
  composeNumber({
    format: TNT_INV, seq: 1, code: 'MCN', docType: 'INVOICE',
    company: 'TNT', date: '2026-08-04',
  }).value,
  '01/INV-TNT/MCN/VIII/26',
);

// HYPE has no code, month or year segment at all.
check(
  'quotation HYPE 003/QUO-HYPE',
  composeNumber({
    format: HYPE_QUO, seq: 3, code: null, docType: 'QUOTATION',
    company: 'HYPE', date: '2026-09-29',
  }).value,
  '003/QUO-HYPE',
);

// An invoice, carrying the QUOTATION prefix, because that is what the office
// prints. Read off 04/QUO-HYPE on the Northwood Coffee invoice.
check(
  'invoice HYPE 04/QUO-HYPE - prefix stays QUO on an invoice',
  composeNumber({
    format: HYPE_INV, seq: 4, code: null, docType: 'INVOICE',
    company: 'HYPE', date: '2026-06-15',
  }).value,
  '04/QUO-HYPE',
);
check(
  'invoice HYPE asks for a sequence only, no code',
  composeNumber({
    format: HYPE_INV, seq: 4, docType: 'INVOICE', company: 'HYPE', date: '2026-06-15',
  }).needs,
  ['seq'],
);
check(
  'the {type} placeholder would have said INV, which is why it is not used',
  composeNumber({
    format: '{seq:2}/{type}-{company}', seq: 4, docType: 'INVOICE', company: 'HYPE',
    date: '2026-06-15',
  }).value,
  '04/INV-HYPE',
);
check('HYPE invoice sequence pads to two digits', padSequence(4, 2), '04');
check('HYPE invoice sequence past 99 does not truncate', padSequence(104, 2), '104');

console.log('\n--- the parts that are fixed by the date, not typed ---');
check('September is IX', composeNumber({ format: TNT_QUO, seq: 37, code: 'SA', docType: 'QUOTATION', company: 'TNT', date: '2026-09-01' }).value.split('/')[3], 'IX');
check('August is VIII', composeNumber({ format: TNT_QUO, seq: 37, code: 'SA', docType: 'QUOTATION', company: 'TNT', date: '2026-08-31' }).value.split('/')[3], 'VIII');
check('year 2026 is 26', composeNumber({ format: TNT_QUO, seq: 37, code: 'SA', docType: 'QUOTATION', company: 'TNT', date: '2026-01-01' }).value.split('/')[4], '26');
check('year 2031 is 31', composeNumber({ format: TNT_QUO, seq: 37, code: 'SA', docType: 'QUOTATION', company: 'TNT', date: '2031-12-31' }).value.split('/')[4], '31');

console.log('\n--- sequence width comes from the template, not a constant ---');
check('width 3 pads 37 to 037', padSequence(37, 3), '037');
check('width 2 pads 1 to 01', padSequence(1, 2), '01');
check('a number wider than the pad is left alone', padSequence(1234, 3), '1234');
check('a sequence typed with leading zeros is not doubled', padSequence('037', 3), '037');

console.log('\n--- nothing is invented when a part is missing ---');
check(
  'no code leaves the segment empty, not guessed',
  composeNumber({ format: TNT_QUO, seq: 37, code: null, docType: 'QUOTATION', company: 'TNT', date: '2026-09-14' }).value,
  '037/QUO-TNT//IX/26',
);
check(
  'no sequence leaves the segment empty, not 000',
  composeNumber({ format: TNT_QUO, seq: null, code: 'SA', docType: 'QUOTATION', company: 'TNT', date: '2026-09-14' }).value,
  '/QUO-TNT/SA/IX/26',
);
check(
  'no date leaves month and year empty rather than using today',
  composeNumber({ format: TNT_QUO, seq: 37, code: 'SA', docType: 'QUOTATION', company: 'TNT', date: null }).value,
  '037/QUO-TNT/SA//',
);

console.log('\n--- what the office has to supply, per series ---');
check('TNT quotation needs seq and code', composeNumber({ format: TNT_QUO, seq: 1, code: 'SA', docType: 'QUOTATION', company: 'TNT', date: '2026-09-14' }).needs, ['seq', 'code']);
check('HYPE quotation needs only seq', composeNumber({ format: HYPE_QUO, seq: 1, docType: 'QUOTATION', company: 'HYPE', date: '2026-09-14' }).needs, ['seq']);

console.log('\n--- a series with no template falls back to typing it all ---');
check('null format composes to nothing', composeNumber({ format: null, seq: 1, docType: 'QUOTATION', company: 'TNT', date: '2026-09-14' }).value, '');
check('a plain-text format is not a template', parseTemplate('contoh: 037/QUO-TNT/SA/IX/26'), null);

console.log('\n--- the help line shows a finished example, not a template ---');
check('TNT quotation example', describeTemplate(TNT_QUO, 'QUOTATION', 'TNT', '2026-09-14'), '003/QUO-TNT/SA/IX/26');
check('HYPE example carries HYPE, not TNT', describeTemplate(HYPE_QUO, 'QUOTATION', 'HYPE', '2026-09-14'), '003/QUO-HYPE');
check('an invoice example reads INV, not QUO', describeTemplate(TNT_INV, 'INVOICE', 'TNT', '2026-09-14'), '03/INV-TNT/SA/IX/26');
check('no template, no example', describeTemplate(null, 'QUOTATION', 'TNT', '2026-09-14'), null);

console.log('\n--- reading the code back out, so the server can learn it ---');
check('SA out of a real quotation number', extractCode(TNT_QUO, '037/QUO-TNT/SA/IX/26'), 'SA');
check('MCN out of a real invoice number', extractCode(TNT_INV, '01/INV-TNT/MCN/VIII/26'), 'MCN');
check('a lowercase code comes back as typed', extractCode(TNT_QUO, '037/QUO-TNT/sa/IX/26'), 'sa');
check('a code with a stray space is trimmed', extractCode(TNT_QUO, '037/QUO-TNT/ SA /IX/26'), 'SA');
check('HYPE has no code segment, so nothing to learn', extractCode(HYPE_QUO, '003/QUO-HYPE'), null);
check('a number that does not match the template yields nothing', extractCode(TNT_QUO, '003/QUO-HYPE'), null);
check('a missing code segment yields nothing rather than a guess', extractCode(TNT_QUO, '037/QUO-TNT//IX/26'), null);
check('no number, no code', extractCode(TNT_QUO, null), null);
check('no template, no code', extractCode(null, '037/QUO-TNT/SA/IX/26'), null);

console.log('\n--- other segments read back correctly ---');
check('the month comes back out of the number', extractSegment(TNT_QUO, '037/QUO-TNT/SA/IX/26', 'roman'), 'IX');
check('the year comes back out', extractSegment(TNT_QUO, '037/QUO-TNT/SA/IX/26', 'yy'), '26');
check('the sequence comes back without its padding', extractSegment(TNT_QUO, '037/QUO-TNT/SA/IX/26', 'seq'), '037');

console.log(failures === 0 ? '\nSemua lulus.\n' : `\n${failures} gagal.\n`);
process.exit(failures === 0 ? 0 : 1);
