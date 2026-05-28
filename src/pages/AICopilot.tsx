import { ChatInterface } from '@/components/ai-copilot/ChatInterface';

export default function AICopilot() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-background-secondary">
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatInterface />
      </div>
    </div>
  );
}

