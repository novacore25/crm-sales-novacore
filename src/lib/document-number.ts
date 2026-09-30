/**
 * Document number composition.
 *
 * The office issues `037/QUO-TNT/SA/IX/26`. Only two of those six parts change
 * from one document to the next: the running sequence and the letter code. The
 * month and the year come from the document's own date, and the type and the
 * company come from the series. Asking for all six meant asking for two facts
 * and retyping four that were already known.
 *
 * So `document_series.format` holds a template, not an example:
 *
 *   {seq:3}/{type}-{company}/{code}/{roman}/{yy}
 *
 * The form is built from that template. Nothing here knows that TNT abbreviates
 * QUOTATION to QUO or that HYPE has no code segment at all - a series with a
 * different shape simply has a different template, and a series with no template
 * falls back to typing the whole number.
 *
 * Pure functions, no database and no React, so the composition can be checked on
 * its own. The arithmetic that decides what gets printed must not depend on a
 * render.
 */

export type SegmentKind = 'seq' | 'code' | 'roman' | 'yy' | 'type' | 'company';

export interface TemplateSegment {
  kind: SegmentKind;
  /** Zero-pad width, for `seq` only. */
  width?: number;
}

export interface ParsedTemplate {
  segments: TemplateSegment[];
  /** The literal parts between segments, same length, index 0 before segment 0. */
  literals: string[];
}

/** The two-letter type code the office prints. Not a free choice. */
const TYPE_CODE: Record<string, string> = {
  QUOTATION: 'QUO',
  INVOICE: 'INV',
};

const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI',
  'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
];

/** Only these tokens are substituted; anything else in the template is literal. */
const TOKEN = /\{(seq|code|roman|yy|type|company)(?::(\d+))?\}/g;

export function parseTemplate(format: string | null | undefined): ParsedTemplate | null {
  if (!format || !format.includes('{')) return null;

  const segments: TemplateSegment[] = [];
  const literals: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(format)) !== null) {
    literals.push(format.slice(last, m.index));
    const kind = m[1] as SegmentKind;
    segments.push({ kind, width: m[2] ? Number(m[2]) : undefined });
    last = m.index + m[0].length;
  }
  literals.push(format.slice(last));

  return segments.length > 0 ? { segments, literals } : null;
}

/** Roman month for a date. Month 9 is IX, which is what the samples show. */
export function romanMonth(date: Date): string {
  return ROMAN[date.getMonth()] ?? String(date.getMonth() + 1);
}

/** Two-digit year, so 2026 prints as 26. */
export function shortYear(date: Date): string {
  return String(date.getFullYear() % 100).padStart(2, '0');
}

/**
 * Zero-pads the sequence. The office prints 037 but 01, so the width is part of
 * the template rather than a fixed 3 - getting this wrong turns 01 into 001 and
 * creates a second, different number for the same document.
 */
export function padSequence(value: number | string, width = 3): string {
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return ''.padStart(width, '0');
  return digits.padStart(width, '0');
}

export interface ComposeInput {
  format: string | null | undefined;
  seq: number | string | null | undefined;
  code?: string | null;
  docType: string;
  company: string;
  /** The document's own date. Supplies the month and the year. */
  date: string | Date | null | undefined;
}

export interface ComposeResult {
  /** The assembled number, or '' when the template is unusable. */
  value: string;
  /** Segment kinds the user has to supply. */
  needs: SegmentKind[];
  /** Resolved text per segment, aligned with parseTemplate().segments. */
  parts: string[];
}

/**
 * Assembles the number. Missing pieces are left empty rather than guessed: a
 * number printed with a silently invented sequence is a real number that went
 * out, and the office would have no way to tell it apart from a deliberate one.
 */
export function composeNumber(input: ComposeInput): ComposeResult {
  const tpl = parseTemplate(input.format);
  if (!tpl) return { value: '', needs: [], parts: [] };

  const d = toDate(input.date);
  // With no usable date there is no honest month or year to print, so they are
  // left blank and the form asks for a date.
  const roman = d ? romanMonth(d) : '';
  const yy = d ? shortYear(d) : '';

  const parts = tpl.segments.map((seg) => {
    switch (seg.kind) {
      case 'seq':
        return input.seq === null || input.seq === undefined || input.seq === ''
          ? ''
          : padSequence(input.seq, seg.width ?? 3);
      case 'code':
        return (input.code ?? '').trim().toUpperCase();
      case 'roman':
        return roman;
      case 'yy':
        return yy;
      case 'type':
        return TYPE_CODE[input.docType] ?? input.docType;
      case 'company':
        return input.company;
    }
  });

  let value = '';
  tpl.segments.forEach((seg, i) => {
    value += tpl.literals[i] ?? '';
    value += parts[i] ?? '';
  });
  value += tpl.literals[tpl.literals.length - 1] ?? '';

  const needs = tpl.segments
    .filter((s) => s.kind === 'seq' || s.kind === 'code')
    .map((s) => s.kind);

  return { value, needs: [...new Set(needs)], parts };
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Reads one segment back out of a finished number.
 *
 * The server needs this to learn which letter code was used, and the client only
 * sends the composed number. Trusting a separate `code` field from the browser
 * would let the dropdown learn a code that does not appear on the document - the
 * list would then offer a value that, picked next time, silently changes the
 * number.
 *
 * Returns null when the template has no such segment, or when the number does not
 * match the template's shape. Guessing here would be worse than not learning: a
 * code invented from a mismatched number is wrong in a way nothing catches.
 */
export function extractSegment(
  format: string | null | undefined,
  number: string | null | undefined,
  kind: SegmentKind,
): string | null {
  const tpl = parseTemplate(format);
  const clean = number?.trim();
  if (!tpl || !clean) return null;

  const index = tpl.segments.findIndex((s) => s.kind === kind);
  if (index < 0) return null;

  // Segment i is whatever sits between literal i and literal i+1. Searching for
  // the FOLLOWING separator is what keeps the indices aligned - an earlier
  // version searched for the preceding one and every segment came back shifted,
  // so the code read as "TNT" and the month as "SA".
  const parts: string[] = [];
  let cursor = 0;
  for (let i = 0; i < tpl.segments.length; i++) {
    const nextLiteral = tpl.literals[i + 1] ?? '';
    const at = nextLiteral ? clean.indexOf(nextLiteral, cursor) : clean.length;
    if (at < 0) return null; // does not match the template's shape
    parts.push(clean.slice(cursor, at));
    cursor = at + nextLiteral.length;
  }

  const value = (parts[index] ?? '').trim();
  return value === '' ? null : value;
}

/** The letter code in a number, or null if this series has no code segment. */
export function extractCode(
  format: string | null | undefined,
  number: string | null | undefined,
): string | null {
  return extractSegment(format, number, 'code');
}

/**
 * A finished example of what this series prints, for the form's help line.
 *
 * Rendered as a real number rather than a template with braces in it. The form
 * already shows the actual composer above this line, with the editable parts as
 * real inputs, so marking every segment again here would only be noise - and it
 * was actively misleading, since it rendered a HYPE series with TNT's company
 * code.
 */
export function describeTemplate(
  format: string | null | undefined,
  docType: string,
  company: string,
  date: string | Date | null | undefined,
): string | null {
  if (!parseTemplate(format)) return null;
  return composeNumber({ format, seq: 3, code: 'SA', docType, company, date }).value || null;
}
