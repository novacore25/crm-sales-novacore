"use client";
import React, { useCallback, useEffect, useState } from 'react';
import Papa from 'papaparse';
import { X, Upload, Info, Loader2, Check, FileSpreadsheet, Database, AlertCircle, Plus, Edit3, Calendar, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { LeadDTO, UserProfile, InterestLevel } from '../types';
import { FALLBACK_CATEGORIES } from '../types';
import {
  getLeadsPage,
  getCategories,
  importLeads,
  updateLead,
  editFunnelHistory,
} from '@/app/actions/lead-actions';
import type { FunnelHistoryDTO } from '@/types';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import ConfirmModal from './ConfirmModal';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  users?: UserProfile[];
}

const STAGES = ["Leads", "Chated", "Responsed", "Set Meeting", "Hold", "Close Win", "Close Lost", "Failed"];
const REP_NAMES = ["fidal", "jeff", "alvin", "rayhan"];

/** Shape accepted by the `importLeads` server action. */
interface ImportRow {
  dateInput: string;
  category: string;
  brandName: string;
  contact: string;
  leadSource: string;
  email: string;
  interestLevel: InterestLevel;
  productOffered: string[];
  actionPlan: string;
  picName?: string;
  dealValue: number;
}

/** A single funnel stamp, either already on the lead or read from this CSV row. */
interface StageStamp {
  stage: string;
  date: string;
  by: string;
}

const PAGE_SIZE = 200;

