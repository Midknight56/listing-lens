import { describe, expect, it } from 'vitest'
import { QlooClient } from '../../src/qloo/client'

class MemoryCache {
  values = new Map<string, string>()
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value) }
}
const fixture = { query: { localities: { signal: { entity_id: 'ent-test-0001', name: 'Sample District', disambiguation: 'Sample District, Test City' } } }, results: { entities: [{ entity_id: 'ent-test-0002', name: 'Sample Chair', types: ['urn:entity:brand'], query: { affinity: 0.72, explainability: { 'signal.interests.entities': [{ entity_id: 'ent-test-0003', score: 0.62 }] } }, popularity: 0.8 }] } }

describe('Qloo request shapes', () => {
  it('sends taste location for all insight kinds and the place location filter only for places', async () => {
    const urls: URL[] = [], client = new QlooClient('secret-test-key', async (input) => { urls.push(new URL(String(input))); return Response.json(fixture) }, new MemoryCache(), async () => true)
    await client.insights({ seedIds: ['ent-test-0003'], type: 'brand', location: 'Test City', take: 10, excludeIds: ['ent-test-0004'] })
    await client.insights({ seedIds: ['ent-test-0003'], type: 'place', location: 'Test City', popularityMax: 0.95, take: 10 })
    expect(urls[0].searchParams.get('signal.location.query')).toBe('Test City')
    expect(urls[0].searchParams.get('filter.location.query')).toBeNull()
    expect(urls[0].searchParams.get('filter.exclude.entities')).toBe('ent-test-0004')
    expect(urls[1].searchParams.get('signal.location.query')).toBe('Test City')
    expect(urls[1].searchParams.get('filter.location.query')).toBe('Test City')
    expect(urls[1].searchParams.get('filter.popularity.max')).toBe('0.95')
    expect(urls.every((url) => !url.href.includes('demographics'))).toBe(true)
  })
  it('supports typed and untyped search with up to ten results', async () => {
    const urls: URL[] = [], client = new QlooClient('secret-test-key', async (input) => { urls.push(new URL(String(input))); return Response.json({ results: [fixture.results.entities[0]] }) }, new MemoryCache(), async () => true)
    await client.search('Sample Chair', undefined, 10)
    await client.search('Sample Chair', 'brand', 14)
    expect(urls[0].searchParams.get('types')).toBeNull()
    expect(urls[0].searchParams.get('take')).toBe('10')
    expect(urls[1].searchParams.get('types')).toBe('urn:entity:brand')
    expect(urls[1].searchParams.get('take')).toBe('10')
  })
  it('returns resolved locality and explainability on insight answers', async () => {
    const client = new QlooClient('secret-test-key', async () => Response.json(fixture), new MemoryCache(), async () => true)
    const answer = await client.insights({ seedIds: ['ent-test-0003'], type: 'brand', location: 'Test City' })
    expect(answer.locality).toEqual({ id: 'ent-test-0001', name: 'Sample District', disambiguation: 'Sample District, Test City' })
    expect(answer.results[0].shares).toEqual([{ id: 'ent-test-0003', share: 0.62 }])
  })
})
