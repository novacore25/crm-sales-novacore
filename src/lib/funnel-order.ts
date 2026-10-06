/**
 * Funnel date ordering.
 *
 * The office rule, confirmed: a deal does not move backwards. Chat first, then
 * responsed, then meeting, then close. Every stage that is filled in must carry
 * a date, and those dates must not run backwards - otherwise the trail on the
 * quotation says one thing and the timeline says another.
 *
 * The modal already refused to close a deal whose earlier stages had no date at
 * all. What it did not check was the order, so a rep could date a Close Win
 * before the chat that started it and nothing would stop them.
 *
 * Pure and free of React and the database so it can be asserted directly, for
 * the same reason document-number.ts is.
 */

/** The stages that must appear in this order before a close. */
export const FUNNEL_PRECEDING_STAGES = ['Chated', 'Responsed', 'Set Meeting'] as const;
export type FunnelPrecedingStage = (typeof FUNNEL_PRECEDING_STAGES)[number];

/** Indonesian labels, for the message the office reads. */
export const STAGE_LABELS: Record<string, string> = {
  Chated: 'Chated',
  Responsed: 'Responsed',
  'Set Meeting': 'Set Meeting',
  'Close Win': 'Close Win',
  'Close Lost': 'Close Lost',
  Failed: 'Failed',
};

type DateInput = string | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function format(d: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
  }).format(d);
}

/**
 * The date that will apply to a stage once this save completes.
 *
 * Three sources, in priority order: what the rep typed into the retro-fill
 * field, then the lead's own denormalised column, then the newest existing
 * history row for that stage. A stage with nothing anywhere is absent from the
 * result rather than dated today, because inventing a date would pass the order
 * check without meaning anything.
 */
export function effectiveStageDate(input: {
  stage: string;
  leadColumn?: DateInput;
  history?: { stage: string; dateOccurred: DateInput }[];
  pending?: DateInput;
}): Date | null {
  if (input.pending) {
    const typed = toDate(input.pending);
    if (typed) return typed;
  }
  const fromColumn = toDate(input.leadColumn);
  if (fromColumn) return fromColumn;

  const rows = (input.history ?? []).filter((h) => h.stage === input.stage);
  if (!rows.length) return null;
  const dates = rows.map((h) => toDate(h.dateOccurred)).filter((d): d is Date => d !== null);
  if (!dates.length) return null;
  // Newest wins: a rep correcting an old entry means the latest one.
  return dates.sort((a, b) => b.getTime() - a.getTime())[0]!;
}

export interface FunnelOrderInput {
  chated?: DateInput;
  responded?: DateInput;
  setMeeting?: DateInput;
  /** The date of the stage being recorded now, including Close Win / Lost. */
  closing: DateInput;
  closingStage?: string;
}

/**
 * Returns a message naming the two stages that are out of order, or null when
 * the trail is sound.
 *
 * Only stages that have a date participate. A stage with no date anywhere is
 * skipped rather than treated as failing - "unknown" is not "before", and
 * guessing a position for it would produce a message that blames the wrong
 * stage.
 */
export function validateFunnelOrder(input: FunnelOrderInput): string | null {
  const closing = toDate(input.closing);
  if (!closing) return null;

  const chain: { stage: string; date: Date }[] = [];
  const byStage: Record<string, DateInput | undefined> = {
    Chated: input.chated,
    Responsed: input.responded,
    'Set Meeting': input.setMeeting,
  };

  for (const stage of FUNNEL_PRECEDING_STAGES) {
    const d = toDate(byStage[stage]);
    if (d) chain.push({ stage, date: d });
  }
  chain.push({ stage: input.closingStage ?? 'Close Win', date: closing });

  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1]!;
    const cur = chain[i]!;
    if (cur.date.getTime() < prev.date.getTime()) {
      return `Urutan tanggal tidak sesuai. ${STAGE_LABELS[prev.stage]} harusnya tidak lebih baru dari ${STAGE_LABELS[cur.stage]} — ${format(prev.date)} sudah lewat ${format(cur.date)}.`;
    }
  }
  return null;
}