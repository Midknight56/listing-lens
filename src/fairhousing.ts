const banned = [
  "family",
  "families",
  "kid",
  "kids",
  "child",
  "children",
  "toddler",
  "baby",
  "nursery",
  "teen",
  "teenager",
  "young",
  "youthful",
  "mature",
  "older",
  "elderly",
  "retiree",
  "retirement",
  "senior",
  "adult",
  "empty nester",
  "newlywed",
  "single",
  "couple",
  "bachelor",
  "bachelorette",
  "student",
  "professional",
  "working folks",
  "grandparent",
  "christian",
  "catholic",
  "jewish",
  "muslim",
  "hindu",
  "buddhist",
  "sikh",
  "church going",
  "churchgoer",
  "god fearing",
  "near church",
  "near mosque",
  "near synagogue",
  "near temple",
  "place of worship",
  "black",
  "white",
  "asian",
  "hispanic",
  "latino",
  "latina",
  "african",
  "european",
  "caucasian",
  "immigrant",
  "english speaking",
  "english only",
  "native born",
  "integrated",
  "segregated",
  "ethnic",
  "nationality",
  "exclusive",
  "restricted",
  "able bodied",
  "handicapped",
  "disabled",
  "wheelchair user",
  "no wheelchairs",
  "mentally ill",
  "crippled",
  "deaf",
  "blind",
  "must climb stairs",
  "healthy only",
  "perfect for her",
  "perfect for him",
  "gentleman",
  "gentlemen",
  "lady",
  "ladies",
  "woman",
  "women",
  "man",
  "men",
  "female",
  "male",
  "girl",
  "girls",
  "boy",
  "boys",
  "his and hers",
  "man cave",
  "she shed",
  "mother in law",
  "bachelor pad",
  "safe neighborhood",
  "safe neighbourhood",
  "crime free",
  "good schools",
  "great schools",
  "school district",
  "quiet neighbor",
  "traditional neighborhood",
  "desirable neighborhood",
  "private community",
  "exclusive community",
  "prestigious",
  "ideal for",
  "perfect for",
  "suits",
  "suitable for",
  "great for",
  "no children",
  "no kids",
  "family friendly",
];
let enabled = true;

function variants(term: string): string[] {
  const out = [term];
  if (term.includes(" ")) return out;
  if (term.endsWith("y")) out.push(term.slice(0, -1) + "ies");
  else if (term.endsWith("s")) return out;
  else out.push(term + "s");
  return out;
}

export function setScanEnabledForTest(value: boolean): void {
  enabled = value;
}

export function scanText(text: string): string[] {
  if (!enabled) return [];
  const found = new Set<string>();
  for (const term of banned) {
    for (const form of variants(term)) {
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        new RegExp(
          `(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`,
          "iu",
        ).test(text)
      )
        found.add(term);
    }
  }
  return [...found];
}

export function scanInput(request: unknown): string[] {
  if (!request || typeof request !== "object") return [];
  const row = request as Record<string, unknown>;
  const fields: string[] = [];
  if (typeof row.city === "string") fields.push(row.city);
  if (typeof row.neighbourhood === "string") fields.push(row.neighbourhood);
  if (row.lens && typeof row.lens === "object") {
    const lens = row.lens as Record<string, unknown>;
    if (typeof lens.label === "string") fields.push(lens.label);
    if (Array.isArray(lens.anchors))
      fields.push(
        ...lens.anchors.filter((v): v is string => typeof v === "string"),
      );
  }
  if (Array.isArray(row.room))
    fields.push(...row.room.filter((v): v is string => typeof v === "string"));
  return [...new Set(fields.flatMap(scanText))];
}
