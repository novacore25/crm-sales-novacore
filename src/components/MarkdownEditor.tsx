import React, { useRef } from 'react';
import { Bold, Italic, Strikethrough, List, ListOrdered, Quote, Code } from 'lucide-react';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function MarkdownEditor({ value, onChange, placeholder, disabled }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertFormat = (prefix: string, suffix: string = prefix) => {
    if (!textareaRef.current) return;
    
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;
    
    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);
    
    const newText = before + prefix + selected + suffix + after;
    onChange(newText);
    
    // Restore focus and selection
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(
          start + prefix.length,
          end + prefix.length
        );
      }
    }, 0);
  };

  const handleBold = () => insertFormat('**');
  const handleItalic = () => insertFormat('_');
  const handleStrike = () => insertFormat('~~');
  const handleCode = () => insertFormat('`');
  const handleQuote = () => insertFormat('> ', '');
  const handleBullet = () => insertFormat('- ', '');
  const handleNumber = () => insertFormat('1. ', '');

  return (
    <div className="flex flex-col w-full border border-gray-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
      <div className="flex items-center gap-1 bg-slate-50 border-b border-gray-200 px-2 py-1">
        <button onClick={handleBold} disabled={disabled} type="button" className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50" title="Bold"><Bold className="w-4 h-4" /></button>
        <button onClick={handleItalic} disabled={disabled} type="button" className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50" title="Italic"><Italic className="w-4 h-4" /></button>
        <button onClick={handleStrike} disabled={disabled} type="button" className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50" title="Strikethrough"><Strikethrough className="w-4 h-4" /></button>
        <div className="w-px h-4 bg-gray-300 mx-1"></div>
        <button onClick={handleQuote} disabled={disabled} type="button" className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50" title="Quote"><Quote className="w-4 h-4" /></button>
        <button onClick={handleCode} disabled={disabled} type="button" className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50" title="Code"><Code className="w-4 h-4" /></button>
        <div className="w-px h-4 bg-gray-300 mx-1"></div>
        <button onClick={handleNumber} disabled={disabled} type="button" className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50" title="Numbered List"><ListOrdered className="w-4 h-4" /></button>
        <button onClick={handleBullet} disabled={disabled} type="button" className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50" title="Bullet List"><List className="w-4 h-4" /></button>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        className="w-full px-4 py-3 border-none focus:ring-0 resize-y text-sm font-medium min-h-[80px]"
        placeholder={placeholder}
      />
    </div>
  );
}
