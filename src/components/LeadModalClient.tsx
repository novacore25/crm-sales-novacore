import React, { useState, useEffect, useCallback } from 'react';
import type {
  LeadDTO,
  UserProfile,
  ProductOffered,
  FunnelHistoryDTO,
} from '@/types';
import { LEAD_SOURCES, FALLBACK_CATEGORIES } from '@/types';
import { X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import ConfirmModal from './ConfirmModal';
import CurrencyInput from './common/CurrencyInput';
import {
  createLead,
  updateLead,
  addFunnelHistory,
  createNote,
  getCategories,
} from '@/app/actions/lead-actions';
import { createEditRequest } from '@/app/actions/task-actions';
import { getOIForecasts, setOIForecastStatus, updateOIForecastField } from '@/app/actions/forecast-actions';

interface LeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadDTO | null;
  user: UserProfile;
  leads?: LeadDTO[];
  users?: UserProfile[];
}

/**
 * Mirrors the forecast row that belongs to this lead.
 *
 * Only WIN and LOSE are pushed: `setOIForecastStatus('OPEN')` rewrites the
 * parent lead's stage as a side effect, which would wipe out the funnel stage
 * the sales rep just recorded whenever a lead is still in progress.
 */
async function syncForecasts(params: {
  leadId: string;
  leadStatus: string;
  campaignNumber: number;
  products: ProductOffered[];
  dealValue: number;
}) {
  try {
    const forecasts = await getOIForecasts();
    const mine = forecasts.filter((f) => f.leadId === params.leadId);
    if (!mine.length) return;

    const forecastStatus =
      params.leadStatus === 'Close Win'
        ? 'WIN'
        : params.leadStatus === 'Close Lost' || params.leadStatus === 'Failed'
          ? 'LOSE'
          : 'OPEN';

    for (const f of mine) {
      const fCategory = (f.category || '').toLowerCase();

      // Match by product
      const isProductMatch = (params.products || []).some(
        (p) =>
          fCategory.includes(p.toLowerCase()) ||
          p.toLowerCase().includes(fCategory.replace(' campaign', '').trim()),
      );
      if (!isProductMatch) continue;

      const fCampaign = Number(f.campaignNumber || 1);
      if (fCampaign !== params.campaignNumber && forecastStatus !== 'OPEN') continue;

      if (forecastStatus === 'WIN') {
        // Forecast value first: this also recomputes gross_margin from the
        // stored ad/creator budgets.
        await updateOIForecastField({ id: f.id, field: 'value', value: params.dealValue });
        const res = await setOIForecastStatus({
          id: f.id,
          status: 'WIN',
          dealValue: params.dealValue,
        });
        if (!res.success) throw new Error(res.error);
      } else if (forecastStatus === 'LOSE') {
        const res = await setOIForecastStatus({ id: f.id, status: 'LOSE' });
        if (!res.success) throw new Error(res.error);
      }
    }
  } catch (err) {
    console.error('Forecast sync failed:', err);
  }
}

