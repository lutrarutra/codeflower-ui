import type { ActionPromptMeta, QueuedPromptSummary } from '../protocol/messages.ts';

export interface QueuedPrompt extends QueuedPromptSummary {
  text: string;
  action?: ActionPromptMeta;
}

export class PromptQueue {
  private items: QueuedPrompt[] = [];
  private nextId = 1;

  enqueue(text: string, title: string, action?: ActionPromptMeta): QueuedPrompt {
    const item = { id: `queued-${this.nextId++}`, title, text, ...(action ? { action } : {}) };
    this.items.push(item);
    return item;
  }

  replace(text: string, title: string, action?: ActionPromptMeta): QueuedPrompt {
    this.items = [];
    return this.enqueue(text, title, action);
  }

  take(): QueuedPrompt | undefined {
    return this.items.shift();
  }

  remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  summaries(): QueuedPromptSummary[] {
    return this.items.map(({ id, title }) => ({ id, title }));
  }

  get length(): number {
    return this.items.length;
  }
}
