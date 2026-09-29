import { useEffect, useState } from 'react';
import type { LeadDTO, UserProfile, NoteDTO, EditRequestDTO } from '@/types';
import { X, Route, MessageSquare, Send, Pin, Bot, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { createNote } from '@/app/actions/lead-actions';
import MarkdownEditor from './MarkdownEditor';
import MarkdownRenderer from './MarkdownRenderer';

interface NotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadDTO;
  user: UserProfile;
  approvals: EditRequestDTO[];
}

const STAGES = ["Leads", "Chated", "Responsed", "Set Meeting", "Close Win", "Close Lost", "Failed"];

export default function NotesModalClient({ isOpen, onClose, lead, user, approvals }: NotesModalProps) {
  const router = useRouter();
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(false);
  // Local mirror of the lead's notes. The previous version pushed onto the
  // `lead` prop's array in place, which mutated a server prop and left the UI
  // showing a note the database did not have until the next full reload.
  const [notes, setNotes] = useState<NoteDTO[]>(lead.notes || []);

  useEffect(() => {
    setNotes(lead.notes || []);
  }, [lead.notes]);

  const leadApprovals = (approvals || [])
    .filter(a => a.leadId === lead.id && a.status === 'approved')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const originalData = leadApprovals.length > 0 ? {
    brand: leadApprovals[leadApprovals.length - 1].oldBrand,
    contact: leadApprovals[leadApprovals.length - 1].oldContact
  } : null;

  const handleSendNote = async () => {
    if (!newNote.trim()) return;
    const text = newNote;
    setLoading(true);
    try {
      const result = await createNote({
        leadId: lead.id,
        text,
        noteType: 'note',
        createdAt: new Date().toISOString(),
        authorName: user.name,
      });
      if (!result.success) throw new Error(result.error ?? 'Gagal menyimpan catatan');

      const created: NoteDTO = {
        id: result.id ?? '',
        leadId: lead.id,
        text,
        authorId: null,
        authorName: user.name,
        isLog: false,
        noteType: 'note',
        createdAt: new Date().toISOString(),
      };

      // Show the note that was actually written, then pull the server's copy so
      // the timeline cannot drift from the database.
      setNotes(prev => [...prev, created]);
      setNewNote('');
      toast.success("Catatan ditambahkan");
      router.refresh();
    } catch (error: any) {
      toast.error("Gagal mengirim: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-30 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col h-[90vh]"
          >
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-white shadow-sm z-10 relative">
              <div>
                <h3 className="font-black text-xl text-gray-800 tracking-tight">Audit Trail & Detail</h3>
                <p className="text-sm font-bold text-blue-600 mt-0.5">{lead.brandName}</p>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition bg-gray-100 w-10 h-10 rounded-full flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row bg-slate-50">
              {/* Left: Funnel Timeline */}
              <div className="w-full md:w-5/12 p-6 border-r border-gray-200 overflow-y-auto timeline-scroll bg-white">
                <h4 className="font-black text-sm text-gray-800 uppercase tracking-wider flex items-center gap-2 mb-6">
                  <Route className="w-5 h-5 text-blue-500" /> Jejak Waktu Funnel
                </h4>
                <div className="relative pl-3 border-l-2 border-slate-200 ml-2 space-y-6">
                  {originalData && (
                    <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <h5 className="text-[10px] font-black text-amber-800 uppercase tracking-wider mb-2">Data Asli (Awal)</h5>
                      <div className="space-y-1 text-xs">
                        <p className="text-gray-500">Brand: <span className="font-bold text-gray-800">{originalData.brand}</span></p>
                        <p className="text-gray-500">Kontak: <span className="font-bold text-gray-800">{originalData.contact}</span></p>
                      </div>
                    </div>
                  )}

                  {leadApprovals.length > 0 && (
                    <div className="mb-6">
                      <h5 className="text-[10px] font-black text-emerald-800 uppercase tracking-wider mb-3 flex items-center gap-1">
                        <User className="w-3 h-3" /> Riwayat Approval Admin
                      </h5>
                      <div className="space-y-3">
                        {leadApprovals.map(a => (
                          <div key={a.id} className="bg-emerald-50/50 p-2.5 rounded-lg border border-emerald-100 text-[11px]">
                            <div className="flex justify-between mb-1">
                              <span className="font-bold text-emerald-700">Disetujui</span>
                              <span className="text-gray-400">{new Date(a.createdAt).toLocaleDateString('id-ID')}</span>
                            </div>
                            <p className="text-gray-600">Oleh: <span className="font-bold">{a.requestedByName}</span> (Staff)</p>
                            <div className="mt-1 pt-1 border-t border-emerald-100 text-[10px] text-gray-500 italic">
                              {a.oldBrand !== a.newBrand && <span>Brand: {a.oldBrand} → {a.newBrand}</span>}
                              {a.oldContact !== a.newContact && <span>{a.oldBrand !== a.newBrand ? ', ' : ''}WA: {a.oldContact} → {a.newContact}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {STAGES.map(s => {
                    const entries = (lead.funnelHistory || [])
                      .filter(h => h.stage === s)
                      .sort((a, b) => new Date(b.dateOccurred).getTime() - new Date(a.dateOccurred).getTime());

                    if (entries.length === 0) return null;

                    return (
                      <div key={s} className="mb-4 relative">
                        <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider mb-2 flex items-center justify-between border-b border-slate-200 pb-1">
                          <span>{s}</span>
                          <span className="bg-blue-100 text-blue-600 px-1.5 rounded-full">{entries.length}x</span>
                        </div>
                        <div className="space-y-2">
                          {entries.map((e, i) => (
                            <div key={i} className="relative">
                              <div className="absolute -left-[17px] top-2 w-2 h-2 bg-blue-500 rounded-full ring-2 ring-white"></div>
                              <div className="text-[11px] text-gray-600 bg-white px-2 py-1.5 rounded-md shadow-sm border border-gray-100">
                                <div className="flex justify-between">
                                  <span>{new Date(e.dateOccurred).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                  <span className="font-bold text-blue-700">by {e.byUserName}
                                    {(e.assignedBy && e.assignedBy !== 'System') && <span className="text-purple-500"> (assigned by {e.assignedBy})</span>}
                                  </span>
                                </div>
                                {e.note && (
                                  <p className="mt-1 pt-1 border-t border-gray-100 text-[10px] text-gray-500 italic">📝 {e.note}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Action Plan & Notes */}
              <div className="w-full md:w-7/12 flex flex-col">
                <div className="p-6 pb-2 shrink-0">
                  {lead.actionPlan && (
                    <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded-r-xl mb-4">
                      <p className="text-[10px] font-black text-blue-800 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Pin className="w-3 h-3" /> Action Plan Utama
                      </p>
                      <p className="text-sm font-medium text-gray-800 leading-relaxed">{lead.actionPlan}</p>
                    </div>
                  )}
                </div>

                <div className="px-6 pb-2">
                  <h4 className="font-black text-sm text-gray-800 uppercase tracking-wider flex items-center gap-2 mb-2">
                    <MessageSquare className="w-5 h-5 text-green-500" /> Log Diskusi & Catatan
                  </h4>
                </div>

                <div className="flex-1 overflow-y-auto p-6 pt-0 space-y-4 timeline-scroll">
                  {notes.length === 0 ? (
                    <div className="text-center text-gray-400 py-8 border border-dashed rounded-xl bg-white text-xs font-medium">
                      Belum ada diskusi tercatat.
                    </div>
                  ) : (
                    notes.slice().reverse().map((n, i) => (
                      n.isLog ? (
                        <div key={n.id || i} className="bg-gray-100/50 p-2 rounded-lg mb-2 flex items-start gap-2 text-gray-500 italic text-xs">
                          <Bot className="w-3 h-3 mt-0.5 opacity-50" />
                          <div className="leading-tight">
                            {n.text}
                            <span className="text-[9px] block opacity-75 mt-0.5">{new Date(n.createdAt).toLocaleString('id-ID')}</span>
                          </div>
                        </div>
                      ) : (
                        <div key={n.id || i} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-3">
                          <div className="flex items-center gap-2 mb-2 border-b border-gray-50 pb-2">
                            <div className="w-5 h-5 rounded bg-gradient-to-tr from-slate-700 to-slate-900 text-white flex items-center justify-center text-[9px] font-bold shadow-sm">
                              {(n.authorName || 'S').charAt(0).toUpperCase()}
                            </div>
                            <b className="text-xs text-gray-800">{n.authorName || 'System'}</b>
                            <span className="text-[9px] font-bold text-gray-400 ml-auto uppercase tracking-wider">
                              {new Date(n.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                            </span>
                          </div>
                          <div className="text-sm text-gray-700 font-medium leading-relaxed mt-2"><MarkdownRenderer content={n.text} /></div>
                        </div>
                      )
                    ))
                  )}
                </div>

                {/* Note Input */}
                <div className="p-4 bg-white border-t border-gray-200 shrink-0">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <MarkdownEditor
                        value={newNote}
                        onChange={setNewNote}
                        placeholder="Tulis catatan diskusi, kendala, atau log manual di sini..."
                        disabled={loading}
                      />
                    </div>
                    <button
                      onClick={handleSendNote}
                      disabled={loading || !newNote.trim()}
                      className="px-6 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition flex items-center justify-center shadow-md disabled:opacity-50"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