export default function LeadModalClient({ isOpen, onClose, lead, user, leads = [], users = [] }: LeadModalProps) {
  const [CATEGORIES, setCATEGORIES] = useState<string[]>([...FALLBACK_CATEGORIES]);

  const refreshCategories = useCallback(async () => {
    try {
      const fromDb = await getCategories();
      setCATEGORIES(
        Array.from(new Set([...FALLBACK_CATEGORIES, ...fromDb]))
          .filter((c) => c && c !== 'Tambah Baru')
          .sort((a, b) => a.localeCompare(b)),
      );
    } catch {
      setCATEGORIES([...FALLBACK_CATEGORIES]);
    }
  }, []);

  useEffect(() => {
    if (isOpen) refreshCategories();
  }, [isOpen, refreshCategories]);

  const [assignedPic, setAssignedPic] = useState<string>('');
  const [formData, setFormData] = useState({
    dateInput: new Date().toISOString().split('T')[0],
    category: '',
    brandName: '',
    contact: '',
    email: '',
    actionPlan: '',
    dealValue: 0,
    leadSource: '',
    customSource: '',
    customCategory: '',
    dateChated: '',
    dateResponsed: '',
    dateSetMeeting: '',
    dateClosed: '',
    campaignNumber: 1
  });
  const [productOffered, setProductOffered] = useState<ProductOffered[]>([]);
  const [loading, setLoading] = useState(false);

  const [duplicateConfirm, setDuplicateConfirm] = useState<{isOpen: boolean, existingLead: LeadDTO} | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [internalLead, setInternalLead] = useState<LeadDTO | null>(lead || null);
  const [smartMatch, setSmartMatch] = useState<LeadDTO | null>(null);

  useEffect(() => {
    setInternalLead(lead);
  }, [lead, isOpen]);

  useEffect(() => {
    if (!lead && formData.brandName.trim().length > 1) {
      const searchName = formData.brandName.trim().toLowerCase();
      const existingData = leads.find(l => l.brandName?.trim().toLowerCase() === searchName);
      setSmartMatch(existingData || null);
    } else {
      setSmartMatch(null);
    }
  }, [formData.brandName, lead, leads]);

  const handleLoadSmartMatch = () => {
    if (smartMatch) {
      setInternalLead(smartMatch);
      setSmartMatch(null);
      toast.success("Data berhasil dimuat. Form otomatis beralih ke Mode Edit!");
    }
  };

  useEffect(() => {
    setErrors({});
    if (internalLead) {
      setFormData({
        dateInput: internalLead.dateInput || '',
        category: CATEGORIES.includes(internalLead.category) ? internalLead.category : (internalLead.category ? 'Tambah Baru' : ''),
        customCategory: CATEGORIES.includes(internalLead.category) ? '' : (internalLead.category || ''),
        brandName: internalLead.brandName,
        contact: internalLead.contact,
        email: internalLead.email || '',
        actionPlan: internalLead.actionPlan || '',
        dealValue: internalLead.dealValue || 0,
        leadSource: (LEAD_SOURCES as readonly string[]).includes(internalLead.leadSource || '') ? (internalLead.leadSource || '') : (internalLead.leadSource ? 'Tambah Baru' : ''),
        customSource: (LEAD_SOURCES as readonly string[]).includes(internalLead.leadSource || '') ? '' : (internalLead.leadSource || ''),
        dateChated: internalLead.dateChated || '',
        dateResponsed: internalLead.dateResponsed || '',
        dateSetMeeting: internalLead.dateSetMeeting || '',
        dateClosed: internalLead.dateClosed || '',
        campaignNumber: 1
      });
      setProductOffered((internalLead.productOffered || []) as ProductOffered[]);
    } else {
      setFormData({
        dateInput: new Date().toISOString().split('T')[0],
        category: '',
        customCategory: '',
        brandName: '',
        contact: '',
        email: '',
        actionPlan: '',
        dealValue: 0,
        leadSource: '',
        customSource: '',
        dateChated: '',
        dateResponsed: '',
        dateSetMeeting: '',
        dateClosed: '',
        campaignNumber: 1
      });
      setProductOffered([]);
    }
  }, [internalLead, isOpen]);

  const validateField = (name: string, value: string) => {
    let error = '';
    if (name === 'dateInput' && !value) {
      error = "Tanggal input harus diisi";
    } else if (name === 'category' && !value) {
      error = "Kategori harus dipilih";
    } else if (name === 'brandName') {
      if (!value.trim()) error = "Nama brand harus diisi";
      else if (value.trim().length < 2) error = "Nama brand minimal 2 karakter";
    } else if (name === 'contact') {
      const cleanValue = value.replace(/[^0-9+]/g, '');
      if (!cleanValue) error = "Nomor kontak harus diisi";
      else if (cleanValue.length < 7 || cleanValue.length > 20) error = "Format nomor tidak valid (7-20 digit angka)";
    } else if (name === 'picPhone' && value) {
      const cleanValue = value.replace(/[^0-9+]/g, '');
      if (cleanValue.length < 7 || cleanValue.length > 20) error = "Format nomor tidak valid (7-20 digit angka)";
    } else if (name === 'socialMedia' && value) {
      if (value.length > 0 && !value.includes('@') && !value.includes('http')) {
        error = "Gunakan format @username atau link profil";
      }
    }
    setErrors(prev => ({ ...prev, [name]: error }));
    return !error;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    let { name, value } = e.target;

    // Auto sanitize contact number to only allow digits and +
    // This removes invisible characters usually present when copy-pasting from WA Business
    if (name === 'contact') {
      value = value.replace(/[^0-9+]/g, '');
    }

    setFormData(prev => ({ ...prev, [name]: value }));
    validateField(name, value);
  };

  const validateForm = () => {
    let isValid = true;
    const results = Object.keys(formData).map(key => validateField(key, (formData as any)[key]));
    if (!results.every(r => r)) isValid = false;

    if (formData.category === 'Tambah Baru' && !formData.customCategory.trim()) {
      setErrors(prev => ({ ...prev, customCategory: 'Kategori baru harus diisi' }));
      isValid = false;
    }
    if (formData.leadSource === 'Tambah Baru' && !formData.customSource.trim()) {
      setErrors(prev => ({ ...prev, customSource: 'Sumber baru harus diisi' }));
      isValid = false;
    }

    if (formData.dateClosed && (!formData.dateSetMeeting || !formData.dateResponsed || !formData.dateChated)) {
      toast.error("Jika Close Win diisi, maka Tgl Meeting, Responsed, dan Chated wajib diisi!");
      isValid = false;
    } else if (formData.dateSetMeeting && (!formData.dateResponsed || !formData.dateChated)) {
      toast.error("Jika Tgl Meeting diisi, maka Tgl Responsed dan Chated wajib diisi!");
      isValid = false;
    } else if (formData.dateResponsed && !formData.dateChated) {
      toast.error("Jika Tgl Responsed diisi, maka Tgl Chated wajib diisi!");
      isValid = false;
    }

    // Chronological Waktu Safeguard
    if (formData.dateChated && formData.dateResponsed) {
      if (new Date(formData.dateResponsed).getTime() < new Date(formData.dateChated).getTime()) {
        toast.error("Logika Waktu Salah: Tgl Responsed tidak boleh mundur dari Tgl Chated!");
        isValid = false;
      }
    }
    if (formData.dateResponsed && formData.dateSetMeeting) {
      if (new Date(formData.dateSetMeeting).getTime() < new Date(formData.dateResponsed).getTime()) {
        toast.error("Logika Waktu Salah: Tgl Meeting tidak boleh mundur dari Tgl Responsed!");
        isValid = false;
      }
    }
    if (formData.dateSetMeeting && formData.dateClosed) {
      if (new Date(formData.dateClosed).getTime() < new Date(formData.dateSetMeeting).getTime()) {
        toast.error("Logika Waktu Salah: Tgl Close Win tidak boleh mundur dari Tgl Meeting!");
        isValid = false;
      }
    }

    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error("Mohon perbaiki kesalahan pada form");
      return;
    }

    setLoading(true);

    try {
      const finalCategory = formData.category === 'Tambah Baru' ? formData.customCategory.trim() : formData.category;
      const finalSource = formData.leadSource === 'Tambah Baru' ? formData.customSource.trim() : formData.leadSource;

      if (internalLead) {
        if (user.role === 'staff') {
          const isMasterDataChanged = internalLead.brandName !== formData.brandName || internalLead.contact !== formData.contact;
          if (isMasterDataChanged) {
            // Staff cannot touch master data - file the request instead.
            const request = await createEditRequest({
              leadId: internalLead.id,
              oldBrand: internalLead.brandName,
              newBrand: formData.brandName,
              oldContact: internalLead.contact,
              newContact: formData.contact,
            });
            if (!request.success) throw new Error(request.error ?? 'Gagal membuat permohonan edit');
            const saved = await updateLead({
              id: internalLead.id,
              dateInput: formData.dateInput,
              category: finalCategory,
              actionPlan: formData.actionPlan
            });
            if (!saved.success) throw new Error(saved.error ?? 'Gagal menyimpan lead');
            toast.info("Permohonan edit terkirim ke Admin");
          } else {
            const saved = await updateLead({
              id: internalLead.id,
              dateInput: formData.dateInput,
              category: finalCategory,
              brandName: formData.brandName,
              contact: formData.contact,
              leadSource: finalSource,
              email: formData.email,
              actionPlan: formData.actionPlan,
              productOffered: productOffered as string[],
              dealValue: Number(formData.dealValue || 0),
            });
            if (!saved.success) throw new Error(saved.error ?? 'Gagal menyimpan lead');
            toast.success("Lead diperbarui");
          }
        } else {
          const changes = [];
          if (internalLead.brandName !== formData.brandName) changes.push(`Brand: ${internalLead.brandName} -> ${formData.brandName}`);
          if (internalLead.contact !== formData.contact) changes.push(`WA: ${internalLead.contact} -> ${formData.contact}`);
          if (internalLead.category !== finalCategory) changes.push(`Kategori: ${internalLead.category} -> ${finalCategory}`);
          if (internalLead.dateInput !== formData.dateInput) changes.push(`Tgl: ${internalLead.dateInput} -> ${formData.dateInput}`);

          if (changes.length > 0) {
            const note = await createNote({
              leadId: internalLead.id,
              text: `[SYSTEM] Data diperbarui oleh ${user.name}. ${changes.join(', ')}`,
              noteType: 'note',
              authorName: 'System',
            });
            if (!note.success) throw new Error(note.error ?? 'Gagal mencatat perubahan');
          }

          const saved = await updateLead({
            id: internalLead.id,
            dateInput: formData.dateInput,
            category: finalCategory,
            brandName: formData.brandName,
            contact: formData.contact,
            leadSource: finalSource,
            email: formData.email,
            actionPlan: formData.actionPlan,
            productOffered: productOffered as string[],
            dealValue: Number(formData.dealValue || 0),
          });
          if (!saved.success) throw new Error(saved.error ?? 'Gagal menyimpan lead');

          // --- Sync with OI Forecast ---
          const lastWin = (internalLead.funnelHistory || [])
            .filter((h: FunnelHistoryDTO) => h.stage === 'Close Win')
            .pop();
          await syncForecasts({
            leadId: internalLead.id,
            leadStatus: internalLead.status,
            campaignNumber: Number(lastWin?.campaignNumber || 1),
            products: productOffered,
            dealValue: Number(formData.dealValue || 0),
          });

          // Register new category to global list if needed
          if (formData.category === 'Tambah Baru' && formData.customCategory.trim()) {
            await refreshCategories();
          }
          toast.success("Lead diperbarui");
        }
      } else {
        const searchName = formData.brandName.trim().toLowerCase();
        const existingData = leads.find(l => l.brandName?.trim().toLowerCase() === searchName);

        if (existingData) {
          if (existingData.contact === formData.contact) {
            setLoading(false);
            toast.error("Data lead ini sudah pernah diinput sebelumnya (Brand & WA Sama)!");
            return;
          } else {
            setLoading(false);
            setDuplicateConfirm({ isOpen: true, existingLead: existingData });
            return;
          }
        }

        const created = await createLead({
          dateInput: formData.dateInput,
          category: finalCategory,
          brandName: formData.brandName,
          contact: formData.contact,
          leadSource: finalSource,
          email: formData.email,
          productOffered: productOffered as string[],
          actionPlan: formData.actionPlan,
          picName: assignedPic || undefined,
          dealValue: Number(formData.dealValue || 0),
        });
        if (!created.success || !created.id) throw new Error(created.error ?? 'Gagal menyimpan lead');

        const newLeadId = created.id;
        let finalStatus = 'Leads';

        // createLead seeds the opening "Leads" entry on the session user. When an
        // admin assigned a PIC we add the assignment on top so the KPI keeps
        // following that PIC.
        if (assignedPic) {
          const assigned = await addFunnelHistory({
            leadId: newLeadId,
            stage: 'Leads',
            dateOccurred: formData.dateInput,
            byUserName: assignedPic,
            assignedBy: user.name,
            note: 'Initial Input',
          });
          if (!assigned.success) throw new Error(assigned.error ?? 'Gagal mencatat funnel');
        }

        const steps: Array<{ stage: 'Chated' | 'Responsed' | 'Set Meeting' | 'Close Win'; date: string }> = [];
        if (formData.dateChated) {
          finalStatus = 'Chated';
          steps.push({ stage: 'Chated', date: formData.dateChated });
        }
        if (formData.dateResponsed) {
          finalStatus = 'Responsed';
          steps.push({ stage: 'Responsed', date: formData.dateResponsed });
        }
        if (formData.dateSetMeeting) {
          finalStatus = 'Set Meeting';
          steps.push({ stage: 'Set Meeting', date: formData.dateSetMeeting });
        }
        if (formData.dateClosed) {
          finalStatus = 'Close Win';
          steps.push({ stage: 'Close Win', date: formData.dateClosed });
        }

        for (const step of steps) {
          const recorded = await addFunnelHistory({
            leadId: newLeadId,
            stage: step.stage,
            dateOccurred: step.date,
            byUserName: user.name,
            dealValue: step.stage === 'Close Win' ? Number(formData.dealValue || 0) : null,
            campaignNumber: step.stage === 'Close Win' ? Number(formData.campaignNumber || 1) : null,
          });
          if (!recorded.success) throw new Error(recorded.error ?? 'Gagal mencatat funnel');
        }

        const note = await createNote({
          leadId: newLeadId,
          text: `Lead dibuat oleh ${user.name}`,
          noteType: 'note',
          authorName: 'System',
        });
        if (!note.success) throw new Error(note.error ?? 'Gagal membuat catatan');

        // Register new category to global list if needed
        if (formData.category === 'Tambah Baru' && formData.customCategory.trim()) {
          await refreshCategories();
        }

        // --- Sync with OI Forecast ---
        await syncForecasts({
          leadId: newLeadId,
          leadStatus: finalStatus,
          campaignNumber: Number(formData.campaignNumber || 1),
          products: productOffered,
          dealValue: Number(formData.dealValue || 0),
        });

        toast.success("Lead baru ditambahkan");
      }
      onClose();
    } catch (error: any) {
      toast.error("Gagal menyimpan: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicateConfirm = async (existingLead: LeadDTO) => {
    setDuplicateConfirm(null);
    setLoading(true);
    try {

      const changes = [`WA: ${existingLead.contact} -> ${formData.contact}`];
      const note = await createNote({
        leadId: existingLead.id,
        text: `[SYSTEM] Data kontak diperbarui oleh ${user.name} saat mencoba tambah lead baru. ${changes.join(', ')}`,
        noteType: 'note',
        authorName: 'System',
      });
      if (!note.success) throw new Error(note.error ?? 'Gagal membuat catatan');
      const saved = await updateLead({
        id: existingLead.id,
        contact: formData.contact,
      });
      if (!saved.success) throw new Error(saved.error ?? 'Gagal memperbarui kontak');
      toast.success("Nomor kontak pada lead lama berhasil diupdate!");
      onClose();
    } catch (error: any) {
      toast.error("Gagal update data ganda: " + error.message);
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
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="font-black text-lg text-gray-800 tracking-tight">
                {internalLead ? 'Edit Lead' : 'Tambah Lead Baru'}
              </h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-red-500 transition bg-white w-8 h-8 rounded-full shadow-sm flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <form id="form-lead" onSubmit={handleSubmit}>
                <div className="grid grid-cols-2 gap-5 mb-5">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Tgl Input Data *</label>
                    <input
                      type="date"
                      name="dateInput"
                      value={formData.dateInput}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium ${errors.dateInput ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                      required
                    />
                    {errors.dateInput && <p className="text-[10px] text-red-500 mt-1 font-bold">{errors.dateInput}</p>}
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Kategori Brand *</label>
                    <select
                      name="category"
                      value={formData.category}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium ${errors.category ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                      required
                    >
                      <option value="">-- Pilih Kategori --</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      <option value="Tambah Baru" className="font-bold text-indigo-600">+ Tambah Baru</option>
                    </select>
                    {formData.category === 'Tambah Baru' && (
                      <input
                        type="text"
                        name="customCategory"
                        value={formData.customCategory}
                        onChange={handleInputChange}
                        className={`w-full px-3 py-2 mt-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium ${errors.customCategory ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                        placeholder="Ketik kategori baru..."
                        required
                      />
                    )}
                    {errors.category && <p className="text-[10px] text-red-500 mt-1 font-bold">{errors.category}</p>}
                    {errors.customCategory && <p className="text-[10px] text-red-500 mt-1 font-bold">{errors.customCategory}</p>}
                  </div>
                </div>

                <div className="mb-5 p-4 bg-yellow-50/50 border border-yellow-100 rounded-xl">
                  <div className="mb-4">
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nama Brand *</label>
                    <input
                      type="text"
                      name="brandName"
                      value={formData.brandName}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-bold text-gray-800 ${errors.brandName ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                      required
                    />
                    {errors.brandName && <p className="text-[10px] text-red-500 mt-1 font-bold">{errors.brandName}</p>}

                    {smartMatch && !internalLead && (
                      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg flex flex-col gap-2 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-start gap-2">
                          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[11px] font-black text-blue-900 leading-snug">Brand ini sudah ada di database!</p>
                            <p className="text-[10px] font-bold text-blue-700 mt-1">
                              {(() => {
                                const picName = smartMatch.picName || "PIC lain";
                                const isSystem = picName.toLowerCase().includes('sistem') || picName.toLowerCase().includes('system') || (smartMatch.leadSource || '').toLowerCase().includes('sistem');

                                if (smartMatch.status === 'Leads') {
                                  if (!isSystem) {
                                    return `Leads ini sudah milik ${picName}. Silakan ubah ke funnel yang lainnya dan sampaikan ke ${picName} untuk memberi tahu kalau leads ini sudah ada yang handle.`;
                                  } else {
                                    return `Leads ini diinput oleh Sistem dan masih berstatus "Leads". Anda dapat mengambil alih leads ini.`;
                                  }
                                } else {
                                  return `Brand ini sudah ada di database dan sedang dikelola oleh ${picName} (Tahap: ${smartMatch.status}). Karena sudah bukan "Leads", Anda bisa menambahkan funnel baru jika diperlukan.`;
                                }
                              })()}
                            </p>
                            <p className="text-[9px] font-medium text-blue-600 mt-1 opacity-80">
                              {(() => {
                                const history = smartMatch.funnelHistory || [];
                                const lastHistory = history[history.length - 1];
                                if (lastHistory) {
                                  return `(Status Terakhir: ${lastHistory.stage} oleh ${lastHistory.byUserName} pada ${lastHistory.dateOccurred})`;
                                }
                                return '';
                              })()}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleLoadSmartMatch}
                          className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black rounded uppercase tracking-widest transition-colors shadow-sm"
                        >
                          Muat Data & Beralih ke Mode Edit
                        </button>
                      </div>
                    )}
                  </div>

                  {!internalLead && (user.role === 'admin' || user.role === 'lord') && (
                    <div className="mb-4 p-4 bg-purple-50 rounded-xl border border-purple-100">
                      <label className="block text-[11px] font-bold text-purple-900 uppercase tracking-wider mb-2">
                        Assign PIC (Opsional)
                      </label>
                      <select
                        value={assignedPic}
                        onChange={(e) => setAssignedPic(e.target.value)}
                        className="w-full px-3 py-2 border border-purple-200 bg-white rounded-lg focus:ring-2 focus:ring-purple-500 font-bold text-purple-900"
                      >
                        <option value="">-- Assign ke Saya ({user.name}) --</option>
                        {users.filter((u: any) => u.role !== 'pending' && u.name !== user.name).map((u: any) => (
                          <option key={u.id || u.uid} value={u.name}>{u.name} ({u.role})</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-purple-600 mt-1.5 font-medium leading-tight">
                        Jika dipilih, funnel Leads pertama akan langsung tercatat atas nama PIC ini.
                      </p>
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Sumber Lead / Online Shop</label>
                    <select
                      name="leadSource"
                      value={formData.leadSource}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-medium"
                    >
                      <option value="">-- Pilih Sumber (Opsional) --</option>
                      {LEAD_SOURCES.filter(s => s !== 'Lainnya').map(src => (
                        <option key={src} value={src}>{src}</option>
                      ))}
                      <option value="Tambah Baru" className="font-bold text-indigo-600">+ Tambah Baru</option>
                    </select>
                    {formData.leadSource === 'Tambah Baru' && (
                      <input
                        type="text"
                        name="customSource"
                        value={formData.customSource}
                        onChange={handleInputChange}
                        className={`w-full px-3 py-2 mt-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium ${errors.customSource ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                        placeholder="Ketik sumber baru..."
                        required
                      />
                    )}
                    {errors.customSource && <p className="text-[10px] text-red-500 mt-1 font-bold">{errors.customSource}</p>}
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">No. WA / Kontak *</label>
                    <input
                      type="text"
                      name="contact"
                      value={formData.contact}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium ${errors.contact ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                      required
                      placeholder="Contoh: 08123456789"
                    />
                    {errors.contact && <p className="text-[10px] text-red-500 mt-1 font-bold">{errors.contact}</p>}
                  </div>
                  {internalLead && user.role === 'staff' && (
                    <p className="text-[10px] text-yellow-600 mt-2 font-semibold flex items-center gap-1">
                      <Info className="w-3 h-3" /> Perubahan pada Brand/WA akan dikirim sebagai Permohonan ke Admin.
                    </p>
                  )}
                </div>

                {/* Email Field */}
                <div className="mb-5">
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Email (Opsional)</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium"
                    placeholder="Contoh: brand@email.com"
                  />
                </div>

                {!internalLead ? (
                  <div className="mb-5 p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                    <h4 className="text-[11px] font-black text-indigo-800 uppercase tracking-widest mb-3 border-b border-indigo-100 pb-2">Jejak Funnel (Opsional)</h4>
                    <p className="text-[9px] font-bold text-slate-500 mb-4 leading-relaxed">
                      Jika Anda langsung menginput data yang sudah di follow-up sebelumnya, silakan isi tanggal-tanggal di bawah secara berurutan.
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Tgl Chated</label>
                        <input
                          type="date"
                          name="dateChated"
                          value={formData.dateChated}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Tgl Responsed</label>
                        <input
                          type="date"
                          name="dateResponsed"
                          value={formData.dateResponsed}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Tgl Set Meeting</label>
                        <input
                          type="date"
                          name="dateSetMeeting"
                          value={formData.dateSetMeeting}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Tgl Close Win</label>
                        <input
                          type="date"
                          name="dateClosed"
                          value={formData.dateClosed}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                        />
                      </div>
                    </div>

                    {formData.dateClosed && (
                      <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex flex-col gap-3">
                        {(() => {
                          const previousWins = ((internalLead as LeadDTO | null)?.funnelHistory ?? []).filter((h: FunnelHistoryDTO) => h.stage === 'Close Win');
                          if (previousWins.length === 0) return null;
                          return (
                            <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg shadow-sm">
                              <p className="text-[10px] font-black text-indigo-800 uppercase tracking-wider mb-2 border-b border-indigo-200 pb-1">
                                Histori Close Win Sebelumnya
                              </p>
                              <ul className="space-y-1.5">
                                {previousWins.map((w: FunnelHistoryDTO, i: number) => (
                                  <li key={i} className="text-[11px] font-bold text-indigo-700 flex justify-between items-center">
                                    <span>Campaign Ke-{w.campaignNumber || 1}</span>
                                    <span className="bg-white px-2 py-0.5 rounded border border-indigo-100">{w.dateOccurred}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })()}
                        <div>
                          <label className="block text-[10px] font-black text-emerald-700 uppercase tracking-wider mb-1">Nominal Closing (Rp) *</label>
                          <CurrencyInput
                            value={formData.dealValue}
                            onChange={(val) => setFormData(prev => ({ ...prev, dealValue: val }))}
                            className="w-full px-3 py-2 border border-emerald-200 rounded-lg focus:ring-2 focus:ring-emerald-500 font-black text-emerald-800 outline-none"
                          />
                          <p className="text-[9px] text-emerald-600 mt-1 font-bold italic">Nominal ini akan ditambahkan ke total pencapaian (Achievement) Target Anda bulan ini.</p>
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-emerald-700 uppercase tracking-wider mb-1">Campaign Keberapa? *</label>
                          <input
                            type="number"
                            name="campaignNumber"
                            value={formData.campaignNumber}
                            onChange={handleInputChange}
                            min="1"
                            className="w-full px-3 py-2 border border-emerald-200 rounded-lg focus:ring-2 focus:ring-emerald-500 font-black text-emerald-800 outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <h4 className="text-[11px] font-black text-amber-800 uppercase tracking-widest mb-2 flex items-center gap-1">
                      <Info className="w-3.5 h-3.5" /> Informasi Mode Edit
                    </h4>
                    <p className="text-[10px] font-bold text-amber-700 leading-relaxed">
                      Untuk menambah atau memperbarui Status dan Jejak Funnel (seperti mencatat Close Win baru), silakan simpan data utama ini terlebih dahulu, lalu gunakan tombol <span className="font-black bg-amber-200 px-1 rounded shadow-sm">Update Status</span> di Halaman Detail Lead.
                    </p>
                  </div>
                )}

                {/* Product Offered Multi-Select */}
                <div className="mb-5">
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Produk Ditawarkan</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setProductOffered(prev => prev.includes('TNT') ? prev.filter(p => p !== 'TNT') : [...prev, 'TNT'])}
                      className={cn(
                        "flex-1 px-4 py-2.5 rounded-xl font-bold text-sm border-2 transition-all active:scale-95",
                        productOffered.includes('TNT')
                          ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-200"
                          : "bg-white text-slate-500 border-slate-200 hover:border-blue-300"
                      )}
                    >
                      TNT
                    </button>
                    <button
                      type="button"
                      onClick={() => setProductOffered(prev => (prev.includes('MCN') || prev.includes('Basemen' as any)) ? prev.filter(p => p !== 'MCN' && (p as any) !== 'Basemen') : [...prev, 'MCN'])}
                      className={cn(
                        "flex-1 px-4 py-2.5 rounded-xl font-bold text-sm border-2 transition-all active:scale-95",
                        productOffered.includes('MCN') || productOffered.includes('Basemen' as any)
                          ? "bg-slate-800 text-white border-slate-800 shadow-lg shadow-slate-200"
                          : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                      )}
                    >
                      MCN
                    </button>
                    <button
                      type="button"
                      onClick={() => setProductOffered(prev => prev.includes('HYPE') ? prev.filter(p => p !== 'HYPE') : [...prev, 'HYPE'])}
                      className={cn(
                        "flex-1 px-4 py-2.5 rounded-xl font-bold text-sm border-2 transition-all active:scale-95",
                        productOffered.includes('HYPE')
                          ? "bg-amber-400 text-white border-amber-400 shadow-lg shadow-amber-200"
                          : "bg-white text-slate-500 border-slate-200 hover:border-amber-300"
                      )}
                    >
                      HYPE
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Action Plan Utama</label>
                  <textarea
                    name="actionPlan"
                    value={formData.actionPlan}
                    onChange={handleInputChange}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    placeholder="Contoh: Akan hubungi kembali minggu depan..."
                  ></textarea>
                </div>

                {internalLead && internalLead.status === 'Close Win' && (user.role === 'admin' || user.role === 'lord') && (
                  <div className="mt-5 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Estimasi Deal Value (Rp)</label>
                      <CurrencyInput
                        value={formData.dealValue || 0}
                        onChange={(val) => setFormData(prev => ({ ...prev, dealValue: val }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </form>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 border border-gray-300 rounded-xl text-gray-600 font-bold hover:bg-gray-100 transition"
              >
                Batal
              </button>
              <button
                type="submit"
                form="form-lead"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition shadow-md shadow-blue-200 disabled:opacity-50"
              >
                {loading ? 'Menyimpan...' : (internalLead ? 'Update Data' : 'Simpan Data')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      <ConfirmModal
        isOpen={!!duplicateConfirm}
        onClose={() => setDuplicateConfirm(null)}
        onConfirm={() => handleDuplicateConfirm(duplicateConfirm!.existingLead)}
        title="Peringatan Duplikasi Data"
        message={`Brand ini sudah ada di sistem dengan nomor WA: ${duplicateConfirm?.existingLead.contact}. Apakah Anda ingin menimpa nomor WA tersebut menjadi ${formData.contact} dan mencatatnya ke histori?`}
      />
    </AnimatePresence>
  );
}
