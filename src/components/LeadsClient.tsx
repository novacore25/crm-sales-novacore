"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  Trash2,
  Pencil,
  Bolt,
  FileDown,
  Upload,
  MessageSquare,
  Phone,
  Database,
  Filter,
  AlertTriangle,
  Mail,
  Package,
  Clock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import LeadModalClient from './LeadModalClient';
import StatusModalClient from './StatusModalClient';
import NotesModalClient from './NotesModalClient';
import ImportModalClient from './ImportModalClient';
import ConfirmModal from './ConfirmModal';
import BulkStatusModal from './BulkStatusModal';
import type { LeadDTO, UserProfile, LeadStatus, InterestLevel } from '@/types';
import {
  getLeadsPage,
  softDeleteLeads,
  restoreLeads,
  permanentlyDeleteLeads,
  emptyTrash,
  deleteFunnelHistory,
  updateLead,
} from '@/app/actions/lead-actions';

interface LeadsTableProps {
  initialLeads: LeadDTO[];
  initialTotal: number;
  user: UserProfile;
  users: UserProfile[];
  approvals: any[];
}

const LEAD_STAGES: LeadStatus[] = [
  'Leads',
  'Chated',
  'Responsed',
  'Set Meeting',
  'Hold',
  'Close Win',
  'Close Lost',
  'Failed',
];

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;
const PRE_2026_CUTOFF = new Date('2026-01-01').getTime();
const PURGE_SCAN_PAGE_SIZE = 200;

/**
 * The product dropdown is a single-select, but the MCN option historically also
 * matched the legacy "Basemen" product tag, so it expands to two tags.
 */
function productFilterArg(value: string): string[] | undefined {
  if (value === 'ALL') return undefined;
  if (value === 'MCN') return ['MCN', 'Basemen'];
  return [value];
}

