import type { ActionPromptMeta, QueuedPromptSummary } from '../protocol/messages.ts';

export interface QueuedPrompt extends QueuedPromptSummary {
  text: string;
  action?: ActionPromptMeta;
}

// Prompts that wait for the agent's turn to end: the user's own messages
// (follow-ups), preview feedback and actions. They go one per turn, in order.
export class PromptQueue {
  private items: QueuedPrompt[] = [];
  private nextId = 1;

  enqueue(text: string, title: string, action?: ActionPromptMeta): QueuedPrompt {
    const item = { id: `queued-${this.nextId++}`, title, text, ...(action ? { action } : {}) };
    this.items.push(item);
    return item;
  }

  /** A message the user wrote. */
  enqueueMessage(text: string): QueuedPrompt {
    const item = { id: `queued-${this.nextId++}`, title: text, text, editable: true };
    this.items.push(item);
    return item;
  }

  /** Puts a prompt taken off the queue back, before the others. */
  putFirst(item: QueuedPrompt): void {
    this.items.unshift(item);
  }

  replace(text: string, title: string, action?: ActionPromptMeta): QueuedPrompt {
    this.items = [];
    return this.enqueue(text, title, action);
  }

  /** The next prompt, or the one with this id, off the queue. */
  take(id?: string): QueuedPrompt | undefined {
    if (id === undefined) return this.items.shift();
    const index = this.items.findIndex((item) => item.id === id);
    return index < 0 ? undefined : this.items.splice(index, 1)[0];
  }

  /** The user's own messages off the queue, e.g. back to the composer when they stop the agent. */
  takeMessages(): QueuedPrompt[] {
    const messages = this.items.filter((item) => item.editable);
    this.items = this.items.filter((item) => !item.editable);
    return messages;
  }

  remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  summaries(): QueuedPromptSummary[] {
    return this.items.map(({ id, title, editable }) => ({ id, title, ...(editable ? { editable } : {}) }));
  }

  get length(): number {
    return this.items.length;
  }
}
