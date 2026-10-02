"use client";
import { useState, useEffect, useMemo } from 'react';
import type { IndividualTargetDTO, UserProfile, AuditLogDTO } from '@/types';
import {
  Target,
  Save,
  Calendar,
  BarChart3,
  TrendingUp,
  Handshake,
  Database,
  Bolt,
  Users,
  Activity,
  Clock,
  User,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { setIndividualTarget } from '@/app/actions/target-actions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import CurrencyInput from './common/CurrencyInput';

/** Per-product milestone target, the source of the company revenue target. */
interface MilestoneDTO {
  id: string;
  monthYear: string;
  product: string;
  targetValue: number;
  updatedAt: string;
}

interface AdminTargetsProps {
  milestones: MilestoneDTO[];
  initialIndividualTargets: IndividualTargetDTO[];
  users: UserProfile[];
  currentUser: UserProfile;
  /** Optional: the page does not currently load audit rows, so this stays empty. */
  auditLogs?: AuditLogDTO[];
}

/** Display order for the product tabs, matching the OI Forecast page. */
const PRODUCT_ORDER = ['TNT', 'MCN', 'HYPE'];

const rupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Sales KPI targets.
 *
 * The GLOBAL tab is read-only. It shows the company's revenue target for the
 * month as the sum of the per-product milestone targets, broken down so the
 * figure can be traced back to the number someone actually typed. It used to be
 * a second form writing to `global_targets`, which held one revenue figure per
 * month with no product breakdown - so it could not express a target split across
 * TNT, MCN and HYPE, and it duplicated the milestones under another name. Two
 * answers to one question is how the two drifted apart.
 *
 * The milestone itself is edited on the OI Forecast page, under MILESTONES.
 * Linking there rather than duplicating the form keeps one place that writes it.
 *
 * The INDIVIDUAL tab is the only place anything is written, and its revenue
 * target is deliberately free of the milestone. The company may aim one rep well
 * past the team figure, so nothing here derives from, prorates against or caps
 * at it, and no comparison is drawn on screen.
 *
 * The old handler wrote individual targets into `oi_targets` using six column
 * names that do not exist there, so per-staff targets never persisted. Both
 * writes now go through server actions that also set `updated_by` to a real user
 * id, since that column is a foreign key rather than a free-text name.
 */
export default function AdminTargetsClient({
  milestones,
  initialIndividualTargets,
  users,
  currentUser,
  auditLogs = [],
}: AdminTargetsProps) {
  const router = useRouter();
  const currentMonth = format(new Date(), 'yyyy-MM');
  const [individualTargets, setIndividualTargets] = useState<IndividualTargetDTO[]>(
    initialIndividualTargets,
  );
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'global' | 'individual' | 'audit'>('global');
  const [targetUser, setTargetUser] = useState<string>('');

  useEffect(() => setIndividualTargets(initialIndividualTargets), [initialIndividualTargets]);

  const monthMilestones = useMemo(() => {
    return milestones
      .filter((m) => m.monthYear === selectedMonth)
      .sort(
        (a, b) =>
          PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product),
      );
  }, [milestones, selectedMonth]);

  const milestoneTotal = useMemo(
    () => monthMilestones.reduce((sum, m) => sum + m.targetValue, 0),
    [monthMilestones],
  );

  const activeIndividualTarget = useMemo(() => {
    if (mode === 'global' || !targetUser) return null;
    return individualTargets.find((t) => t.monthYear === selectedMonth && t.userId === targetUser) || null;
  }, [individualTargets, selectedMonth, targetUser, mode]);

  const [formData, setFormData] = useState({
    targetChat: 0,
    targetMeeting: 0,
    targetRevenue: 0,
  });

  useEffect(() => {
    setFormData({
      targetChat: activeIndividualTarget?.targetChat || 0,
      targetMeeting: activeIndividualTarget?.targetMeeting || 0,
      targetRevenue: activeIndividualTarget?.targetRevenue || 0,
    });
  }, [activeIndividualTarget]);

  // Deliberately NOT assignablePICs(). This list is for setting a personal
  // monthly target, and the lord has none - individual_targets is keyed to a
  // rep, and offering a row that cannot be saved is the same trap as offering a
  // pending account as a PIC. `pending` is excluded for the same reason it is
  // everywhere else: no work can be assigned to it yet.
  const staffList = useMemo(() => {
    return users.filter((u) => u.role !== 'pending' && u.role !== 'lord');
  }, [users]);

  const handleSave = async () => {
    if (!selectedMonth) return toast.error('Bulan harus dipilih');
    if (mode !== 'individual') return;
    if (!targetUser) return toast.error('Pilih sales personil terlebih dahulu');

    if (formData.targetChat < 0 || formData.targetMeeting < 0 || formData.targetRevenue < 0) {
      return toast.error('Target tidak boleh bernilai negatif');
    }

    setLoading(true);
    try {
      const selectedUserName = users.find((u) => u.id === targetUser)?.name || 'Unknown';

      const result = await setIndividualTarget({
        userId: targetUser,
        monthYear: selectedMonth,
        targetChat: Number(formData.targetChat),
        targetMeeting: Number(formData.targetMeeting),
        targetRevenue: Number(formData.targetRevenue),
      });
      if (!result.success) {
        toast.error('Gagal menyimpan target: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }
      setIndividualTargets((prev) => {
        const next: IndividualTargetDTO = {
          id: `${selectedMonth}_${targetUser}`,
          userId: targetUser,
          userName: selectedUserName,
          monthYear: selectedMonth,
          targetChat: Number(formData.targetChat),
          targetMeeting: Number(formData.targetMeeting),
          targetRevenue: Number(formData.targetRevenue),
          updatedBy: currentUser.id,
          updatedAt: new Date().toISOString(),
        };
        const existing = prev.findIndex((t) => t.userId === targetUser && t.monthYear === selectedMonth);
        if (existing === -1) return [...prev, next];
        return prev.map((t, i) => (i === existing ? next : t));
      });
      toast.success(`Target untuk ${selectedUserName} berhasil disimpan`);
      router.refresh();
    } catch (error) {
      toast.error('Gagal menyimpan target: Anda tidak memiliki hak untuk mengatur target');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 z-10 shadow-sm">
        <div className="flex flex-col">
          <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span className="w-2 h-6 bg-indigo-600 rounded-full"></span>
            Sales KPI Targets
          </h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
            Management Performance Goals
          </p>
        </div>

        <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200">
          <button
            onClick={() => setMode('global')}
            className={cn(
              'px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all',
              mode === 'global'
                ? 'bg-white text-indigo-600 shadow-sm border border-slate-200'
                : 'text-slate-400 hover:text-slate-600',
            )}
          >
            Global
          </button>
          <button
            onClick={() => setMode('individual')}
            className={cn(
              'px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all',
              mode === 'individual'
                ? 'bg-white text-indigo-600 shadow-sm border border-slate-200'
                : 'text-slate-400 hover:text-slate-600',
            )}
          >
            Individual
          </button>
          <button
            onClick={() => setMode('audit')}
            className={cn(
              'px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all',
              mode === 'audit'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-200'
                : 'text-slate-400 hover:text-slate-600',
            )}
          >
            Audit Logs
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8 flex justify-center">
        <div className="w-full max-w-3xl space-y-8 pb-12">
          {mode === 'audit' ? (
            <div className="bg-white rounded-3xl border border-rose-200 p-8 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shadow-inner">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 tracking-tight">Global Activity Audit</h3>
                  <p className="text-xs font-bold text-slate-400">
                    Monitoring last 48 security and status events
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {auditLogs.length === 0 ? (
                  <div className="py-20 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      No audit logs recorded yet
                    </p>
                  </div>
                ) : (
                  auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-5 bg-white border border-slate-100 rounded-2xl hover:border-rose-200 transition-all group shadow-sm"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest',
                              log.action.includes('DELETE')
                                ? 'bg-rose-100 text-rose-600'
                                : 'bg-indigo-100 text-indigo-600',
                            )}
                          >
                            {log.action}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <Clock className="w-3 h-3" />
                          <span className="text-[10px] font-bold">
                            {new Date(log.createdAt).toLocaleString('id-ID')}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm font-bold text-slate-700 leading-relaxed">{log.details}</p>
                      <div className="mt-3 pt-3 border-t border-slate-50 flex items-center gap-2">
                        <User className="w-3 h-3 text-slate-400" />
                        <span className="text-[10px] font-black text-slate-500 uppercase">
                          Operator: {log.userName}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : mode === 'global' ? (
            /* Read-only. The number here is not typed anywhere on this page; it
               is the sum of the milestone targets, which are set on the OI
               Forecast page. The breakdown is shown rather than just the total
               because a total nobody can trace is not a figure anyone trusts. */
            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-100 pb-6 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-inner">
                    <Target className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                      Target Revenue Global
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-widest flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Otomatis
                      </span>
                    </h3>
                    <p className="text-xs font-bold text-slate-400">
                      Jumlah dari target milestone per produk
                    </p>
                  </div>
                </div>

                <div className="relative group">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="pl-11 pr-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner uppercase tracking-widest"
                  />
                </div>
              </div>

              {monthMilestones.length === 0 ? (
                <div className="py-14 text-center">
                  <p className="text-sm font-black text-slate-700">
                    Belum ada target milestone untuk bulan ini
                  </p>
                  <p className="text-xs font-bold text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                    Target global dihitung dari milestone TNT, MCN, dan HYPE. Target
                    chat dan meeting tidak ada di level perusahaan — itu per orang
                    saja, di tab Individual.
                  </p>
                  <a
                    href="/oi_forecast"
                    className="inline-flex items-center gap-2 mt-6 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Buka OI Forecast
                  </a>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    {monthMilestones.map((m) => (
                      <div
                        key={m.id}
                        className="p-5 bg-slate-50 border border-slate-100 rounded-2xl"
                      >
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          {m.product}
                        </span>
                        <p className="text-lg font-black text-slate-900 mt-1 tabular-nums">
                          {rupiah(m.targetValue)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="p-6 bg-slate-900 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-indigo-400" />
                      Total target revenue bulan ini
                    </span>
                    <span className="text-3xl font-black text-white tabular-nums">
                      {rupiah(milestoneTotal)}
                    </span>
                  </div>

                  <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
                    <p className="text-xs font-bold text-slate-400 leading-relaxed max-w-md">
                      Target ini tidak diubah di halaman ini. Diisi lewat OI
                      Forecast &rarr; tab Milestones, satu per produk.
                    </p>
                    <a
                      href="/oi_forecast"
                      className="inline-flex items-center gap-2 px-5 py-3 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest transition shrink-0"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Ubah di Milestones
                    </a>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-100 pb-6 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-inner">
                    {mode === 'individual' ? <Users className="w-6 h-6" /> : <Target className="w-6 h-6" />}
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 tracking-tight">
                      {mode === 'individual' ? 'Set Target Personil' : 'Target Revenue Global'}
                    </h3>
                    <p className="text-xs font-bold text-slate-400">Tentukan angka pencapaian bulanan</p>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row gap-4">
                  <div className="relative group">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                    <input
                      type="month"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                      className="pl-11 pr-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner uppercase tracking-widest"
                    />
                  </div>

                  {mode === 'individual' && (
                    <div className="relative group">
                      <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                      <select
                        value={targetUser}
                        onChange={(e) => setTargetUser(e.target.value)}
                        className="pl-11 pr-8 py-3 bg-indigo-50 border border-indigo-100 rounded-xl text-sm font-black text-indigo-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-sm outline-none"
                      >
                        <option value="">- Pilih Sales -</option>
                        {staffList.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.role})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <TrendingUp className="w-3 h-3 text-indigo-500" /> Target Chat (Dihubungi) Bulan Ini
                    </label>
                    <div className="relative group">
                      <div className="absolute left-0 top-0 bottom-0 w-12 flex items-center justify-center bg-slate-100 border-r border-slate-200 rounded-l-xl text-slate-400 font-bold group-focus-within:text-indigo-600 transition">
                        <Bolt className="w-4 h-4" />
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={formData.targetChat || ''}
                        onChange={(e) => setFormData({ ...formData, targetChat: Number(e.target.value) })}
                        className="w-full pl-16 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none"
                        placeholder="e.g. 500"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Handshake className="w-3 h-3 text-amber-500" /> Target Meeting Bulan Ini
                    </label>
                    <div className="relative group">
                      <div className="absolute left-0 top-0 bottom-0 w-12 flex items-center justify-center bg-slate-100 border-r border-slate-200 rounded-l-xl text-slate-400 font-bold group-focus-within:text-amber-600 transition">
                        <Target className="w-4 h-4" />
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={formData.targetMeeting || ''}
                        onChange={(e) => setFormData({ ...formData, targetMeeting: Number(e.target.value) })}
                        className="w-full pl-16 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black text-slate-700 focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all outline-none"
                        placeholder="e.g. 50"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <BarChart3 className="w-3 h-3 text-emerald-500" /> Target Revenue / Nominal Closing Total
                    (Rp)
                  </label>
                  <div className="relative group">
                    <CurrencyInput
                      value={formData.targetRevenue}
                      onChange={(val) => setFormData({ ...formData, targetRevenue: val })}
                      className="w-full pl-20 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-2xl font-black text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all outline-none"
                      placeholder="e.g. 2000000000"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase tracking-widest pointer-events-none">
                      Nominal IDR
                    </div>
                  </div>
                  {formData.targetRevenue > 0 && (
                    <p className="text-xs font-bold text-emerald-600 flex items-center gap-2 mt-2 px-1">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                      {new Intl.NumberFormat('id-ID', {
                        style: 'currency',
                        currency: 'IDR',
                        maximumFractionDigits: 0,
                      }).format(formData.targetRevenue)}
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-8 mt-8 border-t border-slate-100 flex items-center justify-between">
                {activeIndividualTarget ? (
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      Last Updated
                    </span>
                    <span className="text-xs font-bold text-slate-600">
                      {new Date(activeIndividualTarget.updatedAt).toLocaleString('id-ID')} by{' '}
                      {users.find((u) => u.id === activeIndividualTarget.updatedBy)?.name ?? activeIndividualTarget.updatedBy ?? '-'}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      Status
                    </span>
                    <span className="text-xs font-bold text-amber-500">
                      Belum ada target untuk pilihan ini
                    </span>
                  </div>
                )}

                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3.5 rounded-xl font-black tracking-widest text-xs uppercase transition shadow-lg shadow-indigo-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <Database className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {loading ? 'Menyimpan...' : 'Simpan KPI Target'}
                </button>
              </div>
            </div>
          )}

          {mode === 'individual' &&
            individualTargets.filter((t) => t.monthYear === selectedMonth).length > 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <BarChart3 className="w-3 h-3 text-indigo-500" /> Ringkasan Target Sales ({selectedMonth})
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {individualTargets
                    .filter((t) => t.monthYear === selectedMonth)
                    .map((target) => (
                      <div
                        key={target.id}
                        className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex justify-between items-center group hover:bg-white hover:border-indigo-200 transition-all cursor-pointer"
                        onClick={() => setTargetUser(target.userId)}
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition">
                            {target.userName}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase">{target.monthYear}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-black text-emerald-600">
                            {new Intl.NumberFormat('id-ID', {
                              notation: 'compact',
                              style: 'currency',
                              currency: 'IDR',
                            }).format(target.targetRevenue)}
                          </div>
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                            Chat: {target.targetChat} | Meet: {target.targetMeeting}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
