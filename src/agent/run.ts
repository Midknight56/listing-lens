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
  const known = new Set(
    facts.flatMap((fact) =>
      words(fact).map((word) => word.toLocaleLowerCase()),
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
      if (!known.has(normalized) && !allowed.has(normalized)) return false;
    }
  }
  return true;
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
    let brandAnswer = await call("/v2/insights", scope, () =>
      deps.qloo.insights({
        seedIds: anchors.map((anchor) => anchor.id),
        type: "brand",
        location: scope,
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
      brandAnswer = await call("/v2/insights", scope, () =>
        deps.qloo.insights({
          seedIds: anchors.map((anchor) => anchor.id),
          type: "brand",
          location: scope,
          take: 10,
        }),
      );
    }
    if (brandAnswer.results.length < 3 && scope === request.city) {
      await emit({
        t: "relax",
        from: scope,
        to: "all locations",
        why: `Qloo has thin data for ${scope}; using taste alone`,
      });
      scope = "";
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
        location: scope || undefined,
        take: 6,
      }),
    );
    const artists = await call("/v2/insights", "playlist", () =>
      deps.qloo.insights({
        seedIds: anchors.map((anchor) => anchor.id),
        type: "artist",
        location: scope || undefined,
        take: 8,
      }),
    );
    const places = await call("/v2/insights", "places", () =>
      deps.qloo.insights({
        seedIds: anchors.map((anchor) => anchor.id),
        type: "place",
        location: scope || undefined,
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
            location: scope || undefined,
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
        [
          "intro",
          "Write one concise home staging introduction from these facts only.",
          60,
        ],
        [
          "paragraph",
          "Write an 80 word listing paragraph from these facts only.",
          150,
        ],
      ] as const;
      for (const [what, prompt, max] of prompts) {
        const held = reservations.shift();
        if (!held) break;
        try {
          const reply = await writer.write(prompt, baseFacts, max);
          const spent =
            reply.neurons ??
            neuronsFor(reply.prompt_tokens, reply.completion_tokens);
          neurons += spent;
          await held.settle(spent);
          const text = reply.content.trim();
          const facts = [
            baseFacts.scope,
            ...baseFacts.places,
            ...baseFacts.features,
          ];
          const clean = scanText(text).length === 0;
          if (!text || !clean || !namesAreKnown(text, facts)) {
            await emit({
              t: "fallback",
              what,
              why: clean ? "names check" : "fair housing scan",
            });
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
