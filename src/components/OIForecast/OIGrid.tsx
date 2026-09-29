"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { LeadDTO, OIForecastDTO, ProductOffered, UserProfile } from '@/types';
import { createOIForecast, deleteOIForecast, setOIForecastStatus, updateOIForecastField } from '@/app/actions/forecast-actions';
import { getLeadById } from '@/app/actions/lead-actions';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import CurrencyInput from '../common/CurrencyInput';
import StatusModalClient from '../StatusModalClient';

/**
 * Minimal lead shape the grid needs: the brand picker.
 *
 * The grid no longer receives every lead with its full funnel history - that
 * meant the OI page embedded `funnel_history(*)` across the whole table just
 * to draw a dropdown. Full lead records are fetched on demand via
 * `getLeadById` when an action actually needs them.
 */
export interface GridLeadOption {
  id: string;
  brandName: string;
}

interface OIGridProps {
  forecasts: OIForecastDTO[];
  selectedMonthYear: string;
  activeTab: ProductOffered;
  leads: GridLeadOption[];
  user: UserProfile;
  users: UserProfile[];
  onAddForecast: (forecast: OIForecastDTO) => void;
  onUpdateForecast: (id: string, updates: Partial<OIForecastDTO>) => void;
  onDeleteForecast: (id: string) => void;
}

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatIDDate = (dateString: string) => {
  if (!dateString) return 'Pilih Tanggal';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Juni', 'Juli', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

/**
 * Every timestamp in the grid is rendered in WIB, pinned explicitly.
 *
 * The alternative - formatting in the reader's own timezone - looks more
 * "correct" and is actually worse for a dispute. The server stores UTC, so a
 * rep's 14:00 WIB entry renders as 07:00 server-side, which makes their own work
 * look like it happened in the middle of the night. Pinning to Asia/Jakarta
 * fixes that while still showing one number to everyone.
 *
 * Pinning also beats relying on the browser default: a rep travelling abroad or
 * with a misconfigured device would otherwise see a *different* clock for the
 * same event, which is the exact confusion the attribution row exists to
 * remove. One zone, one answer, for the whole team.
 *
 * The minute is included because 14:03 and 14:58 are different events when two
 * people are asked who was in the row.
 */
const WIB = 'Asia/Jakarta';

const longMoment = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: WIB,
});

const shortMoment = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: WIB,
});

