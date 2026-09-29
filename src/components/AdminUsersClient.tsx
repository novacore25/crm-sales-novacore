"use client";
import { useState } from 'react';
import type { Role, UserProfile } from '@/types';
import { setUserName, setUserRole } from '@/app/actions/user-actions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { UserCheck, Shield, UserX, Pencil, Check, X } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

interface AdminUsersProps {
  initialUsers: UserProfile[];
  currentUser: UserProfile;
}

/**
 * User administration.
 *
 * Every mutation here is a server action that re-reads the actor's role from
 * the database and refuses anything but `lord`. The browser is not trusted -
 * the previous version escalated a staff account to admin from a JSX button
 * whose only guard was an RLS policy that was never written.
 */
export default function AdminUsersClient({ initialUsers, currentUser }: AdminUsersProps) {
  const [users, setUsers] = useState<UserProfile[]>(initialUsers);
  const router = useRouter();
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmVariant?: 'danger' | 'primary';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmVariant: 'danger' | 'primary' = 'danger',
  ) => {
    setConfirmConfig({ isOpen: true, title, message, onConfirm, confirmVariant });
  };

  /**
   * Single entry point for every role change. The server rejects a
   * self-demotion, so the local state is only updated once it agrees.
   */
  const changeRole = async (uid: string, role: Role, successMessage: string) => {
    setBusyUid(uid);
    try {
      // setUserRole's first parameter is typed against the role enum (a
      // signature slip in the action); the value passed is a user id.
      const result = await setUserRole(uid as Role, role);
      if (!result.success) {
        toast.error('Gagal: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, role } : u)));
      router.refresh();
      toast.success(successMessage);
    } catch {
      toast.error('Gagal: Anda tidak memiliki hak untuk mengubah role');
    } finally {
      setBusyUid(null);
    }
  };

  const approveUser = async (uid: string) => {
    await changeRole(uid, 'staff', 'User disetujui sebagai Staff');
  };

  const updateName = async (uid: string) => {
    if (!newName.trim()) return;
    setBusyUid(uid);
    try {
      const result = await setUserName(uid, newName);
      if (!result.success) {
        toast.error('Gagal: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, name: newName.trim() } : u)));
      router.refresh();
      setEditingUid(null);
      toast.success('Nama berhasil diperbarui');
    } catch {
      toast.error('Gagal: Anda tidak memiliki hak untuk mengubah nama user');
    } finally {
      setBusyUid(null);
    }
  };

  const makeAdmin = async (uid: string) => {
    showConfirm(
      'Promosi Admin',
      'Apakah Anda yakin ingin menjadikan user ini sebagai Admin? Admin memiliki akses luas ke sistem.',
      () => {
        void changeRole(uid, 'admin', 'User dipromosikan menjadi Admin');
      },
      'primary',
    );
  };

  const revokeAccess = async (uid: string) => {
    showConfirm(
      'Cabut Akses',
      'Apakah Anda yakin ingin mencabut akses user ini? Status akan kembali ke Pending dan user tidak bisa login.',
      () => {
        void changeRole(uid, 'pending', 'Akses dicabut');
      },
    );
  };

  return (
    <div className="flex-1 overflow-auto p-6 md:p-8 space-y-4">
      <div className="mb-4">
        <h2 className="text-2xl font-black text-gray-800">Manajemen User (Approval Akun)</h2>
        <p className="text-sm text-gray-500 mt-1">
          Berikan akses (Approve) kepada akun Google yang baru mendaftar agar bisa login ke sistem.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-gray-500 uppercase bg-gray-100 border-b border-gray-200">
            <tr>
              <th className="px-4 py-4 font-bold">Nama Staff</th>
              <th className="px-4 py-4 font-bold">Email Google</th>
              <th className="px-4 py-4 font-bold text-center">Status / Role</th>
              <th className="px-4 py-4 font-bold text-center">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => {
              // Your own row is read-only: the server refuses to let you change
              // (or revoke) your own account, so the buttons would only ever
              // produce an error.
              const isSelf = u.id === currentUser.id;
              const busy = busyUid === u.id;

              return (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-bold text-gray-800">
                    {editingUid === u.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          className="px-2 py-1 border rounded text-xs w-32"
                          autoFocus
                        />
                        <button
                          onClick={() => updateName(u.id)}
                          disabled={busy}
                          className="text-emerald-600 hover:bg-emerald-50 p-1 rounded disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingUid(null)}
                          className="text-red-500 hover:bg-red-50 p-1 rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        {u.name}
                        {isSelf ? (
                          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                            Anda
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingUid(u.id);
                              setNewName(u.name);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition p-1"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        'px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider',
                        u.role === 'lord'
                          ? 'bg-rose-100 text-rose-700'
                          : u.role === 'admin'
                            ? 'bg-indigo-100 text-indigo-700'
                            : u.role === 'staff'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-yellow-100 text-yellow-700',
                      )}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {u.role === 'pending' ? (
                        <button
                          onClick={() => approveUser(u.id)}
                          disabled={busy || isSelf}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow-sm flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <UserCheck className="w-3 h-3" /> Approve Staff
                        </button>
                      ) : isSelf ? (
                        <span className="text-[10px] font-bold text-gray-400 italic">
                          Baris sendiri tidak dapat diubah
                        </span>
                      ) : (
                        <>
                          {u.role !== 'admin' && u.role !== 'lord' && (
                            <button
                              onClick={() => makeAdmin(u.id)}
                              disabled={busy}
                              className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-300 flex items-center gap-1 disabled:opacity-50"
                            >
                              <Shield className="w-3 h-3" /> Jadikan Admin
                            </button>
                          )}
                          {u.role !== 'lord' && (
                            <button
                              onClick={() => revokeAccess(u.id)}
                              disabled={busy}
                              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 flex items-center gap-1 disabled:opacity-50"
                            >
                              <UserX className="w-3 h-3" /> Revoke
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmVariant={confirmConfig.confirmVariant}
      />
    </div>
  );
}
