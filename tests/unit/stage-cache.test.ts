import { describe, expect, it } from "vitest";
import { PRESETS } from "../../src/app/presets";
import { stage, visitorOf } from "../../src/app/stage";
import { plain } from "../../src/app/plain";
import { BriefStore } from "../../src/store/d1";
import type { Entity, QlooClient } from "../../src/qloo/client";
import { FakeD1 } from "./fake-d1";

function entity(
  id: string,
  name: string,
  type = "brand",
  affinity = 0.8,
): Entity {
  return { id, name, type, affinity, tags: [] };
}

function dependencies(searchFails = false) {
  let searchCalls = 0;
  const qloo = {
    search: async (query: string, type?: string) => {
      searchCalls++;
      if (searchFails) throw new Error("synthetic upstream failure");
      return {
        cached: false,
        results: [
          entity(
            `ent-test-${String(searchCalls).padStart(4, "0")}`,
            query,
            type ?? "artist",
          ),
        ],
      };
    },
    insights: async ({
      type,
      resultIds,
    }: {
      type: string;
      resultIds?: string[];
    }) => ({
      cached: false,
      locality: {
        id: "ent-test-0099",
        name: "Sample District",
        disambiguation: "Sample District, Test City",
      },
      results: resultIds
        ? resultIds.map((id, index) => entity(id, `Room ${index}`, type, 0.7))
        : [
            entity("ent-test-0101", "Sample Pick One", type, 0.9),
            entity("ent-test-0102", "Sample Pick Two", type, 0.8),
            entity("ent-test-0103", "Sample Pick Three", type, 0.7),
          ],
    }),
    quotaLeft: async () => 40000,
  };
  return {
    qloo: qloo as unknown as QlooClient,
    searchCalls: () => searchCalls,
  };
}

function post(value: unknown): Request {
  return new Request("https://listing-lens.test/api/stage", {
    method: "POST",
    body: JSON.stringify(value),
  });
}

