import type { Tool } from '../mcp/server'
import { ENTITY_TYPES, QlooError, type EntityType, type QlooClient } from './client'
import { verdicts } from '../agent/run'
import type { Pick } from '../agent/events'
export interface QlooContext { qloo: QlooClient }
const common = { type: 'object' as const, additionalProperties: false }
const name = { type: 'string' as const, minLength: 2, maxLength: 60 }
function failure(error: unknown) { return { content: [{ type: 'text' as const, text: error instanceof QlooError ? error.message : 'The request could not be completed.' }], isError: true } }
export const resolve: Tool<QlooContext> = {
  name: 'resolve', title: 'Resolve a name', description: 'Find a named entity by its label.', inputSchema: { ...common, properties: { query: name, type: { type: 'string', enum: ENTITY_TYPES }, take: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] }, annotations: { readOnlyHint: true },
  async run(args, ctx) { try { const answer = await ctx.qloo.search(args.query as string, args.type as EntityType | undefined, args.take as number | undefined); return { content: [{ type: 'text', text: JSON.stringify(answer.results) }], structuredContent: { cached: answer.cached, results: answer.results } } } catch (error) { return failure(error) } },
}
export const placeTaste: Tool<QlooContext> = {
  name: 'place_taste', title: 'Explore taste', description: 'Find entities with a shared set of taste anchors in a location.', inputSchema: { ...common, properties: { anchors: { type: 'array', items: { type: 'string', minLength: 8, maxLength: 64 }, maxItems: 3 }, location: name, type: { type: 'string', enum: ENTITY_TYPES }, exclude_entities: { type: 'array', items: { type: 'string', minLength: 8, maxLength: 64 }, maxItems: 6 }, popularity_max: { type: 'number', minimum: 0, maximum: 1 }, take: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['anchors', 'type'] }, annotations: { readOnlyHint: true },
  async run(args, ctx) { try { const answer = await ctx.qloo.insights({ seedIds: args.anchors as string[], type: args.type as EntityType, location: args.location as string | undefined, excludeIds: args.exclude_entities as string[] | undefined, popularityMax: args.popularity_max as number | undefined, take: args.take as number | undefined }); return { content: [{ type: 'text', text: JSON.stringify(answer.results) }], structuredContent: { cached: answer.cached, locality: answer.locality ?? null, results: answer.results } } } catch (error) { return failure(error) } },
}
export const auditRoom: Tool<QlooContext> = {
  name: 'audit_room', title: 'Audit room brands', description: 'Score a list of brands against taste anchors and a city.', inputSchema: { ...common, properties: { anchors: { type: 'array', items: { type: 'string', minLength: 8, maxLength: 64 }, maxItems: 3 }, room: { type: 'array', items: name, maxItems: 6 }, location: name }, required: ['anchors', 'room', 'location'] }, annotations: { readOnlyHint: true },
  async run(args, ctx) { try {
    const room: { name: string; id?: string }[] = []
    for (const value of args.room as string[]) { const hit = (await ctx.qloo.search(value, 'brand', 1)).results[0]; room.push({ name: value, ...(hit ? { id: hit.id } : {}) }) }
    const ids = room.flatMap((item) => item.id ? [item.id] : [])
    const candidates = await ctx.qloo.insights({ seedIds: args.anchors as string[], type: 'brand', location: args.location as string, excludeIds: ids, take: 10 })
    const answer = ids.length ? await ctx.qloo.insights({ seedIds: args.anchors as string[], type: 'brand', location: args.location as string, resultIds: ids, take: 6 }) : { results: [], cached: true, locality: null }
    const picks: Pick[] = candidates.results.map((entity) => ({ id: entity.id, name: entity.name, type: 'brand', affinity: entity.affinity, why: 'Recommended from matching taste' }))
    const rows = verdicts(picks, room.map((item) => ({ ...item, ...(answer.results.find((entity) => entity.id === item.id)?.affinity === undefined ? {} : { affinity: answer.results.find((entity) => entity.id === item.id)!.affinity }) })))
    return { content: [{ type: 'text', text: JSON.stringify(rows) }], structuredContent: { cached: candidates.cached && answer.cached, locality: answer.locality ?? null, rows } }
  } catch (error) { return failure(error) } },
}
export function qlooTools(): Tool<QlooContext>[] { return [resolve, placeTaste, auditRoom] }
