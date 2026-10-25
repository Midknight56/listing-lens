import type { Entity, EntityType } from '../qloo/client'
export interface Pick { id: string; name: string; type: EntityType; affinity?: number; popularity?: number; why: string; anchor?: string; share?: number; detail?: string; address?: string }
export interface AuditRow { name: string; id?: string; affinity?: number; verdict: 'keep' | 'swap' | 'cut' | 'unknown'; gap?: number; swap?: { id: string; name: string; affinity: number } }
export type Event =
  | { t: 'run'; id: string; mode: 'live' | 'template' | 'cache' | 'replay' | 'off'; recorded_at?: string }
  | { t: 'plan'; budget: 16; steps: string[] }
  | { t: 'call'; n: number; path: string; what: string; cached: boolean; ms: number; count: number }
  | { t: 'resolved'; kind: 'anchor' | 'room' | 'scope'; name: string; as: string; id?: string }
  | { t: 'relax'; from: string; to: string; why: string }
  | { t: 'section'; key: 'brands' | 'books' | 'playlist' | 'places'; items: Pick[]; thin?: true }
  | { t: 'audit'; rows: AuditRow[] }
  | { t: 'brief'; intro: string; paragraph: string; written_by: 'model' | 'template'; scope: string; lens: string }
  | { t: 'fallback'; what: string; why: string }
  | { t: 'usage'; qloo_upstream: number; qloo_cached: number; neurons: number }
  | { t: 'error'; text: string }
  | { t: 'done' }

export function whyLine(entity: Entity, anchors: { id: string; name: string }[], scope: string): Pick {
  const share = entity.shares?.[0]
  const anchor = anchors.find((item) => item.id === share?.id)
  return { id: entity.id, name: entity.name, type: entity.type as EntityType, ...(entity.affinity === undefined ? {} : { affinity: entity.affinity }), ...(entity.popularity === undefined ? {} : { popularity: entity.popularity }), why: anchor && share ? `Because they love ${anchor.name} (${Math.round(share.share * 100)}%)` : `Popular with people in ${scope} who share this taste`, ...(anchor ? { anchor: anchor.name } : {}), ...(share ? { share: share.share } : {}), ...(entity.detail ? { detail: entity.detail } : {}), ...(entity.address ? { address: entity.address } : {}) }
}
