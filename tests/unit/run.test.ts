import { describe, expect, it } from 'vitest'
import { verdicts } from '../../src/agent/run'
import type { Pick } from '../../src/agent/events'

const pick = (id: string, name: string, affinity: number): Pick => ({ id, name, type: 'brand', affinity, why: 'A local match' })
describe('room verdicts', () => {
  it('uses the specified gaps and gives swaps a nearest unoffered choice', () => {
    const rows = verdicts([pick('a', 'Top', 0.9), pick('x', 'Swap one', 0.89), pick('y', 'Swap two', 0.88)], [{ name: 'Near', id: 'b', affinity: 0.88 }, { name: 'Middle', id: 'c', affinity: 0.85 }, { name: 'Low', id: 'd', affinity: 0.7 }, { name: 'Missing' }])
    expect(rows.map((row) => row.verdict)).toEqual(['keep', 'swap', 'cut', 'unknown'])
    expect(rows[1].swap?.id).toBe('a')
    expect(rows[2].swap?.id).toBe('x')
  })
})