function formatMoment(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${longMoment.format(d)} WIB`;
}

/** Compact form for milestone chips, where horizontal space is scarce. */
function formatShortMoment(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return shortMoment.format(d);
}

/**
 * Stage colours for the milestone chips. Unknown stages fall back to neutral
 * grey rather than disappearing, so a new stage someone invents is still
 * visible instead of rendering as a blank gap.
 */
const STAGE_TONE: Record<string, string> = {
  Leads: 'bg-slate-100 text-slate-600 border-slate-200',
  Input: 'bg-slate-100 text-slate-600 border-slate-200',
  Chated: 'bg-sky-50 text-sky-700 border-sky-200',
  Responsed: 'bg-blue-50 text-blue-700 border-blue-200',
  'Set Meeting': 'bg-violet-50 text-violet-700 border-violet-200',
  Hold: 'bg-amber-50 text-amber-700 border-amber-200',
  'Close Win': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Close Lost': 'bg-rose-50 text-rose-700 border-rose-200',
  Failed: 'bg-rose-100 text-rose-800 border-rose-300',
};

const stageTone = (stage: string) => STAGE_TONE[stage] ?? 'bg-slate-50 text-slate-600 border-slate-200';

export default function OIGrid({
  forecasts,
  selectedMonthYear,
  activeTab,
  leads,
  user,
  users,
  onAddForecast,
  onUpdateForecast,
  onDeleteForecast,
}: OIGridProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedLeadForStatus, setSelectedLeadForStatus] = useState<LeadDTO | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Cell edits are debounced.
   *
   * Every editable cell fires on `onChange`, which for a text or number input
   * means once per keystroke. Typing "15000000" into Value was eight UPDATE
   * statements against Postgres, and a rep filling in a dozen brands turned
   * into hundreds of round trips while typing.
   *
   * Each cell keeps its own timer keyed by `rowId:field`, so two cells edited
   * in sequence both land - a single shared timer would have dropped the first.
   * The local value is written immediately so the cell stays responsive; only
   * the server call waits.
   */
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, { field: keyof OIForecastDTO; value: string | number }>>({});

  useEffect(() => {
    const inFlight = timers.current;
    return () => {
      Object.values(inFlight).forEach(clearTimeout);
    };
  }, []);

  const flushCell = useCallback(
    async (rowId: string, field: keyof OIForecastDTO, value: string | number) => {
      const result = await updateOIForecastField({ id: rowId, field: String(field), value });
      if (!result.success) {
        toast.error('Gagal update: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }
      // The optimistic local update already applied. The margin the server
      // recomputed uses the same formula, so re-reading the whole table here
      // would cost far more than it could correct - and would reintroduce the
      // per-edit load this change exists to remove.
    },
    [],
  );

  const handleUpdate = useCallback(
    (id: string, field: keyof OIForecastDTO, value: string | number) => {
      const key = `${id}:${field}`;
      pending.current[key] = { field, value };

      // Optimistic local update so typing feels immediate.
      const current = forecasts.find((f) => f.id === id);
      const local: Partial<OIForecastDTO> = { [field]: value } as Partial<OIForecastDTO>;
      if (current && (field === 'budgetAds' || field === 'budgetCreator' || field === 'value')) {
        const val = field === 'value' ? Number(value) : current.value || 0;
        const ads = field === 'budgetAds' ? Number(value) : current.budgetAds || 0;
        const creator = field === 'budgetCreator' ? Number(value) : current.budgetCreator || 0;
        local.grossMargin = Math.max(0, val - ads - creator);
      }
      onUpdateForecast(id, local);

      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        const p = pending.current[key];
        delete pending.current[key];
        delete timers.current[key];
        if (p) void flushCell(id, p.field, p.value);
      }, 600);
    },
    [forecasts, flushCell, onUpdateForecast],
  );

  // Sorting forecasts: Base Case (100-80), Realistic (79-50), Worst Case (<50)
  const sortedForecasts = [...forecasts].sort((a, b) => b.successRate - a.successRate);

  const filteredLeads = leads
    .filter((l) => l.brandName && l.brandName.toLowerCase().includes(searchTerm.toLowerCase()))
    .slice(0, 15);

  const handleAddForecast = async () => {
    if (!selectedLeadId) {
      toast.error('Pilih Brand/Lead terlebih dahulu');
      return;
    }

    setSaving(true);
    try {
      // The seeded value and campaign number come from the lead's own deal
      // value and its Close Win history, so fetch it at the moment of insert
      // rather than shipping every lead to the browser up front.
      const lead = await getLeadById(selectedLeadId);
      const value = lead?.dealValue || 0;
      const campaignNumber =
        (lead?.funnelHistory ?? []).filter((h) => h.stage === 'Close Win').length + 1;

      // MCN is a distinct product line, not a generic "Custom Campaign" - the
      // old ternary lumped it in with the else branch, which mislabelled every
      // MCN row in the Category column and in the milestone grouping.
      const category =
        activeTab === 'TNT'
          ? 'TNT Campaign'
          : activeTab === 'HYPE'
            ? 'HYPE Campaign'
            : 'MCN Campaign';

      const result = await createOIForecast({
        leadId: selectedLeadId,
        monthYear: selectedMonthYear,
        product: activeTab,
        value,
        campaignNumber,
        budgetAds: 0,
        budgetCreator: 0,
        category,
        // 50 = "Realistic", matching the scenario the grid will show.
        successRate: 50,
      });

      if (!result.success || !result.id) {
        // The server rejects a duplicate authoritatively, so the message here
        // is the same one the user would have got from the old client-side
        // check - but it also fires when a colleague added the same brand.
        toast.error('Gagal menambah: ' + (result.error ?? 'Tidak diketahui'));
        return;
      }

      const now = new Date().toISOString();
      const latest = lead?.funnelHistory?.[0];
      onAddForecast({
        id: result.id,
        leadId: selectedLeadId,
        brandName: lead?.brandName ?? '-',
        monthYear: selectedMonthYear,
        product: activeTab,
        value,
        campaignNumber,
        budgetAds: 0,
        budgetCreator: 0,
        // The server derives gross margin from value minus the two budgets.
        grossMargin: Math.max(0, value),
        realMargin: 0,
        realPayment: 0,
        targetGmv: null,
        targetCreator: null,
        targetVideoAffiliate: null,
        targetVideoInternal: null,
        targetViews: null,
        successRate: 50,
        status: 'OPEN',
        tier: '-',
        category,
        lastFollowUp: null,
        noteSales: null,
        dateQuotation: null,
        picQuotation: null,
        dateInvoice: null,
        picInvoice: null,
        isDeleted: false,
        createdAt: now,
        latestStage: latest?.stage ?? null,
        latestPic: latest?.byUserName ?? null,
        latestStageDate: latest?.dateOccurred ?? null,
        // The row was just created by the signed-in user, so the attribution is
        // known without a refetch.
        updatedAt: now,
        updatedBy: user.id,
        updatedByName: user.name,
        // The freshly added brand has no forecast-side history yet; its lead's
        // funnel trail is loaded when the grid next refetches.
        milestones: (lead?.funnelHistory ?? []).map((h) => ({
          stage: h.stage,
          by: h.byUserName ?? null,
          at: h.dateOccurred ?? null,
          note: h.note ?? null,
        })),
      });

      toast.success('Berhasil ditambahkan ke Forecast');
      setIsAdding(false);
      setSelectedLeadId('');
      setSearchTerm('');
      setShowDropdown(false);
    } catch {
      toast.error('Gagal menambah: Anda tidak memiliki akses');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Keluarkan data ini dari Forecast?')) return;
    try {
      const result = await deleteOIForecast(id);
      if (!result.success) {
        toast.error('Gagal hapus: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }
      onDeleteForecast(id);
      toast.success('Data dihapus');
    } catch {
      toast.error('Gagal hapus: Anda tidak memiliki akses');
    }
  };

  /** Open the status modal for a forecast's lead, loading the full record. */
  const openStatusModal = async (leadId: string) => {
    try {
      const lead = await getLeadById(leadId);
      if (lead) setSelectedLeadForStatus(lead);
    } catch {
      toast.error('Gagal memuat data lead');
    }
  };

  const getScenarioInfo = (rate: number) => {
    if (rate >= 80) return { name: 'Base Case (80-100%)', color: 'bg-emerald-500 text-white' };
    if (rate >= 50) return { name: 'Realistic (50-79%)', color: 'bg-lime-500 text-white' };
    return { name: 'Worst Case (<50%)', color: 'bg-rose-500 text-white' };
  };

  return (
    <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden min-h-0">
      {/* TOOLBAR */}
      <div className="shrink-0 p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-100 text-indigo-700 font-black text-xs px-3 py-1.5 rounded-lg uppercase tracking-widest">
            {activeTab} Data Grid
          </div>
          <span className="text-sm font-bold text-slate-400">|</span>
          <span className="text-sm font-bold text-slate-600">{forecasts.length} Brands Forecasted</span>
        </div>

        {isAdding ? (
          <div className="flex items-center gap-2 relative">
            <div className="relative">
              <input
                type="text"
                placeholder="Ketik nama Brand..."
                className="bg-white border border-slate-300 rounded-lg text-sm px-3 py-2 w-64 outline-none focus:ring-2 focus:ring-indigo-500"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowDropdown(true);
                  if (!e.target.value) setSelectedLeadId('');
                }}
                onFocus={() => setShowDropdown(true)}
              />
              {showDropdown && (
                <div className="absolute top-full left-0 mt-1 w-80 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl z-50 divide-y divide-slate-100">
                  {filteredLeads.length > 0 ? (
                    filteredLeads.map((l) => (
                      <div
                        key={l.id}
                        className={`px-4 py-2 text-sm cursor-pointer transition-colors ${
                          selectedLeadId === l.id
                            ? 'bg-indigo-100 font-bold text-indigo-700'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                        onClick={() => {
                          setSelectedLeadId(l.id);
                          setSearchTerm(l.brandName);
                          setShowDropdown(false);
                        }}
                      >
                        {l.brandName} <span className="text-xs text-slate-400 block">No PIC</span>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-slate-400 italic">Brand tidak ditemukan...</div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleAddForecast}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
            >
              Simpan
            </button>
            <button
              onClick={() => {
                setIsAdding(false);
                setSearchTerm('');
                setSelectedLeadId('');
                setShowDropdown(false);
              }}
              className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
            >
              Batal
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-black transition-all shadow-md shadow-indigo-600/20 active:scale-95"
          >
            <Plus className="w-4 h-4" /> Tambah Brand ke Forecast
          </button>
        )}
      </div>

      {/* SPREADSHEET TABLE DIV */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-max text-sm">
          <thead className="sticky top-0 bg-slate-100 shadow-sm z-20">
            <tr>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-500 uppercase tracking-widest w-12 text-center">
                Act
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-500 uppercase tracking-widest w-32">
                Scenario
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-900 uppercase tracking-widest min-w-[150px]">
                Brand Name
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-indigo-700 uppercase tracking-widest bg-indigo-50/50 w-20">
                Camp. Ke
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-900 uppercase tracking-widest bg-emerald-50">
                Value
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-rose-700 uppercase tracking-widest bg-rose-50/50">
                B. Ads
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-rose-700 uppercase tracking-widest bg-rose-50/50">
                B. Creator
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-emerald-700 uppercase tracking-widest bg-emerald-100/50">
                Gross Margin
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-amber-900 uppercase tracking-widest bg-amber-50">
                Real Payment
              </th>

              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-blue-900 uppercase tracking-widest bg-blue-50 border-l-[3px] border-l-blue-200">
                T. GMV
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-blue-900 uppercase tracking-widest bg-blue-50">
                T. Creator
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-blue-900 uppercase tracking-widest bg-blue-50">
                T. Vid Aff
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-blue-900 uppercase tracking-widest bg-blue-50 border-r-[3px] border-r-blue-200">
                T. Vid Int
              </th>

              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-500 uppercase tracking-widest w-20">
                Success %
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-500 uppercase tracking-widest w-32">
                Status
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-500 uppercase tracking-widest w-20">
                Tier
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-500 uppercase tracking-widest w-40">
                Category
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-purple-700 uppercase tracking-widest bg-purple-50">
                Quotation
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-purple-700 uppercase tracking-widest bg-purple-50">
                Invoice
              </th>
              <th className="px-4 py-3 border-b border-r border-slate-200 font-black text-[10px] text-slate-500 uppercase tracking-widest">
                Internal Update
              </th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {sortedForecasts.length === 0 ? (
              <tr>
                <td colSpan={19} className="px-4 py-12 text-center text-slate-400 font-medium">
                  Belum ada data forecast untuk bulan ini pada produk {activeTab}.
                </td>
              </tr>
            ) : (
              sortedForecasts.map((f) => {
                const brandName = f.brandName || 'Unknown Brand';
                const scenario = getScenarioInfo(f.successRate || 0);

                // The milestone trail is truncated to the most recent steps.
                // Showing all of them would turn every row into a wall of chips;
                // the full trail lives on the lead page.
                const recentMilestones = (f.milestones ?? []).slice(-4);

                return (
                  <Fragment key={f.id}>
                  <tr className="hover:bg-slate-50/80 group border-b border-slate-100">
                    <td className="px-2 py-2 border-r border-slate-100 text-center">
                      <button
                        onClick={() => handleDelete(f.id)}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                    <td className={`px-2 py-2 border-r border-slate-100 text-center`}>
                      <span
                        className={`inline-block px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider ${scenario.color} shadow-sm`}
                      >
                        {scenario.name.split(' (')[0]}
                      </span>
                    </td>
                    <td className="px-4 py-2 border-r border-slate-100 font-black text-slate-700">{brandName}</td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-indigo-50/20">
                      <input
                        type="number"
                        min="1"
                        value={f.campaignNumber || ''}
                        onChange={(e) => handleUpdate(f.id, 'campaignNumber', Number(e.target.value))}
                        className="w-full text-center bg-transparent focus:bg-white focus:ring-1 ring-indigo-500 rounded p-1 font-black text-indigo-700 text-sm outline-none"
                        placeholder="1"
                      />
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-emerald-50/30">
                      <CurrencyInput
                        value={f.value || 0}
                        onChange={(val) => handleUpdate(f.id, 'value', val)}
                        className="w-full bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none font-bold text-slate-700 min-w-[140px]"
                      />
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-rose-50/10">
                      <CurrencyInput
                        value={f.budgetAds || 0}
                        onChange={(val) => handleUpdate(f.id, 'budgetAds', val)}
                        className="w-full bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none text-slate-600 min-w-[130px]"
                      />
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-rose-50/10">
                      <CurrencyInput
                        value={f.budgetCreator || 0}
                        onChange={(val) => handleUpdate(f.id, 'budgetCreator', val)}
                        className="w-full bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none text-slate-600 min-w-[130px]"
                      />
                    </td>
                    <td className="px-4 py-2 border-r border-slate-100 bg-emerald-50/30 font-black text-emerald-700">
                      {formatMoney(f.grossMargin || 0)}
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-amber-50/30">
                      <CurrencyInput
                        value={f.realPayment || 0}
                        onChange={(val) => handleUpdate(f.id, 'realPayment', val)}
                        className="w-full bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none font-bold text-amber-700 min-w-[140px]"
                      />
                    </td>

                    {/* TARGETS */}
                    <td className="px-2 py-2 border-r border-slate-100 bg-blue-50/30 border-l-[3px] border-l-blue-100">
                      <CurrencyInput
                        prefix=""
                        placeholder="GMV"
                        value={f.targetGmv || 0}
                        onChange={(val) => handleUpdate(f.id, 'targetGmv', val)}
                        className="w-full min-w-[130px] bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none text-blue-800 font-semibold"
                      />
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-blue-50/30">
                      <input
                        type="number"
                        placeholder="KOC"
                        value={f.targetCreator || ''}
                        onChange={(e) => handleUpdate(f.id, 'targetCreator', Number(e.target.value))}
                        className="w-[60px] bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none text-blue-800 font-semibold"
                      />
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-blue-50/30">
                      <input
                        type="number"
                        placeholder="Vid Aff"
                        value={f.targetVideoAffiliate || ''}
                        onChange={(e) => handleUpdate(f.id, 'targetVideoAffiliate', Number(e.target.value))}
                        className="w-[60px] bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none text-blue-800 font-semibold"
                      />
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-blue-50/30 border-r-[3px] border-r-blue-100">
                      <input
                        type="number"
                        placeholder="Vid Int"
                        value={f.targetVideoInternal || ''}
                        onChange={(e) => handleUpdate(f.id, 'targetVideoInternal', Number(e.target.value))}
                        className="w-[60px] bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none text-blue-800 font-semibold"
                      />
                    </td>

                    <td className="px-2 py-2 border-r border-slate-100">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          max="100"
                          min="0"
                          value={f.successRate || 0}
                          onChange={(e) => handleUpdate(f.id, 'successRate', Number(e.target.value))}
                          className="w-12 bg-transparent border border-transparent focus:border-indigo-300 px-1 py-1 rounded outline-none text-center font-black"
                        />
                        <span className="text-slate-400 font-black text-xs">%</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100">
                      <button
                        onClick={() => openStatusModal(f.leadId)}
                        className={`w-full text-[10px] font-black p-1.5 rounded outline-none cursor-pointer tracking-widest text-center transition hover:opacity-80 ${
                          f.status === 'WIN'
                            ? 'bg-emerald-100 text-emerald-700'
                            : f.status === 'LOSE'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {f.status}
                      </button>
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100">
                      <select
                        value={f.tier || '-'}
                        onChange={(e) => handleUpdate(f.id, 'tier', e.target.value)}
                        className="w-full bg-transparent border border-transparent focus:border-indigo-300 px-1 p-1.5 rounded outline-none text-slate-700 font-bold"
                      >
                        <option value="-">-</option>
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                      </select>
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100">
                      <input
                        type="text"
                        value={f.category || ''}
                        onChange={(e) => handleUpdate(f.id, 'category', e.target.value)}
                        placeholder="Ketik kategori..."
                        className="w-full bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none text-slate-600 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-purple-50/20">
                      <div className="flex flex-col gap-1.5 min-w-[120px]">
                        <div className="relative w-full">
                          <div
                            className={`w-full bg-white border border-slate-200 px-2 py-1.5 rounded text-center font-bold text-[11px] ${
                              f.dateQuotation ? 'text-purple-900' : 'text-slate-400'
                            }`}
                          >
                            {formatIDDate(f.dateQuotation || '')}
                          </div>
                          <input
                            type="date"
                            value={f.dateQuotation || ''}
                            onChange={(e) => handleUpdate(f.id, 'dateQuotation', e.target.value)}
                            onClick={(e) => {
                              try {
                                e.currentTarget.showPicker();
                              } catch {
                                /* older browsers */
                              }
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            title="Tanggal Kirim Quotation"
                          />
                        </div>
                        <input
                          type="text"
                          value={f.picQuotation || ''}
                          onChange={(e) => handleUpdate(f.id, 'picQuotation', e.target.value)}
                          placeholder="+ Nama PIC"
                          className="w-full bg-purple-100 hover:bg-purple-200 focus:bg-purple-200 focus:ring-2 focus:ring-purple-300 border-none px-3 py-1 rounded-full outline-none text-purple-700 font-black text-center text-[10px] tracking-wider uppercase placeholder-purple-400/70 transition-all shadow-sm"
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2 border-r border-slate-100 bg-purple-50/20">
                      <div className="flex flex-col gap-1.5 min-w-[120px]">
                        <div className="relative w-full">
                          <div
                            className={`w-full bg-white border border-slate-200 px-2 py-1.5 rounded text-center font-bold text-[11px] ${
                              f.dateInvoice ? 'text-purple-900' : 'text-slate-400'
                            }`}
                          >
                            {formatIDDate(f.dateInvoice || '')}
                          </div>
                          <input
                            type="date"
                            value={f.dateInvoice || ''}
                            onChange={(e) => handleUpdate(f.id, 'dateInvoice', e.target.value)}
                            onClick={(e) => {
                              try {
                                e.currentTarget.showPicker();
                              } catch {
                                /* older browsers */
                              }
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            title="Tanggal Kirim Invoice"
                          />
                        </div>
                        <input
                          type="text"
                          value={f.picInvoice || ''}
                          onChange={(e) => handleUpdate(f.id, 'picInvoice', e.target.value)}
                          placeholder="+ Nama PIC"
                          className="w-full bg-fuchsia-100 hover:bg-fuchsia-200 focus:bg-fuchsia-200 focus:ring-2 focus:ring-fuchsia-300 border-none px-3 py-1 rounded-full outline-none text-fuchsia-700 font-black text-center text-[10px] tracking-wider uppercase placeholder-fuchsia-400/70 transition-all shadow-sm"
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={f.noteSales || ''}
                        onChange={(e) => handleUpdate(f.id, 'noteSales', e.target.value)}
                        placeholder="Internal notes..."
                        className="w-full bg-transparent border border-transparent focus:border-indigo-300 px-2 py-1 rounded outline-none text-slate-600 text-xs italic"
                      />
                    </td>
                  </tr>

                  {/* Attribution strip, directly under the inputs.
                      Every number in this grid can be disputed in a meeting, and
                      "who changed this?" was previously unanswerable. This row
                      carries the journey (which milestones were reached, by
                      whom, when) plus who last touched the numbers. */}
                  <tr className="bg-slate-50/70 border-b border-slate-200">
                    <td colSpan={19} className="px-4 py-1.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                        <span className="font-black uppercase tracking-widest text-slate-400">
                          Status Terakhir
                        </span>

                        {recentMilestones.length === 0 ? (
                          <span className="italic text-slate-400">
                            Belum ada riwayat funnel untuk brand ini
                          </span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1">
                            {recentMilestones.map((m, i) => (
                              <Fragment key={`${f.id}-ms-${i}`}>
                                {i > 0 && <span className="text-slate-300">&rarr;</span>}
                                <span
                                  title={m.note || undefined}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-bold ${stageTone(m.stage)}`}
                                >
                                  {m.stage}
                                  <span className="font-normal opacity-80">{formatShortMoment(m.at)}</span>
                                  {m.by && <span className="font-normal opacity-80">&middot; {m.by}</span>}
                                </span>
                              </Fragment>
                            ))}
                            {(f.milestones?.length ?? 0) > recentMilestones.length && (
                              <span className="text-slate-400">
                                +{(f.milestones?.length ?? 0) - recentMilestones.length} tahap sebelumnya
                              </span>
                            )}
                          </span>
                        )}

                        <span className="ml-auto flex items-center gap-1 text-slate-400">
                          <span className="font-black uppercase tracking-widest">Update</span>
                          {f.updatedByName ? (
                            <span className="text-slate-600">
                              {f.updatedByName} &middot; {formatMoment(f.updatedAt)}
                            </span>
                          ) : (
                            // Pre-audit rows carry no attribution. Saying so beats
                            // showing a blank, which reads as "not yet updated".
                            <span className="italic text-slate-400">
                              belum tercatat (sebelum pencatatan update)
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedLeadForStatus && (
        <StatusModalClient
          isOpen={true}
          lead={selectedLeadForStatus}
          user={user}
          users={users}
          onClose={() => setSelectedLeadForStatus(null)}
          onSaved={async (newStatus, dealVal) => {
            // Only a closing stage concludes the deal. Anything else - Chated,
            // Responsed, Set Meeting, Hold, Leads - means "still in play", which
            // the forecast already records as OPEN. Treating a mid-pipeline
            // save as OPEN is what previously reset the lead back to 'Leads'.
            const isWin = newStatus === 'Close Win';
            const isLose = newStatus === 'Close Lost' || newStatus === 'Failed';
            const fStatus = isWin ? 'WIN' : isLose ? 'LOSE' : 'OPEN';

            const targetForecast = forecasts.find((f) => f.leadId === selectedLeadForStatus.id);
            if (!targetForecast) return;

            // Saving a mid-pipeline stage must not disturb the forecast row at
            // all: the lead moved, the forecast did not.
            if (!isWin && !isLose && targetForecast.status === 'OPEN') {
              setSelectedLeadForStatus(null);
              return;
            }

            const updates: Partial<OIForecastDTO> = { status: fStatus };
            if (isWin && dealVal) {
              updates.value = dealVal;
              updates.grossMargin = Math.max(
                0,
                dealVal - (targetForecast.budgetAds || 0) - (targetForecast.budgetCreator || 0),
              );
            }

            // Forecast status, the parent lead's status/date/deal value and the
            // matching funnel row are written in one transaction server-side.
            const result = await setOIForecastStatus({
              id: targetForecast.id,
              status: fStatus,
              dealValue: isWin && dealVal ? dealVal : null,
            });

            if (!result.success) {
              toast.error('Gagal sinkronisasi status: ' + (result.error ?? 'Tidak diizinkan'));
              return;
            }

            if (isWin && dealVal) {
              const fieldResult = await updateOIForecastField({
                id: targetForecast.id,
                field: 'value',
                value: dealVal,
              });
              if (!fieldResult.success) {
                toast.error('Gagal update nominal forecast: ' + (fieldResult.error ?? 'Tidak diizinkan'));
                return;
              }
            }

            onUpdateForecast(targetForecast.id, updates);
            setSelectedLeadForStatus(null);
          }}
        />
      )}
    </div>
  );
}
