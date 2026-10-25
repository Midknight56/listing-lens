export interface Preset {
  id: string;
  label: string;
  city: string;
  neighbourhood: string;
  lens: { label: string; anchors: string[] };
  flip: { label: string; anchors: string[] };
  room: string[];
  features: string[];
}

const design = {
  label: "Design forward",
  anchors: ["Herman Miller", "Kinfolk", "Khruangbin"],
};
const classic = {
  label: "Classic comfort",
  anchors: ["Pottery Barn", "Martha Stewart Living", "Norah Jones"],
};

export const PRESETS: Preset[] = [
  {
    id: "east-nashville",
    label: "East Nashville",
    city: "Nashville",
    neighbourhood: "East Nashville",
    lens: design,
    flip: classic,
    room: ["IKEA", "West Elm", "Pottery Barn", "CB2"],
    features: ["natural light", "front porch"],
  },
  {
    id: "wicker-park",
    label: "Wicker Park",
    city: "Chicago",
    neighbourhood: "Wicker Park",
    lens: design,
    flip: classic,
    room: ["Crate & Barrel", "IKEA", "Article", "Restoration Hardware"],
    features: ["hardwood floors", "big windows"],
  },
  {
    id: "hyde-park",
    label: "Hyde Park",
    city: "Chicago",
    neighbourhood: "Hyde Park",
    lens: classic,
    flip: design,
    room: ["Pottery Barn", "Ethan Allen", "IKEA", "West Elm"],
    features: ["fireplace", "reading nook"],
  },
  {
    id: "north-end-halifax",
    label: "North End",
    city: "Halifax",
    neighbourhood: "North End",
    lens: classic,
    flip: design,
    room: ["IKEA", "Wayfair", "Pottery Barn", "Article"],
    features: ["front porch", "hardwood floors"],
  },
  {
    id: "kensington-market",
    label: "Kensington Market",
    city: "Toronto",
    neighbourhood: "Kensington Market",
    lens: design,
    flip: classic,
    room: ["IKEA", "CB2", "Muji", "Wayfair"],
    features: ["natural light", "patio"],
  },
  {
    id: "silver-lake",
    label: "Silver Lake",
    city: "Los Angeles",
    neighbourhood: "Silver Lake",
    lens: design,
    flip: classic,
    room: ["West Elm", "Restoration Hardware", "IKEA", "Article"],
    features: ["patio", "open kitchen"],
  },
];

export const FEATURES = [
  "natural light",
  "open kitchen",
  "front porch",
  "home office",
  "garden",
  "fireplace",
  "hardwood floors",
  "walk in closet",
  "updated bath",
  "big windows",
  "high ceilings",
  "patio",
  "workshop",
  "reading nook",
];

export function preset(id: string | undefined): Preset | undefined {
  return PRESETS.find((item) => item.id === id);
}

export function lensesFor(
  item: Preset,
): { label: string; anchors: string[] }[] {
  return [item.lens, item.flip];
}

export function presetsPayload(): {
  presets: Preset[];
  lenses: { label: string; anchors: string[] }[];
  features: string[];
} {
  const lenses = [
    ...new Map(
      PRESETS.flatMap(lensesFor).map((lens) => [lens.label, lens]),
    ).values(),
  ];
  return { presets: PRESETS, lenses, features: FEATURES };
}

export function presetLensKey(item: Preset, label: string): string {
  return label === item.flip.label ? item.flip.label : item.lens.label;
}
