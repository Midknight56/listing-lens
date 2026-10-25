import { scanText } from '../fairhousing'
import { QlooError, type Entity, type QlooClient } from '../qloo/client'
import type { Budget } from './agent'
import { neuronsFor, type TextWriter } from './model'
import { safeTemplate } from './template'
import { whyLine, type AuditRow, type Event, type Pick } from './events'
import { RunCallBudget } from '../store/caps'

export interface StageRequest { city: string; neighbourhood?: string; lens: { label: string; anchors: string[] }; room: string[]; features: string[]; preset?: string }
export interface RunDeps { qloo: QlooClient; writer?: TextWriter; budget: Budget; emit(event: Event): Promise<void>; setMode?(mode: 'live' | 'template' | 'off'): void }
export function verdicts(picks: Pick[], rows: { name: string; id?: string; affinity?: number }[]): AuditRow[] {
  const scored = picks.filter((pick) => typeof pick.affinity === 'number').sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
  const top = Math.max(0, ...scored.map((pick) => pick.affinity ?? 0))
  const roomIds = new Set(rows.flatMap((row) => row.id ? [row.id] : []))
  const offered = new Set<string>()
  return rows.map((row) => {
    if (!row.id) return { name: row.name, verdict: 'unknown' }
    const affinity = row.affinity ?? 0
    const gap = Math.round((top - affinity) * 1000) / 1000
    const verdict = affinity === 0 || gap > 0.06 ? 'cut' : gap > 0.02 ? 'swap' : 'keep'
    const swap = verdict === 'keep' ? undefined : scored.find((item) => item.id !== row.id && !roomIds.has(item.id) && !offered.has(item.id))
    if (swap) offered.add(swap.id)
    return { ...row, affinity, verdict, gap, ...(swap?.affinity === undefined || !swap ? {} : { swap: { id: swap.id, name: swap.name, affinity: swap.affinity } }) }
  })
}

