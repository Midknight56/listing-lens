import { scanText } from "../fairhousing";
import { neuronsFor, type TextWriter } from "../agent/model";
import type { Entity, QlooClient } from "../qloo/client";
import { NeuronLedger } from "../store/d1";
import { DEFAULT_ACCOUNT_NEURONS, DEFAULT_DAILY_NEURONS, visitorCaps } from "../limits";
import { brief, send, type StageEnv } from "./stage";

interface PlainIdeas {
  brands: string[];
  places: string[];
}
/** The model's own picks with no taste data. The room's brands go in as "avoid", and eight brands are asked for, so
 *  four remain after echoes and scanned names are dropped: with six asked and the room sent as "room", the model gave
 *  back the room's own brands and left too few in 3 of 6 Silver Lake replies; with this prompt, 6 of 6 passed. */
export const PLAIN_PROMPT = [
  "From general knowledge only, suggest eight furniture or home decor brands and six real places in the city",
  "(restaurants, bars, shops, venues) that a buyer with these interests might like.",
  "Never suggest a brand listed in avoid, an interest or the city name.",
  "Answer with JSON only, using exactly the keys brands and places, each a list of names.",
].join(" ");

export type PlainCheck = PlainIdeas | { fault: "parse" | "short" | "scan"; terms?: string[] };

/** Reads four brands and four places, dropping any name that only repeats the input (an interest, a room brand, the
 *  city), since an echo says nothing about what the model knows, and any name the fair housing scan flags. Says which
 *  check failed when four of each do not remain. */
export function checkPlain(text: string, echoes: string[] = []): PlainCheck {
  const repeated = new Set(echoes.map((name) => name.trim().toLocaleLowerCase()));
  const first = text.indexOf("{"),
    last = text.lastIndexOf("}");
  if (first < 0 || last < first) return { fault: "parse" };
  let value: { brands?: unknown; places?: unknown };
  try {
    value = JSON.parse(text.slice(first, last + 1)) as typeof value;
  } catch {
    return { fault: "parse" };
  }
  if (!Array.isArray(value.brands) || !Array.isArray(value.places)) return { fault: "parse" };
  const terms = new Set<string>();
  const clean = (list: unknown[]) =>
    list
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item && !repeated.has(item.toLocaleLowerCase()))
      .filter((item) => {
        const hits = scanText(item);
        hits.forEach((term) => terms.add(term));
        return !hits.length;
      })
      .slice(0, 4);
  const brands = clean(value.brands),
    places = clean(value.places);
  if (brands.length === 4 && places.length === 4) return { brands, places };
  return terms.size ? { fault: "scan", terms: [...terms] } : { fault: "short" };
}

export function ideas(text: string, echoes: string[] = []): PlainIdeas | null {
  const read = checkPlain(text, echoes);
  return "fault" in read ? null : read;
}
export async function plain(
  request: Request,
  env: StageEnv,
  deps: {
    writer?: TextWriter;
    qloo: QlooClient;
    count?(kind: "plain", request: Request): Promise<boolean>;
  },
): Promise<Response> {
  const fail = (text: string, status = 503) =>
    send([{ t: "error", text }, { t: "done" }], status);
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return fail("Send a brief id.", 400);
  }
  if (typeof body.id !== "string") return fail("Send a brief id.", 400);
  const response = await brief(body.id, env);
  if (!response.ok) return fail("That saved brief is not available.", 404);
  if (deps.count && !(await deps.count("plain", request)))
    return fail(
      visitorCaps().plain === 2
        ? "You have opened the plain tab twice today."
        : `You have opened the plain tab ${visitorCaps().plain} times today.`,
      429,
    );
  if (!deps.writer) return fail("Plain writing is off right now.");
  const saved = (await response.json()) as {
    request: {
      city: string;
      lens: { label: string; anchors: string[] };
      room: string[];
    };
    events: {
      t: string;
      scope?: string;
      key?: string;
      items?: { name?: string }[];
    }[];
  };
  const scope =
    saved.events.find((event) => event.t === "brief")?.scope ??
    saved.request.city;
  const ledger = new NeuronLedger(env.LEDGER ?? env.DB, {
    app: "listing-lens",
    dailyCap: DEFAULT_DAILY_NEURONS,
    accountCap: DEFAULT_ACCOUNT_NEURONS,
  });
  const events: import("../agent/events").Event[] = [
    { t: "run", id: body.id, mode: "live" },
  ];
  const echoes = [scope, saved.request.city, ...saved.request.lens.anchors, ...saved.request.room];
  // One more try when a reply fails a check. Each try holds its own place in the ledger, so the daily caps still hold.
  let result: PlainIdeas | null = null;
  for (let attempt = 1; attempt <= 2 && !result; attempt++) {
    const held = await ledger.reserve();
    if (!held)
      return attempt === 1
        ? fail("Writing budget is spent for today.", 429)
        : fail("Plain picks did not pass the text check.", 422);
    let reply;
    try {
      reply = await deps.writer.write(
        PLAIN_PROMPT,
        { city: scope, interests: saved.request.lens.anchors, avoid: saved.request.room },
        220,
      );
    } catch {
      await held.settle(0);
      return fail("Plain picks are unavailable right now.");
    }
    await held.settle(reply.neurons ?? neuronsFor(reply.prompt_tokens, reply.completion_tokens));
    const read = checkPlain(reply.content, echoes);
    if ("fault" in read)
      // The check and the reply's length only, never the reply's text.
      console.warn(
        JSON.stringify({
          at: "plain",
          attempt,
          check: read.fault,
          length: reply.content.length,
          finish: reply.finish ?? null,
          ...(read.terms ? { terms: read.terms } : {}),
        }),
      );
    else result = read;
  }
  if (!result) return fail("Plain picks did not pass the text check.", 422);
  try {
    const anchors = (
      await Promise.all(
        saved.request.lens.anchors.map((anchor) =>
          deps.qloo.search(anchor, undefined, 1),
        ),
      )
    ).flatMap((answer) => answer.results.slice(0, 1));
    const brands: { name: string; entity?: Entity }[] = [];
    for (const name of result.brands)
      brands.push({
        name,
        entity: (await deps.qloo.search(name, "brand", 1)).results[0],
      });
    const ids = brands.flatMap((brand) =>
      brand.entity ? [brand.entity.id] : [],
    );
    const scores =
      ids.length && anchors.length
        ? (
            await deps.qloo.insights({
              seedIds: anchors.map((entity) => entity.id),
              type: "brand",
              location: scope,
              resultIds: ids,
              take: 4,
            })
          ).results
        : [];
    const qlooPicks = new Map(scores.map((entity) => [entity.id, entity]));
    const plainBrands = brands.map((brand) => ({
      name: brand.name,
      found: Boolean(brand.entity),
      qloo_affinity: brand.entity
        ? (qlooPicks.get(brand.entity.id)?.affinity ?? null)
        : null,
    }));
    const qlooPlaces =
      saved.events
        .find((event) => event.t === "section" && event.key === "places")
        ?.items?.flatMap((item) =>
          item.name ? [item.name.toLocaleLowerCase()] : [],
        ) ?? [];
    const places = result.places.map((name) => ({
      name,
      found: qlooPlaces.includes(name.toLocaleLowerCase()),
    }));
    events.push({ t: "plain", brands: plainBrands, places }, { t: "done" });
    return send(events);
  } catch {
    return fail("Plain picks are unavailable right now.");
  }
}
