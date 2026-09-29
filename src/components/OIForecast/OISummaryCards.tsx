"use client";
import { Target, TrendingUp, CheckCircle2, CircleDashed, XCircle, LayoutGrid } from 'lucide-react';
import type { OIForecastDTO, ProductOffered } from '../../types';

interface OISummaryCardsProps {
  forecasts: OIForecastDTO[];
  target: number;
  activeTab: ProductOffered;
  /**
   * Whose numbers these are. The target is a company-wide figure, so when the
   * grid is filtered to one rep, comparing that rep's WIN value against the
   * full target would understate achievement by a factor of the headcount.
   * Showing the scope makes that mismatch visible instead of silently wrong.
   */
  scope?: string;
}

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export default function OISummaryCards({
  forecasts,
  target,
  activeTab,
  scope = 'tim',
}: OISummaryCardsProps) {
  const isTeamScope = scope === 'tim';
  const winForecasts = forecasts.filter(f => f.status === 'WIN');
  const openForecasts = forecasts.filter(f => f.status === 'OPEN');
  const loseForecasts = forecasts.filter(f => f.status === 'LOSE');

  const valueWin = winForecasts.reduce((sum, f) => sum + (f.value || 0), 0);
  const valueOpen = openForecasts.reduce((sum, f) => sum + (f.value || 0), 0);
  const valueLose = loseForecasts.reduce((sum, f) => sum + (f.value || 0), 0);

  const forecastAccuracy = (valueWin + valueLose) > 0 
    ? (valueWin / (valueWin + valueLose)) * 100 
    : 0;

  const achievePercent = target > 0 ? (valueWin / target) * 100 : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 shrink-0">
      
      {/* PIPELINE METRICS */}
      <div className="lg:col-span-8 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-100 flex-1">
          {/* WIN */}
          <div className="p-6 flex flex-col">
            <div className="flex items-center gap-2 text-emerald-600 mb-2">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Value (WIN)</span>
            </div>
            <p className="text-2xl font-black text-slate-900 tracking-tight mt-auto">{formatMoney(valueWin)}</p>
            <div className="w-full h-2 bg-emerald-500 rounded-full mt-4"></div>
          </div>
          
          {/* OPEN */}
          <div className="p-6 flex flex-col">
            <div className="flex items-center gap-2 text-amber-500 mb-2">
              <CircleDashed className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Pipeline (OPEN)</span>
            </div>
            <p className="text-xl font-bold text-slate-700 tracking-tight mt-auto">{formatMoney(valueOpen)}</p>
            <div className="w-full h-2 bg-amber-400 rounded-full mt-4"></div>
          </div>
          
          {/* LOSE */}
          <div className="p-6 flex flex-col">
            <div className="flex items-center gap-2 text-rose-600 mb-2">
              <XCircle className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Lost (LOSE)</span>
            </div>
            <p className="text-xl font-bold text-slate-700 tracking-tight mt-auto">{formatMoney(valueLose)}</p>
            <div className="w-full h-2 bg-rose-500 rounded-full mt-4"></div>
          </div>
          
          {/* ACCURACY */}
          <div className="p-6 flex flex-col bg-slate-50/50">
            <div className="flex items-center gap-2 text-indigo-600 mb-2">
              <Target className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Accuracy</span>
            </div>
            <p className="text-3xl font-black text-indigo-600 tracking-tighter mt-auto">{forecastAccuracy.toFixed(2)}%</p>
            <div className="w-full h-2 bg-slate-200 rounded-full mt-4 overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${forecastAccuracy}%` }}></div>
            </div>
          </div>
        </div>
        
        {/* BRAND COUNTS */}
        <div className="bg-slate-50 px-6 py-4 md:py-3 border-t border-slate-100 flex flex-wrap items-center justify-start gap-4 md:gap-12">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-slate-200 rounded-md"><LayoutGrid className="w-4 h-4 text-slate-500" /></div>
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Total Brands</span>
          </div>
          <div className="flex items-center gap-6 text-sm font-black">
            <span className="text-emerald-600 flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> {winForecasts.length}</span>
            <span className="text-amber-500 flex items-center gap-2"><CircleDashed className="w-4 h-4"/> {openForecasts.length}</span>
            <span className="text-rose-600 flex items-center gap-2"><XCircle className="w-4 h-4"/> {loseForecasts.length}</span>
          </div>
        </div>
      </div>

      {/* TARGET METRICS */}
      <div className="lg:col-span-4 bg-slate-900 rounded-3xl border border-slate-800 shadow-xl overflow-hidden flex flex-col relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl"></div>
        
        <div className="p-6 flex-1 flex flex-col relative z-10">
          <div className="flex items-center justify-between gap-2 text-slate-400 mb-6">
            <span className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">
                {isTeamScope ? 'Global Target' : 'Target TIM'}
              </span>
            </span>
            {!isTeamScope && (
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400/90 bg-amber-400/10 px-2 py-1 rounded">
                {scope}
              </span>
            )}
          </div>

          <div className="mb-6">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
              {isTeamScope ? 'Target Amount' : 'Pencapaian individu vs target tim'}
            </p>
            <p className="text-2xl font-black text-white tracking-tight">{formatMoney(target)}</p>
          </div>
          
          <div className="mt-auto">
            <div className="flex justify-between items-end mb-2">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Achieved</p>
                <p className="text-xl font-bold text-emerald-400 tracking-tight">{formatMoney(valueWin)}</p>
              </div>
              <p className="text-4xl font-black text-white tracking-tighter">{achievePercent.toFixed(2)}<span className="text-xl text-slate-500">%</span></p>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full mt-4 overflow-hidden shadow-inner flex mb-1">
              <div 
                className={`h-full rounded-full transition-all duration-1000 ${achievePercent >= 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-300' : 'bg-gradient-to-r from-indigo-500 to-blue-400'}`} 
                style={{ width: `${Math.min(achievePercent, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
