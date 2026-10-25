import { DurableObject } from 'cloudflare:workers'
import { stage, brief, type StageEnv } from './app/stage'
import { PRESETS } from './app/presets'
import { plain } from './app/plain'
import { D1Cache, type D1Like } from './store/d1'
import { VisitorCaps } from './store/caps'
import { QlooClient } from './qloo/client'
import { BoundTextWriter, type AiBinding } from './agent/model'
import { McpServer } from './mcp/server'
import { qlooTools } from './qloo/tools'

interface Env extends StageEnv {
  DB: D1Like
  LEDGER: D1Like
  WRITER?: AiBinding
  WRITER_NAME?: string
  QLOO_KEY?: string
  SHARE_SECRET?: string
  COUNTERS: DurableObjectNamespace<DailyCounter>
  ASSETS: { fetch(request: Request): Promise<Response> }
}
export class DailyCounter extends DurableObject {
  async get(key: string): Promise<number> { return await this.ctx.storage.get<number>(key) ?? 0 }
  async put(key: string, value: number, ttl: number): Promise<void> { await this.ctx.storage.put(key, value); await this.ctx.storage.setAlarm(Date.now() + ttl * 1000) }
  async take(key: string, cap: number, ttl: number): Promise<boolean> {
    const allowed = await this.ctx.storage.transaction(async (transaction) => {
      const current = await transaction.get<number>(key) ?? 0
      if (current >= cap) return false
      await transaction.put(key, current + 1)
      return true
    })
    if (allowed) await this.ctx.storage.setAlarm(Date.now() + ttl * 1000)
    return allowed
  }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll() }
  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as { action?: string; key?: string; value?: number; cap?: number; ttl?: number }
    if (!body.key) return Response.json({ error: 'A counter key is required.' }, { status: 400 })
    if (body.action === 'put' && typeof body.value === 'number') await this.put(body.key, body.value, body.ttl ?? 86400)
    if (body.action === 'take' && typeof body.cap === 'number') return Response.json({ allowed: await this.take(body.key, body.cap, body.ttl ?? 86400) })
    return Response.json({ value: await this.get(body.key) })
  }
}

const visitorCounter = (env: Env, key: string) => env.COUNTERS.get(env.COUNTERS.idFromName(key))
async function count(env: Env, visitor: string, kind: 'fresh' | 'plain'): Promise<boolean> {
  const caps = new VisitorCaps({
    take: async (key, cap, ttl) => {
      const response = await visitorCounter(env, 'listing-lens-counters').fetch(new Request('https://counter/take', { method: 'POST', body: JSON.stringify({ action: 'take', key, cap, ttl }) }))
      return (await response.json() as { allowed: boolean }).allowed
    },
    get: async (key) => { const response = await visitorCounter(env, 'listing-lens-counters').fetch(new Request('https://counter/get', { method: 'POST', body: JSON.stringify({ key }) })); return (await response.json() as { value: number }).value },
    put: async (key, value, ttl) => { await visitorCounter(env, 'listing-lens-counters').fetch(new Request('https://counter/put', { method: 'POST', body: JSON.stringify({ action: 'put', key, value, ttl }) })) },
  })
  return kind === 'fresh' ? caps.fresh(visitor) : caps.plain(visitor)
}

const server = (env: Env, qloo: QlooClient) => new McpServer({
  info: { name: 'listing-lens', title: 'Listing Lens', version: '1.0.0', websiteUrl: 'https://listing-lens.midknight-labs.workers.dev' },
  tools: qlooTools(), secret: env.SHARE_SECRET ?? 'listing-lens-session-key', allowOrigin: (origin) => origin.startsWith('https://listing-lens.'), context: async () => ({ qloo }),
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const cache = new D1Cache(env.DB)
    const qloo = new QlooClient(env.QLOO_KEY ?? '', (input, init) => fetch(input, init), cache, async () => {
      const visitor = request.headers.get('CF-Connecting-IP') ?? 'visitor'
      return (await new VisitorCaps({
        take: async (key, cap, ttl) => {
          const response = await visitorCounter(env, 'listing-lens-counters').fetch(new Request('https://counter/take', { method: 'POST', body: JSON.stringify({ action: 'take', key, cap, ttl }) }))
          return (await response.json() as { allowed: boolean }).allowed
        },
        get: async (key) => { const res = await visitorCounter(env, 'listing-lens-counters').fetch(new Request('https://counter/get', { method: 'POST', body: JSON.stringify({ key }) })); return (await res.json() as { value: number }).value },
        put: async (key, value, ttl) => { await visitorCounter(env, 'listing-lens-counters').fetch(new Request('https://counter/put', { method: 'POST', body: JSON.stringify({ action: 'put', key, value, ttl }) })) },
      })).qloo(visitor)
    })
    if (url.pathname === '/health') return Response.json({ ok: true })
    if (url.pathname === '/api/presets') return Response.json(PRESETS)
    if (url.pathname === '/api/stage') return stage(request, env, { qloo, ...(env.WRITER && env.WRITER_NAME ? { writer: new BoundTextWriter(env.WRITER, env.WRITER_NAME) } : {}), count: (kind) => count(env, request.headers.get('CF-Connecting-IP') ?? 'visitor', kind) })
    if (url.pathname === '/api/plain') return plain(request, env, { qloo, ...(env.WRITER && env.WRITER_NAME ? { writer: new BoundTextWriter(env.WRITER, env.WRITER_NAME) } : {}), count: (kind) => count(env, request.headers.get('CF-Connecting-IP') ?? 'visitor', kind) })
    const briefMatch = /^\/api\/brief\/([0-9a-f-]{36})$/.exec(url.pathname)
    if (briefMatch) return brief(briefMatch[1], env)
    const shareMatch = /^\/s\/([0-9a-f-]{36})$/.exec(url.pathname)
    if (shareMatch) {
      const record = await brief(shareMatch[1], env)
      if (!record.ok) return record
      const data = await record.json() as { events: { t: string; intro?: string; paragraph?: string }[] }
      const briefEvent = data.events.find((event) => event.t === 'brief')
      const html = `<!doctype html><meta charset="utf-8"><title>Listing Lens brief</title><main><h1>${escape(briefEvent?.intro ?? 'Staging brief')}</h1><p>${escape(briefEvent?.paragraph ?? '')}</p></main>`
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/mcp') return server(env, qloo).handle(request)
    return env.ASSETS.fetch(request)
  },
}
function escape(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!) }