export async function run(request: StageRequest, deps: RunDeps): Promise<Event[]> {
  const events: Event[] = []
  const emit = async (event: Event) => { events.push(event); await deps.emit(event) }
  let callCount = 0, upstream = 0, cachedCount = 0, neurons = 0
  const callBudget = new RunCallBudget()
  const anchors: { id: string; name: string }[] = []
  const call = async (path: string, what: string, operation: () => Promise<{ results: Entity[]; cached: boolean; locality?: { id: string; name: string; disambiguation: string } | null }>) => {
    if (!callBudget.take()) throw new Error('This brief has reached its question limit.')
    const started = Date.now()
    const answer = await operation()
    callCount++
    if (answer.cached) cachedCount++; else upstream++
    await emit({ t: 'call', n: callCount, path, what, cached: answer.cached, ms: Date.now() - started, count: answer.results.length })
    return answer
  }
  await emit({ t: 'plan', budget: 16, steps: ['resolve buyer', 'place and brands', 'books, playlist, places', 'room', 'audit', 'write'] })
  try {
    for (const name of request.lens.anchors.slice(0, 3)) {
      const result = await call('/search', name, () => deps.qloo.search(name, undefined, 1))
      const hit = result.results[0]
      if (hit) { anchors.push({ id: hit.id, name }); await emit({ t: 'resolved', kind: 'anchor', name, as: `${hit.name} (${hit.type})`, id: hit.id }) }
      else await emit({ t: 'resolved', kind: 'anchor', name, as: 'not found' })
    }
    if (!anchors.length) { await emit({ t: 'error', text: 'No buyer loves matched. Try different names or a preset.' }); return events }
    let scope = request.neighbourhood || request.city
    let brandAnswer = await call('/v2/insights', scope, () => deps.qloo.insights({ seedIds: anchors.map((a) => a.id), type: 'brand', location: scope, excludeIds: [], take: 10 }))
    const cityName = request.city.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const resolvedText = brandAnswer.locality?.disambiguation.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') ?? ''
    const wrongCity = Boolean(request.neighbourhood && !resolvedText.includes(cityName))
    if (request.neighbourhood && (brandAnswer.results.length < 3 || wrongCity)) {
      const why = wrongCity ? `Qloo read ${request.neighbourhood} as ${brandAnswer.locality?.disambiguation || 'an unknown area'}; using ${request.city}` : `Qloo has thin data for ${request.neighbourhood}; using ${request.city}`
      await emit({ t: 'relax', from: request.neighbourhood, to: request.city, why })
      scope = request.city
      brandAnswer = await call('/v2/insights', scope, () => deps.qloo.insights({ seedIds: anchors.map((a) => a.id), type: 'brand', location: scope, take: 10 }))
    }
    if (brandAnswer.results.length < 3 && scope === request.city) {
      await emit({ t: 'relax', from: scope, to: 'all locations', why: `Qloo has thin data for ${scope}; using taste alone` })
      scope = ''
      brandAnswer = await call('/v2/insights', 'all locations', () => deps.qloo.insights({ seedIds: anchors.map((a) => a.id), type: 'brand', take: 10 }))
    }
    if (brandAnswer.locality) await emit({ t: 'resolved', kind: 'scope', name: scope || request.city, as: brandAnswer.locality.disambiguation, id: brandAnswer.locality.id })
    const brands = brandAnswer.results.map((entity) => whyLine(entity, anchors, scope || request.city))
    await emit({ t: 'section', key: 'brands', items: brands, ...(brands.length < 3 ? { thin: true as const } : {}) })
    const books = await call('/v2/insights', 'books', () => deps.qloo.insights({ seedIds: anchors.map((a) => a.id), type: 'book', location: scope || undefined, take: 6 }))
    const artists = await call('/v2/insights', 'playlist', () => deps.qloo.insights({ seedIds: anchors.map((a) => a.id), type: 'artist', location: scope || undefined, take: 8 }))
    const places = await call('/v2/insights', 'places', () => deps.qloo.insights({ seedIds: anchors.map((a) => a.id), type: 'place', location: scope || undefined, popularityMax: 0.95, take: 6 }))
    const localPlaces = places.results.filter((place) => !/\b(church|mosque|synagogue|temple|school|university|college)\b/i.test([place.name, place.detail, place.address].filter(Boolean).join(' ')))
    for (const [key, answer] of [['books', books], ['playlist', artists], ['places', places]] as const) {
      const items = (key === 'places' ? localPlaces : answer.results).map((entity) => whyLine(entity, anchors, scope || request.city))
      await emit({ t: 'section', key, items, ...(items.length < 3 ? { thin: true as const } : {}) })
    }
    const roomHits: { name: string; id?: string }[] = []
    for (const name of request.room.slice(0, 6)) {
      const found = await call('/search', name, () => deps.qloo.search(name, 'brand', 1))
      const hit = found.results[0]
      roomHits.push({ name, ...(hit ? { id: hit.id } : {}) })
      await emit({ t: 'resolved', kind: 'room', name, as: hit ? `${hit.name} (brand)` : 'not in Qloo', ...(hit ? { id: hit.id } : {}) })
    }
    const roomIds = roomHits.flatMap((hit) => hit.id ? [hit.id] : [])
    let audit: Entity[] = []
    if (roomIds.length) audit = (await call('/v2/insights', 'room audit', () => deps.qloo.insights({ seedIds: anchors.map((a) => a.id), type: 'brand', location: scope || undefined, resultIds: roomIds, take: 6 }))).results
    const rows = verdicts(brands, roomHits.map((item) => ({ ...item, ...(audit.find((entity) => entity.id === item.id)?.affinity === undefined ? {} : { affinity: audit.find((entity) => entity.id === item.id)!.affinity }) })))
    await emit({ t: 'audit', rows })
    const plain = safeTemplate({ scope: scope || request.city, places: localPlaces.map((place) => place.name), features: request.features })
    let intro = plain.intro, paragraph = plain.paragraph, written_by: 'model' | 'template' = 'template'
    const reservations: NonNullable<Awaited<ReturnType<Budget['reserve']>>>[] = []
    if (deps.writer) for (let index = 0; index < 2; index++) {
      const reservation = await deps.budget.reserve()
      if (!reservation) break
      reservations.push(reservation)
    }
    const writer = deps.writer && reservations.length === 2 ? deps.writer : undefined
    deps.setMode?.(writer ? 'live' : 'template')
    if (deps.writer && !writer) {
      for (const reservation of reservations) await reservation.settle(0)
      await emit({ t: 'fallback', what: 'intro and paragraph', why: 'writing budget spent' })
    }
    if (writer) for (const [what, prompt, max] of [['intro', 'Write one concise home staging introduction from these facts only.', 60], ['paragraph', 'Write an 80 word listing paragraph from these facts only.', 150]] as const) {
      const held = reservations.shift()
      if (!held) break
      try {
        const reply = await writer.write(prompt, { scope: scope || request.city, places: localPlaces.map((p) => p.name), features: request.features }, max)
        const spent = reply.neurons ?? neuronsFor(reply.prompt_tokens, reply.completion_tokens)
        neurons += spent; await held.settle(spent)
        const text = reply.content.trim()
        const facts = [scope || request.city, ...localPlaces.map((place) => place.name), ...request.features, 'Natural', 'The', 'A', 'This', 'Home', 'Bright', 'A considered staging brief']
        const allowed = new Set(facts.flatMap((fact) => fact.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)))
        const namesOkay = [...text.matchAll(/\b[A-Z][a-z]{2,}\b/g)].every((match) => allowed.has(match[0].toLocaleLowerCase()))
        if (!text || scanText(text).length || !namesOkay) { await emit({ t: 'fallback', what, why: scanText(text).length ? 'fair housing scan' : 'names check' }); continue }
        if (what === 'intro') intro = text; else paragraph = text
        written_by = 'model'
      } catch { await held.settle(0); await emit({ t: 'fallback', what, why: 'writing service error' }) }
    }
    for (const reservation of reservations) await reservation.settle(0)
    await emit({ t: 'brief', intro, paragraph, written_by, scope: scope || request.city, lens: request.lens.label })
    await emit({ t: 'usage', qloo_upstream: upstream, qloo_cached: cachedCount, neurons: Math.round(neurons * 10) / 10 })
  } catch (error) {
    deps.setMode?.('off')
    const message = error instanceof QlooError ? error.message : error instanceof Error ? error.message : 'The brief could not be completed.'
    await emit({ t: 'error', text: message })
  }
  return events
}
