"use client";
import { useState } from 'react';
import type { EditRequestDTO, UserProfile } from '@/types';
import { approveEditRequest, rejectEditRequest } from '@/app/actions/task-actions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X, ArrowRight } from 'lucide-react';

interface AdminApprovalsProps {
  approvals: EditRequestDTO[];
  currentUser: UserProfile;
}

/**
 * Edit-request approval queue.
 *
 * Approving is a single server action: it updates the lead's brand/contact,
 * appends a `lead_notes` row recording what changed, and closes the request -
 * all in one transaction. The old version read and wrote a `leads.notes`
 * column that never existed, so merely rendering the queue (or approving)
 * failed.
 */
export default function AdminApprovalsClient({ approvals, currentUser }: AdminApprovalsProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  const handleApprove = async (req: EditRequestDTO) => {
    setBusyId(req.id);
    try {
      const result = await approveEditRequest(req.id);
      if (!result.success) {
        toast.error('Gagal: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }
      router.refresh();
      toast.success('Perubahan disetujui');
    } catch {
      toast.error('Gagal: Anda tidak memiliki hak menyetujui permintaan');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    try {
      const result = await rejectEditRequest(id);
      if (!result.success) {
        toast.error('Gagal: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }
      router.refresh();
      toast.info('Perubahan ditolak');
    } catch {
      toast.error('Gagal: Anda tidak memiliki hak menolak permintaan');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6 md:p-8 space-y-4">
      <div className="mb-4">
        <h2 className="text-2xl font-black text-gray-800">Antrean Permohonan Edit</h2>
        <p className="text-sm text-gray-500 mt-1">
          Staff tidak dapat merubah Brand/WA secara sepihak. Setujui permohonan mereka di sini.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-500 uppercase bg-gray-100 border-b border-gray-200">
            <tr>
              <th className="px-4 py-4 font-bold">Waktu Pengajuan</th>
              <th className="px-4 py-4 font-bold">Pemohon (Staff)</th>
              <th className="px-4 py-4 font-bold">Perubahan Master Data</th>
              <th className="px-4 py-4 font-bold text-center">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pendingApprovals.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-gray-400 italic">
                  Tidak ada antrean permohonan.
                </td>
              </tr>
            ) : (
              pendingApprovals.map((a) => (
                <tr key={a.id} className="border-b border-gray-50">
                  <td className="px-4 py-4 text-xs">{new Date(a.createdAt).toLocaleString('id-ID')}</td>
                  <td className="px-4 py-4 font-bold text-blue-700">{a.requestedByName ?? '-'}</td>
                  <td className="px-4 py-4">
                    <div className="text-xs text-gray-500">
                      Brand:{' '}
                      <span className="line-through text-red-400">{a.oldBrand}</span>{' '}
                      <ArrowRight className="w-3 h-3 inline" /> <b className="text-green-600">{a.newBrand}</b>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      WA: <span className="line-through text-red-400">{a.oldContact}</span>{' '}
                      <ArrowRight className="w-3 h-3 inline" /> <b className="text-green-600">{a.newContact}</b>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => handleApprove(a)}
                        disabled={busyId === a.id}
                        className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg shadow-sm text-xs font-bold hover:bg-emerald-600 flex items-center gap-1 disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" /> ACC
                      </button>
                      <button
                        onClick={() => handleReject(a.id)}
                        disabled={busyId === a.id}
                        className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-300 flex items-center gap-1 disabled:opacity-50"
                      >
                        <X className="w-3 h-3" /> Tolak
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
