"use client";
import React, { useState, useEffect } from 'react';
import type { LeadOption, TaskDTO, UserProfile } from '@/types';
import { saveTask } from '@/app/actions/task-actions';
import { useRouter } from 'next/navigation';
import { X, Calendar, User, Database } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type TaskPriority = 'Low' | 'Medium' | 'High';

interface TaskModalProps {
  /** Optional so the page can render a dormant instance alongside the list. */
  isOpen?: boolean;
  onClose?: () => void;
  user: UserProfile;
  users: UserProfile[];
  leadOptions: LeadOption[];
  editingTask?: TaskDTO | null;
  initialLeadId?: string;
  initialLeadName?: string;
}

/**
 * Create / edit a task.
 *
 * The lead picker and the assignee list are supplied by the page, so the modal
 * never queries for them. It used to `select('id, name')` on `leads`, which has
 * no `name` column - the brand name is `brand_name` - so the dropdown was
 * always empty. The old version also hardcoded `status: 'Todo'` on every save,
 * which reset any task that was already in progress; `saveTask` preserves the
 * existing status on edit and resolves the assignee's display name server side.
 */
export default function TaskModal({
  isOpen = false,
  onClose,
  user,
  users,
  leadOptions,
  editingTask = null,
  initialLeadId,
  initialLeadName,
}: TaskModalProps) {
  const router = useRouter();
  const close = () => onClose?.();

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    dueDate: new Date().toISOString().split('T')[0],
    priority: 'Medium' as TaskPriority,
    assignedTo: user.uid,
    leadId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editingTask) {
      setFormData({
        title: editingTask.title,
        description: editingTask.description || '',
        dueDate: editingTask.dueDate ? editingTask.dueDate.split('T')[0] : new Date().toISOString().split('T')[0],
        priority: (editingTask.priority as TaskPriority) ?? 'Medium',
        assignedTo: editingTask.assignedTo || user.uid,
        leadId: editingTask.leadId || '',
      });
    } else {
      setFormData({
        title: '',
        description: '',
        dueDate: new Date().toISOString().split('T')[0],
        priority: 'Medium',
        assignedTo: user.uid,
        leadId: initialLeadId || '',
      });
    }
    setErrors({});
  }, [editingTask, isOpen, initialLeadId, user.uid]);

  const validateField = (name: string, value: string) => {
    let error = '';
    if (name === 'title' && !value.trim()) error = 'Judul tugas wajib diisi';
    if (name === 'dueDate' && !value) error = 'Tanggal jatuh tempo wajib diisi';
    setErrors((prev) => ({ ...prev, [name]: error }));
    return !error;
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    validateField(name, value);
  };

  const validateForm = () => {
    const titleValid = validateField('title', formData.title);
    const dateValid = validateField('dueDate', formData.dueDate);
    return titleValid && dateValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const result = await saveTask({
        id: editingTask?.id,
        title: formData.title,
        description: formData.description,
        dueDate: formData.dueDate,
        priority: formData.priority,
        // On edit the server keeps the current status; on create the schema
        // default applies.
        status: editingTask ? (editingTask.status as 'Todo' | 'In Progress' | 'Done') : 'Todo',
        assignedTo: formData.assignedTo,
        leadId: formData.leadId || null,
      });

      if (!result.success) {
        toast.error('Gagal menyimpan tugas: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }

      toast.success(editingTask ? 'Task updated successfully' : 'Task created successfully');
      router.refresh();
      close();
    } catch {
      toast.error('Gagal menyimpan tugas');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
          >
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="font-black text-xl text-slate-800 tracking-tight">
                  {editingTask ? 'Edit Tugas' : 'Buat Tugas Baru'}
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                  Sales &amp; Follow-up Management
                </p>
              </div>
              <button
                onClick={close}
                className="text-slate-400 hover:text-rose-500 transition-all bg-white w-10 h-10 rounded-full shadow-sm flex items-center justify-center hover:rotate-90"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                  Judul Tugas
                </label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder="Apa yang perlu dilakukan?"
                  className={cn(
                    'w-full px-5 py-4 bg-slate-50 border rounded-2xl font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all shadow-inner',
                    errors.title ? 'border-rose-300 ring-rose-100' : 'border-slate-200',
                  )}
                />
                {errors.title && (
                  <p className="text-rose-500 text-[10px] font-black uppercase tracking-wider ml-2">
                    {errors.title}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                  Deskripsi (Opsional)
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Tambahkan detail lebih lanjut..."
                  rows={3}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all shadow-inner resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                    Tenggat Waktu
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="date"
                      name="dueDate"
                      value={formData.dueDate}
                      onChange={handleInputChange}
                      className={cn(
                        'w-full pl-12 pr-5 py-4 bg-slate-50 border rounded-2xl font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all shadow-inner',
                        errors.dueDate ? 'border-rose-300 ring-rose-100' : 'border-slate-200',
                      )}
                    />
                  </div>
                  {errors.dueDate && (
                    <p className="text-rose-500 text-[10px] font-black uppercase tracking-wider ml-2">
                      {errors.dueDate}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                    Prioritas
                  </label>
                  <select
                    name="priority"
                    value={formData.priority}
                    onChange={handleInputChange}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all shadow-inner appearance-none"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                    Ditugaskan Ke
                  </label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select
                      name="assignedTo"
                      value={formData.assignedTo}
                      onChange={handleInputChange}
                      className="w-full pl-12 pr-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all shadow-inner appearance-none"
                    >
                      {users.map((u) => (
                        <option key={u.uid} value={u.uid}>
                          {u.name} ({u.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                    Lead Terkait (Opsional)
                  </label>
                  <div className="relative">
                    <Database className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select
                      name="leadId"
                      value={formData.leadId}
                      onChange={handleInputChange}
                      className="w-full pl-12 pr-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all shadow-inner appearance-none"
                    >
                      <option value="">Tidak Ada Lead</option>
                      {leadOptions.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.brandName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-500/20 active:scale-95 text-sm uppercase tracking-widest mt-4 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? 'Menyimpan...' : editingTask ? 'Update Tugas' : 'Buat Tugas'}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
