import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils'; // Optional if you have a class merger

export default function MarkdownRenderer({ content, className = '' }: { content: string, className?: string }) {
  return (
    <div className={cn("prose prose-sm prose-slate max-w-none text-sm", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
