/** 极简事件发射器：导入协调器与存储层用它向外发布可观察事件。 */
import type { ExchangeEvent } from "./types";

export type Listener = (e: ExchangeEvent) => void;

export class ExchangeEvents {
  private listeners = new Set<Listener>();
  private history: ExchangeEvent[] = [];
  private seq = 0;

  emit(kind: ExchangeEvent["kind"], message: string) {
    const e: ExchangeEvent = { at: Date.now() + this.seq++ * 0.01, kind, message };
    this.history.push(e);
    if (this.history.length > 200) this.history.shift();
    for (const l of this.listeners) l(e);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get log(): ExchangeEvent[] {
    return [...this.history];
  }
}
