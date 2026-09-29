"use client";
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  confirmVariant?: 'danger' | 'primary' | 'success';
}

export default function ConfirmModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText = "Hapus", 
  confirmVariant = "danger" 
}: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-100"
          >
            <h3 className="text-xl font-black text-slate-900 mb-2">{title}</h3>
            <p className="text-slate-500 text-sm font-medium mb-8 leading-relaxed">{message}</p>
            <div className="flex gap-3">
              <button 
                onClick={onClose}
                className="flex-1 px-6 py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition"
              >
                Batal
              </button>
              <button 
                onClick={() => { onConfirm(); onClose(); }}
                className={cn(
                  "flex-1 px-6 py-3 rounded-2xl font-bold text-sm transition shadow-lg",
                  confirmVariant === 'danger' && "bg-red-600 text-white shadow-red-100 hover:bg-red-700",
                  confirmVariant === 'primary' && "bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700",
                  confirmVariant === 'success' && "bg-emerald-600 text-white shadow-emerald-100 hover:bg-emerald-700"
                )}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