export default function ImportModalClient({ isOpen, onClose, users = [] }: ImportModalProps) {
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

  const staffUsers = users.filter(u => u.role === 'staff' || u.role === 'admin');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [importMode, setImportMode] = useState<'legacy' | 'individu' | 'legacy-v2' | 'basic'>('basic');
  const [importPIC, setImportPIC] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Siap mengolah data...');
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [step, setStep] = useState<'setup' | 'confirm' | 'compare' | 'error' | 'result'>('setup');
  const [validationErrors, setValidationErrors] = useState<{ row: number; brand: string; reason: string }[]>([]);
  const [analysisResult, setAnalysisResult] = useState<{
    batchData: ImportRow[];
    comparisons: { brandName: string; oldHistory: string[]; addedHistory: string[] }[];
    newCount: number;
    updatedCount: number;
    duplicatesList: string[];
    dateStats: Record<string, number>;
    futureDates: string[];
  } | null>(null);
  const [importResult, setImportResult] = useState<{new: number, updated: number, duplicates: string[]} | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [mappings, setMappings] = useState<Record<string, string | null>>({});
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [dateFallbackFormat, setDateFallbackFormat] = useState<'DD/MM' | 'MM/DD'>('MM/DD');
  const [isFixingDates, setIsFixingDates] = useState(false);
  const [showDateFixer, setShowDateFixer] = useState(false);
  const [dateFixerTarget, setDateFixerTarget] = useState('');
  const [dateFixerReplacement, setDateFixerReplacement] = useState('');
  const [globalProducts, setGlobalProducts] = useState<string[]>([]);

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmConfig({ isOpen: true, title, message, onConfirm });
  };

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
    setPreviewData(null);
    setErrors(prev => ({ ...prev, file: selectedFile ? '' : 'File CSV harus dipilih' }));
    if (selectedFile) {
      parsePreview(selectedFile);
    }
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setCategory(val);
    if (val !== 'Tambah Baru') {
      setCustomCategory('');
    }
    setErrors(prev => ({ ...prev, category: val ? '' : 'Kategori harus dipilih' }));
  };

  const parsePreview = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setErrors(prev => ({ ...prev, file: 'File harus berformat .csv' }));
      return;
    }

    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const lines = results.data as string[][];
          if (lines.length < 2) return;

          const headers = lines[0].map(h => h ? h.toString().trim() : '');
          const headersLower = headers.map(h => h.toLowerCase());
          setCsvHeaders(headers);

          // Detect Mappings
          const newMappings: Record<string, string | null> = {};
          const findHeader = (exactMatches: string[], fuzzyKeywords: string[]) => {
            for (const exact of exactMatches) {
               const idx = headersLower.indexOf(exact.toLowerCase());
               if (idx > -1) return headers[idx];
            }
            const idx = headersLower.findIndex(h => fuzzyKeywords.some(k => h.includes(k)));
            return idx > -1 ? headers[idx] : null;
          };

          newMappings['Date'] = findHeader(['Tanggal Pengisian', 'Date'], ['date', 'tanggal', 'tgl']);
          newMappings['Brand Name'] = findHeader(['Nama Brand', 'Seller', 'Seller Name', 'Brand Name'], ['seller', 'brand', 'nama']);
          newMappings['Contact'] = findHeader(['No. WA', 'Phone Number', 'Contact'], ['phone', 'wa', 'kontak', 'hub']);
          newMappings['Email'] = findHeader(['Email', 'E-mail'], ['email', 'e-mail']);
          newMappings['Product'] = findHeader(['Product Offered', 'Product', 'Produk'], ['product', 'produk', 'package']);
          newMappings['Lead Source'] = findHeader(['Sumber Lead', 'Lead Source', 'Online Shop'], ['sumber', 'toko', 'source']);

          if (importMode === 'basic') {
            newMappings['Category'] = findHeader(['Kategori', 'Category', 'Kategory'], ['kategori', 'category']);
          } else if (importMode === 'individu') {
            newMappings[`Status`] = findHeader(['Keterangan Follow Up Pagi (Status)', 'Status'], ['status']);
            newMappings[`Interest`] = findHeader(['Interest'], ['minat', 'interest']);
            newMappings[`Chated`] = findHeader(['Tgl Chated', 'Chated'], ['chated', 'chat']);
            newMappings[`Responsed`] = findHeader(['Tgl Responsed', 'Responsed'], ['responsed', 'respon']);
            newMappings[`Meeting`] = findHeader(['Tgl Set Meeting', 'Meeting'], ['meeting', 'meet']);
            newMappings[`Closing`] = findHeader(['Tgl Closing', 'Closing'], ['closing', 'close', 'win']);
            newMappings[`Notes`] = findHeader(['Notes'], ['catatan', 'notes']);
            newMappings[`Action Plan`] = findHeader(['Action Plan'], ['action plan', 'action', 'next']);
          } else if (importMode === 'legacy-v2') {
            newMappings['Category'] = findHeader(['Kategori Brand', 'Brand Category', 'Kategori', 'Category'], ['kategori', 'category']);
            ['fidal', 'jeff'].forEach(rep => {
              const Rep = rep.charAt(0).toUpperCase() + rep.slice(1);
              newMappings[`${Rep} - Chated`] = findHeader([`Tgl Chated TNT (${rep})`, `${Rep} - Chated`], ['chated', rep]);
              newMappings[`${Rep} - Responsed`] = findHeader([`Tgl Responsed INT (${rep})`, `Tgl Responsed TNT (${rep})`, `${Rep} - Responsed`], ['responsed', rep]);
              newMappings[`${Rep} - Meeting`] = findHeader([`Tgl Meeting INT (${rep})`, `Tgl Meeting TNT (${rep})`, `${Rep} - Set Meeting`], ['meeting', rep]);
              newMappings[`${Rep} - Closing`] = findHeader([`Tgl Closing TNT (${rep})`, `${Rep} - Closing`], ['closing', rep]);
              newMappings[`${Rep} - Notes`] = findHeader([`NOTES TNT (${rep})`, `${Rep} - Notes`], ['notes', rep]);
              newMappings[`${Rep} - Status`] = findHeader([`STATUS TNT (${rep})`, `PROGRES STATUS (${rep})`, `SUMBER-TNT (${rep})`, `SUMBER TNT (${rep})`, `${Rep} - Status`], ['status', 'sumber', rep]);
              newMappings[`${Rep} - Interest`] = findHeader([`MINAT TNT (${rep})`, `Interest (${rep})`, `${Rep} - Interest`], ['minat', 'interest', rep]);
              newMappings[`${Rep} - Action Plan`] = findHeader([`NEXT ACTION PLAN TNT (${rep})`, `NEXT ACTION PLAN (${rep})`, `Action Plan (${rep})`, `${Rep} - Action Plan`], ['action plan', 'next action', rep]);
            });
          } else {
            REP_NAMES.forEach(rep => {
              const Rep = rep.charAt(0).toUpperCase() + rep.slice(1);
              newMappings[`${rep} - Chated`] = findHeader([`Tgl Chated TNT (${rep})`, `${Rep} - Chated`], ['chated', rep]);
              newMappings[`${rep} - Responsed`] = findHeader([`Tgl Responsed TNT (${rep})`, `${Rep} - Responsed`], ['responsed', rep]);
              newMappings[`${rep} - Meeting`] = findHeader([`Tgl Meeting TNT (${rep})`, `${Rep} - Set Meeting`], ['meeting', rep]);
              newMappings[`${rep} - Closing`] = findHeader([`Tgl Closing TNT (${rep})`, `${Rep} - Closing`], ['closing', rep]);
              newMappings[`${rep} - Notes`] = findHeader([`NOTES TNT (${rep})`, `${Rep} - Notes`], ['notes', rep]);
              newMappings[`${rep} - Status`] = findHeader([`SUMBER-TNT (${rep})`, `SUMBER TNT (${rep})`, `${Rep} - Status`], ['sumber', 'status', rep]);
              newMappings[`${rep} - Interest`] = findHeader([`Interest (${rep})`, `${Rep} - Interest`], ['minat', 'interest', rep]);
              newMappings[`${rep} - Action Plan`] = findHeader([`Action Plan (${rep})`, `${Rep} - Action Plan`], ['action plan', 'next action', rep]);
            });
          }

          setMappings(newMappings);

          const validRows: string[][] = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].map(c => c ? c.toString().trim() : '');
            if (cols.some(c => c !== '')) {
              validRows.push(cols);
            }
          }
          setPreviewData(validRows);
          setStatus(`Sistem siap memproses ${validRows.length} baris data sesuai mapping yang Anda pilih.`);
        } catch (err) {
          console.error(err);
        }
      },
      error: (err: any) => {
        toast.error("Gagal membaca file CSV: " + err.message);
      }
    });
  };

  /**
   * Load every existing lead (including trashed ones) so the dedupe pass in
   * `analyzeData` compares the CSV against the real database instead of an
   * optimistic in-memory guess. Paged reads keep the payload bounded.
   */
  const loadAllLeads = async (): Promise<LeadDTO[]> => {
    const collected: LeadDTO[] = [];
    let page = 0;
    for (;;) {
      const result = await getLeadsPage({ page, pageSize: PAGE_SIZE, includeDeleted: true });
      collected.push(...result.leads);
      if (collected.length >= result.total || result.leads.length === 0) break;
      page += 1;
    }
    return collected;
  };

  const analyzeData = async () => {
    if (!file || !previewData) {
      toast.error("File CSV harus dipilih!");
      setStep('setup');
      return;
    }
    if (importMode !== 'legacy-v2' && importMode !== 'basic' && !category) {
      toast.error("Pilih kategori terlebih dahulu di langkah 1!");
      setStep('setup');
      return;
    }
    if (category === 'Tambah Baru' && !customCategory.trim()) {
      toast.error("Silakan isi kategori baru!");
      setStep('setup');
      return;
    }
    if (importMode === 'individu' && !importPIC) {
      toast.error("Pilih nama PIC (Sales) terlebih dahulu di langkah 1!");
      setStep('setup');
      return;
    }

    setLoading(true);
    setStatus("Menganalisa data untuk mencegah duplikasi masal...");

    try {
      const existingLeads = await loadAllLeads();

      const iDate = csvHeaders.indexOf(mappings['Date'] || '');
      const iBrand = csvHeaders.indexOf(mappings['Brand Name'] || '');
      const iPhone = csvHeaders.indexOf(mappings['Contact'] || '');
      const iCategoryV2 = (importMode === 'legacy-v2' || importMode === 'basic') ? csvHeaders.indexOf(mappings['Category'] || '') : -1;

      const batchData: ImportRow[] = [];
      const comparisons: { brandName: string; oldHistory: string[]; addedHistory: string[] }[] = [];
      const newValidationErrors: { row: number; brand: string; reason: string }[] = [];
      let updatedCount = 0;
      let newCount = 0;
      const duplicatedList: string[] = [];
      const dateStats: Record<string, number> = {};
      const futureDates: string[] = [];
      const todayTime = new Date().setHours(23, 59, 59, 999);

      for (let rowIndex = 0; rowIndex < previewData.length; rowIndex++) {
        const cols = previewData[rowIndex];
        const rowNum = rowIndex + 2;

        const brandNameRaw = iBrand > -1 && cols[iBrand] ? cols[iBrand].trim() : '';
        if (!brandNameRaw || brandNameRaw === '') {
           newValidationErrors.push({ row: rowNum, brand: "KOSONG", reason: "Nama Brand wajib diisi" });
           continue;
        }
        const brandName = brandNameRaw;
        let contact = (iPhone > -1 && cols[iPhone]) ? cols[iPhone] : '-';
        if (!contact || contact === '') contact = '-';

        const iEmail = csvHeaders.indexOf(mappings['Email'] || '');
        const email = (iEmail > -1 && cols[iEmail]) ? cols[iEmail].trim() : '';

        const iProduct = csvHeaders.indexOf(mappings['Product'] || '');
        let productOffered: string[] = [];
        if (iProduct > -1 && cols[iProduct]) {
          const pVal = cols[iProduct].toUpperCase();
          if (pVal.includes('TNT')) productOffered.push('TNT');
          if (pVal.includes('BASEMEN') || pVal.includes('MCN')) productOffered.push('MCN');
          if (pVal.includes('HYPE')) productOffered.push('HYPE');
        }

        // Fallback to global selected products if row doesn't have any
        if (productOffered.length === 0 && globalProducts.length > 0) {
          productOffered = [...globalProducts];
        }

        const dateInputRaw = (iDate > -1 && cols[iDate]) ? cols[iDate].trim() : '';
        const csvRowDates: {stage: string, date: string}[] = [];

        try {
          const dateInput = dateInputRaw ? parseDateStrict(dateInputRaw, rowNum, 'Date') : new Date().toISOString().split('T')[0];
          if (dateInputRaw) csvRowDates.push({stage: 'Input Data', date: dateInput});

          const iSource = csvHeaders.indexOf(mappings['Lead Source'] || '');
          const leadSource = (iSource > -1 && cols[iSource]) ? cols[iSource].trim() : '';

          const existing = existingLeads.find(l => (l.brandName || '').toLowerCase() === brandName.toLowerCase());
          const existingStamps: StageStamp[] = (existing?.funnelHistory ?? []).map(toStamp);

          // Seed the pipeline with what the lead already has, then append only the
          // stages this CSV row contributes.
          const stamps: StageStamp[] = existing
            ? [...existingStamps]
            : [{ stage: 'Input', date: dateInput, by: importMode === 'individu' ? importPIC : 'System Import' }];

          const rowCategory = (importMode === 'legacy-v2' || importMode === 'basic')
            ? ((iCategoryV2 > -1 && cols[iCategoryV2]) ? cols[iCategoryV2].trim() : 'Unknown Source')
            : (category === 'Tambah Baru' ? customCategory.trim() : category);

          let interestLevel: InterestLevel = '-';
          let actionPlan = '';

          const oldHistoryStrs = existingStamps.map(h => `${h.stage} oleh ${h.by} (${h.date})`);
          const addedHistoryStrs: string[] = [];

          let highestStageIdx = STAGES.indexOf(existing?.status || 'Leads');
          if (highestStageIdx === -1) highestStageIdx = 0;

          const processRepCols = (rep: string, prefix: string) => {
            const pChat = csvHeaders.indexOf(mappings[`${prefix}Chated`] || '');
            const pRes = csvHeaders.indexOf(mappings[`${prefix}Responsed`] || '');
            const pMeet = csvHeaders.indexOf(mappings[`${prefix}Meeting`] || '');
            const pClose = csvHeaders.indexOf(mappings[`${prefix}Closing`] || '');
            const pStatus = csvHeaders.indexOf(mappings[`${prefix}Status`] || '');
            const pMinat = csvHeaders.indexOf(mappings[`${prefix}Interest`] || '');
            const pAction = csvHeaders.indexOf(mappings[`${prefix}Action Plan`] || '');

            const repNameRaw = importMode === 'individu' ? rep : (rep.charAt(0).toUpperCase() + rep.slice(1));

            if (pMinat > -1 && cols[pMinat] && cols[pMinat] !== '-') {
              const val = cols[pMinat].toUpperCase();
              if (val === 'HOT' || val === 'WARM' || val === 'COLD') interestLevel = val;
            }

            if (pAction > -1 && cols[pAction] && cols[pAction] !== '-') actionPlan = cols[pAction];

            const pushStage = (stage: string, d: string, stageIdx: number) => {
              const isDuplicate = stamps.some(h => h.stage === stage && h.date === d && h.by === repNameRaw);
              if (isDuplicate) return;
              stamps.push({ stage, date: d, by: repNameRaw });
              highestStageIdx = Math.max(highestStageIdx, stageIdx);
              addedHistoryStrs.push(`${stage} oleh ${repNameRaw} (${d})`);
            };

            if (pChat > -1 && cols[pChat] && cols[pChat] !== '-') {
              const d = parseDateStrict(cols[pChat], rowNum, `${prefix}Chated`);
              csvRowDates.push({stage: 'Chated', date: d});
              pushStage('Chated', d, 1);
            }
            if (pRes > -1 && cols[pRes] && cols[pRes] !== '-') {
              const d = parseDateStrict(cols[pRes], rowNum, `${prefix}Responsed`);
              csvRowDates.push({stage: 'Responsed', date: d});
              pushStage('Responsed', d, 2);
            }
            if (pMeet > -1 && cols[pMeet] && cols[pMeet] !== '-') {
              const d = parseDateStrict(cols[pMeet], rowNum, `${prefix}Meeting`);
              csvRowDates.push({stage: 'Set Meeting', date: d});
              pushStage('Set Meeting', d, 3);
            }
            if (pClose > -1 && cols[pClose] && cols[pClose] !== '-') {
              const d = parseDateStrict(cols[pClose], rowNum, `${prefix}Closing`);
              csvRowDates.push({stage: 'Close Win', date: d});
              pushStage('Close Win', d, 4);
            }

            if (pStatus > -1 && cols[pStatus]) {
              const sVal = cols[pStatus].toUpperCase();
              if (sVal.includes('LOST')) highestStageIdx = 5;
              else if (sVal.includes('WIN')) highestStageIdx = 4;
              else if (sVal.includes('HOLD')) highestStageIdx = Math.max(highestStageIdx, STAGES.indexOf('Hold'));
            }
          };

          if (importMode === 'individu') {
            processRepCols(importPIC, '');
          } else if (importMode === 'legacy-v2') {
            // Reset highest stage internally so we can resolve winners cleanly
            highestStageIdx = 0;
            processRepCols('fidal', 'Fidal - ');
            processRepCols('jeff', 'Jeff - ');

            const parseTime = (dateStr: string) => {
              if (!dateStr) return 0;
              const t = new Date(dateStr).getTime();
              return isNaN(t) ? 0 : t;
            };

            const fidalHist = stamps.filter(h => h.by === 'Fidal');
            const jeffHist = stamps.filter(h => h.by === 'Jeff');

            let fMax = 0; let fStage = 0;
            fidalHist.forEach(h => {
              const t = parseTime(h.date);
              if (t > fMax) fMax = t;
              const sIdx = STAGES.indexOf(h.stage);
              if (sIdx > fStage) fStage = sIdx;
            });

            let jMax = 0; let jStage = 0;
            jeffHist.forEach(h => {
              const t = parseTime(h.date);
              if (t > jMax) jMax = t;
              const sIdx = STAGES.indexOf(h.stage);
              if (sIdx > jStage) jStage = sIdx;
            });

            // Resolution Logic
            if (fidalHist.length > 0 && jeffHist.length === 0) {
              highestStageIdx = fStage;
            } else if (fidalHist.length === 0 && jeffHist.length > 0) {
              highestStageIdx = jStage;
            } else if (fidalHist.length > 0 && jeffHist.length > 0) {
              if (fMax > jMax) {
                highestStageIdx = fStage;
              } else if (jMax > fMax || jMax > 0) {
                highestStageIdx = jStage;
              } else {
                // Both have history but no valid dates, default Jeff
                highestStageIdx = jStage;
              }
            }
          } else if (importMode === 'legacy') {
            REP_NAMES.forEach(rep => processRepCols(rep, `${rep} - `));
          }

          // Chronological Validation Check (HANYA CEK TANGGAL DARI CSV ROW INI)
          csvRowDates.sort((a, b) => {
             const iA = STAGES.indexOf(a.stage);
             const iB = STAGES.indexOf(b.stage);
             return (iA === -1 ? 0 : iA) - (iB === -1 ? 0 : iB);
          });

          let prevDate = 0;
          let prevStage = '';
          let rowHasChronologyError = false;
          for (const h of csvRowDates) {
             const dTime = new Date(h.date).getTime();
             if (dTime > 0) {
                const dStr = new Date(h.date).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'});
                const statKey = `${h.stage} di tanggal ${dStr}`;
                dateStats[statKey] = (dateStats[statKey] || 0) + 1;
                if (dTime > todayTime && !futureDates.includes(dStr)) {
                   futureDates.push(dStr);
                }

                if (prevDate > 0 && dTime < prevDate) {
                   newValidationErrors.push({
                     row: rowNum,
                     brand: brandName,
                     reason: `Tanggal ${h.stage} (${h.date}) mundur sebelum ${prevStage} (${new Date(prevDate).toISOString().split('T')[0]})`
                   });
                   rowHasChronologyError = true;
                }
                prevDate = dTime;
                prevStage = h.stage;
             }
          }
          if (rowHasChronologyError) continue;

          if (existing) {
            // A brand that already exists is reported as a duplicate and is not
            // re-inserted - importing it again would create a second lead row.
            updatedCount++;
            duplicatedList.push(existing.brandName);
            comparisons.push({
              brandName: existing.brandName,
              oldHistory: oldHistoryStrs,
              addedHistory: addedHistoryStrs
            });
          } else {
            newCount++;
            batchData.push({
              dateInput,
              category: rowCategory,
              brandName,
              contact,
              leadSource,
              email,
              interestLevel,
              productOffered,
              actionPlan,
              picName: importMode === 'individu' ? importPIC : undefined,
              dealValue: 0,
            });
          }

        } catch (err: any) {
           newValidationErrors.push({ row: rowNum, brand: brandName, reason: err.message });
           continue;
        }
      }

      if (newValidationErrors.length > 0) {
        setValidationErrors(newValidationErrors);
        setStatus(`Ditemukan ${newValidationErrors.length} baris dengan data/tanggal yang tidak valid.`);
        setStep('error');
        return;
      }

      if (newCount === 0) throw new Error("Tidak ada data valid untuk diimport");

      setAnalysisResult({
        batchData,
        comparisons,
        newCount,
        updatedCount,
        duplicatesList: duplicatedList,
        dateStats,
        futureDates
      });
      setStatus("Selesai menganalisa data. Silakan review perbandingan.");
      setStep('compare');

    } catch (error: any) {
      toast.error("Gagal analisa: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const commitData = async () => {
    if (!analysisResult) return;

    setLoading(true);
    setStatus("Menyimpan data ke database...");

    try {
      const { batchData, newCount, updatedCount, duplicatesList } = analysisResult;
      const chunkSize = 400;
      for (let i = 0; i < batchData.length; i += chunkSize) {
        const slice = batchData.slice(i, i + chunkSize);
        const done = Math.min(i + chunkSize, batchData.length);
        setStatus(`Menyimpan data ke database... (${done}/${batchData.length} baris)`);
        const result = await importLeads(slice);
        if (!result.success) throw new Error(result.error ?? 'Gagal menyimpan batch data');
      }

      setStatus(`Selesai! ${newCount} baru, ${updatedCount} diperbarui.`);
      setImportResult({ new: newCount, updated: updatedCount, duplicates: duplicatesList });

      // A brand-new category becomes real as soon as a lead uses it, so pull the
      // fresh list straight from the server.
      if (category === 'Tambah Baru' && customCategory.trim()) {
        await refreshCategories();
      }
      toast.success("Migrasi selesai diproses!");
      setStep('result');
    } catch (error: any) {
      toast.error("Gagal menyimpan data: " + error.message);
    } finally {
      setLoading(false);
      setStatus('Siap mengolah data...');
    }
  };

  const parseDateStrict = (str: string, rowNum: number, colName: string) => {
    if (!str || str === '-') return '';
    const dateOnly = str.split(' ')[0].trim();

    const match = dateOnly.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) {
        throw new Error(`Format tanggal salah ('${str}') pada baris ke-${rowNum} kolom '${colName}'. Wajib format DD/MM/YYYY atau DD-MM-YYYY (Tanggal-Bulan-Tahun).`);
    }

    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];

    const d = new Date(`${year}-${month}-${day}`);
    if (isNaN(d.getTime())) {
        throw new Error(`Tanggal tidak valid ('${str}') pada baris ke-${rowNum} kolom '${colName}'.`);
    }
    return `${year}-${month}-${day}`;
  };

  const executeDateReplace = async () => {
    if (!dateFixerTarget || !dateFixerReplacement) {
        toast.error("Tanggal salah dan tanggal baru harus diisi.");
        return;
    }
    showConfirm(
      "Find & Replace Tanggal",
      `Apakah Anda yakin ingin mengubah seluruh data tanggal "${dateFixerTarget}" menjadi "${dateFixerReplacement}" secara menyeluruh di semua profil?`,
      async () => {
        setIsFixingDates(true);
        setStatus(`Mengganti ${dateFixerTarget} menjadi ${dateFixerReplacement}...`);
        try {
          const allLeads = await loadAllLeads();
          let fixesCount = 0;

          const swapExactDate = (dateStr: string) => {
             if (!dateStr) return dateStr;
             return dateStr.replace(dateFixerTarget, dateFixerReplacement);
          };

          const DATE_FIELDS = ['dateInput', 'dateChated', 'dateResponsed', 'dateSetMeeting', 'dateClosed', 'dateFailed'] as const;

          for (const leadRow of allLeads) {
            let isModified = false;
            const patch: Record<string, string> = {};

            DATE_FIELDS.forEach(field => {
               const value = (leadRow as any)[field];
               if (value && typeof value === 'string' && value.includes(dateFixerTarget)) {
                  patch[field] = swapExactDate(value).slice(0, 10);
                  isModified = true;
               }
            });

            if (isModified) {
              fixesCount++;
              await updateLead({ id: leadRow.id, ...patch });
            }

            // Funnel entries carry their own copy of the date.
            for (const h of leadRow.funnelHistory ?? []) {
               const stamp = toStamp(h);
               if (!stamp.date.includes(dateFixerTarget)) continue;
               const nextDate = swapExactDate(stamp.date);
               const historyUpdate = await updateFunnelStamp(h, {
                 dateOccurred: nextDate,
               });
               if (historyUpdate) fixesCount++;
            }

            setStatus(`Mengganti ${dateFixerTarget} menjadi ${dateFixerReplacement}... (${fixesCount} diperbaiki)`);
          }

          toast.success(`Berhasil memulihkan ${fixesCount} baris data yang tanggalnya terbalik!`);
          setShowDateFixer(false);
          setDateFixerTarget('');
          setDateFixerReplacement('');
        } catch (err: any) {
             toast.error("Gagal memperbaiki database: " + err.message);
        } finally {
             setIsFixingDates(false);
             setStatus("Siap mengolah data...");
        }
      }
    );
  };

  const downloadTemplate = () => {
    let headers: string[] = [];
    let mockupRow: string[] = [];

    if (importMode === 'basic') {
      headers = [
        "Date", "Brand Name", "Contact", "Email", "Product", "Category", "Sumber Lead"
      ];
      mockupRow = [
        new Date().toISOString().split('T')[0], "Contoh Brand Store", "081234567890", "brand@email.com", "TNT", "Accessories", "Shopee"
      ];
    } else if (importMode === 'individu') {
      headers = [
        "Tanggal Pengisian", "No.", "Nama Brand", "No. WA", "Email", "Product Offered", "Sumber Lead", "Status", "Minat/Interest",
        "Tgl Chated", "Tgl Responsed", "Tgl Set Meeting", "Tgl Close Win", "Notes", "Action Plan"
      ];
      mockupRow = [
        new Date().toISOString().split('T')[0], "1", "Contoh Brand", "08123456789", "brand@email.com", "TNT", "Tokopedia",
        "Chated", "HOT", "2025-01-01", "", "", "", "Diskon 5%", "Follow up sore besok"
      ];
    } else if (importMode === 'legacy-v2') {
      headers = [
        "Date", "Brand Name", "Product", "Contact",
        ...['fidal', 'jeff'].flatMap(rep => [
          `SUMBER-TNT (${rep})`,
          `NOTES TNT (${rep})`,
          `STATUS TNT (${rep})`,
          `MINAT TNT (${rep})`,
          rep === 'fidal' ? `PROGRES STATUS (Fidal)` : `TEMPLATE CHAT TNT (Jeff)`,
          `NEXT ACTION PLAN TNT (${rep})`,
          `Tgl Chated TNT (${rep})`,
          `Tgl Responsed INT (${rep})`,
          `Tgl Meeting INT (${rep})`,
          `Tgl Closing TNT (${rep})`
        ]),
        "Kategoria Brand"
      ];
      mockupRow = [
        new Date().toISOString().split('T')[0],
        "Contoh Brand Store",
        "TNT",
        "081234567890",
        ...['fidal', 'jeff'].flatMap(() => ["", "", "", "", "", "", "", "", "", ""]),
        "Accessories"
      ];
    } else {
      headers = [
        "Date", "Brand Name", "Contact", "Email", "Product Offered",
        ...REP_NAMES.flatMap(rep => [
          `${rep.charAt(0).toUpperCase() + rep.slice(1)} - Chated`,
          `${rep.charAt(0).toUpperCase() + rep.slice(1)} - Responsed`,
          `${rep.charAt(0).toUpperCase() + rep.slice(1)} - Meeting`,
          `${rep.charAt(0).toUpperCase() + rep.slice(1)} - Closing`,
          `${rep.charAt(0).toUpperCase() + rep.slice(1)} - Status`,
          `${rep.charAt(0).toUpperCase() + rep.slice(1)} - Interest`,
          `${rep.charAt(0).toUpperCase() + rep.slice(1)} - Action Plan`,
          `${rep.charAt(0).toUpperCase() + rep.slice(1)} - Notes`
        ])
      ];

      mockupRow = [
        new Date().toISOString().split('T')[0],
        "Contoh Brand Store",
        "081234567890",
        "brand@email.com",
        "TNT",
        ...REP_NAMES.flatMap(() => ["", "", "", "", "", "", "", ""])
      ];
    }

    const csvContent = "data:text/csv;charset=utf-8,"
      + headers.join(",") + "\n"
      + mockupRow.join(",");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", importMode === 'individu' ? "Template_Individu_Leads_CRM.csv" : importMode === 'legacy-v2' ? "Template_Legacy_V2.csv" : "Master_Template_Leads_CRM.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-7xl h-[95vh] flex flex-col overflow-hidden border border-slate-100"
          >
            <div className="px-10 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
              <div className="flex flex-col">
                <h3 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <Upload className="w-5 h-5 text-white" />
                  </div>
                  Super Import Engine
                </h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1 ml-13">Automated Data Migration</p>
              </div>
              <div className="flex items-center gap-3">
                {step === 'setup' && (
                  <button
                    onClick={() => setShowDateFixer(!showDateFixer)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition text-xs shadow-sm",
                      showDateFixer ? "bg-slate-800 text-white" : "bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-100"
                    )}
                    title="Find & Replace Tanggal Masal"
                  >
                    <AlertCircle className="w-4 h-4" />
                    Find & Replace Tanggal
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-red-500 transition-all hover:rotate-90 bg-white w-10 h-10 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">
              <AnimatePresence>
                {showDateFixer && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-6 border-2 border-dashed border-rose-200 bg-rose-50/50 rounded-3xl space-y-4">
                      <div className="flex items-center gap-3 mb-2">
                        <AlertCircle className="w-5 h-5 text-rose-500" />
                        <div>
                          <h4 className="text-sm font-black text-slate-900 tracking-tight">Massal Find & Replace Tanggal</h4>
                          <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Ubah tanggal yang salah ketik / terbalik formatnya secara serentak.</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-rose-600 tracking-wider ml-1 mb-1 block">Tanggal Salah (Target)</label>
                          <input
                            type="date"
                            value={dateFixerTarget}
                            onChange={(e) => setDateFixerTarget(e.target.value)}
                            className="w-full px-4 py-3 border border-rose-200 bg-white rounded-xl focus:ring-2 focus:ring-rose-500 outline-none text-sm font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider ml-1 mb-1 block">Ubah Menjadi (Benar)</label>
                          <input
                            type="date"
                            value={dateFixerReplacement}
                            onChange={(e) => setDateFixerReplacement(e.target.value)}
                            className="w-full px-4 py-3 border border-emerald-200 bg-white rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm font-bold"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end pt-2">
                        <button
                          onClick={executeDateReplace}
                          disabled={isFixingDates || !dateFixerTarget || !dateFixerReplacement}
                          className="px-6 py-2.5 bg-rose-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-rose-700 shadow-md shadow-rose-200 disabled:opacity-50 flex items-center gap-2 transition-all"
                        >
                          {isFixingDates ? <Loader2 className="w-4 h-4 animate-spin" /> : "Eksekusi Ganti Otomatis"}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="bg-slate-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-xl">
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Processing Engine Status</h4>
                  </div>
                  <p className="text-lg font-bold leading-relaxed flex items-center gap-3">
                    <Info className="w-5 h-5 text-indigo-400" />
                    {status}
                  </p>
                </div>
                <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-indigo-600/20 rounded-full blur-3xl"></div>
              </div>

              <AnimatePresence mode="wait">
                {step === 'setup' ? (
                  <motion.div
                    key="setup"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-8"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                          1. Tipe Import
                        </label>
                        <select
                          value={importMode}
                          onChange={e => {
                            setImportMode(e.target.value as any);
                            setFile(null);
                            setPreviewData(null);
                            setMappings({});
                          }}
                          className="w-full px-5 py-4 bg-white border-2 border-slate-100 rounded-2xl text-sm font-bold text-slate-700 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all cursor-pointer"
                        >
                          <option value="basic">Standard Sync</option>
                          <option value="individu">Individu PIC</option>
                          <option value="legacy">Legacy Migration (Multi-PIC)</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                          2. Pilih PIC Sales
                        </label>
                        <select
                          value={importPIC}
                          onChange={e => setImportPIC(e.target.value)}
                          disabled={importMode === 'legacy'}
                          className="w-full px-5 py-4 bg-white border-2 border-slate-100 rounded-2xl text-sm font-bold text-slate-700 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all cursor-pointer disabled:opacity-50 disabled:bg-slate-50"
                        >
                          <option value="">Pilih Nama Sales</option>
                          {staffUsers.map(u => (
                            <option key={u.uid} value={u.name}>{u.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                          3. Pilih Kategori
                        </label>
                        <div className="relative group">
                          <Database className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                          <select
                            value={category}
                            onChange={handleCategoryChange}
                            disabled={importMode === 'legacy'}
                            className="w-full pl-12 pr-5 py-4 bg-white border-2 border-slate-100 rounded-2xl text-sm font-bold text-slate-700 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all cursor-pointer disabled:opacity-50"
                          >
                            <option value="">Select Database</option>
                            {CATEGORIES.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                            <option value="Tambah Baru" className="text-indigo-600 font-black">+ Tambah Baru</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* CUSTOM CATEGORY INPUT */}
                    <AnimatePresence>
                      {category === 'Tambah Baru' && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <input
                            type="text"
                            value={customCategory}
                            onChange={e => setCustomCategory(e.target.value)}
                            placeholder="Ketik nama kategori baru di sini..."
                            className="w-full px-6 py-4 bg-indigo-50 border-2 border-indigo-200 rounded-2xl text-sm font-black text-indigo-700 placeholder:text-indigo-300 focus:ring-4 focus:ring-indigo-100 transition-all"
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* GLOBAL PRODUCT SELECTION */}
                    <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 block text-center">
                        📦 Produk Yang Ditawarkan (Default jika tidak ada di CSV)
                      </label>
                      <div className="flex flex-wrap justify-center gap-3">
                        {['TNT', 'MCN', 'HYPE'].map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              setGlobalProducts(prev =>
                                prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                              );
                            }}
                            className={cn(
                              "px-6 py-3 rounded-xl text-[11px] font-black tracking-widest transition-all active:scale-95 border-2",
                              globalProducts.includes(p)
                                ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100"
                                : "bg-white border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-500"
                            )}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-amber-600 uppercase tracking-[0.2em] ml-2">Format Utama Tanggal</label>
                        <select
                          value={dateFallbackFormat}
                          onChange={(e) => setDateFallbackFormat(e.target.value as any)}
                          className="w-full px-4 py-4 bg-amber-50 border border-amber-200 rounded-2xl font-bold text-amber-800 focus:ring-2 focus:ring-amber-500 transition shadow-inner"
                        >
                          <option value="MM/DD">Bulan di awal (MM/DD/YYYY) - Format USA</option>
                          <option value="DD/MM">Tanggal di awal (DD/MM/YYYY) - Format ID</option>
                        </select>
                      </div>

                      <div className={cn("space-y-2", importMode === 'legacy' ? "md:col-span-1" : "md:col-span-1")}>
                        <div className="flex items-center justify-between px-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">4. Upload Folder CSV</label>
                          <button
                            type="button"
                            onClick={downloadTemplate}
                            className="text-[9px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100 hover:bg-indigo-100 hover:scale-105 active:scale-95 transition-all text-left"
                          >
                            Download Template CSV
                          </button>
                        </div>
                        <div className="relative group">
                          <input
                            type="file"
                            accept=".csv"
                            onChange={handleFileChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                          <div className={cn(
                            "px-6 py-4 bg-slate-50 border rounded-2xl font-bold text-slate-500 flex items-center gap-3 shadow-inner group-hover:border-indigo-400 transition-colors",
                            errors.file ? "border-rose-300 ring-rose-100" : "border-slate-200"
                          )}>
                            <FileSpreadsheet className="w-5 h-5 text-indigo-500" />
                            <span className="truncate">{file ? file.name : 'Upload CSV File...'}</span>
                          </div>
                          {errors.file && <p className="text-rose-500 text-[10px] font-black uppercase tracking-wider ml-2 mt-1">{errors.file}</p>}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : step === 'confirm' ? (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">3. Review Column Mappings</h4>
                      <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">Auto-Detected</span>
                    </div>

                    <div className="grid grid-cols-1 gap-3 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                      {Object.entries(mappings).map(([field, column]) => (
                        <div key={field} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                          <span className="text-xs font-black text-slate-500 uppercase tracking-wider">{field}</span>
                          <div className="flex items-center gap-2 min-w-[200px]">
                            <select
                              value={column || ''}
                              onChange={(e) => setMappings(prev => ({ ...prev, [field]: e.target.value || null }))}
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none transition shadow-sm"
                            >
                              <option value="">Not Found</option>
                              {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                            {column && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex gap-4">
                      <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs font-medium text-amber-700 leading-relaxed">
                        Please verify that the columns above match your CSV headers. If a column is "Not Found", that data will be skipped or set to default values.
                      </p>
                    </div>

                    {previewData && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="border border-slate-200 rounded-3xl overflow-hidden bg-slate-50 shadow-inner"
                      >
                        <div className="px-6 py-3 bg-slate-100/50 border-b border-slate-200 flex justify-between items-center">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Live Data Preview</span>
                          <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">Updates Automatically</span>
                        </div>
                        <div className="max-h-64 overflow-auto custom-scrollbar">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                              <tr className="whitespace-nowrap">
                                <th className="px-6 py-3">Brand Name</th>
                                <th className="px-6 py-3">Contact</th>
                                <th className="px-6 py-3">Sumber Lead</th>
                                {importMode === 'individu' && <th className="px-6 py-3">Status</th>}
                                {importMode === 'individu' && <th className="px-6 py-3">Chated</th>}
                                {importMode === 'legacy' && <th className="px-6 py-3">Tgl Chated (Fidal)</th>}
                                {importMode === 'legacy' && <th className="px-6 py-3">Tgl Chated (Jeff)</th>}
                                {importMode === 'legacy' && <th className="px-6 py-3">Tgl Chated (Rayhan)</th>}
                                {(importMode === 'legacy-v2' || importMode === 'basic') && <th className="px-6 py-3">Kategori</th>}
                                {importMode === 'basic' && <th className="px-6 py-3">Email</th>}
                                {importMode === 'legacy-v2' && <th className="px-6 py-3">Tgl Chated (Fidal)</th>}
                                {importMode === 'legacy-v2' && <th className="px-6 py-3">Tgl Chated (Jeff)</th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {previewData.slice(0, 100).map((row, idx) => {
                                const getCol = (key: string) => {
                                  const colName = mappings[key];
                                  if (!colName) return '-';
                                  const i = csvHeaders.indexOf(colName);
                                  return i > -1 ? (row[i] || '-') : '-';
                                };
                                return (
                                  <tr key={idx} className="hover:bg-white transition-colors whitespace-nowrap">
                                    <td className="px-6 py-3 font-bold text-slate-800 max-w-[150px] truncate" title={getCol('Brand Name')}>{getCol('Brand Name')}</td>
                                    <td className="px-6 py-3 text-slate-500 font-mono text-[10px]">{getCol('Contact')}</td>
                                    <td className="px-6 py-3 text-slate-500 font-mono text-[10px]">{getCol('Lead Source')}</td>
                                    {importMode === 'individu' && <td className="px-6 py-3 text-slate-500 text-[10px]">{getCol('Status')}</td>}
                                    {importMode === 'individu' && <td className="px-6 py-3 text-slate-500 text-[10px]">{getCol('Chated')}</td>}
                                    {importMode === 'legacy' && <td className="px-6 py-3 text-slate-500 text-[10px]">{getCol('fidal - Chated')}</td>}
                                    {importMode === 'legacy' && <td className="px-6 py-3 text-slate-500 text-[10px]">{getCol('jeff - Chated')}</td>}
                                    {importMode === 'legacy' && <td className="px-6 py-3 text-slate-500 text-[10px]">{getCol('rayhan - Chated')}</td>}
                                    {(importMode === 'legacy-v2' || importMode === 'basic') && <td className="px-6 py-3 text-slate-500 text-[10px] truncate max-w-[100px]">{getCol('Category')}</td>}
                                    {importMode === 'basic' && <td className="px-6 py-3 text-slate-500 text-[10px] truncate max-w-[150px]">{getCol('Email')}</td>}
                                    {importMode === 'legacy-v2' && <td className="px-6 py-3 text-slate-500 text-[10px]">{getCol('Fidal - Chated')}</td>}
                                    {importMode === 'legacy-v2' && <td className="px-6 py-3 text-slate-500 text-[10px]">{getCol('Jeff - Chated')}</td>}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                ) : step === 'compare' && analysisResult ? (
                  <motion.div
                    key="compare"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">4. Review Perbandingan Data</h4>
                      <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-100 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Cek Data Duplikat
                      </span>
                    </div>

                    <div className="flex gap-4 mb-4">
                      <div className="flex-1 bg-indigo-50 border border-indigo-100 p-4 rounded-3xl flex items-center gap-3 shadow-inner">
                        <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center shrink-0">
                          <Plus className="w-6 h-6 text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Data Baru</p>
                          <p className="text-2xl font-black text-indigo-900">{analysisResult.newCount}</p>
                        </div>
                      </div>
                      <div className="flex-1 bg-amber-50 border border-amber-100 p-4 rounded-3xl flex items-center gap-3 shadow-inner">
                        <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center shrink-0">
                          <Edit3 className="w-6 h-6 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Update Data</p>
                          <p className="text-2xl font-black text-amber-900">{analysisResult.updatedCount}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-indigo-50/50 border border-indigo-100 rounded-3xl p-6 shadow-sm mb-6">
                      <h4 className="text-sm font-black text-indigo-900 mb-4 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-indigo-500" /> Ringkasan Pembacaan Tanggal
                      </h4>
                      <div className="space-y-2">
                        {analysisResult.dateStats && Object.entries(analysisResult.dateStats).map(([statName, count]) => (
                          <div key={statName} className="flex justify-between items-center bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-100">
                            <span className="text-xs font-bold text-slate-700">{statName}</span>
                            <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">{count} Brand</span>
                          </div>
                        ))}
                        {(!analysisResult.dateStats || Object.keys(analysisResult.dateStats).length === 0) && (
                          <div className="text-center py-4 text-xs font-bold text-slate-400">Tidak ada data tanggal yang terbaca</div>
                        )}
                      </div>
                      <p className="text-[10px] font-semibold text-slate-500 mt-4 italic bg-white/50 p-3 rounded-lg border border-slate-200">
                        Mohon cek ringkasan di atas. Apakah bulannya sudah benar? Jika terbalik (misal terbaca 5 Juni padahal maksudnya 6 Mei), silakan batalkan dan perbaiki Excel Anda ke format DD/MM/YYYY.
                      </p>
                    </div>

                    {analysisResult.futureDates && analysisResult.futureDates.length > 0 && (
                      <div className="bg-rose-50 border-2 border-dashed border-rose-300 rounded-3xl p-6 shadow-sm mb-6 animate-pulse">
                        <h4 className="text-sm font-black text-rose-700 mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-rose-500" /> PERINGATAN: TERDETEKSI TANGGAL MASA DEPAN!
                        </h4>
                        <p className="text-xs font-bold text-rose-600 mb-3 leading-relaxed">
                          Sistem menemukan tanggal yang melewati hari ini. Ini sangat sering terjadi karena salah ketik bulan dan tanggal (contoh 05/06 terbaca 5 Juni).
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {analysisResult.futureDates.map(fd => (
                            <span key={fd} className="text-[10px] font-black uppercase tracking-widest bg-rose-200 text-rose-800 px-3 py-1.5 rounded-lg">
                              {fd}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {analysisResult.comparisons.length > 0 && (
                      <div className="border border-slate-200 rounded-3xl overflow-hidden bg-slate-50 shadow-inner">
                        <div className="px-6 py-3 bg-slate-100/50 border-b border-slate-200 flex justify-between items-center">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Daftar Perbandingan Lead</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto custom-scrollbar">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-500 tracking-wider sticky top-0 z-10 shadow-sm">
                              <tr>
                                <th className="px-6 py-3 w-1/4">Brand Name</th>
                                <th className="px-6 py-3 w-1/3">Riwayat Lama (Existing)</th>
                                <th className="px-6 py-3 w-1/3">Riwayat Baru Ditambahkan</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                              {analysisResult.comparisons.map((comp, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 transition-colors align-top">
                                  <td className="px-6 py-4 font-black text-slate-800">{comp.brandName}</td>
                                  <td className="px-6 py-4">
                                    {comp.oldHistory.length > 0 ? (
                                      <ul className="space-y-1">
                                        {comp.oldHistory.map((h, i) => <li key={i} className="text-slate-500 text-[10px] flex items-start gap-1"><span className="text-slate-300 mt-0.5">•</span> {h}</li>)}
                                      </ul>
                                    ) : <span className="text-slate-400 italic text-[10px]">Kosong</span>}
                                  </td>
                                  <td className="px-6 py-4 border-l border-emerald-50 bg-emerald-50/30">
                                    {comp.addedHistory.length > 0 ? (
                                      <ul className="space-y-1">
                                        {comp.addedHistory.map((h, i) => <li key={i} className="text-emerald-700 font-bold text-[10px] flex items-start gap-1"><span className="text-emerald-400 mt-0.5">+</span> {h}</li>)}
                                      </ul>
                                    ) : <span className="text-slate-400 italic text-[10px]">Tidak ada perubahan riwayat (Skip Duplikat)</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : step === 'error' ? (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="space-y-6"
                  >
                    <div className="flex flex-col items-center text-center p-6 bg-rose-50 border-2 border-dashed border-rose-200 rounded-3xl mb-6">
                      <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mb-4">
                        <X className="w-8 h-8 text-rose-600 shadow-xl shadow-rose-200" />
                      </div>
                      <h3 className="text-2xl font-black text-rose-700 mb-2">Import Gagal! Ditemukan {validationErrors.length} Baris Error</h3>
                      <p className="text-sm font-bold text-rose-600 max-w-lg">
                        Import DIBATALKAN. Silakan perbaiki file Excel/CSV Anda pada baris-baris berikut, lalu upload ulang. Tanggal wajib berurutan: Input ≤ Chated ≤ Responsed ≤ Set Meeting ≤ Close.
                      </p>
                    </div>

                    <div className="border border-rose-200 rounded-3xl overflow-hidden bg-rose-50/30 shadow-inner">
                      <div className="px-6 py-3 bg-rose-100/50 border-b border-rose-200 flex justify-between items-center">
                        <span className="text-[10px] font-black text-rose-600 uppercase tracking-[0.2em]">Daftar Baris CSV Yang Harus Diperbaiki</span>
                      </div>
                      <div className="max-h-96 overflow-y-auto custom-scrollbar">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-rose-100/50 text-[10px] uppercase font-bold text-rose-700 tracking-wider sticky top-0 z-10 shadow-sm">
                            <tr>
                              <th className="px-6 py-3 w-20 text-center">Baris CSV</th>
                              <th className="px-6 py-3 w-1/3">Brand Name</th>
                              <th className="px-6 py-3">Alasan Error / Penolakan</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-rose-100 bg-white">
                            {validationErrors.map((err, idx) => (
                              <tr key={idx} className="hover:bg-rose-50/50 transition-colors">
                                <td className="px-6 py-4 font-black text-rose-700 text-center">#{err.row}</td>
                                <td className="px-6 py-4 font-bold text-slate-800">{err.brand}</td>
                                <td className="px-6 py-4 text-rose-600 font-medium flex items-start gap-2">
                                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                  {err.reason}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </motion.div>
                ) : step === 'result' ? (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-6 text-center"
                  >
                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Check className="w-10 h-10 text-emerald-600 shadow-xl shadow-emerald-200" />
                    </div>
                    <h3 className="text-2xl font-black text-slate-800">Review Migrasi Selesai!</h3>
                    <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
                      <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                        <p className="text-3xl font-black text-indigo-600">{importResult?.new}</p>
                        <p className="text-[10px] font-bold text-indigo-400 uppercase mt-1">Data Baru Ditambah</p>
                      </div>
                      <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                        <p className="text-3xl font-black text-amber-600">{importResult?.updated}</p>
                        <p className="text-[10px] font-bold text-amber-400 uppercase mt-1">Data Duplikat Di-update</p>
                      </div>
                    </div>
                    {importResult?.duplicates && importResult.duplicates.length > 0 && (
                      <div className="text-left mt-6 bg-slate-50 border border-slate-200 rounded-2xl p-4 max-h-48 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertCircle className="w-4 h-4 text-amber-500" />
                          <h4 className="text-[11px] font-black text-slate-600 uppercase">Daftar Brand Terduplikasi ({importResult.duplicates.length}):</h4>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {importResult.duplicates.map((b, i) => (
                            <span key={i} className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-700">{b}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <div className="px-10 py-6 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
              {step === 'setup' ? (
                <>
                  <button
                    onClick={onClose}
                    className="px-6 py-3 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-600 transition"
                  >
                    Cancel Operation
                  </button>
                  <button
                    onClick={() => setStep('confirm')}
                    disabled={!file || !previewData}
                    className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center gap-3 disabled:opacity-50 disabled:shadow-none active:scale-95 text-sm uppercase tracking-widest"
                  >
                    Review Mappings
                  </button>
                </>
              ) : step === 'confirm' ? (
                <>
                  <button
                    onClick={() => setStep('setup')}
                    className="px-6 py-3 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-600 transition"
                  >
                    Back to Setup
                  </button>
                  <button
                    onClick={() => setIsConfirming(true)}
                    disabled={loading}
                    className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-500/20 flex items-center gap-3 disabled:opacity-50 disabled:shadow-none active:scale-95 text-sm uppercase tracking-widest"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
                    Analyze Data
                  </button>
                </>
              ) : step === 'compare' ? (
                <>
                  <button
                    onClick={() => setStep('confirm')}
                    className="px-6 py-3 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-600 transition"
                  >
                    Back to Mappings
                  </button>
                  <button
                    onClick={() => commitData()}
                    disabled={loading}
                    className="px-10 py-4 bg-emerald-600 text-white rounded-2xl font-black hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-500/20 flex items-center gap-3 disabled:opacity-50 disabled:shadow-none active:scale-95 text-sm uppercase tracking-widest"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                    Confirm & Save
                  </button>
                </>
              ) : step === 'error' ? (
                <div className="w-full flex justify-center">
                  <button
                    onClick={() => {
                      setStep('setup');
                      setFile(null);
                      setPreviewData(null);
                    }}
                    className="px-10 py-4 bg-rose-600 text-white rounded-2xl font-black hover:bg-rose-700 transition-all shadow-xl shadow-rose-500/20 flex items-center gap-3 active:scale-95 text-sm uppercase tracking-widest w-full sm:w-auto"
                  >
                    <Upload className="w-5 h-5" />
                    Kembali & Upload CSV Ulang
                  </button>
                </div>
              ) : (
                <div className="w-full flex justify-center">
                  <button
                    onClick={() => {
                      setStep('setup');
                      setImportResult(null);
                      setFile(null);
                      setPreviewData(null);
                      onClose();
                    }}
                    className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition w-full sm:w-auto uppercase tracking-widest text-sm"
                  >
                    Selesai & Tutup
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
      <ConfirmModal
        isOpen={isConfirming}
        onClose={() => setIsConfirming(false)}
        onConfirm={() => {
          setIsConfirming(false);
          analyzeData();
        }}
        title="Konfirmasi Import"
        message={`Anda akan mengimport ${previewData?.length || 0} baris data ke kategori ${category}. Pastikan mapping kolom sudah benar. Lanjutkan?`}
      />
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
      />
    </AnimatePresence>
  );
}

/** Flatten a stored funnel entry into the {stage, date, by} shape the analysis uses. */
function toStamp(h: FunnelHistoryDTO): StageStamp {
  return {
    stage: h.stage,
    date: (h.dateOccurred || '').slice(0, 10),
    by: h.byUserName,
  };
}

/** Move a single funnel entry to a new date, leaving every other field intact. */
async function updateFunnelStamp(
  h: FunnelHistoryDTO,
  changes: { dateOccurred: string },
): Promise<boolean> {
  const result = await editFunnelHistory({
    id: h.id,
    stage: h.stage,
    dateOccurred: changes.dateOccurred,
    byUserName: h.byUserName,
    dealValue: h.dealValue ?? null,
    campaignNumber: h.campaignNumber ?? null,
    note: h.note ?? null,
  });
  return result.success;
}
