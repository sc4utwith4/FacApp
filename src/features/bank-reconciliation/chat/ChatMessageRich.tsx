'use client';

import { cn } from '@/lib/utils';
import type { ChatMessage, RichMessageContent } from '@/types/bank-reconciliation';
import { MessageTable } from '@/features/bank-reconciliation/chat/MessageTable';
import type { MessageTableData } from '@/features/bank-reconciliation/chat/MessageTable';
import { MessageChart } from '@/features/bank-reconciliation/chat/MessageChart';
import type { MessageChartData } from '@/features/bank-reconciliation/chat/MessageChart';
import { MessageSummary } from '@/features/bank-reconciliation/chat/MessageSummary';
import type { MessageSummaryData } from '@/features/bank-reconciliation/chat/MessageSummary';
import { MessageList } from '@/features/bank-reconciliation/chat/MessageList';
import type { MessageListData } from '@/features/bank-reconciliation/chat/MessageList';

export interface ChatMessageRichProps {
  message: ChatMessage;
  /** Quando informado, substitui message.content no texto (ex.: texto animado) */
  displayContent?: string;
  className?: string;
}

function RichBlock({ content }: { content: RichMessageContent }) {
  const { type, data } = content;
  if (!data || typeof data !== 'object') return null;

  switch (type) {
    case 'table':
      return <MessageTable data={data as MessageTableData} className="mt-2" />;
    case 'chart':
      return <MessageChart data={data as MessageChartData} className="mt-2" />;
    case 'summary':
      return <MessageSummary data={data as MessageSummaryData} className="mt-2" />;
    case 'list':
      return <MessageList data={data as MessageListData} className="mt-2" />;
    default:
      return null;
  }
}

export function ChatMessageRich({ message, displayContent, className }: ChatMessageRichProps) {
  const isUser = message.role === 'user';
  const text = displayContent !== undefined ? displayContent : message.content;

  return (
    <div
      className={cn(
        'max-w-[85%] rounded-lg px-3 py-2 text-sm',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        className
      )}
    >
      <p className="whitespace-pre-wrap break-words">{text}</p>
      {message.richContent && <RichBlock content={message.richContent} />}
    </div>
  );
}
