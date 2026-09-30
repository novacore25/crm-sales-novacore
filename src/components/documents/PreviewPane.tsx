'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import { DocumentPreview, type PreviewDoc } from './DocumentPreview';
import { cn } from '@/lib/utils';

/**
 * The live preview pane.
 *
 * Three things the office actually needs, none of which a shrunken thumbnail
 * provides:
 *
 * - Full A4 height. Scaling the sheet down to a strip made the description text
 *   unreadable, so nobody could check the wording before sending.
 * - Zoom and drag. Reading a 9px table cell on a 0.6 scale is guesswork.
 * - A wider pane. At 46% the sheet could not be shown at a legible size on a
 *   laptop screen at all.
 *
 * Zoom is the CSS `zoom` property, not `transform: scale`. The preview is full
 * height and scrolls, and `transform` would leave the layout box at its
 * unscaled size - which is the bug that made the previous preview cut off at a
 * third of its real height. `zoom` is a layout property, so the scroll height,
 * the sticky header and the sticky footer all agree with what is on screen.
 */

const SHEET_W = 794; // A4 at 96dpi
const SHEET_H = 1123;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

const ZOOM_STEPS = [0.3, 0.4, 0.5, 0.65, 0.8, 0.9, 1, 1.25, 1.5, 1.75, 2];

export function PreviewPane({
  doc,
  summary,
  expanded,
  onToggleExpanded,
  className,
}: {
  doc: PreviewDoc;
  summary: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);

  /** null means "follow the pane width" - fit, recomputed on every resize. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // 32px of padding either side, plus a hair so the sheet never butts the edge.
    const avail = el.clientWidth - 40;
    if (avail <= 0) return;
    setFitZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, avail / SHEET_W)));
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const effective = zoom ?? fitZoom;

  const step = useCallback(
    (dir: 1 | -1) => {
      setZoom((prev) => {
        const from = prev ?? fitZoom;
        if (dir === 1) {
          return ZOOM_STEPS.find((s) => s > from + 0.001) ?? MAX_ZOOM;
        }
        const below = [...ZOOM_STEPS].reverse().find((s) => s < from - 0.001);
        return below ?? MIN_ZOOM;
      });
    },
    [fitZoom],
  );

  /* Ctrl + wheel zooms, the way every other document viewer does. Without it
     the only way to change size is the two buttons, which is not enough when
     you are hunting for a specific number. */
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    },
    [step],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = scroller.current;
    if (!el) return;
    if (e.button !== 0) return;
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setDragging(true);
    el.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = scroller.current;
    const start = pan.current;
    if (!el || !start) return;
    // Scrolling deltas are in CSS pixels, so at a zoom below 1 the pointer has to
    // travel further to move the page the same distance. Dividing keeps the
    // sheet under the cursor instead of racing away from it.
    const k = 1 / effective;
    el.scrollLeft = start.left - (e.clientX - start.x) * k;
    el.scrollTop = start.top - (e.clientY - start.y) * k;
  }, [effective]);

  const endDrag = useCallback((e: React.PointerEvent) => {
    pan.current = null;
    setDragging(false);
    const el = scroller.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }, []);

  const btn =
    'h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm transition disabled:opacity-30 disabled:pointer-events-none';

  return (
    <div className={cn('bg-slate-200 border-l border-slate-300 flex flex-col min-h-0', className)}>
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-300 bg-slate-100">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5 shrink-0">
          <Eye className="w-3 h-3" />
          Preview langsung
        </span>

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} className={btn} title="Perkecil (Ctrl - scroll)">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(null)}
            title="Ikuti lebar panel"
            className="h-7 min-w-[52px] px-1.5 rounded-md text-[10px] font-black tabular-nums text-slate-600 hover:bg-white hover:shadow-sm transition"
          >
            {zoom === null ? 'Fit' : `${Math.round(effective * 100)}%`}
          </button>
          <button type="button" onClick={() => step(1)} className={btn} title="Perbesar (Ctrl + scroll)">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-slate-300 mx-1" />
          <button
            type="button"
            onClick={onToggleExpanded}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm transition"
            title={expanded ? 'Perkecil panel preview' : 'Lebarkan panel preview'}
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="shrink-0 px-4 pb-2 pt-2 text-[10px] font-bold text-slate-500 tabular-nums bg-slate-100 border-b border-slate-300">
        {summary}
      </div>

      <div
        ref={scroller}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'flex-1 min-h-0 overflow-auto p-4',
          dragging ? 'cursor-grabbing select-none' : 'cursor-grab',
        )}
      >
        <div
          className="mx-auto bg-white shadow-xl ring-1 ring-slate-300"
          style={{
            zoom: effective,
            width: SHEET_W,
            minHeight: SHEET_H,
          }}
        >
          <DocumentPreview doc={doc} />
        </div>
      </div>
    </div>
  );
}
