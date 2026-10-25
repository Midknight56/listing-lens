import { scanText } from "../fairhousing";
import { QlooError, type Entity, type QlooClient } from "../qloo/client";
import type { Budget } from "./agent";
import { neuronsFor, type TextWriter } from "./model";
import { safeTemplate } from "./template";
import { whyLine, type AuditRow, type Event, type Pick } from "./events";
import { RunCallBudget } from "../store/caps";

export interface StageRequest {
  city: string;
  neighbourhood?: string;
  lens: { label: string; anchors: string[] };
  room: string[];
  features: string[];
  preset?: string;
}
export interface RunDeps {
  qloo: QlooClient;
  writer?: TextWriter;
  budget: Budget;
  catalog?: { name: string; id: string }[];
  emit(event: Event): Promise<void>;
  setMode?(mode: "live" | "template" | "off"): void;
}

export function namesAreKnown(text: string, facts: string[]): boolean {
  return unknownName(text, facts) === null;
}

/** The first capitalised word that is not in the facts, or null when every name is known. */
export function unknownName(text: string, facts: string[]): string | null {
  // A joined word in a note ("Cantonese-style") also vouches for its parts, which a draft may use alone.
  const known = new Set(
    facts.flatMap((fact) =>
      words(fact).flatMap((word) => {
        const lower = word.toLocaleLowerCase();
        return [lower, ...lower.split(/[-'’]/)];
      }),
    ),
  );
  const allowed = new Set([
    "the",
    "a",
    "an",
    "this",
    "these",
    "those",
    "nearby",
    "around",
    "with",
    "from",
    "each",
    "here",
    "there",
    "natural",
    "bright",
    "soft",
    "warm",
    "calm",
    "open",
    "local",
    "home",
    "easy",
    "simple",
    "considered",
    "and",
    "for",
    "in",
    "on",
    "to",
    "of",
    "at",
    "is",
    "are",
    "has",
    "while",
    "where",
    "that",
    "which",
    "can",
    "will",
    "its",
    "by",
    "as",
    "days",
    "months",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]);
  for (const sentence of text.split(/[.!?]+/)) {
    const sentenceWords = words(sentence);
    // Sentence openings are ignored because ordinary prose capitalizes them.
    for (const word of sentenceWords.slice(1)) {
      if (!/^[A-Z][a-z]{2,}$/.test(word)) continue;
      const normalized = word.toLocaleLowerCase();
      if (!known.has(normalized) && !allowed.has(normalized)) return word;
    }
  }
  return null;
}

/** The writer's two jobs. The facts name what the home has apart from what is near it, so places never borrow
 *  the home's features, and no line may say who the home suits (fair housing). */
export const INTRO_PROMPT = [
  "You write the opening line of a home staging brief.",
  "The facts give the area, home_features (things the home itself has) and nearby_places",
  "(real places in the area, not part of the home).",
  "Write ONE sentence of at most 25 words about the home and its area. Use only the facts.",
  "Do not name any place, brand or city that is not in the facts.",
  "Do not describe people, households, ages, or who the home suits.",
  "Use no word for a nationality, ethnicity, language or religion. Plain text, no quotes.",
].join(" ");
export const PARAGRAPH_PROMPT = [
  "You write a listing paragraph of 60 to 80 words.",
  "home_features are things the home itself has: open with them.",
  "nearby_places are real places in the area, each with a short note about it.",
  "They are not part of the home. If places_span is city, say they are in the area, never that they are nearby.",
  "Pick three of them and give each a few words drawn from its note.",
  "Do not name any other place, brand or city.",
  "Do not describe people, households, ages, or who the home suits. No prices, schools or safety claims.",
  "Never write the phrases ideal for or perfect for.",
  "Use no word for a nationality, ethnicity, language or religion unless that exact word is in a note.",
  "One paragraph of plain prose.",
].join(" ");
const NOTE_CHARS = 120;

export interface WriterFacts {
  area: string;
  places_span: "neighbourhood" | "city";
  home_features: string[];
  nearby_places: { name: string; about: string }[];
}

/** Builds what the writer sees. A place note that fails the fair housing scan is left out, not passed on. */
export function writerFacts(
  area: string,
  relaxed: boolean,
  features: string[],
  places: { name: string; detail?: string }[],
): WriterFacts {
  return {
    area,
    places_span: relaxed ? "city" : "neighbourhood",
    home_features: [...new Set(features)],
    nearby_places: places.map((place) => {
      const note = cutAtWord(place.detail ?? "", NOTE_CHARS);
      return { name: place.name, about: scanText(note).length ? "" : note };
    }),
  };
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)).trim();
}

function words(text: string): string[] {
  return text.match(/[\p{L}][\p{L}'’-]*/gu) ?? [];
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

/** "Hyde Park" plus "Chicago" gives "Hyde Park, Chicago"; a name that already holds the city is sent as typed. */
export function withCity(neighbourhood: string, city: string): string {
  return normalize(neighbourhood).includes(normalize(city))
    ? neighbourhood
    : `${neighbourhood}, ${city}`;
}

/** True when Qloo resolved the neighbourhood query to a place whose name lacks the neighbourhood's words. */
export function readAsCity(localityName: string, neighbourhood: string): boolean {
  const named = new Set(words(normalize(localityName)));
  return words(normalize(neighbourhood)).some((word) => !named.has(word));
}

export function wrongCity(disambiguation: string, city: string): boolean {
  const actual = new Set(words(normalize(disambiguation)));
  return words(normalize(city)).some((word) => !actual.has(word));
}

function legacyVerdicts(
  picks: Pick[],
  rows: { name: string; id?: string; affinity?: number }[],
): AuditRow[] {
  const scored = picks
    .filter((pick) => typeof pick.affinity === "number")
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));
  const top = Math.max(0, ...scored.map((pick) => pick.affinity ?? 0));
  const roomIds = new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
  const offered = new Set<string>();
  return rows.map((row) => {
    if (!row.id) return { name: row.name, verdict: "unknown" };
    const affinity = row.affinity ?? 0;
    const gap = Math.round((top - affinity) * 1000) / 1000;
    const verdict =
      affinity === 0 || gap > 0.06 ? "cut" : gap > 0.02 ? "swap" : "keep";
    const swap =
      verdict === "keep"
        ? undefined
        : scored.find(
            (item) =>
              item.id !== row.id &&
              !roomIds.has(item.id) &&
              !offered.has(item.id),
          );
    if (swap) offered.add(swap.id);
    return {
      ...row,
      affinity,
      verdict,
      gap,
      ...(swap
        ? {
            swap: {
              id: swap.id,
              name: swap.name,
              affinity: swap.affinity ?? 0,
            },
          }
        : {}),
    };
  });
}

export const verdicts = legacyVerdicts;

export function catalogVerdicts(
  catalog: Entity[],
  rows: { name: string; id?: string }[],
  roomScores: Entity[],
): AuditRow[] {
  const ranked = catalog
    .filter((item) => typeof item.affinity === "number")
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));
  const roomIds = new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
  const offered = new Set<string>();
  return rows.map((row) => {
    if (!row.id) {
      return {
        name: row.name,
        verdict: "unknown",
        better_than: 0,
        of: ranked.length,
      };
    }
    const scored = roomScores.find((item) => item.id === row.id);
    if (!scored || typeof scored.affinity !== "number") {
      return {
        name: row.name,
        id: row.id,
        verdict: "cut",
        better_than: 0,
        reason: "no pull here",
        of: ranked.length,
      };
    }
    const better = ranked.filter(
      (item) => (item.affinity ?? 0) < scored.affinity!,
    ).length;
    const betterThan = ranked.length ? better / ranked.length : 0;
    const verdict =
      betterThan >= 0.6 ? "keep" : betterThan >= 0.3 ? "swap" : "cut";
    const swap =
      verdict === "keep"
        ? undefined
        : ranked.find((item) => !roomIds.has(item.id) && !offered.has(item.id));
    if (swap) offered.add(swap.id);
    return {
      name: row.name,
      id: row.id,
      affinity: scored.affinity,
      verdict,
      better_than: Math.round(betterThan * 1000) / 1000,
      of: ranked.length,
      ...(swap
        ? {
            swap: {
              id: swap.id,
              name: swap.name,
              affinity: swap.affinity ?? 0,
            },
          }
        : {}),
    };
  });
}

