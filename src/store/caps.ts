import { DAILY_FRESH_RUNS_PER_VISITOR, DAILY_QLOO_CALLS, DAILY_QLOO_CALLS_PER_VISITOR, DAILY_PLAIN_PER_VISITOR, MAX_RUN_QLOO_CALLS } from '../limits'

export interface CounterStore { get(key: string): Promise<number>; put(key: string, value: number, ttl: number): Promise<void> }
export class VisitorCaps {
  constructor(private store: CounterStore, private day: () => string = () => new Date().toISOString().slice(0, 10)) {}
  private key(kind: string, visitor?: string): string { return [this.day(), kind, visitor ?? 'all'].join(':') }
  private async take(key: string, cap: number): Promise<boolean> { const current = await this.store.get(key); if (current >= cap) return false; await this.store.put(key, current + 1, 86400); return true }
  fresh(visitor: string): Promise<boolean> { return this.take(this.key('fresh', visitor), DAILY_FRESH_RUNS_PER_VISITOR) }
  qloo(visitor: string): Promise<boolean> { return this.take(this.key('visitor-qloo', visitor), DAILY_QLOO_CALLS_PER_VISITOR).then(async (ok) => ok && await this.take(this.key('daily-qloo'), DAILY_QLOO_CALLS)) }
  plain(visitor: string): Promise<boolean> { return this.take(this.key('plain', visitor), DAILY_PLAIN_PER_VISITOR) }
}
export class RunCallBudget {
  private count = 0
  take(): boolean { if (this.count >= MAX_RUN_QLOO_CALLS) return false; this.count++; return true }
  used(): number { return this.count }
}
