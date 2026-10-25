import { afterEach, describe, expect, it } from 'vitest'
import { scanInput, scanText, setScanEnabledForTest } from '../../src/fairhousing'
import { composeTemplate } from '../../src/agent/template'

afterEach(() => setScanEnabledForTest(true))
describe('fair housing scan', () => {
  it('catches protected phrases in varied copy', () => {
    const bad = [
      'Perfect family home with a sunny kitchen.', 'Families will love this front porch.', 'A great place for kids to play.', 'Bring your children to this garden.', 'Ideal for singles near downtown.',
      'A quiet home for couples.', 'A bachelor pad with room to relax.', 'Young buyers will love the patio.', 'Mature residents enjoy the calm street.', 'Retirees can settle in nearby.',
      'Seniors will appreciate the elevator.', 'Adults only building.', 'An empty nester retreat.', 'Newlyweds can start here.', 'Student housing near campus.',
      'Christian community near the church.', 'Church going residents welcome.', 'A private community with security.', 'Exclusive home for working professionals.', 'A wheelchair user can access the entry.',
      'Able bodied visitors can take the stairs.', 'A man cave waits downstairs.', 'Mother in law suite with a separate entrance.', 'Perfect for her with a dressing room.', 'Perfect for him with a workshop.',
    ]
    for (const text of bad) expect(scanText(text), text).not.toEqual([])
  })
  it('allows neutral home descriptions', () => {
    const clean = ['Bright kitchen with stone counters.', 'Hardwood floors run through the main rooms.', 'A covered porch faces the garden.', 'The home includes a quiet reading nook.', 'Updated bath with a walk in shower.', 'The patio opens to a fenced yard.', 'High ceilings and big windows add volume.', 'A dedicated home office has built in shelves.', 'Local shops are a short walk away.', 'A fireplace anchors the living room.']
    for (const text of clean) expect(scanText(text), text).toEqual([])
  })
  it('fails when the scan is switched off', () => {
    expect(scanText('Perfect family home')).not.toEqual([])
  })
  it('scans free text fields in the request', () => {
    expect(scanInput({ city: 'Boston', lens: { label: 'Family home', anchors: ['Kinfolk'] }, room: [] })).toContain('family')
  })
  it('keeps every feature combination up to size three clear in template copy', () => {
    const features = ['natural light', 'open kitchen', 'front porch', 'home office', 'garden', 'fireplace', 'hardwood floors', 'walk in closet', 'updated bath', 'big windows', 'high ceilings', 'patio', 'workshop', 'reading nook']
    const check = (selected: string[], at: number) => {
      if (selected.length <= 3) expect(scanText(Object.values(composeTemplate({ scope: 'Halifax', places: ['Test Cafe'], features: selected })).join(' '))).toEqual([])
      if (selected.length === 3) return
      for (let i = at; i < features.length; i++) check([...selected, features[i]], i + 1)
    }
    check([], 0)
  })
})
