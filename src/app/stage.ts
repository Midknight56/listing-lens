import { scanInput } from "../fairhousing";
import { DEFAULT_ACCOUNT_NEURONS, DEFAULT_DAILY_NEURONS } from "../limits";
import { run, type StageRequest } from "../agent/run";
import type { Event } from "../agent/events";
import type { QlooClient } from "../qloo/client";
import {
  BriefStore,
  D1Cache,
  NeuronLedger,
  runKey,
  type D1Like,
} from "../store/d1";
import type { AiBinding, TextWriter } from "../agent/model";
import { FEATURES, preset, presetLensKey } from "./presets";

export interface StageEnv {
  DB: D1Like;
  LEDGER?: D1Like;
  QLOO_KEY?: string;
  SESSION_SECRET?: string;
  WRITER?: AiBinding;
  COUNTERS?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}
export interface StageDeps {
  qloo: QlooClient;
  writer?: TextWriter;
  catalog?: { name: string; id: string }[];
  count?(kind: "fresh" | "plain", request: Request): Promise<boolean>;
}

function parse(raw: unknown): StageRequest | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return "Send a brief as JSON.";
  const data = raw as Record<string, unknown>;
  if (
    typeof data.city !== "string" ||
    data.city.trim().length < 2 ||
    data.city.length > 60
  ) {
    return "Enter a city between 2 and 60 characters.";
  }
  const neighbourhood =
    data.neighbourhood === undefined ? "" : data.neighbourhood;
  if (typeof neighbourhood !== "string" || neighbourhood.length > 60) {
    return "Keep the neighbourhood to 60 characters.";
  }
  const lens = data.lens as Record<string, unknown> | undefined;
  if (
    !lens ||
    typeof lens.label !== "string" ||
    lens.label.length < 2 ||
    lens.label.length > 60 ||
    !Array.isArray(lens.anchors) ||
    lens.anchors.length < 1 ||
    lens.anchors.length > 3 ||
    lens.anchors.some(
      (value) =>
        typeof value !== "string" ||
        value.trim().length < 2 ||
        value.length > 60,
    )
  )
    return "Give one to three buyer interests, each between 2 and 60 characters.";
  const room = data.room ?? [];
  if (
    !Array.isArray(room) ||
    room.length > 6 ||
    room.some(
      (value) =>
        typeof value !== "string" ||
        value.trim().length < 2 ||
        value.length > 60,
    )
  ) {
    return "List up to six brand names, each between 2 and 60 characters.";
  }
  const features = data.features ?? [];
  if (
    !Array.isArray(features) ||
    features.length > 6 ||
    features.some(
      (value) => typeof value !== "string" || !FEATURES.includes(value),
    )
  ) {
    return "Choose up to six listed home features.";
  }
  const request: StageRequest = {
    city: data.city.trim(),
    ...(neighbourhood.trim() ? { neighbourhood: neighbourhood.trim() } : {}),
    lens: {
      label: lens.label.trim(),
      anchors: (lens.anchors as string[]).map((value) => value.trim()),
    },
    room: (room as string[]).map((value) => value.trim()),
    features: features as string[],
  };
  if (typeof data.preset === "string") request.preset = data.preset;
  const banned = scanInput(request);
  return banned.length
    ? "Please remove a phrase that describes the people who might live in the home."
    : request;
}

