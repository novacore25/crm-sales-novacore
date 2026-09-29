"use client";
import { useState } from 'react';
import type { LeadDTO, LeadStatus, InterestLevel, UserProfile } from '@/types';
import { X, Calendar, Edit3, MessageSquare } from 'lucide-react';
import { addFunnelHistory, createNote, editFunnelHistory, updateLead } from '@/app/actions/lead-actions';
import CurrencyInput from './common/CurrencyInput';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface BulkStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLeads: LeadDTO[];
  user: UserProfile;
  users?: UserProfile[];
  onSuccess: () => void;
}

const STAGES: LeadStatus[] = ['Leads', 'Chated', 'Responsed', 'Set Meeting', 'Hold', 'Close Win', 'Close Lost', 'Failed'];

/**
 * Bulk status update across many leads.
 *
 * The previous version assembled one big object per lead in JavaScript and
 * wrote it straight to the `leads` table: `interestLevel`, `dateChated`,
 * `dealValue`, `funnelHistory`, `notes` and `dateInput` are camelCase, and
 * none of them are columns on `leads`. Every bulk update failed, and the
 * funnel entries it built in memory were discarded because nothing was ever
 * written to `funnel_history`.
 *
 * Now each selected lead gets `addFunnelHistory` - which appends the funnel
 * row, updates the lead's denormalised stage/date/deal-value summary and logs
 * the change, all in one transaction - plus `updateLead` for the field-level
 * changes such as the interest level.
 */
