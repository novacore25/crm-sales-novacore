"use client";
import { useState, useEffect, useMemo } from 'react';
import type { OIForecastDTO, OITargetDTO, UserProfile, ProductOffered } from '@/types';
import { getForecastableLeads } from '@/app/actions/forecast-actions';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingUp, Target, CalendarDays } from 'lucide-react';
import OISummaryCards from './OIForecast/OISummaryCards';
import OIGrid, { type GridLeadOption } from './OIForecast/OIGrid';
import OIMilestone from './OIForecast/OIMilestone';

interface OIForecastPageProps {
  forecasts: OIForecastDTO[];
  targets: OITargetDTO[];
  users: UserProfile[];
  user: UserProfile;
}

export default function OIForecastClient({
  forecasts: serverForecasts,
  targets: serverTargets,
  users = [],
  user,
}: OIForecastPageProps) {
  const [activeTab, setActiveTab] = useState<ProductOffered>('TNT');
  const [activeView, setActiveView] = useState<'forecast' | 'milestones'>('forecast');

  // Filters
  const currentMonth = new Date().toISOString().slice(0, 7); // e.g. "2026-04"
  const [selectedMonthYear, setSelectedMonthYear] = useState<string>(currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedPIC, setSelectedPIC] = useState<string>('All');

  const [localForecasts, setLocalForecasts] = useState<OIForecastDTO[]>(serverForecasts || []);
  const [localTargets, setLocalTargets] = useState<OITargetDTO[]>(serverTargets || []);

  useEffect(() => {
    setLocalForecasts(serverForecasts || []);
  }, [serverForecasts]);
  useEffect(() => {
    setLocalTargets(serverTargets || []);
  }, [serverTargets]);

  /**
   * Lead picker options.
   *
   * The page no longer ships every lead to the browser just to populate a
   * dropdown; the forecast row already carries `brandName`, and the picker
   * only needs id + brand name. The list is loaded on demand through a server
   * action rather than embedded in the page payload.
   */
  const [leadOptions, setLeadOptions] = useState<GridLeadOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getForecastableLeads().then((rows) => {
      if (cancelled) return;
      setLeadOptions(rows.map((r) => ({ id: r.id, brandName: r.brandName })));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddForecast = (forecast: OIForecastDTO) =>
    setLocalForecasts((prev) => [...prev, forecast]);
  const handleUpdateForecast = (id: string, updates: Partial<OIForecastDTO>) =>
    setLocalForecasts((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  const handleDeleteForecast = (id: string) =>
    setLocalForecasts((prev) => prev.filter((f) => f.id !== id));
  const handleUpdateTarget = (target: OITargetDTO) =>
    setLocalTargets((prev) => {
      const existing = prev.find((t) => t.id === target.id);
      return existing ? prev.map((t) => (t.id === target.id ? { ...t, ...target } : t)) : [...prev, target];
    });

  /**
   * The PIC a forecast is attributed to.
   *
   * This used to walk each lead's funnel history in the browser, which meant
   * shipping every funnel row for every lead on the page. The server resolves
   * the most recent funnel entry per forecast row in the query itself and
   * returns it as `latestPic`.
   */
  const getForecastPIC = (f: OIForecastDTO) => f.latestPic || 'Unknown';

  /**
   * Forecasts for the active month and product.
   *
   * The grid narrows this further by PIC; the milestone view uses it whole,
   * because a milestone is a company-versus-target number and a per-rep target
   * is a different question. The two views are labelled accordingly so the
   * difference is not mistaken for an inconsistency.
   */
  const monthForecasts = useMemo(
    () => localForecasts.filter((f) => f.monthYear === selectedMonthYear && f.product === activeTab),
    [localForecasts, selectedMonthYear, activeTab],
  );

  const filteredForecasts = useMemo(
    () =>
      selectedPIC === 'All'
        ? monthForecasts
        : monthForecasts.filter((f) => getForecastPIC(f) === selectedPIC),
    [monthForecasts, selectedPIC],
  );

  const currentTarget = localTargets.find(
    (t) => t.monthYear === selectedMonthYear && t.product === activeTab,
  );

  const uniquePICs = useMemo(
    () => Array.from(new Set(localForecasts.map(getForecastPIC))).filter(Boolean).sort(),
    [localForecasts],
  );

  return (
    <div className="flex-1 flex flex-col bg-slate-50 relative overflow-hidden h-full">
      {/* HEADER */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-8 py-6 z-10 shadow-sm relative">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg border border-indigo-400/20 text-white">
                <TrendingUp className="w-5 h-5" />
              </div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">OI Forecast</h1>
            </div>
            <p className="text-sm font-medium text-slate-500 max-w-2xl leading-relaxed">
              Pipeline financial projections and deal conversions. Data auto-syncs with original leads.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200/60 shadow-inner">
              <button
                onClick={() => setActiveView('forecast')}
                className={`flex flex-col items-center justify-center h-16 px-6 rounded-lg font-bold text-xs uppercase tracking-widest transition-all duration-300 ${
                  activeView === 'forecast'
                    ? 'bg-white text-indigo-600 shadow-md shadow-slate-200/50'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <TrendingUp className="w-5 h-5 mb-1" />
                <span>Forecast</span>
              </button>
              <button
                onClick={() => setActiveView('milestones')}
                className={`flex flex-col items-center justify-center h-16 px-6 rounded-lg font-bold text-xs uppercase tracking-widest transition-all duration-300 ${
                  activeView === 'milestones'
                    ? 'bg-white text-emerald-600 shadow-md shadow-slate-200/50'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Target className="w-5 h-5 mb-1" />
                <span>Milestones</span>
              </button>
            </div>
          </div>
        </div>

        {/* TABS & FILTERS */}
        <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('TNT')}
              className={`px-8 py-3 rounded-full font-black text-sm uppercase tracking-widest transition-all duration-300 shadow-sm ${
                activeTab === 'TNT'
                  ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-red-500/30'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              TNT Campaign
            </button>
            <button
              onClick={() => setActiveTab('MCN')}
              className={`px-8 py-3 rounded-full font-black text-sm uppercase tracking-widest transition-all duration-300 shadow-sm ${
                activeTab === 'MCN'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-blue-500/30'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              MCN
            </button>
            <button
              onClick={() => setActiveTab('HYPE')}
              className={`px-8 py-3 rounded-full font-black text-sm uppercase tracking-widest transition-all duration-300 shadow-sm ${
                activeTab === 'HYPE'
                  ? 'bg-gradient-to-r from-amber-400 to-yellow-500 text-white shadow-amber-500/30'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              HYPE
            </button>
          </div>

          {activeView === 'forecast' && (
            <div className="flex items-center gap-3">
              <div className="bg-white p-2 py-2.5 rounded-2xl border border-slate-200 shadow-sm flex items-center">
                <select
                  value={selectedPIC}
                  onChange={(e) => setSelectedPIC(e.target.value)}
                  className="bg-transparent border-none text-sm font-bold text-slate-700 outline-none cursor-pointer pl-2 pr-1"
                >
                  <option value="All">Semua PIC</option>
                  {uniquePICs.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                <CalendarDays className="w-5 h-5 text-slate-400 ml-2" />
                <input
                  type="month"
                  value={selectedMonthYear}
                  onChange={(e) => setSelectedMonthYear(e.target.value)}
                  className="bg-slate-50 border-none rounded-xl text-sm font-black text-slate-700 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="flex-1 overflow-y-auto lg:overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeTab}-${activeView}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="min-h-full lg:h-full flex flex-col"
          >
            {activeView === 'forecast' ? (
              <div className="flex-1 flex flex-col lg:h-full lg:overflow-hidden p-4 lg:p-6 space-y-6 min-h-0">
                <OISummaryCards
                  forecasts={filteredForecasts}
                  target={currentTarget?.targetValue || 0}
                  activeTab={activeTab}
                  /** Whether the numbers below are one rep's or the whole team's. */
                  scope={selectedPIC === 'All' ? 'tim' : selectedPIC}
                />
                <OIGrid
                  forecasts={filteredForecasts}
                  selectedMonthYear={selectedMonthYear}
                  activeTab={activeTab}
                  leads={leadOptions}
                  user={user}
                  users={users}
                  onAddForecast={handleAddForecast}
                  onUpdateForecast={handleUpdateForecast}
                  onDeleteForecast={handleDeleteForecast}
                />
              </div>
            ) : (
              <div className="flex-1 lg:overflow-hidden p-4 lg:p-6">
                <OIMilestone
                  forecasts={localForecasts}
                  targets={localTargets}
                  activeTab={activeTab}
                  user={user}
                  leads={leadOptions}
                  selectedYear={selectedYear}
                  setSelectedYear={setSelectedYear}
                  onUpdateTarget={handleUpdateTarget}
                  selectedMonthYear={selectedMonthYear}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
