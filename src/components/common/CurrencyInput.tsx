"use client";
import React, { useState, useEffect } from 'react';

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  prefix?: string;
}

export default function CurrencyInput({
  value,
  onChange,
  className = '',
  placeholder = '0',
  disabled = false,
  prefix = 'Rp '
}: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = useState<string>('');

  useEffect(() => {
    if (value === undefined || value === null) {
      setDisplayValue('');
      return;
    }
    
    const parsedDisplay = parseInt(displayValue.replace(/\D/g, ''), 10);
    if (isNaN(parsedDisplay) || parsedDisplay !== value) {
       setDisplayValue(formatIdr(value));
    }
  }, [value]);

  const formatIdr = (num: number) => {
    if (isNaN(num)) return '';
    if (num === 0) return '0';
    return new Intl.NumberFormat('id-ID', {
      maximumFractionDigits: 0
    }).format(num);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allows clearing the input
    if (e.target.value === '') {
      setDisplayValue('');
      onChange(0);
      return;
    }

    const rawVal = e.target.value.replace(/\D/g, '');
    if (!rawVal) {
      setDisplayValue('0');
      onChange(0);
      return;
    }

    const numericVal = parseInt(rawVal, 10);
    setDisplayValue(formatIdr(numericVal));
    onChange(numericVal);
  };

  return (
    <div className={`relative flex items-center w-full`}>
      {prefix && displayValue !== '' && (
        <span className={`absolute left-0 text-slate-400 font-medium pointer-events-none select-none text-[inherit] ${className.includes('text-center') ? 'hidden' : 'px-3'}`}>
          {prefix}
        </span>
      )}
      <input
        type="text"
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`${className} ${prefix && displayValue !== '' && !className.includes('text-center') ? 'pl-9' : ''}`}
        inputMode="numeric"
      />
    </div>
  );
}

