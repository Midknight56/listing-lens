import { describe, expect, it, vi } from "vitest";
import { QlooClient, workerFetch } from "../../src/qloo/client";

class MemoryCache {
  values = new Map<string, string>();
  remaining: number | null = null;
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async quotaLeft(): Promise<number | null> {
    return this.remaining;
  }
  async updateQuota(remaining: number): Promise<void> {
    this.remaining = remaining;
  }
}
const fixture = {
  query: {
    localities: {
      signal: {
        entity_id: "ent-test-0001",
        name: "Sample District",
        disambiguation: "Sample District, Test City",
      },
    },
  },
  results: {
    entities: [
      {
        entity_id: "ent-test-0002",
        name: "Sample Chair",
        types: ["urn:entity:brand"],
        query: {
          affinity: 0.72,
          explainability: {
            "signal.interests.entities": [
              { entity_id: "ent-test-0003", score: 0.62 },
            ],
          },
        },
        popularity: 0.8,
      },
    ],
  },
};

describe("Qloo request shapes", () => {
  it("passes fetch through a bound wrapper", async () => {
    const mocked = vi.fn(async () => Response.json({ results: [] }));
    vi.stubGlobal("fetch", mocked);
    try {
      const client = new QlooClient(
        "test-key",
        workerFetch,
        new MemoryCache(),
        async () => true,
      );
      expect(workerFetch).not.toBe(globalThis.fetch);
      await client.search("Sample", undefined, 1);
      expect(mocked).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("stores monthly quota and blocks a call below the floor", async () => {
    const cache = new MemoryCache();
    let calls = 0;
    const client = new QlooClient(
      "test-key",
      async () => {
        calls++;
        return Response.json(
          { results: [fixture.results.entities[0]] },
          {
            headers: { "X-Month-RateLimit-Remaining": "2999" },
          },
        );
      },
      cache,
      async () => true,
    );
    await client.search("Sample", undefined, 1);
    expect(cache.remaining).toBe(2999);
    await expect(client.search("Different", undefined, 1)).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("refuses a live request when the stored month quota is low", async () => {
    const cache = new MemoryCache();
    cache.remaining = 2999;
    const fetcher = vi.fn(async () => Response.json(fixture));
    const client = new QlooClient("test-key", fetcher, cache, async () => true);
    await expect(client.search("Sample", undefined, 1)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends taste location for all insight kinds and the place location filter only for places", async () => {
    const urls: URL[] = [],
      client = new QlooClient(
        "secret-test-key",
        async (input) => {
          urls.push(new URL(String(input)));
          return Response.json(fixture);
        },
        new MemoryCache(),
        async () => true,
      );
    await client.insights({
      seedIds: ["ent-test-0003"],
      type: "brand",
      location: "Test City",
      take: 10,
      excludeIds: ["ent-test-0004"],
    });
    await client.insights({
      seedIds: ["ent-test-0003"],
      type: "place",
      location: "Test City",
      popularityMax: 0.95,
      take: 10,
    });
    expect(urls[0].searchParams.get("signal.location.query")).toBe("Test City");
    expect(urls[0].searchParams.get("filter.location.query")).toBeNull();
    expect(urls[0].searchParams.get("filter.exclude.entities")).toBe(
      "ent-test-0004",
    );
    expect(urls[1].searchParams.get("signal.location.query")).toBe("Test City");
    expect(urls[1].searchParams.get("filter.location.query")).toBe("Test City");
    expect(urls[1].searchParams.get("filter.popularity.max")).toBe("0.95");
    expect(urls.every((url) => !url.href.includes("demographics"))).toBe(true);
  });
  it("supports typed and untyped search with up to ten results", async () => {
    const urls: URL[] = [],
      client = new QlooClient(
        "secret-test-key",
        async (input) => {
          urls.push(new URL(String(input)));
          return Response.json({ results: [fixture.results.entities[0]] });
        },
        new MemoryCache(),
        async () => true,
      );
    await client.search("Sample Chair", undefined, 10);
    await client.search("Sample Chair", "brand", 14);
    expect(urls[0].searchParams.get("types")).toBeNull();
    expect(urls[0].searchParams.get("take")).toBe("10");
    expect(urls[1].searchParams.get("types")).toBe("urn:entity:brand");
    expect(urls[1].searchParams.get("take")).toBe("10");
  });
  it("returns resolved locality and explainability on insight answers", async () => {
    const client = new QlooClient(
      "secret-test-key",
      async () => Response.json(fixture),
      new MemoryCache(),
      async () => true,
    );
    const answer = await client.insights({
      seedIds: ["ent-test-0003"],
      type: "brand",
      location: "Test City",
    });
    expect(answer.locality).toEqual({
      id: "ent-test-0001",
      name: "Sample District",
      disambiguation: "Sample District, Test City",
    });
    expect(answer.results[0].shares).toEqual([
      { id: "ent-test-0003", share: 0.62 },
    ]);
  });
});

describe("Qloo rate limit", () => {
  it("retries a 429 once after a pause and counts the call once", async () => {
    const answers = [new Response("", { status: 429 }), Response.json(fixture)];
    const fetcher = vi.fn(async () => answers.shift()!);
    const allow = vi.fn(async () => true);
    const pauses: number[] = [];
    const client = new QlooClient("test-key", fetcher, new MemoryCache(), allow, async (ms) => {
      pauses.push(ms);
    });
    const answer = await client.insights({ seedIds: ["ent-test-0003"], type: "brand" });
    expect(answer.results).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(allow).toHaveBeenCalledTimes(1);
    expect(pauses).toContain(1100);
  });

  it("spaces two upstream calls at least 120 ms apart", async () => {
    const fetcher = vi.fn(async () => Response.json(fixture));
    const pauses: number[] = [];
    const client = new QlooClient("test-key", fetcher, new MemoryCache(), async () => true, async (ms) => {
      pauses.push(ms);
    });
    await client.insights({ seedIds: ["ent-test-0003"], type: "brand" });
    await client.insights({ seedIds: ["ent-test-0004"], type: "brand" });
    expect(pauses.length).toBe(1);
    expect(pauses[0]).toBeGreaterThan(100);
  });
});
