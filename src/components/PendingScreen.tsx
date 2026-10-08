'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, UserCircle, RefreshCw, Clock } from 'lucide-react';

import { logout } from '@/app/actions/auth-actions';

/**
 * Shown to accounts whose role is still `pending`.
 *
 * Sign-out now goes through the Auth.js server action instead of
 * `supabase.auth.signOut()`. That is required, not cosmetic: the old call
 * worked only because @supabase/ssr kept the session in cookies it knew how
 * to clear. With a hand-rolled session there is no such implicit cleanup, so
 * the cookie has to be destroyed explicitly.
 */
export default function PendingScreen({ email, name }: { email: string; name: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  const handleCheckStatus = () => {
    setChecking(true);
    router.refresh();
    setTimeout(() => {
      setChecking(false);
    }, 1200);
  };

  const handleLogout = async () => {
    await logout();
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-2 bg-indigo-500" />

        <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <UserCircle className="w-10 h-10 text-indigo-500" />
        </div>

        <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-2">
          Halo, {name}! 👋
        </h1>
        <p className="text-sm font-bold text-slate-500 bg-slate-50 py-2 px-4 rounded-xl inline-block mb-6">
          {email}
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 text-left">
          <h2 className="text-sm font-black text-amber-800 mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            Menunggu Persetujuan Admin
          </h2>
          <p className="text-xs font-medium text-amber-700/80 leading-relaxed">
            Akun Anda telah berhasil terdaftar, namun saat ini sedang menunggu persetujuan dari
            Administrator. Silakan hubungi Admin untuk segera mengaktifkan akses Anda (Staff / Admin).
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleCheckStatus}
            disabled={checking}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-100 active:scale-95 disabled:opacity-75"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Memeriksa Akses...' : 'Periksa Status Akses'}
          </button>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all"
          >
            <LogOut className="w-4 h-4" /> Keluar (Logout)
          </button>
        </div>
      </div>
    </div>
  );
}