describe("run recording", () => {
  it("does not save or cache a failed run", async () => {
    const db = new FakeD1();
    const deps = dependencies(true);
    try {
      const response = await stage(
        post({
          city: "Test City",
          lens: { label: "Design forward", anchors: ["Test Anchor"] },
          room: [],
          features: [],
        }),
        { DB: db, SESSION_SECRET: "synthetic-secret" },
        { qloo: deps.qloo },
      );
      expect(response.status).toBe(503);
      const runCache = await db
        .prepare("SELECT COUNT(*) AS count FROM run_cache")
        .bind()
        .first<{ count: number }>();
      const briefs = await db
        .prepare("SELECT COUNT(*) AS count FROM briefs")
        .bind()
        .first<{ count: number }>();
      expect(runCache?.count).toBe(0);
      expect(briefs?.count).toBe(0);
      expect(deps.searchCalls()).toBe(1);
    } finally {
      db.close();
    }
  });

  it("replays a recorded preset before charging another fresh run", async () => {
    const db = new FakeD1();
    const preset = PRESETS[0];
    const deps = dependencies();
    const value = {
      city: preset.city,
      neighbourhood: preset.neighbourhood,
      lens: preset.lens,
      room: preset.room,
      features: preset.features,
      preset: preset.id,
    };
    try {
      const first = await stage(
        post(value),
        {
          DB: db,
          SESSION_SECRET: "synthetic-secret",
        },
        { qloo: deps.qloo },
      );
      const firstEvents = (await first.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(firstEvents.some((event) => event.t === "brief")).toBe(true);
      expect(firstEvents.find((event) => event.t === "usage").quota_left).toBe(
        40000,
      );
      expect(
        firstEvents.some(
          (event) =>
            event.t === "fallback" && event.why.includes("catalog not ready"),
        ),
      ).toBe(true);
      const callCount = deps.searchCalls();
      const replay = await stage(
        post(value),
        {
          DB: db,
          SESSION_SECRET: "synthetic-secret",
        },
        {
          qloo: {
            ...deps.qloo,
            search: async () => {
              throw new Error("should replay");
            },
          } as unknown as QlooClient,
          count: async () => false,
        },
      );
      const replayEvents = (await replay.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(replayEvents[0].mode).toBe("replay");
      expect(replayEvents[0].recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(replayEvents.some((event) => event.t === "brief")).toBe(true);
      expect(deps.searchCalls()).toBe(callCount);
    } finally {
      db.close();
    }
  });

  it("replays a preset recording when an attempted live run fails", async () => {
    const db = new FakeD1();
    const preset = PRESETS[0];
    const original = {
      city: preset.city,
      neighbourhood: preset.neighbourhood,
      lens: preset.lens,
      room: preset.room,
      features: preset.features,
      preset: preset.id,
    };
    try {
      await stage(
        post(original),
        { DB: db, SESSION_SECRET: "synthetic-secret" },
        {
          qloo: dependencies().qloo,
        },
      );
      const changed = { ...original, room: ["New Sample Brand"] };
      const failed = await stage(
        post(changed),
        {
          DB: db,
          SESSION_SECRET: "synthetic-secret",
        },
        { qloo: dependencies(true).qloo },
      );
      const events = (await failed.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events[0].mode).toBe("replay");
      expect(events.some((event) => event.t === "brief")).toBe(true);
      expect(events.some((event) => event.t === "error")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("keeps a written recording when a later run falls back to the template", async () => {
    const db = new FakeD1();
    const preset = PRESETS[0];
    const original = {
      city: preset.city,
      neighbourhood: preset.neighbourhood,
      lens: preset.lens,
      room: preset.room,
      features: preset.features,
      preset: preset.id,
    };
    const writer = {
      write: async () => ({
        content: "The home has natural light.",
        prompt_tokens: 1,
        completion_tokens: 1,
        finish: "stop",
      }),
    };
    const lines = async (response: Response) =>
      (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    try {
      const env = { DB: db, SESSION_SECRET: "synthetic-secret" };
      const first = await lines(await stage(post(original), env, { qloo: dependencies().qloo, writer }));
      expect(first[0].mode).toBe("live");
      // The day's writing allowance is now spent, so the next run is written by the template.
      db.insertCall("listing-lens", new Date().toISOString().slice(0, 10), 450);
      const changed = { ...original, room: ["New Sample Brand"] };
      const second = await lines(await stage(post(changed), env, { qloo: dependencies().qloo, writer }));
      expect(second[0].mode).toBe("template");
      // Asked again with no fresh runs left, the changed request replays the written recording, not the template.
      const third = await lines(
        await stage(post(changed), env, { qloo: dependencies(true).qloo, writer, count: async () => false }),
      );
      expect(third[0].mode).toBe("replay");
      expect(third.find((event) => event.t === "brief").written_by).toBe("model");
    } finally {
      db.close();
    }
  });

  it("answers with 503 when the session secret is missing", async () => {
    const db = new FakeD1();
    try {
      const response = await stage(
        post({ city: "Test City" }),
        { DB: db },
        {
          qloo: dependencies().qloo,
        },
      );
      expect(response.status).toBe(503);
      expect(await response.text()).toContain('"t":"error"');
    } finally {
      db.close();
    }
  });

  it("hashes visitor addresses before returning a counter identity", async () => {
    const visitor = await visitorOf(
      new Request("https://example.invalid", {
        headers: { "CF-Connecting-IP": "192.0.2.15" },
      }),
      "synthetic-secret",
    );
    expect(visitor).toMatch(/^[a-f0-9]{64}$/);
    expect(visitor).not.toContain("192.0.2.15");
  });

  it("returns plain failures as NDJSON error and done events", async () => {
    const db = new FakeD1();
    try {
      const response = await plain(
        new Request("https://example.invalid/api/plain", {
          method: "POST",
          body: "not json",
        }),
        { DB: db },
        { qloo: dependencies().qloo },
      );
      const lines = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(response.headers.get("Content-Type")).toContain(
        "application/x-ndjson",
      );
      expect(lines.map((event) => event.t)).toEqual(["error", "done"]);
    } finally {
      db.close();
    }
  });

  it("returns plain picks as run, plain and done NDJSON events", async () => {
    const db = new FakeD1();
    const id = "00000000-0000-4000-8000-000000000001";
    try {
      await new BriefStore(db).save(
        id,
        {
          city: "Test City",
          lens: { label: "Design forward", anchors: ["Test Anchor"] },
          room: [],
          features: [],
        },
        [
          {
            t: "brief",
            intro: "Test",
            paragraph: "Test",
            written_by: "template",
            scope: "Test City",
            lens: "Design forward",
          },
          {
            t: "section",
            key: "places",
            items: [
              {
                id: "ent-test-0001",
                name: "Cafe One",
                type: "place",
                why: "Test",
              },
            ],
          },
        ],
        "live",
      );
      const response = await plain(
        new Request("https://example.invalid/api/plain", {
          method: "POST",
          body: JSON.stringify({ id }),
        }),
        { DB: db },
        {
          qloo: dependencies().qloo,
          writer: {
            write: async () => ({
              content: JSON.stringify({
                brands: ["Brand One", "Brand Two", "Brand Three", "Brand Four"],
                places: ["Cafe One", "Cafe Two", "Cafe Three", "Cafe Four"],
              }),
              prompt_tokens: 1,
              completion_tokens: 1,
              neurons: 0.2,
            }),
          },
        },
      );
      const lines = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(response.headers.get("Content-Type")).toContain(
        "application/x-ndjson",
      );
      expect(lines.map((event) => event.t)).toEqual(["run", "plain", "done"]);
      expect(lines[1].brands[0]).toMatchObject({
        name: "Brand One",
        found: true,
      });
      expect(lines[1].places[0]).toEqual({ name: "Cafe One", found: true });
    } finally {
      db.close();
    }
  });
});