export default function BulkStatusModal({
  isOpen,
  onClose,
  selectedLeads,
  user,
  users = [],
  onSuccess,
}: BulkStatusModalProps) {
  const [status, setStatus] = useState<LeadStatus>('Chated');
  const [interest, setInterest] = useState<InterestLevel>('-');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [wrongDate, setWrongDate] = useState('');
  const [dealValue, setDealValue] = useState<number>(0);
  const [note, setNote] = useState('');
  const [assignedPic, setAssignedPic] = useState<string>('');
  const [isCorrectionMode, setIsCorrectionMode] = useState(false);
  const [loading, setLoading] = useState(false);

  const isLordOrAdmin = user.role === 'lord' || user.role === 'admin';
  const staffUsers = users
    .filter((u) => u.role === 'staff' || u.role === 'lord' || u.role === 'admin')
    .filter((u) => u.uid !== user.uid);

  const handleSave = async () => {
    if (isCorrectionMode) {
      if (!wrongDate || !date) {
        toast.error('Pilih Tanggal Salah dan Tanggal Benar!');
        return;
      }
    } else {
      if (!status) {
        toast.error('Pilih tahap funnel!');
        return;
      }
      if (status !== 'Leads' && !date) {
        toast.error('Pilih tanggal pelaksanaan!');
        return;
      }
      if (status === 'Close Win' && dealValue <= 0) {
        toast.error('Masukkan nominal Deal (Rp) yang akan menimpa seluruh entri terpilih!');
        return;
      }
    }

    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (selectedDate > today) {
      toast.error('Tanggal tidak boleh di masa depan!');
      return;
    }

    const finalAuthor = isLordOrAdmin && assignedPic ? assignedPic : user.name;
    const wasAssigned = isLordOrAdmin && assignedPic && assignedPic !== user.name;

    // Analysis before batch
    let myOverrides = 0;
    let othersDuplicates = 0;
    let hasWinConflict = false;

    if (!isCorrectionMode) {
      for (const lead of selectedLeads) {
        const sameDay = (lead.funnelHistory || []).filter((h) => h.dateOccurred?.split('T')[0] === date);
        const sameStage = sameDay.find((h) => h.stage === status);
        const anyWin = sameDay.find((h) => h.stage === 'Close Win');

        if (sameStage) {
          if (sameStage.byUserName === finalAuthor) myOverrides++;
          else othersDuplicates++;
        }
        if (status === 'Close Win' && anyWin && (!sameStage || sameStage.byUserName !== finalAuthor)) {
          hasWinConflict = true;
        }
      }

      if (myOverrides > 0 || othersDuplicates > 0 || hasWinConflict) {
        let msg = `⚠️ ANALISIS BULK UPDATE (Tanggal: ${date}):\n\n`;
        if (myOverrides > 0)
          msg += `- ${myOverrides} Lead akan di-OVERRIDE (Anda sudah mencatat status ini hari ini).\n`;
        if (othersDuplicates > 0)
          msg += `- ${othersDuplicates} Lead sudah dicatat oleh SALES LAIN hari ini (Akan terhitung dobel).\n`;
        if (hasWinConflict) msg += `- Terdapat konflik "Close Win" hari ini pada salah satu brand.\n`;
        msg += `\nLanjutkan eksekusi massal?`;

        if (!window.confirm(msg)) return;
      }
    }

    if (isCorrectionMode) {
      if (
        !window.confirm(
          `MODE KOREKSI TANGGAL AKTIF!\n\nAnda akan MENGGANTI tanggal histori tahap "${status}" menjadi "${date}" untuk ${selectedLeads.length} Lead. \n\nTindakan ini tidak akan mengubah Status Utama Lead (kecuali status lead saat ini adalah ${status}). Lanjutkan?`,
        )
      )
        return;
    }

    setLoading(true);
    let okCount = 0;
    let failed = 0;
    let firstError = '';

    try {
      for (const lead of selectedLeads) {
        try {
          if (isCorrectionMode) {
            // Correction mode rewrites the date of the existing funnel rows
            // rather than appending a new one. Each row is edited in place.
            const affected = (lead.funnelHistory || []).filter(
              (h) => h.dateOccurred?.split('T')[0] === wrongDate,
            );

            for (const entry of affected) {
              const result = await editFunnelHistory({
                id: entry.id,
                stage: entry.stage,
                dateOccurred: date,
                byUserName: entry.byUserName,
                dealValue: entry.dealValue,
                campaignNumber: entry.campaignNumber,
                note: entry.note,
              });
              if (!result.success) throw new Error(result.error ?? 'Gagal mengoreksi histori');
            }

            // Keep the lead's own stage dates aligned with the corrected rows.
            // `date_input` is intentionally left alone: it is the original
            // intake date, not a funnel stage date, and updateLead does not
            // patch it.
            const patch: Parameters<typeof updateLead>[0] = { id: lead.id };
            if (lead.dateChated?.split('T')[0] === wrongDate) patch.dateChated = date;
            if (lead.dateResponsed?.split('T')[0] === wrongDate) patch.dateResponsed = date;
            if (lead.dateSetMeeting?.split('T')[0] === wrongDate) patch.dateSetMeeting = date;
            if (lead.dateClosed?.split('T')[0] === wrongDate) patch.dateClosed = date;
            if (lead.dateFailed?.split('T')[0] === wrongDate) patch.dateFailed = date;

            if (Object.keys(patch).length > 1) {
              const leadResult = await updateLead(patch);
              if (!leadResult.success) throw new Error(leadResult.error ?? 'Gagal memperbarui lead');
            }

            if (affected.length > 0) {
              const noteResult = await createNote({
                leadId: lead.id,
                text: `[SYSTEM] Histori tanggal ${wrongDate} dikoreksi menjadi ${date} secara masal oleh ${user.name}`,
                noteType: 'note',
              });
              if (!noteResult.success) throw new Error(noteResult.error ?? 'Gagal menulis catatan');
            }

            okCount++;
            continue;
          }

          if (interest !== '-') {
            const leadResult = await updateLead({ id: lead.id, interestLevel: interest });
            if (!leadResult.success) throw new Error(leadResult.error ?? 'Gagal memperbarui lead');
          }

          const sameDay = (lead.funnelHistory || []).filter(
            (h) => h.dateOccurred?.split('T')[0] === date,
          );
          const existingSelf = sameDay.find((h) => h.stage === status && h.byUserName === finalAuthor);

          if (existingSelf) {
            // Override: rewrite the entry that is already there instead of
            // appending a second row for the same day and stage.
            const result = await editFunnelHistory({
              id: existingSelf.id,
              stage: status,
              dateOccurred: date,
              byUserName: finalAuthor,
              dealValue: status === 'Close Win' ? Number(dealValue) : (existingSelf.dealValue ?? null),
              campaignNumber:
                status === 'Close Win'
                  ? (existingSelf.campaignNumber ?? 1)
                  : (existingSelf.campaignNumber ?? null),
              note: note.trim() || existingSelf.note,
            });
            if (!result.success) throw new Error(result.error ?? 'Gagal menimpa histori');
          } else {
            const result = await addFunnelHistory({
              leadId: lead.id,
              stage: status,
              dateOccurred: status === 'Leads' && lead.dateInput ? lead.dateInput : date,
              byUserName: finalAuthor,
              note: note.trim() || null,
              assignedBy: wasAssigned ? user.name : null,
              dealValue: status === 'Close Win' ? Number(dealValue) : null,
              campaignNumber:
                status === 'Close Win'
                  ? (lead.funnelHistory || []).filter((h) => h.stage === 'Close Win').length + 1
                  : null,
            });
            if (!result.success) throw new Error(result.error ?? 'Gagal menambah histori');
          }

          // The uniform note also lands on the lead's own Notes tab.
          if (note.trim() && !existingSelf) {
            const noteResult = await createNote({
              leadId: lead.id,
              text: note.trim(),
              noteType: 'note',
            });
            if (!noteResult.success) throw new Error(noteResult.error ?? 'Gagal menulis catatan');
          }

          okCount++;
        } catch (leadError) {
          failed++;
          if (!firstError) {
            firstError = leadError instanceof Error ? leadError.message : 'Gagal tidak diketahui';
          }
        }
      }

      if (failed > 0) {
        toast.error(`${okCount} lead berhasil, ${failed} gagal. ${firstError}`);
      } else {
        toast.success('Berhasil eksekusi status massal');
      }
      onSuccess();
      onClose();
    } catch {
      toast.error('Gagal melakukan aksi massal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100"
          >
            <div className="px-6 py-5 border-b border-indigo-50 flex justify-between items-center bg-indigo-600/5">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-md shadow-indigo-600/20">
                  {selectedLeads.length}
                </div>
                <div>
                  <h3 className="font-black text-lg text-slate-800 tracking-tight leading-tight">
                    Bulk Status Update
                  </h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                    Tindakan massal tidak dapat di-_undo_
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-rose-500 transition-colors bg-white w-8 h-8 rounded-full shadow-sm flex items-center justify-center border border-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[70vh] custom-scrollbar space-y-5">
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                {!isCorrectionMode && (
                  <>
                    <label className="block text-[11px] font-black text-indigo-800 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5" /> Set Tahap Funnel Baru
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as LeadStatus)}
                      className="w-full px-4 py-3 bg-white border border-indigo-200 rounded-xl font-bold text-slate-800 focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 transition-all outline-none"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isCorrectionMode"
                    checked={isCorrectionMode}
                    onChange={(e) => setIsCorrectionMode(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 border-indigo-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="isCorrectionMode" className="text-xs font-bold text-indigo-900 cursor-pointer">
                    Mode Koreksi Tanggal (Ubah Histori Tanpa Nambah Baru)
                  </label>
                </div>
              </div>

              {isCorrectionMode ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Tanggal Salah (Lama)
                    </label>
                    <input
                      type="date"
                      value={wrongDate}
                      onChange={(e) => setWrongDate(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-rose-600 focus:ring-2 focus:ring-rose-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Tanggal Benar (Baru)
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-emerald-600 focus:ring-2 focus:ring-emerald-600 outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                      Update Level Minat
                    </label>
                    <select
                      value={interest}
                      onChange={(e) => setInterest(e.target.value as InterestLevel)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-600 outline-none"
                    >
                      <option value="-">- Abaikan / Jangan Ubah -</option>
                      <option value="HOT" className="text-red-600">
                        Jadikan HOT
                      </option>
                      <option value="WARM" className="text-yellow-600">
                        Jadikan WARM
                      </option>
                      <option value="COLD" className="text-blue-600">
                        Jadikan COLD
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Tanggal Eksekusi
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      disabled={status === 'Leads'}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-600 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                </div>
              )}

              {!isCorrectionMode && isLordOrAdmin && (
                <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4">
                  <label className="block text-[11px] font-black text-purple-800 uppercase tracking-widest mb-2 flex items-center gap-1">
                    Assign PIC
                  </label>
                  <select
                    value={assignedPic}
                    onChange={(e) => setAssignedPic(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-purple-200 rounded-xl font-bold text-slate-800 focus:ring-2 focus:ring-purple-600 focus:border-purple-600 transition-all outline-none"
                  >
                    <option value="">- Default (Saya sendiri) -</option>
                    {staffUsers.map((u) => (
                      <option key={u.uid} value={u.name}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] mt-2 text-slate-500 font-medium">
                    Bila diisi, puluhan data ini akan menyumbang KPI sepenuhnya ke PIC tersebut.
                  </p>
                </div>
              )}

              {!isCorrectionMode && status === 'Close Win' && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <label className="block text-[11px] font-black text-emerald-700 uppercase tracking-wider mb-2">
                    Keseragaman Deal Value (Rp) *
                  </label>
                  <CurrencyInput
                    value={dealValue}
                    onChange={(val) => setDealValue(val)}
                    className="w-full px-3 py-3 border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-black text-emerald-900 bg-white"
                  />
                </div>
              )}

              {!isCorrectionMode && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" /> Tembuskan Catatan Seragam (Opsional)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Contoh: Pengiriman promo katalog 4.4"
                    rows={3}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-all outline-none resize-none custom-scrollbar"
                  ></textarea>
                  <p className="text-[9px] text-slate-400 font-medium mt-1.5 italic">
                    Catatan ini akan tersalin ke tab Notes pada masing-masing Brand terpilih.
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 capitalize bg-slate-200/50 px-2 py-1 rounded">
                PIC: {user.name}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                >
                  Batalkan
                </button>
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50 disabled:shadow-none min-w-[120px]"
                >
                  {loading ? 'Menyuntik Data...' : 'Eksekusi Massal'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