export function shortBook(entity: Entity): Entity {
  if (entity.type !== "book") return entity;
  const full = entity.name;
  const colon = full.indexOf(":");
  if (colon >= 0 && colon < 60) {
    return { ...entity, name: full.slice(0, colon).trim(), detail: full };
  }
  if (full.length <= 60) return entity;
  const prefix = full.slice(0, 60);
  const boundary =
    full[60] === " " ? prefix : prefix.slice(0, prefix.lastIndexOf(" "));
  return { ...entity, name: boundary.trim(), detail: full };
}

export async function run(
  request: StageRequest,
  deps: RunDeps,
): Promise<Event[]> {
  const events: Event[] = [];
  const emit = async (event: Event) => {
    events.push(event);
    await deps.emit(event);
  };
  let callCount = 0;
  let upstream = 0;
  let cachedCount = 0;
  let neurons = 0;
  const callBudget = new RunCallBudget();
  const anchors: { id: string; name: string }[] = [];
  const call = async (
    path: string,
    what: string,
    operation: () => Promise<{
      results: Entity[];
      cached: boolean;
      locality?: { id: string; name: string; disambiguation: string } | null;
    }>,
  ) => {
    if (!callBudget.take())
      throw new Error("This brief has reached its question limit.");
    const started = Date.now();
    const answer = await operation();
    callCount++;
    if (answer.cached) cachedCount++;
    else upstream++;
    await emit({
      t: "call",
      n: callCount,
      path,
      what,
      cached: answer.cached,
      ms: Date.now() - started,
      count: answer.results.length,
    });
    return answer;
  };
  await emit({
    t: "plan",
    budget: 16,
    steps: [
      "resolve buyer",
      "place and brands",
      "books, playlist, places",
      "room",
      "audit",
      "write",
    ],
  });
  try {
    for (const name of request.lens.anchors.slice(0, 3)) {
      const result = await call("/search", name, () =>
        deps.qloo.search(name, undefined, 1),
      );
      const hit = result.results[0];
      if (hit) {
        anchors.push({ id: hit.id, name });
        await emit({
          t: "resolved",
          kind: "anchor",
          name,
          as: `${hit.name} (${hit.type})`,
          id: hit.id,
        });
      } else {
        await emit({ t: "resolved", kind: "anchor", name, as: "not found" });
      }
    }
    if (!anchors.length) {
      await emit({
        t: "error",
        text: "No buyer loves matched. Try different names or a preset.",
      });
      return events;
    }
    let scope = request.neighbourhood || request.city;
    // Qloo reads a bare neighbourhood name anywhere ("Hyde Park" became Tampa), so it is always sent with its city.
    let where = request.neighbourhood
      ? withCity(request.neighbourhood, request.city)
      : request.city;
    let brandAnswer = await call("/v2/insights", scope, () =>
      deps.qloo.insights({
        seedIds: anchors.map((anchor) => anchor.id),
        type: "brand",
        location: where,
        excludeIds: [],
        take: 10,
      }),
    );
    const wrong = request.neighbourhood
      ? wrongCity(brandAnswer.locality?.disambiguation ?? "", request.city)
      : false;
    if (request.neighbourhood && (brandAnswer.results.length < 3 || wrong)) {
      const why = wrong
        ? [
            `Qloo read ${request.neighbourhood} as `,
            `${brandAnswer.locality?.disambiguation || "an unknown area"}; `,
            `using ${request.city}`,
          ].join("")
        : [
            `Qloo has thin data for ${request.neighbourhood}; `,
            `using ${request.city}`,
          ].join("");
      await emit({
        t: "relax",
        from: request.neighbourhood,
        to: request.city,
        why,
      });
      scope = request.city;
      where = request.city;
      brandAnswer = await call("/v2/insights", scope, () =>
        deps.qloo.insights({
          seedIds: anchors.map((anchor) => anchor.id),
          type: "brand",
          location: where,
          take: 10,
        }),
      );
    }
    else if (
      request.neighbourhood &&
      brandAnswer.locality &&
      readAsCity(brandAnswer.locality.name, request.neighbourhood)
    ) {
      // Qloo answered for the whole city; the lists are already the city's, so no second call is needed.
      await emit({
        t: "relax",
        from: request.neighbourhood,
        to: request.city,
        why: `Qloo read ${request.neighbourhood} as ${request.city}; using ${request.city}`,
      });
      scope = request.city;
    }
    if (brandAnswer.results.length < 3 && scope === request.city) {
      await emit({
        t: "relax",
        from: scope,
        to: "all locations",
        why: `Qloo has thin data for ${scope}; using taste alone`,
      });
      scope = "";
      where = "";
      brandAnswer = await call("/v2/insights", "all locations", () =>
        deps.qloo.insights({
          seedIds: anchors.map((anchor) => anchor.id),
          type: "brand",
          take: 10,
        }),
      );
    }
    if (brandAnswer.locality) {
      await emit({
        t: "resolved",
        kind: "scope",
        name: scope || request.city,
        as: brandAnswer.locality.disambiguation,
        id: brandAnswer.locality.id,
      });
    }
    const brands = brandAnswer.results.map((entity) =>
      whyLine(entity, anchors, scope || request.city),
    );
    await emit({
      t: "section",
      key: "brands",
      items: brands,
      ...(brands.length < 3 ? { thin: true as const } : {}),
    });
    const books = await call("/v2/insights", "books", () =>
      deps.qloo.insights({
        seedIds: anchors.map((anchor) => anchor.id),
        type: "book",
        location: where || undefined,
        take: 6,
      }),
    );
    const artists = await call("/v2/insights", "playlist", () =>
      deps.qloo.insights({
        seedIds: anchors.map((anchor) => anchor.id),
        type: "artist",
        location: where || undefined,
        take: 8,
      }),
    );
    const places = await call("/v2/insights", "places", () =>
      deps.qloo.insights({
        seedIds: anchors.map((anchor) => anchor.id),
        type: "place",
        location: where || undefined,
        popularityMax: 0.95,
        take: 6,
      }),
    );
    const localPlaces = places.results.filter(
      (place) =>
        !/\b(church|mosque|synagogue|temple|school|university|college)\b/i.test(
          [place.name, place.detail, place.address].filter(Boolean).join(" "),
        ),
    );
    const sections = [
      { key: "books" as const, items: books.results.map(shortBook) },
      { key: "playlist" as const, items: artists.results },
      { key: "places" as const, items: localPlaces },
    ];
    for (const section of sections) {
      const items = section.items.map((entity) =>
        whyLine(entity, anchors, scope || request.city),
      );
      await emit({
        t: "section",
        key: section.key,
        items,
        ...(items.length < 3 ? { thin: true as const } : {}),
      });
    }
    const roomHits: { name: string; id?: string }[] = [];
    for (const name of request.room.slice(0, 6)) {
      const found = await call("/search", name, () =>
        deps.qloo.search(name, "brand", 1),
      );
      const hit = found.results[0];
      roomHits.push({ name, ...(hit ? { id: hit.id } : {}) });
      await emit({
        t: "resolved",
        kind: "room",
        name,
        as: hit ? `${hit.name} (brand)` : "not in Qloo",
        ...(hit ? { id: hit.id } : {}),
      });
    }
    const roomIds = roomHits.flatMap((hit) => (hit.id ? [hit.id] : []));
    const catalog = deps.catalog ?? [];
    const readyCatalog = catalog.length >= 10;
    if (!readyCatalog) {
      await emit({
        t: "fallback",
        what: "room audit",
        why: "catalog not ready; using today's audit",
      });
    }
    const ids = [
      ...new Set([
        ...roomIds,
        ...(readyCatalog ? catalog.map((item) => item.id) : []),
      ]),
    ];
    const auditResult = ids.length
      ? await call("/v2/insights", "room audit", () =>
          deps.qloo.insights({
            seedIds: anchors.map((anchor) => anchor.id),
            type: "brand",
            location: where || undefined,
            resultIds: ids,
            take: ids.length,
          }),
        )
      : { results: [], cached: true };
    const scoredRoom = auditResult.results.filter((item) =>
      roomIds.includes(item.id),
    );
    const rows = readyCatalog
      ? catalogVerdicts(
          auditResult.results.filter((item) =>
            catalog.some((brand) => brand.id === item.id),
          ),
          roomHits,
          scoredRoom,
        )
      : legacyVerdicts(
          brands,
          roomHits.map((item) => ({
            ...item,
            ...(scoredRoom.find((entity) => entity.id === item.id)?.affinity ===
            undefined
              ? {}
              : {
                  affinity: scoredRoom.find((entity) => entity.id === item.id)!
                    .affinity,
                }),
          })),
        );
    await emit({ t: "audit", rows });
    const baseFacts = {
      scope: scope || request.city,
      places: localPlaces.map((place) => place.name),
      features: request.features,
    };
    const plain = safeTemplate(baseFacts);
    const toWriter = writerFacts(
      scope || request.city,
      scope !== request.neighbourhood,
      request.features,
      localPlaces,
    );
    const known = [
      toWriter.area,
      request.city,
      request.neighbourhood ?? "",
      ...toWriter.home_features,
      ...toWriter.nearby_places.flatMap((place) => [place.name, place.about]),
    ];
    let intro = plain.intro;
    let paragraph = plain.paragraph;
    let writtenBy: "model" | "template" = "template";
    const reservations: NonNullable<Awaited<ReturnType<Budget["reserve"]>>>[] =
      [];
    if (deps.writer) {
      for (let index = 0; index < 2; index++) {
        const reservation = await deps.budget.reserve();
        if (!reservation) break;
        reservations.push(reservation);
      }
    }
    const writer =
      deps.writer && reservations.length === 2 ? deps.writer : undefined;
    deps.setMode?.(writer ? "live" : "template");
    if (deps.writer && !writer) {
      for (const reservation of reservations) await reservation.settle(0);
      await emit({
        t: "fallback",
        what: "intro and paragraph",
        why: "writing budget spent",
      });
    }
    if (writer) {
      const prompts = [
        ["intro", INTRO_PROMPT, 80],
        ["paragraph", PARAGRAPH_PROMPT, 220],
      ] as const;
      for (const [what, prompt, max] of prompts) {
        const held = reservations.shift();
        if (!held) break;
        try {
          const reply = await writer.write(prompt, toWriter, max);
          const spent =
            reply.neurons ??
            neuronsFor(reply.prompt_tokens, reply.completion_tokens);
          neurons += spent;
          await held.settle(spent);
          const text = reply.content.trim();
          const blocked = scanText(text);
          const stranger = unknownName(text, known);
          // A reply stopped at the token limit ends mid sentence, so it is never shown.
          const cut = reply.finish === "length";
          if (!text || cut || blocked.length || stranger) {
            const why = cut
              ? "cut short"
              : blocked.length
                ? "fair housing scan"
                : "names check";
            // The run log names what was caught, so the guard can be seen working.
            const detail = cut ? "" : blocked.length ? blocked.join(", ") : (stranger ?? "");
            await emit({ t: "fallback", what, why, ...(detail ? { detail } : {}) });
            continue;
          }
          if (what === "intro") intro = text;
          else paragraph = text;
          writtenBy = "model";
        } catch {
          await held.settle(0);
          await emit({ t: "fallback", what, why: "writing service error" });
        }
      }
    }
    for (const reservation of reservations) await reservation.settle(0);
    await emit({
      t: "brief",
      intro,
      paragraph,
      written_by: writtenBy,
      scope: scope || request.city,
      lens: request.lens.label,
    });
    await emit({
      t: "usage",
      qloo_upstream: upstream,
      qloo_cached: cachedCount,
      neurons: Math.round(neurons * 10) / 10,
      quota_left: (await deps.qloo.quotaLeft?.()) ?? null,
    });
  } catch (error) {
    deps.setMode?.("off");
    const message =
      error instanceof QlooError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The brief could not be completed.";
    await emit({ t: "error", text: message });
  }
  return events;
}
