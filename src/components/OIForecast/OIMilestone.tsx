'use client';

import { useState } from 'react';
import { CheckCircle2, Save, Target } from 'lucide-react';
import { toast } from 'sonner';

import CurrencyInput from '../common/CurrencyInput';
import { setOITarget } from '@/app/actions/target-actions';
import type { LeadOption, OIForecastDTO, OITargetDTO, ProductOffered, UserProfile } from '@/types';

interface OIMilestoneProps {
  forecasts: OIForecastDTO[];
  targets: OITargetDTO[];
  activeTab: ProductOffered;
  user: UserProfile;
  leads: LeadOption[];
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  onUpdateTarget: (target: OITargetDTO) => void;
}

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * Per-product, per-month sales targets.
 *
 * Writes go through the `setOITarget` server action, which upserts on the
 * `(month_year, product)` unique constraint. The previous version branched
 * between an UPDATE and an INSERT from the browser and built the composite id
 * as `${product}_${monthYear}`; the action handles both cases in one statement
 * and the id format is now the server's concern.
 */
export default function OIMilestone({
  forecasts,
  targets,
  activeTab,
  leads,
  selectedYear,
  setSelectedYear,
  onUpdateTarget,
}: OIMilestoneProps) {
  const [dirtyTargets, setDirtyTargets] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  const handleTargetChange = (monthYear: string, val: number) => {
    setDirtyTargets((prev) => ({ ...prev, [monthYear]: val }));
  };

  const saveTarget = async (monthYear: string) => {
    if (dirtyTargets[monthYear] === undefined) return;
    setIsSaving(true);

    const newVal = dirtyTargets[monthYear];

    try {
      const result = await setOITarget({
        monthYear,
        product: activeTab,
        targetValue: newVal,
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Gagal menyimpan target');
      }

      const existing = targets.find((t) => t.monthYear === monthYear && t.product === activeTab);
      onUpdateTarget({
        id: existing?.id ?? `${activeTab}_${monthYear}`,
        monthYear,
        product: activeTab,
        targetValue: newVal,
        updatedAt: new Date().toISOString(),
      });

      toast.success(`Target untuk ${monthYear} berhasil disimpan.`);

      setDirtyTargets((prev) => {
        const next = { ...prev };
        delete next[monthYear];
        return next;
      });
    } catch (err) {
      console.error('[oi-target] save failed', err);
      toast.error(`Gagal menyimpan: ${err instanceof Error ? err.message : 'terjadi kesalahan'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const getMonthData = (monthIndex: number) => {
    const monthStr = (monthIndex + 1).toString().padStart(2, '0');
    const monthYear = `${selectedYear}-${monthStr}`;

    const existingTarget = targets.find((t) => t.monthYear === monthYear && t.product === activeTab);
    const savedVal = existingTarget ? existingTarget.targetValue : 0;
    const currentVal = dirtyTargets[monthYear] !== undefined ? dirtyTargets[monthYear] : savedVal;

    const winForecasts = forecasts.filter(
      (f) => f.monthYear === monthYear && f.product === activeTab && f.status === 'WIN',
    );
    const achieveValue = winForecasts.reduce((sum, f) => sum + (f.value || 0), 0);
    const percent = savedVal > 0 ? (achieveValue / savedVal) * 100 : 0;

    // Forecast rows now carry brandName directly, so no lookup against the
    // full lead list is needed.
    const brandNames = winForecasts.map((f) => f.brandName || 'Unknown');

    return {
      monthYear,
      monthName: MONTH_NAMES[monthIndex],
      currentVal,
      savedVal,
      achieveValue,
      percent,
      brandNames,
      isDirty: dirtyTargets[monthYear] !== undefined && dirtyTargets[monthYear] !== savedVal,
    };
  };

  return (
    <div className="bg-white border flex flex-col h-full border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl text-white shadow-lg">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              Milestone Sales {activeTab}
            </h2>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
              Global Target Planning
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm font-black text-slate-400 uppercase tracking-widest">
            Pilih Tahun:
          </span>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-white border-2 border-slate-200 px-4 py-2 rounded-xl text-lg font-black text-slate-700 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
          >
            {[2024, 2025, 2026, 2027, 2028].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 bg-slate-50">
        <div className="max-w-5xl mx-auto rounded-2xl overflow-hidden shadow-xl border border-slate-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-widest w-32">Month</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-widest w-56">
                  Target (Rp)
                </th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-widest w-56 text-emerald-400">
                  Actual Achieve (Rp)
                </th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-widest text-center w-24">
                  %
                </th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-widest">
                  Brand (WIN)
                </th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-widest text-center w-24">
                  Act
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...Array(12)].map((_, i) => {
                const data = getMonthData(i);

                return (
                  <tr key={data.monthYear} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-5 font-black text-slate-700 text-sm">{data.monthName}</td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <CurrencyInput
                          value={data.currentVal}
                          onChange={(val) => handleTargetChange(data.monthYear, val)}
                          placeholder="0"
                          className={`w-full pr-3 py-2 bg-white border-2 rounded-xl text-slate-800 font-black outline-none transition-colors ${
                            data.isDirty
                              ? 'border-amber-400 focus:border-amber-500'
                              : 'border-slate-200 focus:border-indigo-400'
                          }`}
                        />
                      </div>
                    </td>
                    <td className="px-6 py-5 font-black text-emerald-600 text-lg tracking-tight">
                      {formatMoney(data.achieveValue)}
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-black tracking-tighter ${
                            data.percent >= 100 ? 'text-emerald-500' : 'text-slate-600'
                          }`}
                        >
                          {data.percent.toFixed(2)}%
                        </span>
                        {data.percent >= 100 && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <p className="text-xs font-bold text-slate-500 leading-relaxed line-clamp-2">
                        {data.brandNames.length > 0 ? (
                          data.brandNames.length + ' Brands (Id hidden)'
                        ) : (
                          <span className="text-slate-300 italic">Belum ada WIN</span>
                        )}
                      </p>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <button
                        onClick={() => saveTarget(data.monthYear)}
                        disabled={!data.isDirty || isSaving}
                        className={`p-2 rounded-lg transition-all ${
                          data.isDirty
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-500 hover:text-white shadow-md cursor-pointer'
                            : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                        }`}
                      >
                        <Save className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
