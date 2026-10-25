import { scanInput } from '../fairhousing'
import { DEFAULT_ACCOUNT_NEURONS, DEFAULT_DAILY_NEURONS } from '../limits'
import { run, type StageRequest } from '../agent/run'
import type { Event } from '../agent/events'
import type { QlooClient } from '../qloo/client'
import { BriefStore, NeuronLedger, runKey, type D1Like } from '../store/d1'
import type { AiBinding, TextWriter } from '../agent/model'
import { preset } from './presets'

export interface StageEnv { DB: D1Like; LEDGER?: D1Like; QLOO_KEY?: string; WRITER?: AiBinding; WRITER_NAME?: string; COUNTERS?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } } }
export interface StageDeps { qloo: QlooClient; writer?: TextWriter; count?(kind: 'fresh' | 'plain', request: Request): Promise<boolean> }
const FEATURES = ['natural light', 'open kitchen', 'front porch', 'home office', 'garden', 'fireplace', 'hardwood floors', 'walk in closet', 'updated bath', 'big windows', 'high ceilings', 'patio', 'workshop', 'reading nook']
const visitor = (request: Request) => request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'visitor'
function parse(raw: unknown): StageRequest | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Send a brief as JSON.'
  const data = raw as Record<string, unknown>
  if (typeof data.city !== 'string' || data.city.trim().length < 2 || data.city.length > 60) return 'Enter a city between 2 and 60 characters.'
  const neighbourhood = data.neighbourhood === undefined ? '' : data.neighbourhood
  if (typeof neighbourhood !== 'string' || neighbourhood.length > 60) return 'Keep the neighbourhood to 60 characters.'
  const lens = data.lens as Record<string, unknown> | undefined
  if (!lens || typeof lens.label !== 'string' || lens.label.length < 2 || lens.label.length > 60 || !Array.isArray(lens.anchors) || lens.anchors.length < 1 || lens.anchors.length > 3 || lens.anchors.some((v) => typeof v !== 'string' || v.trim().length < 2 || v.length > 60)) return 'Give one to three buyer interests, each between 2 and 60 characters.'
  const room = data.room ?? []
  if (!Array.isArray(room) || room.length > 6 || room.some((v) => typeof v !== 'string' || v.trim().length < 2 || v.length > 60)) return 'List up to six brand names, each between 2 and 60 characters.'
  const features = data.features ?? []
  if (!Array.isArray(features) || features.length > 6 || features.some((v) => typeof v !== 'string' || !FEATURES.includes(v))) return 'Choose up to six listed home features.'
  const request: StageRequest = { city: data.city.trim(), ...(neighbourhood.trim() ? { neighbourhood: neighbourhood.trim() } : {}), lens: { label: lens.label.trim(), anchors: (lens.anchors as string[]).map((v) => v.trim()) }, room: (room as string[]).map((v) => v.trim()), features: features as string[] }
  if (typeof data.preset === 'string') request.preset = data.preset
  const banned = scanInput(request)
  return banned.length ? 'Please remove a phrase that describes the people who might live in the home.' : request
}
function send(events: Event[], status = 200): Response { return new Response(events.map((event) => JSON.stringify(event)).join('\n') + '\n', { status, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } }) }

export async function stage(request: Request, env: StageEnv, deps: StageDeps): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  let body: unknown
  try { body = await request.json() } catch { return send([{ t: 'error', text: 'Send a brief as JSON.' }, { t: 'done' }], 400) }
  const parsed = parse(body)
  if (typeof parsed === 'string') return send([{ t: 'error', text: parsed }, { t: 'done' }], 400)
  const knownPreset = parsed.preset ? preset(parsed.preset) : undefined
  if (parsed.preset && !knownPreset) return send([{ t: 'error', text: 'That example is not available.' }, { t: 'done' }], 400)
  const store = new BriefStore(env.DB)
  const key = await runKey(JSON.stringify({ ...parsed, preset: undefined }))
  const cached = await store.cached(key)
  if (cached) {
    const saved = await store.get(cached)
    if (saved) return send([{ t: 'run', id: saved.id, mode: parsed.preset ? 'replay' : 'cache', ...(parsed.preset ? { recorded_at: saved.recorded_at } : {}) }, ...saved.events.filter((event) => event.t !== 'done'), { t: 'done' }])
  }
  if (deps.count && !(await deps.count('fresh', request))) {
    return send([{ t: 'run', id: crypto.randomUUID(), mode: 'off' }, { t: 'error', text: 'You have staged three briefs today. Try again tomorrow or open an example.' }, { t: 'done' }], 429)
  }
  const id = crypto.randomUUID()
  const ledger = new NeuronLedger(env.LEDGER ?? env.DB, { app: 'listing-lens', dailyCap: DEFAULT_DAILY_NEURONS, accountCap: DEFAULT_ACCOUNT_NEURONS })
  let mode: 'live' | 'template' | 'off' = deps.writer ? 'live' : 'template'
  const events: Event[] = [{ t: 'run', id, mode }]
  await run(parsed, { qloo: deps.qloo, ...(deps.writer ? { writer: deps.writer } : {}), budget: ledger, setMode: (next) => { mode = next; events[0] = { t: 'run', id, mode } }, emit: async (event) => { events.push(event) } })
  if (events.at(-1)?.t !== 'done') events.push({ t: 'done' })
  await store.save(id, parsed, events, mode)
  await store.cache(key, id)
  return send(events)
}

export async function brief(id: string, env: StageEnv): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 })
  const saved = await new BriefStore(env.DB).get(id)
  return saved ? Response.json(saved, { headers: { 'Cache-Control': 'no-store' } }) : new Response('Not found', { status: 404 })
}
export function visitorId(request: Request): string { return visitor(request) }