export function send(events: Event[], status = 200): Response {
  return new Response(
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    {
      status,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function hasBrief(events: Event[]): boolean {
  return (
    events.some((event) => event.t === "brief") &&
    !events.some((event) => event.t === "error")
  );
}

function replayEvents(
  id: string,
  events: Event[],
  recordedAt: string,
): Event[] {
  return [
    { t: "run", id, mode: "replay", recorded_at: recordedAt },
    ...events.filter((event) => event.t !== "run" && event.t !== "done"),
    { t: "done" },
  ];
}

export async function stage(
  request: Request,
  env: StageEnv,
  deps: StageDeps,
): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  if (!env.SESSION_SECRET) {
    return send(
      [
        { t: "error", text: "Live staging is not configured right now." },
        { t: "done" },
      ],
      503,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return send(
      [{ t: "error", text: "Send a brief as JSON." }, { t: "done" }],
      400,
    );
  }
  const parsed = parse(body);
  if (typeof parsed === "string")
    return send([{ t: "error", text: parsed }, { t: "done" }], 400);
  const selectedPreset = parsed.preset ? preset(parsed.preset) : undefined;
  if (parsed.preset && !selectedPreset) {
    return send(
      [{ t: "error", text: "That example is not available." }, { t: "done" }],
      400,
    );
  }
  const store = new BriefStore(env.DB);
  const key = await runKey(JSON.stringify({ ...parsed, preset: undefined }));
  // Keep a second key so a changed preset request can recover its last brief.
  const recordingKey = selectedPreset
    ? await runKey(
        JSON.stringify({
          preset_record: `${selectedPreset.id}:${presetLensKey(selectedPreset, parsed.lens.label)}`,
        }),
      )
    : null;
  const cachedId = await store.cached(key);
  if (cachedId) {
    const saved = await store.get(cachedId);
    if (saved && hasBrief(saved.events)) {
      return send(
        selectedPreset
          ? replayEvents(saved.id, saved.events, saved.recorded_at)
          : [
              { t: "run", id: saved.id, mode: "cache" },
              ...saved.events.filter(
                (event) => event.t !== "run" && event.t !== "done",
              ),
              { t: "done" },
            ],
      );
    }
  }
  const recordedId = recordingKey ? await store.cached(recordingKey) : null;
  const fallback = async (status: number): Promise<Response | null> => {
    if (!selectedPreset || !recordedId) return null;
    const saved = await store.get(recordedId);
    if (!saved || !hasBrief(saved.events)) return null;
    return send(
      replayEvents(saved.id, saved.events, saved.recorded_at),
      status,
    );
  };
  if (deps.count && !(await deps.count("fresh", request))) {
    const saved = await fallback(200);
    if (saved) return saved;
    return send(
      [
        { t: "run", id: crypto.randomUUID(), mode: "off" },
        {
          t: "error",
          text: "You have staged three briefs today. Try again tomorrow or open an example.",
        },
        { t: "done" },
      ],
      429,
    );
  }
  const id = crypto.randomUUID();
  const ledger = new NeuronLedger(env.LEDGER ?? env.DB, {
    app: "listing-lens",
    dailyCap: DEFAULT_DAILY_NEURONS,
    accountCap: DEFAULT_ACCOUNT_NEURONS,
  });
  let mode: "live" | "template" | "off" = deps.writer ? "live" : "template";
  const events: Event[] = [{ t: "run", id, mode }];
  await run(parsed, {
    qloo: deps.qloo,
    ...(deps.writer ? { writer: deps.writer } : {}),
    catalog: deps.catalog,
    budget: ledger,
    setMode: (next) => {
      mode = next;
      events[0] = { t: "run", id, mode };
    },
    emit: async (event) => {
      events.push(event);
    },
  });
  if (events.at(-1)?.t !== "done") events.push({ t: "done" });
  if (!hasBrief(events)) {
    const saved = await fallback(200);
    if (saved) return saved;
    return send(events, 503);
  }
  await store.save(id, parsed, events, mode);
  await store.cache(key, id);
  if (recordingKey) await store.cache(recordingKey, id);
  return send(events);
}

export async function brief(id: string, env: StageEnv): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/.test(id))
    return new Response("Not found", { status: 404 });
  const saved = await new BriefStore(env.DB).get(id);
  return saved
    ? Response.json(saved, { headers: { "Cache-Control": "no-store" } })
    : new Response("Not found", { status: 404 });
}

/** True only when the secret warm token is set and the request carries it (the owner's recording runs). */
export function isOperator(request: Request, env: { WARM_TOKEN?: string }): boolean {
  const token = request.headers.get("X-Warm-Token");
  return Boolean(env.WARM_TOKEN) && token === env.WARM_TOKEN;
}

export async function visitorOf(
  request: Request,
  secret: string,
): Promise<string> {
  // Hash the address before it becomes a persistent counter name.
  const address =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "visitor";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:${address}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function cachedCatalog(
  env: StageEnv,
): Promise<{ name: string; id: string }[]> {
  return new D1Cache(env.DB).catalogIds();
}
