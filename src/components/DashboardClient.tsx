"use client";
import React, { useState, useMemo, useEffect, useTransition } from 'react';
import type {
  LeadDTO,
  FunnelHistoryDTO,
  DashboardStatsDTO,
  ContributionDTO,
  GhostedLeadDTO,
  UserProfile,
  GlobalTargetDTO,
  IndividualTargetDTO,
  LeadStatus,
} from '@/types';
import { getDashboardStats, getIndividualContributions, getGhostedLeads, getFunnelIncompleteWins, type DataHealthRow } from '@/app/actions/analytics-actions';
import { getLeadsPage, getCategories } from '@/app/actions/lead-actions';
import { Database, Send, ReplyAll, Handshake, Trophy, Filter, TrendingUp, Users, Target, Search, Phone, Info, Check, Clock, AlertTriangle, Square, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { assignablePICNames } from '@/lib/pic-filter';
import { format, startOfMonth } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import BulkStatusModal from './BulkStatusModal';
import DataHealthPanel from './DataHealthPanel';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface DashboardProps {
  stats: DashboardStatsDTO;
  contributions: ContributionDTO[];
  ghosted: GhostedLeadDTO[];
  user: UserProfile;
  users: UserProfile[];
  targets: GlobalTargetDTO[];
  individualTargets: IndividualTargetDTO[];
}

const EMPTY_STATS: DashboardStatsDTO = {
  totalLeads: 0,
  totalLeadsInScope: 0,
  totalChated: 0,
  totalResponsed: 0,
  totalSetMeeting: 0,
  dealsWon: 0,
  dealsWonLifetime: 0,
  lostDeals: 0,
  failedDeals: 0,
  totalRevenue: 0,
};

const STAGE_RANK: Record<string, number> = {
  'Input Data': 0,
  'Leads': 1,
  'Chated': 2,
  'Responsed': 3,
  'Set Meeting': 4,
  'Hold': 5,
  'Close Win': 6,
  'Close Lost': 6,
};

const getStageRank = (stage: string) => STAGE_RANK[stage] || 0;

/**
 * Funnel timestamps arrive as full ISO strings; the date inputs are plain
 * `yyyy-MM-dd`. Normalising both through one parser keeps the range checks in
 * the pipeline table and in the rate cards comparable.
 */
const parseDateString = (dStr: string | null | undefined) => {
  if (!dStr) return 0;
  const parsed = new Date(dStr).getTime();
  if (!isNaN(parsed)) return parsed;
  const parts = dStr.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0]!.length === 4) {
      return new Date(`${parts[0]}-${parts[2]}-${parts[1]}`).getTime();
    } else if (parts[2]!.length === 4) {
      return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
    }
  }
  return 0;
};

const historyTimestamp = (h: FunnelHistoryDTO) => {
  const t = new Date(h.createdAt).getTime();
  return isNaN(t) ? 0 : t;
};

/** The legacy "ghosted" panel triggered at 14 days. Keep the same threshold. */
const GHOSTED_MIN_DAYS = 14;

/**
 * The report timezone: WIB, fixed.
 *
 * Two bugs lived in the old date handling and both silently dropped data.
 *
 * `new Date('2026-09-29')` is parsed as UTC midnight, which is 07:00 in WIB. The
 * old code then called `endOfDay()` on that instant, adding 23:59:59.999 of
 * *browser-local* time to it. For a reader in WIB the range therefore ended at
 * 16:59 UTC, throwing away the last seven hours of the closing day. Every
 * evening entry was invisible until tomorrow.
 *
 * Worse, the two ends of the range were computed in different timezones while
 * the comparison happened in UTC, so a reader who changed their machine's
 * timezone saw a different dashboard.
 *
 * The window is now built as explicit calendar dates in WIB and formatted with
 * a fixed offset, so "29 Sep" means 00:00 to 23:59:59.999 WIB regardless of
 * where the reader is or what their device thinks the zone is.
 */
const REPORT_OFFSET_MIN = 7 * 60; // WIB is UTC+7, no DST

/** `yyyy-MM-dd` for a date, read as calendar text rather than a UTC instant. */
const calendarDay = (dStr: string): string => {
  const trimmed = dStr.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
};

/**
 * `2026-09-29` -> `29/09/2026` for display.
 *
 * Split on the string rather than parsing it, so the label always shows the day
 * the user picked instead of a day shifted by a timezone conversion.
 */
const formatID = (dStr: string): string => {
  const parts = calendarDay(dStr).split('-');
  if (parts.length !== 3) return dStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

/**
 * Start of the given calendar day in WIB, as an ISO instant.
 * `2026-09-01` + `start` -> `2026-08-31T17:00:00.000Z`, which is 00:00 WIB.
 */
const wibDayStartIso = (dStr: string): string | null => {
  const day = calendarDay(dStr);
  if (!day) return null;
  const ms = Date.parse(`${day}T00:00:00.000Z`) - REPORT_OFFSET_MIN * 60_000;
  return new Date(ms).toISOString();
};

/**
 * End of the given calendar day in WIB, inclusive.
 *
 * The boundary is the last millisecond of the day, not midnight of the next
 * one, so a `funnel_history` row written at 23:59:59.500 is still counted.
 */
const wibDayEndIso = (dStr: string): string | null => {
  const day = calendarDay(dStr);
  if (!day) return null;
  const nextDay = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000);
  const nextDayText = nextDay.toISOString().slice(0, 10);
  // Midnight WIB of the following day, minus 1ms.
  const ms = Date.parse(`${nextDayText}T00:00:00.000Z`) - REPORT_OFFSET_MIN * 60_000 - 1;
  return new Date(ms).toISOString();
};

