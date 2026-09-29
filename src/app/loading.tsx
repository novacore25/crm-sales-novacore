import React from 'react';

export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col w-full animate-pulse p-4 sm:p-6 lg:p-8">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="h-8 w-56 bg-slate-200 rounded-lg mb-2"></div>
          <div className="h-4 w-32 bg-slate-200 rounded-md"></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-28 bg-slate-200 rounded-xl"></div>
          <div className="h-10 w-28 bg-slate-200 rounded-xl"></div>
          <div className="h-10 w-10 bg-slate-200 rounded-xl"></div>
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="flex flex-col gap-6">
        {/* Top metrics or filters (4 cards) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="h-28 bg-white border border-slate-200 rounded-2xl"></div>
          <div className="h-28 bg-white border border-slate-200 rounded-2xl"></div>
          <div className="h-28 bg-white border border-slate-200 rounded-2xl"></div>
          <div className="h-28 bg-white border border-slate-200 rounded-2xl"></div>
        </div>

        {/* List/Table area */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col gap-5 min-h-[400px]">
          {/* Controls row */}
          <div className="flex justify-between items-center mb-2">
            <div className="h-8 w-64 bg-slate-100 rounded-lg"></div>
            <div className="h-8 w-32 bg-slate-100 rounded-lg"></div>
          </div>
          
          {/* Table rows */}
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex gap-4 items-center p-3 border border-slate-100 rounded-xl">
              <div className="h-12 w-12 bg-slate-100 rounded-lg shrink-0"></div>
              <div className="flex flex-col gap-2 flex-1">
                <div className="h-4 w-1/3 bg-slate-200 rounded-md"></div>
                <div className="h-3 w-1/4 bg-slate-100 rounded-md"></div>
              </div>
              <div className="hidden sm:block h-6 w-24 bg-slate-100 rounded-full"></div>
              <div className="hidden sm:block h-6 w-20 bg-slate-100 rounded-full"></div>
              <div className="flex gap-2">
                <div className="h-8 w-8 bg-slate-100 rounded-lg"></div>
                <div className="h-8 w-8 bg-slate-100 rounded-lg"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
