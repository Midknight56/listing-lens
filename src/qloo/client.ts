export const QLOO_BASE = 'https://hackathon.api.qloo.com'
export const ENTITY_TYPES = ['artist', 'book', 'brand', 'destination', 'movie', 'person', 'place', 'podcast', 'tv_show', 'video_game'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]
export const CACHE_SECONDS = 60 * 24 * 3600

export interface Entity { id: string; name: string; type: string; affinity?: number; shares?: { id: string; share: number }[]; popularity?: number; detail?: string; address?: string; tags: string[] }
export interface Locality { id: string; name: string; disambiguation: string }
export interface Cache { get(key: string): Promise<string | null>; put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> }
export interface Answer<T> { results: T[]; cached: boolean; locality?: Locality | null }
export class QlooError extends Error {}
export class QlooBusy extends QlooError { constructor() { super('Today’s Qloo question limit has been reached.') } }
export class QlooOff extends QlooError { constructor() { super('Live results are off right now.') } }
interface RawEntity { entity_id?: string; name?: string; types?: string[]; subtype?: string; popularity?: number; query?: { affinity?: number; explainability?: Record<string, unknown> }; properties?: { short_description?: string; address?: string }; tags?: { name?: string }[] }
interface RawBody { results?: { entities?: RawEntity[]; tags?: unknown[] }; query?: { localities?: { signal?: { entity_id?: string; name?: string; disambiguation?: string } } } }
function toEntity(raw: RawEntity): Entity {
  const entity: Entity = { id: raw.entity_id ?? '', name: raw.name ?? '', type: (raw.subtype ?? raw.types?.[0] ?? '').replace(/^urn:entity:/, ''), tags: (raw.tags ?? []).map((tag) => tag.name ?? '').filter(Boolean).slice(0, 5) }
  if (typeof raw.query?.affinity === 'number') entity.affinity = Math.round(raw.query.affinity * 1000) / 1000
  if (typeof raw.popularity === 'number') entity.popularity = Math.round(raw.popularity * 1000) / 1000
  if (raw.properties?.short_description) entity.detail = raw.properties.short_description.slice(0, 200)
  if (raw.properties?.address) entity.address = raw.properties.address
  const shares = raw.query?.explainability?.['signal.interests.entities']
  if (Array.isArray(shares)) entity.shares = shares.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const value = row as { entity_id?: unknown; score?: unknown }
    return typeof value.entity_id === 'string' && typeof value.score === 'number' ? [{ id: value.entity_id, share: value.score }] : []
  }).sort((a, b) => b.share - a.share)
  return entity
}

export class QlooClient {
  constructor(private key: string, private fetcher: typeof fetch, private cache: Cache, private allow: () => Promise<boolean>) {}

  async search(query: string, type?: EntityType, take = 1): Promise<Answer<Entity>> {
    const params: Record<string, string> = { query: query.trim(), take: String(Math.min(10, Math.max(1, take))) }
    if (type) params.types = 'urn:entity:' + type
    const { body, cached } = await this.get('/search', params)
    return { results: ((body.results as RawEntity[] | undefined) ?? []).map(toEntity), cached }
  }

  async insights(opts: { seedIds: string[]; type: EntityType; location?: string; take?: number; excludeIds?: string[]; resultIds?: string[]; popularityMax?: number }): Promise<Answer<Entity>> {
    const params: Record<string, string> = { 'filter.type': 'urn:entity:' + opts.type, 'feature.explainability': 'true', take: String(Math.min(10, Math.max(1, opts.take ?? 8))) }
    if (opts.seedIds.length) params['signal.interests.entities'] = opts.seedIds.join(',')
    if (opts.location?.trim()) {
      params['signal.location.query'] = opts.location.trim()
      if (opts.type === 'place') params['filter.location.query'] = opts.location.trim()
    }
    if (opts.excludeIds?.length) params['filter.exclude.entities'] = opts.excludeIds.join(',')
    if (opts.resultIds?.length) params['filter.results.entities'] = opts.resultIds.join(',')
    if (opts.popularityMax !== undefined) params['filter.popularity.max'] = String(opts.popularityMax)
    const { body, cached } = await this.get('/v2/insights', params)
    const results = body.results as { entities?: RawEntity[] } | undefined
    const rawLocality = body.query?.localities?.signal
    const locality = rawLocality ? { id: rawLocality.entity_id ?? '', name: rawLocality.name ?? '', disambiguation: rawLocality.disambiguation ?? '' } : null
    return { results: (results?.entities ?? []).map(toEntity), cached, locality }
  }

  private async get(path: string, params: Record<string, string>): Promise<{ body: RawBody; cached: boolean }> {
    const url = path + '?' + new URLSearchParams(params).toString()
    const hit = await this.cache.get(url)
    if (hit) { try { return { body: JSON.parse(hit) as RawBody, cached: true } } catch { /* Corrupt entries are fetched again. */ } }
    if (!this.key) throw new QlooOff()
    if (!(await this.allow())) throw new QlooBusy()
    let response: Response
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try { response = await this.fetcher(QLOO_BASE + url, { headers: { 'X-Api-Key': this.key, Accept: 'application/json' }, signal: controller.signal }) }
    catch { throw new QlooError('Live results are not answering right now.') }
    finally { clearTimeout(timer) }
    if (response.status === 429) throw new QlooBusy()
    if (response.status === 404) return { body: { results: { entities: [] } }, cached: false }
    if (!response.ok) {
      let reason = ''
      try { reason = ((await response.json()) as { errors?: { message?: string }[] }).errors?.[0]?.message ?? '' } catch { /* Ignore unreadable error bodies. */ }
      if (this.key) reason = reason.split(this.key).join('[redacted]')
      throw new QlooError(reason ? 'Qloo said: ' + reason : 'Qloo said: HTTP ' + response.status)
    }
    let body: RawBody
    try { body = await response.json() as RawBody } catch { throw new QlooError('Qloo returned an unreadable answer.') }
    await this.cache.put(url, JSON.stringify(body), { expirationTtl: CACHE_SECONDS })
    return { body, cached: false }
  }
}
