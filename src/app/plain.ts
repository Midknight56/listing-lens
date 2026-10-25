import { scanText } from "../fairhousing";
import { neuronsFor, type TextWriter } from "../agent/model";
import type { Entity, QlooClient } from "../qloo/client";
import { NeuronLedger } from "../store/d1";
import { DEFAULT_ACCOUNT_NEURONS, DEFAULT_DAILY_NEURONS } from "../limits";
import { brief, send, type StageEnv } from "./stage";

interface PlainIdeas {
  brands: string[];
  places: string[];
}
function ideas(text: string): PlainIdeas | null {
  const first = text.indexOf("{"),
    last = text.lastIndexOf("}");
  if (first < 0 || last < first) return null;
  try {
    const value = JSON.parse(text.slice(first, last + 1)) as {
      brands?: unknown;
      places?: unknown;
    };
    if (!Array.isArray(value.brands) || !Array.isArray(value.places))
      return null;
    const brands = value.brands
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);
    const places = value.places
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);
    return brands.length === 4 && places.length === 4
      ? { brands, places }
      : null;
  } catch {
    return null;
  }
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
    return fail("You have opened the plain tab twice today.", 429);
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
  const held = await ledger.reserve();
  if (!held) return fail("Writing budget is spent for today.", 429);
  const events: import("../agent/events").Event[] = [
    { t: "run", id: body.id, mode: "live" },
  ];
  let settled = false;
  try {
    const prompt = [
      "Return four furniture brand names and four local place names as JSON.",
      "Use exactly the keys brands and places.",
      "Use only the city, interests and room facts given.",
    ].join(" ");
    const reply = await deps.writer.write(
      prompt,
      {
        city: scope,
        interests: saved.request.lens.anchors,
        lens: saved.request.lens.label,
        room: saved.request.room,
      },
      220,
    );
    await held.settle(
      reply.neurons ?? neuronsFor(reply.prompt_tokens, reply.completion_tokens),
    );
    settled = true;
    const result = ideas(reply.content);
    if (!result || scanText(reply.content).length)
      return fail("Plain picks did not pass the text check.", 422);
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
    if (!settled) await held.settle(0);
    return fail("Plain picks are unavailable right now.");
  }
}
