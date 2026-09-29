"use client";

import React from 'react';
import { Shield, Lock, Info, Key } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import type { PermissionSet, UserProfile } from '@/types';

/**
 * Indonesian labels shown in the Lord column. `src/lib/permissions.ts` exports
 * short names used by the nav; this table needs the full description plus the
 * grouping the original screen used.
 */
const PERMISSION_LABELS: Record<keyof PermissionSet, { label: string; desc: string; category: string }> = {
  canManageUsers: {
    label: 'User Management',
    desc: 'Approve, promote, revoke akses, ganti nama staff',
    category: 'Administration',
  },
  canSetTargets: {
    label: 'Set Targets',
    desc: 'Set target bulanan (Chat, Meeting, Revenue)',
    category: 'Administration',
  },
  canApproveEdits: {
    label: 'Approve Edit Requests',
    desc: 'Setujui/tolak perubahan data dari Staff',
    category: 'Administration',
  },
  canAssignPic: {
    label: 'Assign PIC',
    desc: 'Assign PIC ke staff lain saat update status',
    category: 'Leads',
  },
  canDeleteLeads: { label: 'Delete Leads', desc: 'Hapus lead individual', category: 'Leads' },
  canBulkDelete: { label: 'Bulk Delete', desc: 'Hapus banyak lead sekaligus', category: 'Leads' },
  canEditDealValue: {
    label: 'Edit Deal Value',
    desc: 'Ubah nominal deal pada Close Win',
    category: 'Leads',
  },
  canImportCsv: {
    label: 'Import CSV',
    desc: 'Akses Super Import untuk upload database',
    category: 'Leads',
  },
  canEditFunnelHistory: {
    label: 'Edit Funnel History',
    desc: 'Edit entry histori funnel secara siluman',
    category: 'History & Notes',
  },
  canDeleteFunnelHistory: {
    label: 'Delete Funnel History',
    desc: 'Hapus entry histori funnel',
    category: 'History & Notes',
  },
  canClearAllHistory: {
    label: 'Clear All History',
    desc: 'Bersihkan semua histori & notes sekaligus',
    category: 'History & Notes',
  },
  canDeleteNotes: {
    label: 'Delete Notes',
    desc: 'Hapus catatan individual pada lead',
    category: 'History & Notes',
  },
};

const CATEGORIES = ['Administration', 'Leads', 'History & Notes'];

const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as (keyof PermissionSet)[];

interface PermissionSettingsProps {
  currentUser: UserProfile;
}

/**
 * Role permission reference.
 *
 * This page is read-only on purpose. The matrix below is rendered straight from
 * `ROLE_PERMISSIONS`, which is the same object every server action checks via
 * `requirePermission`, so what you read here is what is actually enforced.
 *
 * The previous version looked editable: it held the matrix in local state and
 * its "Simpan Perubahan" button was a `setTimeout` stub. Nothing was ever
 * written - `role_permissions` was never read or written anywhere in the
 * codebase - so the toggles were decoration. Changing a permission now requires
 * editing `src/lib/permissions.ts` and deploying.
 */
export default function PermissionSettingsClient({ currentUser }: PermissionSettingsProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Key className="w-6 h-6 text-indigo-600" /> Role Permissions
          </h2>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Referensi hak akses tiap peran secara detail.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold flex items-center gap-2">
            <Lock className="w-4 h-4" /> Read-only
          </span>
          <span className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-black shadow-lg shadow-indigo-200 flex items-center gap-2">
            <Shield className="w-4 h-4" /> {currentUser.role}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 md:p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start gap-3 mb-6 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
            <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <p className="text-xs font-bold text-indigo-900 leading-relaxed">
              Halaman ini hanya menampilkan referensi. Matriks di bawah dibaca langsung dari{' '}
              <code className="bg-white px-1 py-0.5 rounded">src/lib/permissions.ts</code>, yang juga dipakai
              oleh setiap server action saat memeriksa hak akses. Untuk mengubah hak akses, edit file tersebut
              lalu deploy - tidak ada penyimpanan dari halaman ini.
            </p>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6 mb-6 p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500"></div>
              <span className="text-xs font-bold text-slate-500">Lord — Selalu aktif (tidak bisa diubah)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
              <span className="text-xs font-bold text-slate-500">Admin</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
              <span className="text-xs font-bold text-slate-500">Staff</span>
            </div>
          </div>

          {CATEGORIES.map((category) => (
            <div key={category} className="mb-8">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" /> {category}
              </h3>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-1/2">
                        Permission
                      </th>
                      <th className="text-center px-4 py-4 text-[10px] font-black text-rose-400 uppercase tracking-widest">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-rose-500"></div> Lord
                        </div>
                      </th>
                      <th className="text-center px-4 py-4 text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-indigo-500"></div> Admin
                        </div>
                      </th>
                      <th className="text-center px-4 py-4 text-[10px] font-black text-emerald-400 uppercase tracking-widest">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-emerald-500"></div> Staff
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSION_KEYS.filter((key) => PERMISSION_LABELS[key].category === category).map((key) => {
                      const lordOn = ROLE_PERMISSIONS.lord[key];
                      const adminOn = ROLE_PERMISSIONS.admin[key];
                      const staffOn = ROLE_PERMISSIONS.staff[key];

                      return (
                        <tr
                          key={key}
                          className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-slate-800">{PERMISSION_LABELS[key].label}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">{PERMISSION_LABELS[key].desc}</p>
                          </td>
                          {/* Lord - always on */}
                          <td className="text-center px-4 py-4">
                            <div className="flex justify-center">
                              <div
                                className={cn(
                                  'w-10 h-6 rounded-full flex items-center px-0.5 cursor-not-allowed',
                                  lordOn ? 'bg-rose-500 justify-end opacity-50' : 'bg-slate-200 justify-start',
                                )}
                              >
                                <div className="w-5 h-5 bg-white rounded-full shadow-sm"></div>
                              </div>
                            </div>
                          </td>
                          {/* Admin */}
                          <td className="text-center px-4 py-4">
                            <div className="flex justify-center">
                              <div
                                className={cn(
                                  'w-10 h-6 rounded-full flex items-center px-0.5 cursor-not-allowed',
                                  adminOn ? 'bg-indigo-500 justify-end opacity-90' : 'bg-slate-200 justify-start',
                                )}
                              >
                                <div className="w-5 h-5 bg-white rounded-full shadow-sm"></div>
                              </div>
                            </div>
                          </td>
                          {/* Staff */}
                          <td className="text-center px-4 py-4">
                            <div className="flex justify-center">
                              <div
                                className={cn(
                                  'w-10 h-6 rounded-full flex items-center px-0.5 cursor-not-allowed',
                                  staffOn
                                    ? 'bg-emerald-500 justify-end opacity-90'
                                    : 'bg-slate-200 justify-start',
                                )}
                              >
                                <div className="w-5 h-5 bg-white rounded-full shadow-sm"></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