export default function DashboardClient({
  stats: initialStats,
  contributions: initialContributions,
  ghosted: initialGhosted,
  user,
  users,
  targets,
  individualTargets,
}: DashboardProps) {
  const router = useRouter();
  const [filterAdmin, setFilterAdmin] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterProduct, setFilterProduct] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'ALL'>('ALL');
  const [filterStart, setFilterStart] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [filterEnd, setFilterEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [search, setSearch] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;

  // Aggregates arrive with the server render and are re-fetched whenever a
  // filter changes. Aggregation lives in SQL now, so nothing is re-derived here.
  const [stats, setStats] = useState<DashboardStatsDTO>(initialStats);
  const [contributions, setContributions] = useState<ContributionDTO[]>(initialContributions);
  const [ghosted, setGhosted] = useState<GhostedLeadDTO[]>(initialGhosted);
  const [incompleteWins, setIncompleteWins] = useState<DataHealthRow[]>([]);

  const [tableLeads, setTableLeads] = useState<LeadDTO[]>([]);
  const [totalFilteredLeads, setTotalFilteredLeads] = useState(0);
  const [tableLoading, setTableLoading] = useState(true);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  // Bumped after a write so both effects refetch without touching the filters.
  const [reloadToken, setReloadToken] = useState(0);

  // Arrays are recreated on every render, so the effects key off these strings.
  const productKey = filterProduct.join('|');
  const productList = useMemo(() => filterProduct, [productKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const isBusy = loading || isPending || tableLoading;

  useEffect(() => {
    let cancelled = false;
    getCategories()
      .then((cats) => {
        if (!cancelled) setCategoryOptions(cats);
      })
      .catch(() => {
        /* the category dropdown simply stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterAdmin, filterCategory, productKey, filterStatus, filterStart, filterEnd, search]);

  // Scorecard + per-rep contribution + stagnant leads, scoped to the filters.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const analyticsFilters = {
      admin: filterAdmin,
      category: filterCategory,
      products: productList,
      // Both bounds are calendar days in WIB, resolved to absolute instants.
      // A half-set range is treated as "no range" so the UI can never send a
      // start without an end and silently report a one-sided window.
      startDate: (!filterStart || !filterEnd) ? null : wibDayStartIso(filterStart),
      endDate: (!filterStart || !filterEnd) ? null : wibDayEndIso(filterEnd),
    };

    const run = async () => {
      const [nextStats, nextContributions, nextGhosted, nextIncomplete] = await Promise.all([
        getDashboardStats(analyticsFilters),
        getIndividualContributions(analyticsFilters),
        getGhostedLeads({
          admin: filterAdmin,
          category: filterCategory,
          products: productList,
          minDays: GHOSTED_MIN_DAYS,
          // Staleness is measured against "now" on purpose - a ghosted lead is
          // one nobody has touched recently, whatever date range you happen to
          // be looking at. Narrowing it to the selected window would hide
          // exactly the leads that need chasing.
        }),
        // Deliberately not scoped by the filters. This is an audit of broken
        // data, and "what needs repairing" must not change because someone
        // picked a different month - otherwise a broken lead can be hidden by
        // choosing the wrong date.
        //
        // Fetched separately rather than inside Promise.all's destructuring
        // error path: if this one query fails, the scorecard should still load.
        getFunnelIncompleteWins().catch((e) => {
          console.error('[data-health] failed', e);
          return [];
        }),
      ]);
      if (cancelled) return;
      setStats(nextStats);
      setContributions(nextContributions);
      setGhosted(nextGhosted);
      setIncompleteWins(nextIncomplete);
    };

    startTransition(async () => {
      try {
        await run();
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setStats(EMPTY_STATS);
        setContributions([]);
        setGhosted([]);
        toast.error('Gagal memuat data analitik. Silakan coba lagi.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filterAdmin, filterCategory, productKey, filterStart, filterEnd, initialStats, initialContributions, initialGhosted, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pipeline table is a server-paginated page of leads. The funnel scope
  // (PIC + date window) goes to the server, not the browser, so the rows, the
  // count and the pager all describe the same set of leads.
  useEffect(() => {
    let cancelled = false;
    setTableLoading(true);

    const run = async () => {
      const result = await getLeadsPage({
        page: currentPage - 1,
        pageSize: itemsPerPage,
        includeDeleted: false,
        search: search.trim() || undefined,
        statusFilter: filterStatus,
        categoryFilter: filterCategory,
        productFilter: productList,
        funnelAdmin: filterAdmin,
        funnelStart: (!filterStart || !filterEnd) ? null : wibDayStartIso(filterStart),
        funnelEnd: (!filterStart || !filterEnd) ? null : wibDayEndIso(filterEnd),
      });
      if (cancelled) return;
      setTableLeads(result.leads);
      setTotalFilteredLeads(result.total);
    };

    run()
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setTableLeads([]);
        setTotalFilteredLeads(0);
        toast.error('Gagal memuat daftar lead. Silakan coba lagi.');
      })
      .finally(() => {
        if (!cancelled) setTableLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentPage, search, filterStatus, filterCategory, productKey, filterAdmin, filterStart, filterEnd, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    setCurrentPage(1);
    setReloadToken(t => t + 1);
  };

  const toggleSelectAll = () => {
    const paginatedIds = tableLeads.map(l => l.id);
    const allSelected = paginatedIds.length > 0 && paginatedIds.every(id => selectedLeadIds.includes(id));
    if (allSelected) {
      setSelectedLeadIds(prev => prev.filter(id => !paginatedIds.includes(id)));
    } else {
      setSelectedLeadIds(prev => Array.from(new Set([...prev, ...paginatedIds])));
    }
  };

  const toggleSelectRow = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedLeadIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  // The PIC filter offers staff, admin and lord. `pending` is excluded because
  // such an account has never been assigned a lead, so selecting one could only
  // ever return an empty result.
  const admins = useMemo(() => assignablePICNames(users), [users]);

  const currentTargetMonth = filterEnd.slice(0, 7) || format(new Date(), 'yyyy-MM');
  const activeTarget = useMemo(() => targets?.find(t => t.monthYear === currentTargetMonth), [targets, currentTargetMonth]);

  // The scorecards render the same eight aggregates the server computed.
  const scorecard = useMemo(() => ({
    // All-time, on purpose: the lead pool is the denominator a funnel is
    // measured against, and cutting it to the window would make the response
    // rate describe only the leads that happened to arrive this month.
    total: stats.totalLeads,
    // Leads the selected PIC actually worked in the window. This is the honest
    // denominator for the rates below.
    inScope: stats.totalLeadsInScope,
    chated: stats.totalChated,
    responsed: stats.totalResponsed,
    meeting: stats.totalSetMeeting,
    // Wins INSIDE the window. This is the only figure comparable to the stage
    // counts above, so it is what the rates divide.
    win: stats.dealsWon,
    // Wins, all time. The Conversion Success card is a lifetime headline, and
    // mixing it with a windowed rate is what produced a 185% Efficiency Rate.
    winLifetime: stats.dealsWonLifetime,
    lost: stats.lostDeals,
    failed: stats.failedDeals,
    revenue: stats.totalRevenue,
  }), [stats]);

  /**
   * Every rate is clamped to 100.
   *
   * They were not before, and the dashboard was showing INTEREST RATE 100.0%
   * off a 26-of-26 split. The stages are counted independently from the lead's
   * history, so a lead that responded in the window and set a meeting outside
   * it makes `meeting > responsed` and the ratio exceeds 100. A conversion
   * rate over 100% is not a success story, it is a broken funnel, and printing
   * it as a number hides the fact that the team should look at how stages are
   * being logged.
   *
   * `pct` returns an em-dash when the denominator is zero instead of "0%",
   * because "0% of nothing responded" is a different statement from "no one
   * was chated yet".
   */
  const pct = (num: number, den: number): string => {
    if (!den) return '—';
    return Math.min(100, (num / den) * 100).toFixed(1) + '%';
  };

  /**
   * The unclamped ratio, so a rate that hit the ceiling can say so.
   *
   * Clamping alone is a quiet lie. 48 wins against 26 responses is 185%, and
   * printing that as "100.0%" in a card headed EFFICIENCY RATE invites the
   * reading that the team converted every response it got - when in fact 22
   * deals closed without a response ever being logged for them. The clamp stops
   * an impossible number going on screen; this stops the impossibility going
   * unnoticed.
   */
  const rawPct = (num: number, den: number): number => (den ? (num / den) * 100 : 0);

  const rates = useMemo(() => {
    return {
      // Of the leads the PIC worked, how many were chatted.
      response: pct(scorecard.chated, scorecard.inScope),
      // Of the leads that responded, how many became a meeting.
      interest: pct(scorecard.meeting, scorecard.responsed),
      // Wins inside the window over responses inside the window. Both sides
      // now come from the same scoped set, which is what makes the ratio mean
      // anything.
      conversion: pct(scorecard.win, scorecard.responsed),
      // Non-null when the true ratio still exceeds 100 after scoping. That
      // residual is real missing data, not a query mistake: a win inside the
      // window whose response was logged outside it, or never logged.
      conversionOverflow: (() => {
        const raw = rawPct(scorecard.win, scorecard.responsed);
        return raw > 100 ? raw : null;
      })(),
    };
  }, [scorecard]);

  /**
   * Individual Target Contribution, biggest revenue first.
   *
   * The server sorts by name, so the panel opened with whoever happened to be
   * alphabetically first regardless of what they brought in. Revenue is the
   * figure the panel exists to show, so it is what orders it.
   *
   * The unattributed bucket is pinned to the bottom whatever its size. It is
   * not a person, and sorting it by revenue would put a Rp 1.9 billion row
   * directly under the first trophy, which is the exact reading this was fixed
   * to prevent. It is still rendered, and still carries its warning banner.
   *
   * Ties break on revenue then on name, so the order is stable between renders
   * rather than depending on the server's row order.
   */
  const sortedContributions = useMemo(() => {
    return [...contributions].sort((a, b) => {
      const aUn = a.adminName === 'Tanpa PIC';
      const bUn = b.adminName === 'Tanpa PIC';
      if (aUn !== bUn) return aUn ? 1 : -1;
      const byRevenue = Number(b.totalRevenue) - Number(a.totalRevenue);
      if (byRevenue !== 0) return byRevenue;
      return a.adminName.localeCompare(b.adminName, 'id');
    });
  }, [contributions]);

  /**
   * Rows shown in the pipeline table.
   *
   * The PIC and date filters used to be applied here, in the browser, to the
   * page of 50 the server had already paginated. Two things broke at once:
   *
   *   - The page could come back holding 4 rows that match out of 50, so the
   *     table showed "4 rows" where the pager said "Page 1 of 128". The
   *     `totalFilteredLeads` driving that pager came from the server and knew
   *     nothing about this filter, so the count and the contents disagreed.
   *   - A page whose 50 rows were all filtered away rendered as an empty table
   *     with a pager still offering 127 more pages, which reads as "no leads
   *     match" when it actually means "none of these 50 match".
   *
   * `getLeadsPage` now receives the same funnel scope the analytics queries get,
   * so the rows, the count and the pager all describe one set. `funnelHistory`
   * is still filtered per lead so the stage chips on each row respect the
   * window, but that no longer decides whether the row exists.
   */
  const visibleLeads = useMemo(() => tableLeads, [tableLeads]);

  const stagnantAlerts = useMemo(() => {
    return ghosted
      .map(g => ({ g, days: g.daysPassed, msg: buildStagnantMessage(g.status, g.daysPassed) }))
      .sort((a, b) => b.days - a.days);
  }, [ghosted]);

  /**
   * Scale a monthly target down to the window actually being viewed.
   *
   * A three-day view must not be measured against a full month, or the bar sits
   * near zero no matter how well the rep did. Defined once and used by both the
   * bar and its label, because the old code divided by 4 in the bar AND printed
   * `targetChat / 4` in the label, so the number shown and the number used were
   * both wrong and disagreed with each other.
   *
   * Returns 1 (no scaling) when no range is selected, so a full-period view
   * compares like with like.
   */
  const prorate = useMemo(() => {
    if (!filterStart || !filterEnd) return (_monthly: number) => _monthly;

    const spanDays = Math.max(
      1,
      Math.round(
        (parseDateString(filterEnd) - parseDateString(filterStart)) / 86_400_000,
      ) + 1,
    );
    const daysInMonth = new Date(
      Number(currentTargetMonth.slice(0, 4)),
      Number(currentTargetMonth.slice(5, 7)),
      0,
    ).getDate();
    // Clamped: selecting a range longer than the month must not inflate the
    // target past the monthly figure.
    const share = Math.min(1, spanDays / Math.max(1, daysInMonth));

    return (monthly: number) => monthly * share;
  }, [filterStart, filterEnd, currentTargetMonth]);

  /**
   * Revenue sitting in the unattributed bucket.
   *
   * Surfaced as a headline warning rather than only as a row in the panel: a
   * sum that large is not a rounding artifact, and whoever looks at the
   * contribution figures needs to know a meaningful slice of them has no owner.
   */
  const unattributedRevenue = useMemo(
    () => contributions
      .filter(c => c.adminName === 'Tanpa PIC')
      .reduce((sum, c) => sum + Number(c.totalRevenue), 0),
    [contributions],
  );

  const handleGlobalSync = async () => { alert("Global Sync is disabled in Next.js version"); };

  const fixSuperImportData = async () => { alert("Fix Super Import is disabled in Next.js version"); };

  const bulkLeads = useMemo(
    () => tableLeads.filter(l => selectedLeadIds.includes(l.id)),
    [tableLeads, selectedLeadIds],
  );

  if (tableLoading && tableLeads.length === 0) {
    return (
      <div className="flex-1 flex flex-col p-4 space-y-4 animate-pulse">
        <div className="h-20 bg-slate-200 rounded-lg w-full"></div>
        <div className="h-10 bg-slate-200 rounded w-1/3"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="h-32 bg-slate-200 rounded-xl"></div>
          <div className="h-32 bg-slate-200 rounded-xl"></div>
          <div className="h-32 bg-slate-200 rounded-xl"></div>
          <div className="h-32 bg-slate-200 rounded-xl"></div>
        </div>
        <div className="h-64 bg-slate-200 rounded-xl w-full"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <header className="py-4 md:h-20 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between px-4 md:px-8 shrink-0 z-10 shadow-sm gap-4 overflow-y-auto custom-scrollbar md:overflow-visible relative">
        {isBusy && (
          <div className="absolute top-0 left-0 w-full h-1 bg-indigo-100 overflow-hidden">
            <div className="h-full bg-indigo-500 animate-[pulse_1s_ease-in-out_infinite] w-1/3 rounded-full"></div>
          </div>
        )}
        <div className="flex flex-col shrink-0">
          <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span className="w-2 h-5 md:h-6 bg-indigo-600 rounded-full"></span>
            Performance Scorecard
          </h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Real-time Analytics</p>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 shrink-0">
          <div className="flex flex-col items-end mr-2">
            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Role: {user.role}</span>
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Ver: 1.3</span>
            {user.role === 'lord' && (
              <div className="flex flex-col items-end gap-0.5">
                <button 
                  onClick={handleGlobalSync}
                  className="text-[8px] font-black text-emerald-500 hover:text-emerald-600 underline uppercase tracking-tighter mt-0.5"
                >
                  Sync All Data
                </button>
                <button 
                  onClick={fixSuperImportData}
                  className="text-[8px] font-black text-rose-500 hover:text-rose-600 underline uppercase tracking-tighter"
                >
                  Patch Data PIC
                </button>
              </div>
            )}
          </div>
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
            <input
              type="text"
              placeholder="Search Brand/WA..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 pr-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all w-full md:w-64 shadow-inner"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 bg-slate-100 p-1 rounded-xl border border-slate-200 w-full md:w-auto">
            <div className="flex-1 md:flex-none flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg shadow-sm border border-slate-200">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              <select
                value={filterAdmin}
                onChange={(e) => setFilterAdmin(e.target.value)}
                className="bg-transparent border-none text-xs font-black text-slate-700 focus:ring-0 cursor-pointer p-0"
              >
                <option value="ALL">All Team Members</option>
                {admins.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>

            <div className="flex-1 md:flex-none flex items-center gap-2 px-3 py-1.5">
              <Target className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="bg-transparent border-none text-xs font-bold text-slate-500 focus:ring-0 cursor-pointer p-0"
              >
                <option value="ALL">All Categories</option>
                {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm w-full md:w-auto">
            <Filter className={cn("w-3.5 h-3.5", (!filterStart || !filterEnd) ? "text-indigo-500" : "text-slate-400")} />
            {!filterStart || !filterEnd ? (
              <span className="text-xs font-black text-indigo-600 px-2 py-0.5 tracking-widest uppercase">All Time</span>
            ) : (
              <>
                <input
                  type="date"
                  value={filterStart}
                  onChange={(e) => setFilterStart(e.target.value)}
                  className="bg-transparent border-none text-xs font-bold text-slate-600 focus:ring-0 p-0 w-24"
                />
                <span className="text-slate-300 font-bold">/</span>
                <input
                  type="date"
                  value={filterEnd}
                  onChange={(e) => setFilterEnd(e.target.value)}
                  className="bg-transparent border-none text-xs font-bold text-slate-600 focus:ring-0 p-0 w-24"
                />
              </>
            )}
            <button 
              onClick={() => {
                if (!filterStart || !filterEnd) {
                  setFilterStart(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
                  setFilterEnd(format(new Date(), 'yyyy-MM-dd'));
                } else {
                  setFilterStart('');
                  setFilterEnd('');
                }
              }}
              className="ml-2 px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[9px] font-black text-slate-500 uppercase tracking-widest transition"
            >
              {(!filterStart || !filterEnd) ? 'Set Range' : 'Reset'}
            </button>
          </div>
        </div>
      </header>

      {/* Product Filter Strip */}
      <div className="bg-white border-b border-slate-100 px-4 md:px-8 py-3 flex items-center gap-3 shrink-0">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">Produk:</span>
        {[
          { key: 'TNT', label: 'TNT', active: 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 border-indigo-600', inactive: 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50' },
          { key: 'MCN', label: 'MCN', active: 'bg-slate-800 text-white shadow-lg shadow-slate-200 border-slate-800', inactive: 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50' },
          { key: 'HYPE', label: 'HYPE', active: 'bg-amber-400 text-white shadow-lg shadow-amber-200 border-amber-400', inactive: 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50' },
        ].map(({ key, label, active, inactive }) => (
          <button
            key={key}
            onClick={() => setFilterProduct(prev =>
              prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
            )}
            className={cn(
              "px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all duration-200",
              filterProduct.includes(key) ? active : inactive
            )}
          >
            {label}
            {filterProduct.includes(key) && <span className="ml-1.5 text-[9px] opacity-75">✓</span>}
          </button>
        ))}
        {filterProduct.length > 0 && (
          <button
            onClick={() => setFilterProduct([])}
            className="ml-1 px-3 py-2 rounded-xl text-[10px] font-black text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-200 hover:border-red-200 transition-all uppercase tracking-widest"
          >
            Reset
          </button>
        )}
        {filterProduct.length > 0 && (
          <span className="ml-auto text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Filter: {filterProduct.join(' + ')}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-8 space-y-6 md:space-y-8 custom-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="TOTAL LEADS"
            value={scorecard.total}
            icon={<Database className="w-5 h-5" />}
            color="slate"
            // The one number on this page that ignores the date range, so it
            // says so. A reader comparing it against CHATED OUT needs to know
            // they are on different clocks.
            note="Semua periode · tidak ikut filter tanggal"
          />
          <StatCard label="CHATED OUT" value={scorecard.chated} icon={<Send className="w-5 h-5" />} color="indigo" />
          <StatCard label="RESPONSES" value={scorecard.responsed} icon={<ReplyAll className="w-5 h-5" />} color="purple" />
          <StatCard label="MEETINGS SET" value={scorecard.meeting} icon={<Handshake className="w-5 h-5" />} color="amber" />
        </div>

        {/*
          The funnel cards above are scoped to the selected PIC and date window,
          but TOTAL LEADS is all-time. When those two disagree the reader has no
          way to tell that the rate denominator is a third number, so the scope
          is spelled out whenever the cards are actually filtered.
        */}
        {(filterAdmin !== 'ALL' || Boolean(filterStart && filterEnd)) && (
          <p className="text-[11px] text-slate-400 -mt-2">
            Chated, Responses, dan Meetings mengikuti filter di atas
            {filterAdmin !== 'ALL' ? (
              <>
                {' '}
                (PIC: <span className="font-bold text-slate-600">{filterAdmin}</span>)
              </>
            ) : null}
            {filterStart && filterEnd ? (
              <>
                {' '}
                ({formatID(filterStart)} &ndash; {formatID(filterEnd)})
              </>
            ) : null}
            {' '}&mdash; total {scorecard.inScope} lead dihitung. Total Leads di atas tetap seluruh periode.
          </p>
        )}

        {/*
          A rate that hit the ceiling is clamped to 100%, which is correct as a
          number and misleading as a display. 48 wins against 26 responses is
          185%: without this line the Efficiency card reads as "every response
          converted", when the real finding is that 22 deals closed with no
          response ever logged against them. The data is the problem, and the
          card should say so rather than round it away.
        */}
        {rates.conversionOverflow !== null && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 -mt-1 leading-relaxed">
            <span className="font-black">Catatan:</span> {scorecard.win} deal Close Win di periode ini
            tapi hanya {scorecard.responsed} lead yang punya stage Responsed di periode yang sama
            ({rates.conversionOverflow.toFixed(0)}%). Bisa karena responsnya tercatat di luar
            periode ini, atau belum dicatat sama sekali. Lihat panel{' '}
            <span className="font-black">Data Health</span> di bawah untuk daftar lead yang perlu
            dilengkapi.
          </p>
        )}



        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:col-span-2">
            <div className="bg-slate-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-2xl shadow-slate-200 group flex flex-col justify-between">
              <div className="absolute top-0 right-0 p-4 md:p-6 opacity-10 group-hover:scale-110 transition-transform duration-500">
                <Trophy className="w-24 md:w-40 h-24 md:h-40" />
              </div>
              <div className="relative z-10 w-full">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-1 bg-indigo-500 rounded-full"></span>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Conversion Success</p>
                  </div>
                </div>

                <div className="mb-8">
                  <h3 className="text-5xl font-black tracking-tighter mb-1 flex items-baseline gap-3">
                    {scorecard.winLifetime} <span className="text-xl text-slate-400 font-bold tracking-tight">Deals Wan</span>
                  </h3>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Total Nominal Revenue</p>
                  <div className="text-4xl lg:text-5xl font-black text-emerald-400 tracking-tighter truncate">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(scorecard.revenue)}
                  </div>
                </div>
              </div>

              <div className="relative z-10 mt-6 md:mt-10 pt-4 md:pt-6 border-t border-slate-800 flex items-center justify-between gap-4">
                <div className="flex flex-col group/rate relative tooltip-container">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-indigo-400">{rates.conversion}</span>
                    <Info className="w-3 h-3 text-slate-500" />
                  </div>
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Global Rate</span>
                  <div className="absolute invisible group-hover/rate:visible opacity-0 group-hover/rate:opacity-100 transition bottom-full left-0 mb-2 w-48 bg-slate-800 text-white text-[10px] p-2 rounded-lg z-50 shadow-xl font-medium">
                    Efficiency Rate = (Total Deals Won ÷ Total Responses) × 100%. Mengukur efektivitas konversi dari leads yang sudah memberikan respon.
                  </div>
                </div>
                <div className="w-px h-8 bg-slate-800"></div>
                <div className="flex flex-col text-right">
                  <span className="text-2xl font-black text-red-400">{scorecard.lost}</span>
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Lost Deals</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 justify-center">
              <RateCard label="Response Rate" value={rates.response} color="indigo" icon={<TrendingUp className="w-4 h-4" />} />
              <RateCard label="Interest Rate" value={rates.interest} color="purple" icon={<TrendingUp className="w-4 h-4" />} />
              <RateCard label="Efficiency Rate" value={rates.conversion} color="emerald" icon={<TrendingUp className="w-4 h-4" />} />
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 shadow-sm flex flex-col h-[400px] md:h-[420px]">
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-2 flex items-center gap-2 shrink-0">
              <div className="w-1.5 h-4 bg-indigo-600 rounded-full"></div>
              Individual Target Contribution
            </h4>
            {unattributedRevenue > 0 && (
              // Nine won deals have no funnel_history row and no pic_name, so
              // nobody can be credited for Rp 1.92 billion. Flagged here rather
              // than shown as a rep, because a row labelled with someone's name
              // would read as their achievement and quietly misattribute it.
              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 leading-relaxed shrink-0">
                <span className="font-black">Tanpa PIC:</span>{' '}
                {new Intl.NumberFormat('id-ID', {
                  style: 'currency',
                  currency: 'IDR',
                  maximumFractionDigits: 0,
                }).format(unattributedRevenue)} dari total revenue tidak bisa
                diatribusikan ke nama tertentu — lead-nya berstatus Close Win tapi
                tidak punya riwayat PIC. Baris
                <span className="font-black"> &quot;Tanpa PIC&quot; </span>
                di bawah menunjukkannya, bukan sebuah pencapaian.
              </p>
            )}
            <div className="space-y-6 overflow-y-auto flex-1 pr-2 custom-scrollbar">
              {sortedContributions.map((contribution, index) => {
                const admin = contribution.adminName;
                const adminChat = Number(contribution.totalChat);
                const adminMeet = Number(contribution.totalMeet);
                const adminRev = Number(contribution.totalRevenue);
                // The unattributed bucket must not collect a trophy or a medal.
                const isUnattributed = admin === 'Tanpa PIC';

                let pChat = 0, pMeet = 0, pRev = 0;
                const adminRef = users.find(u => u.name === admin);
                const personalTarget = adminRef ? individualTargets.find(it => it.userId === adminRef.uid && it.monthYear === currentTargetMonth) : null;

                if (filterStart && filterEnd) {
                  const tChat = personalTarget?.targetChat || 0;
                  const tMeet = personalTarget?.targetMeeting || 0;
                  const tRev = personalTarget?.targetRevenue || 0;

                  pChat = tChat ? Math.min(100, (adminChat / prorate(tChat)) * 100) : 0;
                  pMeet = tMeet ? Math.min(100, (adminMeet / prorate(tMeet)) * 100) : 0;
                  pRev = tRev ? Math.min(100, (adminRev / prorate(tRev)) * 100) : 0;
                }

                return (
                  <div key={admin} className="group border-b border-slate-50 pb-4 last:border-0 relative">
                    <div className="flex justify-between items-end mb-3">
                      <span className="text-sm font-bold text-slate-700 group-hover:text-indigo-600 transition flex items-center gap-2">
                        {/* A trophy for a bucket with no person in it would be
                            absurd, and it ranked first precisely because the
                            unattributed revenue is the largest single figure. */}
                        {index === 0 && !isUnattributed && <Trophy className="w-4 h-4 text-amber-400 fill-amber-400" />}
                        {index === 1 && !isUnattributed && <Trophy className="w-4 h-4 text-slate-300 fill-slate-300" />}
                        {index === 2 && !isUnattributed && <Trophy className="w-4 h-4 text-amber-700 fill-amber-700" />}
                        <span className={isUnattributed ? 'text-amber-700 italic' : undefined}>
                          {admin}
                        </span>
                      </span>
                      <span className={cn(
                        "text-[10px] font-black tracking-widest",
                        isUnattributed ? 'text-amber-600' : 'text-emerald-600',
                      )}>
                        {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(adminRev)}
                      </span>
                    </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                        <span>Chat ({adminChat})</span>
                        {filterStart && filterEnd ? (
                          /* Show the target the bar is actually measured against.
                             The old label printed `targetChat / 4` while the bar
                             divided the same number by 4 again, so the figure
                             shown and the figure used were both wrong and did
                             not match each other. `prorate` is the single
                             source of truth for both. */
                          <span>
                            {isUnattributed
                              ? 'Tanpa target'
                              : personalTarget?.targetChat
                                ? `Target (${Math.round(prorate(personalTarget.targetChat))} di periode ini)`
                                : 'Belum diset'}
                          </span>
                        ) : null}
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${pChat}%` }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                        <span>Meet ({adminMeet})</span>
                        {filterStart && filterEnd ? (
                          <span>Target Mingguan: {personalTarget?.targetMeeting ? Math.round(personalTarget.targetMeeting / 4) : 'Belum diset'}</span>
                        ) : null}
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full transition-all duration-1000" style={{ width: `${pMeet}%` }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                        <span>Revenue</span>
                        {filterStart && filterEnd ? (
                          <span>Target: {personalTarget?.targetRevenue ? new Intl.NumberFormat('id-ID', { notation: 'compact', style: 'currency', currency: 'IDR', maximumFractionDigits: 1 }).format(personalTarget.targetRevenue) : 'Belum diset'}</span>
                        ) : null}
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000" style={{ width: `${pRev}%` }}></div>
                      </div>
                    </div>
                  </div>
                  </div>
                );
              })}
              {(!activeTarget && filterStart && filterEnd) && (
                <div className="text-xs font-bold text-amber-600 bg-amber-50 p-4 rounded-xl border border-amber-100">
                  Belum ada target global di set untuk bulan {currentTargetMonth}.
                </div>
              )}
              {(!filterStart || !filterEnd) && (
                <div className="text-xs font-bold text-indigo-600 bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  Target tidak ditampilkan karena mode All Time sedang aktif.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[500px] xl:col-span-2">
            <div className="p-4 md:p-8 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between shrink-0 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-6 bg-indigo-600 rounded-full"></div>
                <h3 className="text-base md:text-lg font-black text-slate-900 tracking-tight">Leads Pipeline</h3>
              </div>
              <div className="flex md:items-center gap-2 flex-wrap justify-start md:justify-end overflow-x-auto custom-scrollbar pb-1 md:pb-0">
                {(['ALL', 'Leads', 'Chated', 'Responsed', 'Set Meeting', 'Hold', 'Close Win', 'Close Lost', 'Failed'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                      filterStatus === s
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                        : "text-slate-500 hover:bg-slate-100"
                    )}
                  >
                    {s === 'ALL' ? 'Semua' : s}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-auto flex-1 custom-scrollbar">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-white border-b border-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-4 w-12 text-center border-r border-slate-50">
                      <button onClick={toggleSelectAll} className="text-slate-300 hover:text-indigo-500 transition focus:outline-none">
                        {visibleLeads.length > 0 && visibleLeads.every(l => selectedLeadIds.includes(l.id)) ? (
                          <CheckSquare className="w-4 h-4 text-indigo-500 drop-shadow-sm" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-left w-1/3">Brand & Info</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">Category</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Produk</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                      {filterAdmin === 'ALL' ? 'Status' : `Status ${filterAdmin}`}
                    </th>
                    {filterAdmin !== 'ALL' && (
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                        Status Global
                      </th>
                    )}
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                      {filterAdmin === 'ALL' ? 'Date' : `Date ${filterAdmin}`}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {visibleLeads.map((lead) => {
                    // `funnelHistory` already arrives scoped to the selected PIC
                    // and date window - the server did the filtering, so the
                    // browser does not re-apply a slightly different rule and
                    // disagree with the row count.
                    const compareHistory = (a: FunnelHistoryDTO, b: FunnelHistoryDTO) => {
                      const timeA = parseDateString(a.dateOccurred);
                      const timeB = parseDateString(b.dateOccurred);
                      if (timeA !== timeB) return timeB - timeA;
                      const tsA = historyTimestamp(a);
                      const tsB = historyTimestamp(b);
                      if (tsA !== tsB) return tsB - tsA;
                      return getStageRank(b.stage) - getStageRank(a.stage);
                    };

                    const sortedFilteredHistory = [...(lead.funnelHistory || [])].sort(compareHistory);

                    // Where the lead really sits, ignoring both filters. The
                    // server resolves this because the scoped history above
                    // cannot answer it - deriving it client-side made "Status
                    // Global" identical to "Status" by construction.
                    const globalLatest = lead.latestGlobal ?? null;

                    let picLatest: FunnelHistoryDTO | null = null;

                    if (filterAdmin !== 'ALL') {
                      picLatest = sortedFilteredHistory.find(h => h.byUserName === filterAdmin) ?? null;
                    } else {
                      picLatest = sortedFilteredHistory[0] ?? null;
                    }

                    const displayStatus = (() => {
                      if (filterStatus !== 'ALL') {
                        const matchingEntry = sortedFilteredHistory.find(h => {
                          if (filterAdmin !== 'ALL') return h.stage === filterStatus && h.byUserName === filterAdmin;
                          return h.stage === filterStatus;
                        });
                        if (matchingEntry) return matchingEntry.stage;
                      }
                      return picLatest ? picLatest.stage : (sortedFilteredHistory[0]?.stage || lead.status);
                    })();

                    const displayDate = (() => {
                      if (filterStatus !== 'ALL') {
                        const matchingEntry = sortedFilteredHistory.find(h => {
                          if (filterAdmin !== 'ALL') return h.stage === filterStatus && h.byUserName === filterAdmin;
                          return h.stage === filterStatus;
                        });
                        if (matchingEntry) return matchingEntry.dateOccurred;
                      }
                      return picLatest ? picLatest.dateOccurred : (sortedFilteredHistory[0]?.dateOccurred || lead.dateInput);
                    })();
                    const isOverriddenByOther = !!(filterAdmin !== 'ALL' && globalLatest && picLatest && globalLatest.byUserName !== filterAdmin && (historyTimestamp(globalLatest) || parseDateString(globalLatest.dateOccurred)) >= (historyTimestamp(picLatest) || parseDateString(picLatest.dateOccurred)));

                    // The entry the displayed status actually came from.
                    const displayLatest = filterStatus !== 'ALL'
                      ? (sortedFilteredHistory.find(h => {
                          if (filterAdmin !== 'ALL') return h.stage === filterStatus && h.byUserName === filterAdmin;
                          return h.stage === filterStatus;
                        }) ?? picLatest)
                      : picLatest;

                    const isValidDate = !!displayDate && parseDateString(displayDate) > 0;
                    const formattedDate = isValidDate ? new Date(parseDateString(displayDate)).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' }) : displayDate;

                    return (
                      <tr 
                        key={lead.id} 
                        className={cn(
                          "transition group",
                          selectedLeadIds.includes(lead.id) ? "bg-indigo-50/40" : "hover:bg-slate-50/50"
                        )}
                      >
                        <td className="px-6 py-4 text-center border-r border-slate-50">
                          <button onClick={(e) => toggleSelectRow(e, lead.id)} className="text-slate-300 hover:text-indigo-500 transition focus:outline-none">
                            {selectedLeadIds.includes(lead.id) ? (
                              <CheckSquare className="w-4 h-4 text-indigo-500" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-8 py-4">
                          <button 
                            onClick={() => router.push(`/lead/${lead.id}`)}
                            className="flex flex-col items-start group/brand"
                          >
                            <span className="font-bold text-slate-900 text-xs group-hover/brand:text-indigo-600 transition tracking-tight">
                              {lead.brandName}
                            </span>
                            <a 
                              href={`https://wa.me/${(lead.contact || '').replace(/^0/, '62').replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[9px] text-slate-400 font-medium group-hover/brand:text-emerald-500 hover:text-emerald-600 transition flex items-center gap-1 mt-0.5 hover:underline"
                            >
                              <Phone className="w-2.5 h-2.5" /> {(lead.contact || '').replace(/^0/, '62')}
                            </a>
                          </button>
                        </td>
                        <td className="px-8 py-4">
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-[8px] font-black uppercase tracking-widest">
                            {lead.category.split('/')[0]}
                          </span>
                        </td>
                        <td className="px-8 py-4 text-center">
                          {lead.productOffered && lead.productOffered.length > 0 ? (
                            <div className="flex justify-center gap-1">
                              {lead.productOffered.map(p => (
                                <span key={p} className={cn(
                                  "px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border shadow-sm whitespace-nowrap",
                                  p === 'TNT' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 
                                  (p === 'MCN' || p === 'Basemen') ? 'bg-slate-100 text-slate-700 border-slate-200' : 
                                  'bg-amber-50 text-amber-600 border-amber-100'
                                )}>
                                  {p === 'Basemen' ? 'MCN' : p}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[10px] font-black text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-8 py-4 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm",
                              getStatusColor(displayStatus as LeadStatus)
                            )}>
                              {displayStatus}
                            </span>
                            {/*
                              Attribute the stage to whoever recorded the entry
                              the badge is actually showing. This used
                              `globalLatest.byUserName`, which pairs a scoped
                              status with an unscoped author - so a date-filtered
                              row could read "Close Win" with a name that never
                              made that entry.
                            */}
                            {filterAdmin === 'ALL' && displayLatest && (
                              <div className="text-[8px] font-bold text-indigo-400 whitespace-nowrap">
                                by {displayLatest.byUserName}
                              </div>
                            )}
                          </div>
                        </td>
                        
                        {filterAdmin !== 'ALL' && (
                          <td className="px-8 py-4 text-center">
                            {isOverriddenByOther && globalLatest ? (
                              <div className="flex flex-col items-center gap-1.5" title={`Override oleh ${globalLatest.byUserName}`}>
                                <span className={cn(
                                  "px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest opacity-80 border-dashed border",
                                  getStatusColor(globalLatest.stage as LeadStatus)
                                )}>
                                  {globalLatest.stage}
                                </span>
                                <div className="text-[8px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 flex items-center gap-1 shadow-sm">
                                  <AlertTriangle className="w-2.5 h-2.5" /> {globalLatest.byUserName}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[8px] font-bold text-emerald-500 flex items-center justify-center gap-1 bg-emerald-50 px-2 py-1 rounded-md w-fit mx-auto border border-emerald-100 shadow-sm opacity-80">
                                <Check className="w-2.5 h-2.5" /> Normal
                              </span>
                            )}
                          </td>
                        )}

                        <td className="px-8 py-4 text-right flex flex-col items-end justify-center">
                          <span className="text-[10px] font-black text-slate-600 uppercase whitespace-nowrap mt-2">
                            {isValidDate ? formattedDate : '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleLeads.length === 0 && !tableLoading && (
                    <tr>
                      <td colSpan={filterAdmin === 'ALL' ? 6 : 7} className="px-8 py-20 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <Database className="w-8 h-8 text-slate-200" />
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No matching leads found</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {(() => {
              const totalPages = Math.ceil(totalFilteredLeads / itemsPerPage);
              return totalFilteredLeads > 0 && (
                <div className="px-6 py-3 border-t border-slate-100 bg-white flex items-center justify-between shrink-0">
                  <span className="text-[10px] font-bold text-slate-400">
                    Page {currentPage} of {totalPages || 1} ({totalFilteredLeads} total)
                  </span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold disabled:opacity-50 hover:bg-slate-50 transition"
                    >
                      Prev
                    </button>
                    <button 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages || totalPages === 0}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold disabled:opacity-50 hover:bg-slate-50 transition"
                    >
                      Next
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="bg-white rounded-3xl border border-rose-200 p-6 md:p-8 shadow-sm flex flex-col h-[400px] md:h-[500px] xl:col-span-1 relative overflow-hidden">
            <div className="absolute -right-6 -top-6 text-rose-50 opacity-40 pointer-events-none">
              <AlertTriangle className="w-48 h-48" />
            </div>
            
            <h4 className="text-sm font-black text-rose-700 uppercase tracking-widest mb-1 flex items-center gap-2 shrink-0 z-10">
              <div className="w-1.5 h-4 bg-rose-600 rounded-full"></div>
              Ghosted Lead Alert
            </h4>
            {/* The threshold is 14 days, but the badge only fires at 30. Without
                this the panel looked like it was alerting on 30+ when the real
                trigger was two weeks, and a 20-day lead showed with no warning
                colour at all. */}
            <p className="text-[10px] text-slate-400 mb-4 shrink-0 z-10 leading-relaxed">
              Lead terbuka tanpa progres lebih dari {GHOSTED_MIN_DAYS} hari. Merah mulai 30 hari.
              {stagnantAlerts.length > 50 && ` Menampilkan 50 dari ${stagnantAlerts.length}.`}
            </p>

            <div className="space-y-4 overflow-y-auto flex-1 pr-2 custom-scrollbar z-10">
              {stagnantAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-70">
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-3">
                    <Check className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Aman Terkendali!</p>
                  <p className="text-[10px] text-slate-400 mt-1">Seluruh lead masih terpantau segar.</p>
                </div>
              ) : (
                stagnantAlerts.slice(0, 50).map((alert, idx) => (
                  <div key={alert.g.leadId || idx} className={cn("p-4 rounded-2xl border transition hover:shadow-md cursor-pointer", alert.days >= 30 ? "bg-rose-50 border-rose-200" : "bg-amber-50 border-amber-200")} onClick={() => router.push(`/lead/${alert.g.leadId}`)}>
                    <div className="flex justify-between items-start mb-2 border-b border-black/5 pb-2">
                        <span className="text-xs font-black text-slate-900 line-clamp-1 flex-1 pr-2">{alert.g.brandName}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {alert.days >= 30 && <span className="bg-rose-600 text-white text-[8px] font-black tracking-widest uppercase px-2 py-0.5 rounded-full shadow-sm animate-pulse">30+ Days!</span>}
                          <span className="text-[9px] font-black text-slate-600 uppercase bg-black/5 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {alert.days}d
                          </span>
                        </div>
                    </div>
                    
                    <p className="text-[10px] font-bold text-slate-700 leading-relaxed mb-3">
                      "{alert.msg}"
                    </p>
                    
                    <div className="flex items-center justify-between mt-auto">
                      <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full inline-block", getStatusColor(alert.g.status as LeadStatus))}>
                        {alert.g.status}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full flex items-center gap-1">
                        <Users className="w-3 h-3" /> {alert.g.picName}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/*
          Data Health sits below the scorecard on purpose. It is the answer to
          "why does the Efficiency Rate look wrong", so it belongs where the
          reader is already looking for the cause, not buried in an admin page
          nobody opens. Read-only: it reports which leads to repair and links to
          them, and deliberately cannot repair them, because whether a stage
          really happened is a question about a conversation nobody logged.
        */}
        <DataHealthPanel rows={incompleteWins} />
      </div>

      {selectedLeadIds.length > 0 && (
        <motion.div
           initial={{ y: 50, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-800 text-white px-5 py-3 rounded-full shadow-2xl flex items-center gap-5 z-40 backdrop-blur-md"
        >
           <div className="flex items-center gap-3 pl-2">
             <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-[11px] font-black shadow-inner shadow-white/20">
               {selectedLeadIds.length}
             </div>
             <div className="flex flex-col">
               <span className="text-sm font-black tracking-tight leading-tight">Brand Terpilih</span>
               <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Siap Dieksekusi</span>
             </div>
           </div>
           
           <div className="w-px h-8 bg-slate-700 mx-1"></div>
           
           <div className="flex items-center gap-2 pr-1">
             <button onClick={() => setSelectedLeadIds([])} className="px-4 py-2 bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 rounded-xl text-xs font-bold text-slate-300 transition-colors">
               Batalkan
             </button>
             <button onClick={() => setIsBulkModalOpen(true)} className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-[11px] font-black rounded-xl transition-all shadow-lg shadow-indigo-500/30 uppercase tracking-widest">
               Update Massal
             </button>
           </div>
        </motion.div>
      )}

      <AnimatePresence>
        {isBulkModalOpen && (
          <BulkStatusModal
            isOpen={isBulkModalOpen}
            onClose={() => setIsBulkModalOpen(false)}
            selectedLeads={bulkLeads}
            user={user}
            users={users}
            onSuccess={() => {
              setSelectedLeadIds([]);
              refresh();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function buildStagnantMessage(status: string, days: number) {
  if (status === 'Hold') return `udah lebih dari ${days} hari nih statusnya hold gamau di coba lagi?`;
  if (status === 'Chated') return `${days} hari berlalu, gamau coba follow up nih?`;
  if (status === 'Responsed') return `udah ${days} hari, gimana hasilnya?, bisa di ajak meeting kah`;
  if (status === 'Set Meeting') return `udah ${days} hari, gimana hasil meetingnya?, Bad or No?`;
  return `udah ${days} hari berlalu tanpa ada pergerakan.`;
}

function getStatusColor(status: LeadStatus) {
  switch (status) {
    case 'Chated': return 'bg-blue-100 text-blue-800';
    case 'Responsed': return 'bg-purple-100 text-purple-800';
    case 'Set Meeting': return 'bg-yellow-100 text-yellow-800';
    case 'Hold': return 'bg-slate-200 text-slate-800';
    case 'Close Win': return 'bg-emerald-100 text-emerald-800';
    case 'Close Lost': return 'bg-red-100 text-red-800';
    case 'Failed': return 'bg-gray-200 text-gray-700';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function StatCard({ label, value, icon, color, note }: { label: string, value: number, icon: React.ReactNode, color: string, note?: string }) {
  const colors: Record<string, string> = {
    slate: "text-slate-600 bg-slate-100 border-slate-200",
    indigo: "text-indigo-600 bg-indigo-50 border-indigo-100",
    purple: "text-purple-600 bg-purple-50 border-purple-100",
    amber: "text-amber-600 bg-amber-50 border-amber-100",
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all group">
      <div className="flex justify-between items-start mb-4">
        <div className={cn("p-3 rounded-2xl border transition-transform group-hover:scale-110", colors[color])}>
          {icon}
        </div>
        <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">{label}</span>
      </div>
      <h3 className="text-4xl font-black text-slate-900 tracking-tighter">{value}</h3>
      {note && (
        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">{note}</p>
      )}
    </div>
  );
}

function RateCard({ label, value, color, icon }: { label: string, value: string, color: string, icon: React.ReactNode }) {
  const colors: Record<string, string> = {
    indigo: "text-indigo-600 bg-indigo-50",
    purple: "text-purple-600 bg-purple-50",
    emerald: "text-emerald-600 bg-emerald-50",
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center gap-4">
        <div className={cn("p-2 rounded-xl", colors[color])}>
          {icon}
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
          <span className="text-xl font-black text-slate-900">{value}</span>
        </div>
      </div>
      <div className="h-1 w-12 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", colors[color].split(' ')[0]!.replace('text', 'bg'))} style={{ width: value.replace('%', '') + '%' }}></div>
      </div>
    </div>
  );
}