export default function LeadsClient({
  initialLeads,
  initialTotal,
  user,
  users,
  approvals,
}: LeadsTableProps) {
  const router = useRouter();
  const navigate = router.push;
  const isAdmin = user.role === 'admin' || user.role === 'lord';

  const [leads, setLeads] = useState<LeadDTO[]>(initialLeads);
  const [total, setTotal] = useState<number>(initialTotal);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'ALL'>('ALL');
  const [filterProduct, setFilterProduct] = useState('ALL');
  const [filterDate, setFilterDate] = useState('');
  const [sortField, setSortField] = useState<'dateInput' | 'brandName' | 'status'>('dateInput');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'active' | 'trash'>('active');
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadDTO | null>(null);
  const [activeLead, setActiveLead] = useState<LeadDTO | null>(null);
  const [trashTotal, setTrashTotal] = useState(0);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    type?: 'danger' | 'primary' | 'success';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Guards against out-of-order responses when the user flips filters fast.
  const requestIdRef = useRef(0);
  const skipFirstFetchRef = useRef(true);

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmText = 'Konfirmasi',
    type: 'danger' | 'primary' | 'success' = 'danger',
  ) => {
    setConfirmConfig({ isOpen: true, title, message, onConfirm, confirmText, type });
  };

  /** Re-run the active query and pull fresh server props. */
  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    router.refresh();
  }, [router]);

  // -------------------------------------------------------------------------
  // Debounced search box
  // -------------------------------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Any server-side filter change starts over from page 1.
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filterStatus, filterProduct, viewMode]);

  // -------------------------------------------------------------------------
  // Server-side pagination
  // -------------------------------------------------------------------------
  useEffect(() => {
    // The server component already rendered page 1 of the unfiltered list.
    if (skipFirstFetchRef.current) {
      skipFirstFetchRef.current = false;
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      try {
        const result = await getLeadsPage({
          page: currentPage - 1,
          pageSize: PAGE_SIZE,
          includeDeleted: viewMode === 'trash',
          search: debouncedSearch,
          statusFilter: filterStatus,
          categoryFilter: 'ALL',
          productFilter: productFilterArg(filterProduct),
        });

        if (cancelled || requestId !== requestIdRef.current) return;

        setLeads(result.leads);
        setTotal(result.total);

        const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        setCurrentPage((page) => Math.min(page, lastPage));
      } catch (error: any) {
        if (cancelled || requestId !== requestIdRef.current) return;
        console.error('Gagal memuat leads:', error);
        toast.error('Gagal memuat data: ' + (error?.message ?? 'Unknown error'));
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setIsLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [currentPage, viewMode, debouncedSearch, filterStatus, filterProduct, refreshKey]);

  // -------------------------------------------------------------------------
  // Trash counter for the "Kosongkan Sampah" button
  //
  // getLeadsPage can only express "deleted excluded" vs "no restriction", so the
  // trash size is derived as (everything) - (active).
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (viewMode !== 'trash') return;
    let cancelled = false;

    const run = async () => {
      try {
        const [all, active] = await Promise.all([
          getLeadsPage({ page: 0, pageSize: 1, includeDeleted: true }),
          getLeadsPage({ page: 0, pageSize: 1, includeDeleted: false }),
        ]);
        if (!cancelled) setTrashTotal(Math.max(0, all.total - active.total));
      } catch (error) {
        console.error('Gagal menghitung isi sampah:', error);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [viewMode, refreshKey]);

  // Keep the row currently open in a modal in sync with the refetched page.
  useEffect(() => {
    if (activeLead) {
      const updated = leads.find((l) => l.id === activeLead.id);
      if (updated) setActiveLead(updated);
    }
  }, [leads]);

  // -------------------------------------------------------------------------
  // Current-page filtering (date) + sorting
  // -------------------------------------------------------------------------
  const visibleLeads = useMemo(() => {
    let result = leads.filter((l) => {
      // The server already scopes the query to active vs trash, but keep the
      // guard so a stale row can never leak across tabs.
      const isTrash = l.isDeleted === true;
      if (viewMode === 'active' && isTrash) return false;
      if (viewMode === 'trash' && !isTrash) return false;

      if (filterDate) {
        let dateVal = '';
        if (filterStatus === 'ALL' || filterStatus === 'Leads') dateVal = l.dateInput || '';
        else if (filterStatus === 'Chated') dateVal = l.dateChated || l.dateInput || '';
        else if (filterStatus === 'Responsed') dateVal = l.dateResponsed || l.dateInput || '';
        else if (filterStatus === 'Set Meeting') dateVal = l.dateSetMeeting || l.dateInput || '';
        else if (filterStatus === 'Close Win' || filterStatus === 'Close Lost')
          dateVal = l.dateClosed || l.dateInput || '';
        else dateVal = l.dateInput || '';

        if (!dateVal.includes(filterDate)) return false;
      }

      return true;
    });

    result = [...result].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'dateInput') {
        let dateA = a.dateInput || '';
        let dateB = b.dateInput || '';

        if (filterStatus === 'Chated') {
          dateA = a.dateChated || dateA;
          dateB = b.dateChated || dateB;
        } else if (filterStatus === 'Responsed') {
          dateA = a.dateResponsed || dateA;
          dateB = b.dateResponsed || dateB;
        } else if (filterStatus === 'Set Meeting') {
          dateA = a.dateSetMeeting || dateA;
          dateB = b.dateSetMeeting || dateB;
        } else if (filterStatus === 'Close Win' || filterStatus === 'Close Lost') {
          dateA = a.dateClosed || dateA;
          dateB = b.dateClosed || dateB;
        }

        comparison = new Date(dateA || 0).getTime() - new Date(dateB || 0).getTime();
      } else if (sortField === 'brandName') {
        comparison = (a.brandName || '').localeCompare(b.brandName || '');
      } else if (sortField === 'status') {
        comparison = (a.status || '').localeCompare(b.status || '');
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [leads, filterDate, filterStatus, sortField, sortOrder, viewMode]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, total);

  const toggleSort = (field: 'dateInput' | 'brandName' | 'status') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (visibleLeads.length > 0 && visibleLeads.every((l) => selectedIds.has(l.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleLeads.map((l) => l.id)));
    }
  };

  // -------------------------------------------------------------------------
  // Trash / restore / purge
  // -------------------------------------------------------------------------
  const handleDelete = async (id: string) => {
    const lead = leads.find((l) => l.id === id);
    showConfirm(
      'Pindahkan ke Sampah',
      `Apakah Anda yakin ingin memindahkan "${lead?.brandName}" ke tempat sampah? Data akan dihapus permanen secara otomatis setelah 30 hari.`,
      async () => {
        try {
          const res = await softDeleteLeads([id]);
          if (!res.success) throw new Error(res.error ?? 'Operasi gagal');

          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          toast.success('Lead dipindahkan ke sampah');
          refresh();
        } catch (error: any) {
          console.error('Gagal move to trash:', error);
          toast.error('Gagal: ' + (error?.message ?? 'Unknown error'));
        }
      },
      'Buang ke Sampah',
    );
  };

  const handleRestore = async (id: string) => {
    const lead = leads.find((l) => l.id === id);
    try {
      const res = await restoreLeads([id]);
      if (!res.success) throw new Error('Operasi gagal');

      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success(`Lead ${lead?.brandName ?? ''} berhasil dipulihkan`.trim());
      refresh();
    } catch (error: any) {
      console.error('Gagal memulihkan:', error);
      toast.error('Gagal memulihkan: ' + (error?.message ?? 'Unknown error'));
    }
  };

  const handlePermanentDelete = async (id: string) => {
    const lead = leads.find((l) => l.id === id);
    showConfirm(
      'Hapus Permanen',
      'PERINGATAN: Tindakan ini akan menghapus data selamanya dan tidak bisa dibatalkan. Apakah Anda yakin?',
      async () => {
        try {
          // oi_forecasts / funnel_history / lead_notes cascade from leads.id,
          // so a single statement removes the whole subtree.
          const res = await permanentlyDeleteLeads([id]);
          if (!res.success) throw new Error(res.error ?? 'Operasi gagal');

          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          toast.success('Lead dihapus secara permanen');
          refresh();
        } catch (error: any) {
          console.error('Gagal menghapus permanen:', error);
          toast.error('Gagal menghapus permanen: ' + (error?.message ?? 'Unknown error'));
        }
      },
      'Hapus Selamanya',
    );
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    showConfirm(
      viewMode === 'active' ? 'Pindahkan Massal ke Sampah' : 'Hapus Massal Permanen',
      viewMode === 'active'
        ? `Apakah Anda yakin ingin memindahkan ${ids.length} data ke sampah?`
        : `PERINGATAN: ${ids.length} data akan dihapus SELAMANYA. Lanjutkan?`,
      async () => {
        const toastId = toast.loading(`Memproses ${ids.length} lead...`);
        try {
          if (viewMode === 'active') {
            const res = await softDeleteLeads(ids);
            if (!res.success) throw new Error(res.error ?? 'Operasi gagal');
          } else {
            const res = await permanentlyDeleteLeads(ids);
            if (!res.success) throw new Error(res.error ?? 'Operasi gagal');
          }

          toast.dismiss(toastId);
          setSelectedIds(new Set());
          toast.success(`${ids.length} Lead berhasil diproses`);
          refresh();
        } catch (error: any) {
          toast.dismiss(toastId);
          console.error('Gagal proses massal:', error);
          toast.error('Gagal: ' + (error?.message ?? 'Unknown error'));
        }
      },
      viewMode === 'active' ? 'Pindahkan Semua' : 'Hapus Semua Selamanya',
    );
  };

  const handleEmptyTrash = async () => {
    if (trashTotal === 0) {
      toast.info('Tempat sampah sudah kosong!');
      return;
    }

    showConfirm(
      '🗑️ Kosongkan Semua Sampah',
      `PERINGATAN: ${trashTotal} data di tempat sampah akan DIHAPUS SELAMANYA dari server dan tidak bisa dikembalikan. Lanjutkan?`,
      async () => {
        const toastId = toast.loading(`Menghapus permanen ${trashTotal} data...`);
        try {
          const res = await emptyTrash();
          toast.dismiss(toastId);

          setSelectedIds(new Set());
          setTrashTotal(0);
          toast.success(`✅ ${res.deleted} data berhasil dihapus permanen dari server!`);
          refresh();
        } catch (error: any) {
          toast.dismiss(toastId);
          console.error('Gagal mengosongkan sampah:', error);
          toast.error('Gagal mengosongkan sampah: ' + (error?.message ?? 'Unknown error'));
        }
      },
      'Hapus Selamanya',
      'danger',
    );
  };

  // -------------------------------------------------------------------------
  // Purge Pre-2026
  //
  // The legacy version did `select('*')` with no embedded relation, so
  // `funnelHistory` was always undefined and the whole feature was a no-op.
  // Here we walk the real paginated feed, collect the funnel entries that
  // actually predate 2026, delete exactly those rows, and re-derive each
  // affected lead's status + stage dates from what remains.
  // -------------------------------------------------------------------------
  const handlePurgeOldData = async () => {
    const scanToast = toast.loading('Memindai history pre-2026...');

    // leadId -> entries to delete + a snapshot of the remaining history.
    const doomed = new Map<string, { entries: { id: string }[]; remaining: LeadDTO['funnelHistory'] }>();

    try {
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await getLeadsPage({
          page,
          pageSize: PURGE_SCAN_PAGE_SIZE,
          includeDeleted: true,
        });

        if (!result.leads.length) break;

        for (const lead of result.leads) {
          const pre2026 = (lead.funnelHistory || []).filter((h) => {
            const t = new Date(h.dateOccurred).getTime();
            return !isNaN(t) && t < PRE_2026_CUTOFF;
          });
          if (!pre2026.length) continue;

          const doomedIds = new Set(pre2026.map((h) => h.id));
          doomed.set(lead.id, {
            entries: pre2026.map((h) => ({ id: h.id })),
            remaining: (lead.funnelHistory || []).filter((h) => !doomedIds.has(h.id)),
          });
        }

        if (result.leads.length < PURGE_SCAN_PAGE_SIZE) {
          hasMore = false;
        } else {
          page += 1;
        }
      }

      toast.dismiss(scanToast);

      const totalEntries = Array.from(doomed.values()).reduce((sum, d) => sum + d.entries.length, 0);

      if (totalEntries === 0) {
        toast.success('Tidak ada history funnel pre-2026 yang perlu dibersihkan.');
        return;
      }

      showConfirm(
        'DANGER: Purge Pre-2026',
        `PERINGATAN: ${totalEntries} jejak funnel history sebelum 1 Januari 2026 pada ${doomed.size} leads akan dihapus permanen, dan status/tanggal tiap lead akan dihitung ulang dari sisa history. Data tidak bisa di-undo atau dibatalkan setelah eksekusi. Yakin 100%?`,
        async () => {
          const toastId = toast.loading(`Menghapus ${totalEntries} history lama...`);

          let removed = 0;
          let corrected = 0;
          let failed = 0;

          try {
            // Sequential on purpose: each call is a small transaction and a
            // parallel burst would just queue behind the same connection.
            for (const [leadId, info] of Array.from(doomed.entries())) {
              let leadOk = true;

              for (const entry of info.entries) {
                try {
                  const res = await deleteFunnelHistory(entry.id);
                  if (res.success) removed += 1;
                  else leadOk = false;
                } catch (error) {
                  console.error('Gagal hapus history', entry.id, error);
                  leadOk = false;
                }
              }

              if (!leadOk) {
                failed += 1;
                continue;
              }

              // Re-derive the denormalised summary from the surviving history.
              const sorted = [...info.remaining].sort((a, b) => {
                const timeA = new Date(a.dateOccurred).getTime() || 0;
                const timeB = new Date(b.dateOccurred).getTime() || 0;
                if (timeA !== timeB) return timeB - timeA;
                return (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0);
              });

              // Guard against a stage string the server validator would reject
              // (e.g. a legacy "Input Data" entry): fall back to the opening stage.
              const latest = sorted[0];
              const newStatus =
                latest && LEAD_STAGES.includes(latest.stage as LeadStatus)
                  ? latest.stage
                  : 'Leads';
              const latestDateForStage = (stageName: string) => {
                const entry = sorted.find((h) => h.stage === stageName);
                return entry ? entry.dateOccurred : null;
              };

              const closedStage = sorted.find(
                (h) => h.stage === 'Close Win' || h.stage === 'Close Lost',
              );

              try {
                const res = await updateLead({
                  id: leadId,
                  status: newStatus as LeadStatus,
                  dateChated: latestDateForStage('Chated'),
                  dateResponsed: latestDateForStage('Responsed'),
                  dateSetMeeting: latestDateForStage('Set Meeting'),
                  dateClosed: closedStage ? closedStage.dateOccurred : null,
                });
                if (res.success) corrected += 1;
                else failed += 1;
              } catch (error) {
                console.error('Gagal koreksi summary lead', error);
                failed += 1;
              }
            }

            toast.dismiss(toastId);
            toast.success(
              `Selesai! ${removed} history lama dihapus pada ${corrected} leads.` +
                (failed > 0 ? ` ${failed} leads gagal diproses.` : ''),
            );
            refresh();
          } catch (error: any) {
            toast.dismiss(toastId);
            toast.error('Gagal purge data: ' + (error?.message ?? 'Unknown error'));
          }
        },
        'Yakin, Hapus Permanen!',
        'danger',
      );
    } catch (error: any) {
      toast.dismiss(scanToast);
      toast.error('Gagal memindai data: ' + (error?.message ?? 'Unknown error'));
    }
  };

  // -------------------------------------------------------------------------
  // CSV export (current page, or the current selection)
  // -------------------------------------------------------------------------
  const exportCSV = () => {
    const targetLeads =
      selectedIds.size > 0 ? visibleLeads.filter((l) => selectedIds.has(l.id)) : visibleLeads;

    let csv =
      'Tgl Input,Nama Brand,Sumber Lead,Kategori,No WA,Email,Product Offered,Status Terbaru,Minat,Rekam Jejak Funnel\n';
    targetLeads.forEach((l) => {
      const hLog = (l.funnelHistory || [])
        .map(
          (h) =>
            `[${h.stage}: ${h.dateOccurred} by ${h.byUserName}${
              h.assignedBy ? ` (assigned by ${h.assignedBy})` : ''
            }${h.note ? ` - ${h.note}` : ''}]`,
        )
        .join(' | ');
      const products = (l.productOffered || []).join(', ');
      csv += `${l.dateInput},"${l.brandName}","${l.leadSource || ''}","${l.category}",${l.contact},"${
        l.email || ''
      }","${products}",${l.status},${l.interestLevel},"${hLog}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `TNT_Leads_Export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success(`${targetLeads.length} Lead berhasil diexport`);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 z-10 shadow-sm">
        <div className="flex flex-col">
          <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span className="w-2 h-6 bg-indigo-600 rounded-full"></span>
            Database Leads
          </h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
            Total {total} Records Found
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 mr-2">
            <button
              onClick={() => setViewMode('active')}
              className={cn(
                'px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center gap-2',
                viewMode === 'active'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200'
                  : 'text-slate-400 hover:text-slate-600',
              )}
            >
              <Database className="w-3 h-3" /> Active
            </button>
            <button
              onClick={() => setViewMode('trash')}
              className={cn(
                'px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center gap-2',
                viewMode === 'trash'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-200'
                  : 'text-slate-400 hover:text-slate-600',
              )}
            >
              <Trash2 className="w-3 h-3" /> Sampah
            </button>
          </div>

          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition" />
            <input
              type="text"
              placeholder="Cari brand atau kontak..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-slate-100 border-none rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500 transition w-64 shadow-inner"
            />
          </div>

          <div className="flex gap-2">
            {selectedIds.size > 0 && (
              <div className="flex gap-2 items-center mr-2">
                <button
                  onClick={handleBulkDelete}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl font-bold transition flex items-center gap-2 text-sm shadow-lg shadow-rose-200"
                >
                  <Trash2 className="w-4 h-4" /> {viewMode === 'active' ? 'Buang' : 'Hapus'} (
                  {selectedIds.size})
                </button>
                {viewMode === 'active' && (
                  <button
                    onClick={() => setIsBulkModalOpen(true)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold transition shadow-lg shadow-indigo-100 flex items-center gap-2 text-sm"
                  >
                    <Bolt className="w-4 h-4" /> Status ({selectedIds.size})
                  </button>
                )}
                <div className="h-8 w-px bg-slate-200 mx-2" />
              </div>
            )}

            {user.role === 'lord' && (
              <button
                onClick={handlePurgeOldData}
                className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 shadow-lg shadow-rose-200 text-sm mr-2"
                title="Hapus History Pre-2026"
              >
                <Trash2 className="w-4 h-4 text-rose-100" /> Purge 2025
              </button>
            )}

            {viewMode === 'trash' && (user.role === 'lord' || user.role === 'admin') && (
              <button
                onClick={handleEmptyTrash}
                className="bg-rose-700 hover:bg-rose-800 text-white px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 shadow-lg shadow-rose-300 text-sm mr-2 border-2 border-rose-400"
                title="Hapus semua sampah selamanya"
              >
                <Trash2 className="w-4 h-4" /> Kosongkan Sampah ({trashTotal})
              </button>
            )}

            <button
              onClick={exportCSV}
              className="bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 shadow-lg shadow-teal-200 text-sm mr-2"
            >
              <FileDown className="w-4 h-4 text-teal-100" /> Super Export
            </button>

            {viewMode === 'active' && (
              <>
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 shadow-lg shadow-slate-200 text-sm"
                >
                  <Upload className="w-4 h-4 text-indigo-400" /> Super Import
                </button>

                <button
                  onClick={() => {
                    setEditingLead(null);
                    setIsLeadModalOpen(true);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 shadow-lg shadow-indigo-200 text-sm"
                >
                  <Plus className="w-4 h-4" /> Add Lead
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="p-8 flex-1 overflow-hidden flex flex-col">
        <div className="mb-6 flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 mr-2" />
            <select
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
              className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all border border-slate-200 bg-slate-50 text-slate-700 mr-2"
            >
              <option value="ALL">Semua Produk</option>
              <option value="TNT">TNT</option>
              <option value="MCN">MCN</option>
              <option value="HYPE">HYPE</option>
            </select>
            {(
              ['ALL', 'Leads', 'Chated', 'Responsed', 'Set Meeting', 'Hold', 'Close Win', 'Close Lost', 'Failed'] as const
            ).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={cn(
                  'px-4 py-1.5 rounded-lg text-xs font-bold transition-all',
                  filterStatus === s
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                    : 'text-slate-500 hover:bg-slate-100',
                )}
              >
                {s === 'ALL' ? 'Semua' : s}
              </button>
            ))}

            <div className="h-4 w-px bg-slate-300 mx-1"></div>

            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-slate-200 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
              title="Filter tanggal (dinamis sesuai status tab)"
            />
            {filterDate && (
              <button
                onClick={() => setFilterDate('')}
                className="text-slate-400 hover:text-rose-500 transition-colors p-1"
                title="Hapus Filter Tanggal"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            <span>Urutkan:</span>
            <select
              value={sortField}
              onChange={(e) => toggleSort(e.target.value as any)}
              className="bg-transparent border-none text-indigo-600 focus:ring-0 cursor-pointer p-0 font-black"
            >
              <option value="dateInput">Tgl Input</option>
              <option value="brandName">Nama Brand</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-auto crm-card relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-20 flex items-start justify-center pt-24 pointer-events-none">
              <div className="px-4 py-2 rounded-xl bg-white border border-slate-200 shadow-lg text-[10px] font-black uppercase tracking-widest text-indigo-600">
                Memuat data...
              </div>
            </div>
          )}

          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200">
                <th className="px-6 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={visibleLeads.length > 0 && visibleLeads.every((l) => selectedIds.has(l.id))}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                  />
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Brand &amp; Info
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Category
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                  Current Status
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                  Interest
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleLeads.map((lead) => (
                <tr
                  key={lead.id}
                  className={cn(
                    'hover:bg-slate-50/50 transition group',
                    selectedIds.has(lead.id) && 'bg-indigo-50/30',
                  )}
                >
                  <td className="px-6 py-5 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      className="rounded border-slate-300 text-indigo-600 cursor-pointer w-4 h-4"
                    />
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <button
                        onClick={() => navigate(`/lead/${lead.id}`)}
                        className="text-left font-bold text-slate-900 text-base group-hover:text-indigo-600 transition tracking-tight flex flex-col items-start group/brand"
                      >
                        <span className="flex items-center gap-1">
                          {lead.brandName}
                          <Bolt className="w-3 h-3 opacity-0 group-hover/brand:opacity-100 transition text-indigo-400" />
                        </span>
                        <span className="text-[10px] text-slate-400 font-normal group-hover/brand:text-indigo-400 transition">
                          Klik untuk detail
                        </span>
                      </button>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[11px] text-slate-400 flex items-center gap-1 font-semibold">
                          <Database className="w-3 h-3" />{' '}
                          {new Date(lead.dateInput || 0).toLocaleDateString('id-ID')}
                        </span>
                        <a
                          href={`https://wa.me/${(lead.contact || '').replace(/^0/, '62')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-emerald-600 hover:underline font-bold flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3" /> {lead.contact || '-'}
                        </a>
                        {lead.leadSource && (
                          <span className="text-[9px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                            {lead.leadSource}
                          </span>
                        )}
                        {lead.email && (
                          <a
                            href={`mailto:${lead.email}`}
                            className="text-[11px] text-blue-500 hover:underline font-bold flex items-center gap-1"
                          >
                            <Mail className="w-3 h-3" /> {lead.email}
                          </a>
                        )}
                      </div>
                      {lead.productOffered && lead.productOffered.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <Package className="w-3 h-3 text-slate-400" />
                          {lead.productOffered.map((p) => (
                            <span
                              key={p}
                              className={cn(
                                'px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-tight border',
                                p === 'TNT'
                                  ? 'bg-indigo-50 text-indigo-600 border-indigo-100'
                                  : p === 'MCN' || p === 'Basemen'
                                    ? 'bg-slate-100 text-slate-700 border-slate-200'
                                    : 'bg-amber-50 text-amber-600 border-amber-100',
                              )}
                            >
                              {p === 'Basemen' ? 'MCN' : p}
                            </span>
                          ))}
                        </div>
                      )}
                      {lead.actionPlan && (
                        <p className="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md mt-2 w-fit border border-indigo-100 font-bold">
                          <Bolt className="w-3 h-3 inline mr-1" /> {lead.actionPlan}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase tracking-tight">
                      {lead.category}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-center">
                    {viewMode === 'active' ? (
                      <div className="flex flex-col items-center gap-1.5">
                        <button
                          onClick={() => {
                            setActiveLead(lead);
                            setIsStatusModalOpen(true);
                          }}
                          className={cn(
                            'px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-1',
                            getStatusColor(lead.status as LeadStatus),
                          )}
                        >
                          {lead.status}
                        </button>
                        {(() => {
                          const sortedHistory = [...(lead.funnelHistory || [])].sort(
                            (a, b) =>
                              new Date(b.dateOccurred).getTime() - new Date(a.dateOccurred).getTime() ||
                              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                          );
                          const latestAction = sortedHistory[0];
                          if (!latestAction) {
                            return (
                              <div className="flex flex-col items-center mt-0.5">
                                <span className="text-[9px] font-bold text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                                  Belum di-assign
                                </span>
                              </div>
                            );
                          }

                          const recentAuthors = Array.from(
                            new Set(sortedHistory.slice(0, 3).map((h) => h.byUserName)),
                          );
                          const isMultiPIC = recentAuthors.length > 1;
                          const isValidDate = !isNaN(new Date(latestAction.dateOccurred).getTime());

                          return (
                            <div className="flex flex-col items-center">
                              <span className="text-[9px] font-bold text-slate-400 whitespace-nowrap">
                                {isValidDate
                                  ? new Date(latestAction.dateOccurred).toLocaleDateString('id-ID', {
                                      day: 'numeric',
                                      month: 'short',
                                    })
                                  : '-'}{' '}
                                • <span className="text-slate-600">{latestAction.byUserName}</span>
                              </span>
                              {isMultiPIC && (
                                <span
                                  className="text-[8px] font-black text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded mt-0.5 whitespace-nowrap cursor-help flex items-center"
                                  title={`Riwayat PIC: ${recentAuthors.join(', ')}`}
                                >
                                  <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Multi PIC
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <div className="px-3 py-1 bg-rose-50 text-rose-600 border border-rose-100 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 italic">
                          <Clock className="w-3 h-3" />
                          {(() => {
                            if (!lead.autoDeleteAt) return 'Segera dihapus';
                            const diff = new Date(lead.autoDeleteAt).getTime() - Date.now();
                            const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
                            return days > 0 ? `${days} Hari Lagi Dihapus` : 'Hapus Hari Ini';
                          })()}
                        </div>
                        <span className="text-[9px] font-bold text-slate-400">
                          Status Terakhir: {lead.status}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-5 text-center">
                    <InterestBadge level={lead.interestLevel as InterestLevel} />
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
                      {viewMode === 'active' ? (
                        <>
                          <button
                            onClick={() => {
                              setActiveLead(lead);
                              setIsNotesModalOpen(true);
                            }}
                            className="p-2.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition shadow-sm bg-white border border-slate-100 relative"
                            title="Notes & History"
                          >
                            <MessageSquare className="w-4 h-4" />
                            {(lead.funnelHistory?.length || 0) > 1 && (
                              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] w-4 h-4 flex items-center justify-center rounded-full font-black border-2 border-white">
                                {(lead.funnelHistory?.length || 0) - 1}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setEditingLead(lead);
                              setIsLeadModalOpen(true);
                            }}
                            className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition shadow-sm bg-white border border-slate-100"
                            title="Edit Data"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(lead.id)}
                              className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition shadow-sm bg-white border border-slate-100"
                              title="Delete Lead"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleRestore(lead.id)}
                            className="p-2.5 text-emerald-500 hover:text-white hover:bg-emerald-500 rounded-xl transition shadow-sm bg-white border border-emerald-100 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-4"
                            title="Pulihkan Lead"
                          >
                            <Database className="w-3.5 h-3.5" /> Restore
                          </button>
                          <button
                            onClick={() => handlePermanentDelete(lead.id)}
                            className="p-2.5 text-rose-500 hover:text-white hover:bg-rose-500 rounded-xl transition shadow-sm bg-white border border-rose-100 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-4"
                            title="Hapus Permanen"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Hapus Selamanya
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {total > 0 && (
            <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between sticky left-0">
              <span className="text-xs font-bold text-slate-500">
                Menampilkan {rangeStart} - {rangeEnd} dari {total} data
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || isLoading}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-50 hover:bg-slate-50 transition text-slate-700 shadow-sm"
                >
                  Prev
                </button>
                <div className="text-xs font-black text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg border border-indigo-100">
                  Page {currentPage} / {totalPages}
                </div>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || isLoading}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-50 hover:bg-slate-50 transition text-slate-700 shadow-sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {total === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-20 bg-white">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <Database className="w-10 h-10 text-slate-200" />
              </div>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No Data Found</p>
            </div>
          )}
        </div>
      </div>

      <LeadModalClient
        isOpen={isLeadModalOpen}
        onClose={() => {
          setIsLeadModalOpen(false);
          setEditingLead(null);
          refresh();
        }}
        lead={editingLead}
        user={user}
        leads={leads}
        users={users}
      />

      {activeLead && (
        <>
          <StatusModalClient
            isOpen={isStatusModalOpen}
            onClose={() => {
              setIsStatusModalOpen(false);
              refresh();
            }}
            lead={activeLead}
            user={user}
            users={users}
          />
          <NotesModalClient
            isOpen={isNotesModalOpen}
            onClose={() => {
              setIsNotesModalOpen(false);
              refresh();
            }}
            lead={activeLead}
            user={user}
            approvals={approvals}
          />
        </>
      )}

      {isBulkModalOpen && (
        <BulkStatusModal
          isOpen={isBulkModalOpen}
          selectedLeads={leads.filter((l) => selectedIds.has(l.id))}
          onClose={() => {
            setIsBulkModalOpen(false);
            setSelectedIds(new Set());
            refresh();
          }}
          user={user}
          users={users}
          onSuccess={() => {}}
        />
      )}

      <ImportModalClient
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          refresh();
        }}
        users={users}
      />

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
      />
    </div>
  );
}

function getStatusColor(status: LeadStatus) {
  switch (status) {
    case 'Chated':
      return 'bg-blue-100 text-blue-800';
    case 'Responsed':
      return 'bg-purple-100 text-purple-800';
    case 'Set Meeting':
      return 'bg-yellow-100 text-yellow-800';
    case 'Hold':
      return 'bg-slate-200 text-slate-800';
    case 'Close Win':
      return 'bg-emerald-100 text-emerald-800';
    case 'Close Lost':
      return 'bg-red-100 text-red-800';
    case 'Failed':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function InterestBadge({ level }: { level: InterestLevel }) {
  switch (level) {
    case 'HOT':
      return (
        <span className="text-red-600 font-bold flex items-center justify-center gap-1">
          <Bolt className="w-3 h-3" /> HOT
        </span>
      );
    case 'WARM':
      return <span className="text-yellow-600 font-bold">WARM</span>;
    case 'COLD':
      return (
        <span className="text-blue-600 font-bold flex items-center justify-center gap-1">COLD</span>
      );
    default:
      return <span className="text-gray-400">-</span>;
  }
}
