import { DurableObject } from "cloudflare:workers";
import {
  stage,
  brief,
  cachedCatalog,
  visitorOf,
  type StageEnv,
} from "./app/stage";
import { presetsPayload } from "./app/presets";
import { HOME_BRANDS } from "./agent/catalog";
import { plain } from "./app/plain";
import { D1Cache, type D1Like } from "./store/d1";
import { counterKey, VisitorCaps } from "./store/caps";
import { QlooClient, workerFetch } from "./qloo/client";
import { BoundTextWriter, type AiBinding } from "./agent/model";
import { McpServer } from "./mcp/server";
import { qlooTools } from "./qloo/tools";

interface Env extends StageEnv {
  DB: D1Like;
  LEDGER: D1Like;
  WRITER?: AiBinding;
  QLOO_KEY?: string;
  SESSION_SECRET?: string;
  WARM_TOKEN?: string;
  COUNTERS: DurableObjectNamespace<DailyCounter>;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export class DailyCounter extends DurableObject {
  async get(day: string): Promise<number> {
    return (await this.ctx.storage.get<number>(day)) ?? 0;
  }

  async put(day: string, value: number, ttl: number): Promise<void> {
    await this.ctx.storage.put(day, value);
    await this.ctx.storage.setAlarm(Date.now() + ttl * 1000);
  }

  async take(day: string, limit: number): Promise<boolean> {
    const allowed = await this.ctx.storage.transaction(async (transaction) => {
      const current = (await transaction.get<number>(day)) ?? 0;
      if (current >= limit) return false;
      await transaction.put(day, current + 1);
      return true;
    });
    if (allowed) await this.ctx.storage.setAlarm(Date.now() + 86400 * 1000);
    return allowed;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      action?: string;
      day?: string;
      value?: number;
      cap?: number;
      ttl?: number;
    };
    if (!body.day)
      return Response.json({ error: "A day is required." }, { status: 400 });
    if (body.action === "put" && typeof body.value === "number") {
      await this.put(body.day, body.value, body.ttl ?? 86400);
    }
    if (body.action === "take" && typeof body.cap === "number") {
      return Response.json({ allowed: await this.take(body.day, body.cap) });
    }
    return Response.json({ value: await this.get(body.day) });
  }
}

function counter(env: Env, name: string): DurableObjectStub<DailyCounter> {
  return env.COUNTERS.get(env.COUNTERS.idFromName(name));
}

async function count(
  env: Env,
  visitor: string,
  kind: "fresh" | "plain" | "qloo",
): Promise<boolean> {
  const caps = new VisitorCaps({
    take: async (key, cap) => {
      const { day, name } = counterKey(key);
      return counter(env, name).take(day, cap);
    },
    get: async (key) => {
      const { day, name } = counterKey(key);
      return counter(env, name).get(day);
    },
    put: async (key, value, ttl) => {
      const { day, name } = counterKey(key);
      await counter(env, name).put(day, value, ttl);
    },
  });
  if (kind === "qloo") return caps.qloo(visitor);
  return kind === "fresh" ? caps.fresh(visitor) : caps.plain(visitor);
}

function ndjsonError(text: string, status: number): Response {
  const lines = [{ t: "error", text }, { t: "done" }];
  return new Response(
    lines.map((event) => JSON.stringify(event)).join("\n") + "\n",
    {
      status,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/api/presets") {
      return Response.json(presetsPayload());
    }
    if (url.pathname === "/api/warm") return warm(request, env);
    const requiresSession = ["/api/stage", "/api/plain", "/mcp"].includes(
      url.pathname,
    );
    if (requiresSession && !env.SESSION_SECRET) {
      return url.pathname === "/mcp"
        ? new Response("Service unavailable", { status: 503 })
        : ndjsonError("Live staging is not configured right now.", 503);
    }
    const session = env.SESSION_SECRET ?? "";
    const visitor = await visitorOf(request, session);
    const cache = new D1Cache(env.DB);
    const qloo = new QlooClient(env.QLOO_KEY ?? "", workerFetch, cache, () =>
      count(env, visitor, "qloo"),
    );
    const writer = env.WRITER ? new BoundTextWriter(env.WRITER) : undefined;
    if (url.pathname === "/api/stage") {
      return stage(request, env, {
        qloo,
        ...(writer ? { writer } : {}),
        catalog: await cachedCatalog(env),
        count: (kind) => count(env, visitor, kind),
      });
    }
    if (url.pathname === "/api/plain") {
      return plain(request, env, {
        qloo,
        ...(writer ? { writer } : {}),
        count: (kind) => count(env, visitor, kind),
      });
    }
    const briefMatch = /^\/api\/brief\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (briefMatch) return brief(briefMatch[1], env);
    const shareMatch = /^\/s\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (shareMatch) {
      const record = await brief(shareMatch[1], env);
      if (!record.ok) return record;
      const data = (await record.json()) as {
        events: { t: string; intro?: string; paragraph?: string }[];
      };
      const briefEvent = data.events.find((event) => event.t === "brief");
      const html =
        '<!doctype html><meta charset="utf-8"><title>Listing Lens brief</title>' +
        `<main><h1>${escape(briefEvent?.intro ?? "Staging brief")}</h1>` +
        `<p>${escape(briefEvent?.paragraph ?? "")}</p></main>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/mcp") {
      const server = new McpServer({
        info: {
          name: "listing-lens",
          title: "Listing Lens",
          version: "1.0.0",
          websiteUrl: "https://listing-lens.midknight-labs.workers.dev",
        },
        tools: qlooTools(),
        secret: session,
        allowOrigin: (origin) => origin.startsWith("https://listing-lens."),
        context: async () => ({ qloo, catalog: await cachedCatalog(env) }),
      });
      return server.handle(request);
    }
    return env.ASSETS.fetch(request);
  },
};

async function warm(request: Request, env: Env): Promise<Response> {
  if (
    !env.WARM_TOKEN ||
    request.headers.get("X-Warm-Token") !== env.WARM_TOKEN
  ) {
    return new Response("Not found", { status: 404 });
  }
  if (!env.SESSION_SECRET)
    return Response.json({ error: "Not configured." }, { status: 503 });
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const visitor = await visitorOf(request, env.SESSION_SECRET);
  const cache = new D1Cache(env.DB);
  const qloo = new QlooClient(env.QLOO_KEY ?? "", workerFetch, cache, () =>
    count(env, visitor, "qloo"),
  );
  const saved: string[] = [];
  for (const name of HOME_BRANDS) {
    try {
      const answer = await qloo.search(name, "brand", 1);
      const entity = answer.results[0];
      if (entity) {
        await cache.saveCatalogId(name, entity.id);
        saved.push(name);
      }
    } catch {
      return Response.json(
        { saved: saved.length, stopped: name },
        { status: 503 },
      );
    }
  }
  return Response.json({ saved: saved.length });
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}
