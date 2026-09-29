'use client';

import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { toast } from 'sonner';

import { loginWithGoogle } from '@/app/actions/auth-actions';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  /**
   * Delegates to the Auth.js server action, which owns the OAuth redirect.
   *
   * The legacy page called `supabase.auth.signInWithOAuth` directly from the
   * browser and surfaced failures with `window.alert`. Using the server action
   * keeps the client secret on the server and gives us the toast component the
   * rest of the app already uses.
   */
  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (error) {
      console.error('[auth] sign-in failed', error);
      toast.error('Gagal login dengan Google. Silakan coba lagi.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-sm w-full space-y-6 text-center border border-slate-100">
        <div>
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-blue-200 shadow-xl">
            <LogIn className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Login CRM</h1>
          <p className="text-sm text-slate-500 mt-2">
            Masuk dengan akun Google Anda untuk melanjutkan ke Dashboard.
          </p>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center space-x-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 py-3 px-4 rounded-xl font-medium transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
          <span>{loading ? 'Menyambungkan...' : 'Lanjutkan dengan Google'}</span>
        </button>

        <div className="text-xs text-slate-400 mt-8">
          &copy; {new Date().getFullYear()} CoreDesk CRM TNT
        </div>
      </div>
    </div>
  );
}
