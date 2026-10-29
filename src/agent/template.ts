import { scanText } from "../fairhousing";

export interface BriefFacts {
  scope: string;
  places: string[];
  features: string[];
}
function naturalList(values: string[]): string {
  if (values.length < 2) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

export function composeTemplate(facts: BriefFacts): {
  intro: string;
  paragraph: string;
} {
  const placeText = facts.places.length
    ? naturalList(facts.places.slice(0, 3))
    : "local spots";
  const chosen = [...new Set(facts.features)];
  const features = chosen.length ? naturalList(chosen) : "a calm layout";
  const vicinity = `Around ${facts.scope}`;
  const intro = `A considered staging brief for ${facts.scope}.`;
  const lead = chosen.length
    ? `${features[0].toLocaleUpperCase()}${features.slice(1)} ${
        chosen.length === 1 ? "gives" : "give"
      } the home an easy sense of flow.`
    : "A considered layout gives the home an easy sense of flow.";
  const paragraph = [
    `${lead} ${vicinity}, ${placeText} add a local touch.`,
    "A simple table display and warm lighting keep the rooms ready for a showing.",
  ].join(" ");
  return { intro, paragraph };
}
export function safeTemplate(facts: BriefFacts): {
  intro: string;
  paragraph: string;
} {
  const text = composeTemplate(facts);
  return scanText(text.intro + " " + text.paragraph).length
    ? {
        intro: "A thoughtful look at the home.",
        paragraph: [
          "Natural light and a considered palette give the home an easy sense of flow.",
          "A simple table display and warm lighting keep the rooms ready for a showing.",
        ].join(" "),
      }
    : text;
}
