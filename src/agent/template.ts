import { scanText } from '../fairhousing'

export interface BriefFacts { scope: string; places: string[]; features: string[] }
export function composeTemplate(facts: BriefFacts): { intro: string; paragraph: string } {
  const placeText = facts.places.length ? facts.places.slice(0, 3).join(', ') : 'nearby local spots'
  const features = facts.features.length ? facts.features.join(', ') : 'a calm, welcoming layout'
  const intro = `A considered staging brief for ${facts.scope}.`
  const paragraph = `Natural light, ${features}, and a considered palette give the home an easy sense of flow. Nearby, ${placeText} add a local touch. A simple table display and warm lighting keep the rooms ready for a showing.`
  return { intro, paragraph }
}
export function safeTemplate(facts: BriefFacts): { intro: string; paragraph: string } {
  const text = composeTemplate(facts)
  return scanText(text.intro + ' ' + text.paragraph).length ? { intro: 'A thoughtful look at the home.', paragraph: 'Natural light and a considered palette give the home an easy sense of flow. A simple table display and warm lighting keep the rooms ready for a showing.' } : text
}
