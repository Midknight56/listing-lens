import type { Cache } from '../qloo/client'
import type { Budget, Reservation } from '../agent/agent'
import type { Event } from '../agent/events'
import { MAX_CALL_NEURONS } from '../limits'

interface Stmt { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> }
export interface D1Like { prepare(sql: string): { bind(...v: unknown[]): Stmt } }
export class D1Cache implements Cache {
  constructor(private db: D1Like, private now: () => number = Date.now) {}
  async get(key: string): Promise<string | null> { const row = await this.db.prepare('SELECT body, expires_at FROM qloo_cache WHERE key = ?').bind(key).first<{ body: string; expires_at: number }>(); return row && row.expires_at > this.now() ? row.body : null }
  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    await this.db.prepare('INSERT INTO qloo_cache (key, body, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at').bind(key, value, this.now() + (opts?.expirationTtl ?? 60 * 86400) * 1000).run()
  }
}
export class NeuronLedger implements Budget {
  constructor(private db: D1Like, private opts: { app: string; dailyCap: number; accountCap: number; reserve?: number; day?: () => string }) {}
  async spentToday(): Promise<{ app: number; all: number }> {
    const day = this.opts.day?.() ?? new Date().toISOString().slice(0, 10)
    const app = await this.db.prepare('SELECT COALESCE(SUM(neurons),0) AS total FROM ai_calls WHERE day = ? AND app = ?').bind(day, this.opts.app).first<{ total: number }>()
    const all = await this.db.prepare('SELECT COALESCE(SUM(neurons),0) AS total FROM ai_calls WHERE day = ?').bind(day).first<{ total: number }>()
    return { app: app?.total ?? 0, all: all?.total ?? 0 }
  }
  async allow(): Promise<boolean> { const spent = await this.spentToday(), amount = this.opts.reserve ?? MAX_CALL_NEURONS; return spent.app + amount <= this.opts.dailyCap && spent.all + amount <= this.opts.accountCap }
  async reserve(): Promise<Reservation | null> {
    const day = this.opts.day?.() ?? new Date().toISOString().slice(0, 10), amount = this.opts.reserve ?? MAX_CALL_NEURONS
    const row = await this.db.prepare('INSERT INTO ai_calls (app, day, neurons) SELECT ?, ?, ? WHERE (SELECT COALESCE(SUM(neurons),0) FROM ai_calls WHERE day = ? AND app = ?) + ? <= ? AND (SELECT COALESCE(SUM(neurons),0) FROM ai_calls WHERE day = ?) + ? <= ? RETURNING id').bind(this.opts.app, day, amount, day, this.opts.app, amount, this.opts.dailyCap, day, amount, this.opts.accountCap).first<{ id: number }>()
    if (!row) return null
    return { settle: async (spent) => { await this.db.prepare('UPDATE ai_calls SET neurons = ? WHERE id = ?').bind(spent, row.id).run() } }
  }
}
export class BriefStore {
  constructor(private db: D1Like, private now: () => Date = () => new Date()) {}
  async save(id: string, request: unknown, events: Event[], mode: string): Promise<void> {
    await this.db.prepare('INSERT OR REPLACE INTO briefs (id, request, events, mode, recorded_at) VALUES (?, ?, ?, ?, ?)').bind(id, JSON.stringify(request), JSON.stringify(events), mode, this.now().toISOString().slice(0, 10)).run()
  }
  async get(id: string): Promise<{ id: string; request: unknown; events: Event[]; mode: string; recorded_at: string } | null> {
    const row = await this.db.prepare('SELECT id, request, events, mode, recorded_at FROM briefs WHERE id = ?').bind(id).first<{ id: string; request: string; events: string; mode: string; recorded_at: string }>()
    return row ? { ...row, request: JSON.parse(row.request), events: JSON.parse(row.events) as Event[] } : null
  }
  async cached(key: string): Promise<string | null> { return (await this.db.prepare('SELECT conversation AS id FROM run_cache WHERE key = ?').bind(key).first<{ id: string }>())?.id ?? null }
  async cache(key: string, id: string): Promise<void> { await this.db.prepare('INSERT INTO run_cache (key, conversation, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET conversation = excluded.conversation, created_at = excluded.created_at').bind(key, id, Date.now()).run() }
}
export async function runKey(text: string): Promise<string> {
  const normalized = text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return 'run:' + Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
