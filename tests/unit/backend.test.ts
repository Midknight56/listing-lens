import { describe, expect, it } from "vitest";
import {
  namesAreKnown,
  wrongCity,
  catalogVerdicts,
  shortBook,
  run,
  withCity,
  readAsCity,
} from "../../src/agent/run";
import { composeTemplate } from "../../src/agent/template";
import { HOME_BRANDS } from "../../src/agent/catalog";
import { PRESETS, FEATURES, presetsPayload } from "../../src/app/presets";
import { BoundTextWriter, MODEL_NAME } from "../../src/agent/model";
import type { Entity } from "../../src/qloo/client";
import type { Event as StageEvent } from "../../src/agent/events";
import { scanText } from "../../src/fairhousing";

const cleanDrafts = [
  "Warm Halifax light fills the home.",
  "The home frames Halifax in natural light.",
  "A calm Halifax layout opens to Test Cafe.",
  "Bright Test Cafe views meet Halifax style.",
  "Soft natural light fills Halifax rooms.",
  "This home connects Halifax and Test Cafe.",
  "Open Halifax spaces meet warm natural light.",
  "Around Halifax, Test Cafe adds a local touch.",
  "Calm rooms in Halifax pair with Test Cafe.",
  "A considered Halifax home brings soft light.",
];
const inventedDrafts = [
  "A Zorvane kitchen opens to the home.",
  "Warm Zorvane light fills each room.",
  "The Zorvane layout frames the home.",
  "Bright Zorvane rooms bring soft light.",
  "Soft Zorvane tones open the space.",
  "Around Zorvane, local details add flow.",
  "Calm Zorvane rooms connect each space.",
  "A Zorvane porch meets a warm interior.",
  "This Zorvane home offers natural light.",
  "Open Zorvane spaces bring an easy flow.",
];

describe("backend copy and scoring rules", () => {
  it("accepts ten clean drafts and rejects ten invented names", () => {
    const facts = ["Halifax", "Test Cafe", "natural light"];
    for (const draft of cleanDrafts)
      expect(namesAreKnown(draft, facts), draft).toBe(true);
    for (const draft of inventedDrafts)
      expect(namesAreKnown(draft, facts), draft).toBe(false);
  });

  it("detects a wrong city in a neighbourhood match", () => {
    expect(
      wrongCity(
        "Silver Lake, New Hanover County, North Carolina",
        "Los Angeles",
      ),
    ).toBe(true);
    expect(
      wrongCity("Silver Lake, Los Angeles, California", "Los Angeles"),
    ).toBe(false);
  });

  it("relaxes a wrong Silver Lake match to the typed city", async () => {
    const locations: (string | undefined)[] = [];
    const events: {
      t: string;
      to?: string;
      scope?: string;
      paragraph?: string;
    }[] = [];
    const qloo = {
      search: async (query: string) => ({
        cached: true,
        results: [
          { id: "ent-test-1200", name: query, type: "brand", tags: [] },
        ],
      }),
      insights: async ({
        location,
        type,
      }: {
        location?: string;
        type: string;
      }) => {
        locations.push(location);
        const disambiguation =
          locations.length === 1
            ? "Silver Lake, New Hanover County, North Carolina"
            : "Los Angeles, California";
        return {
          cached: true,
          locality: {
            id: "ent-test-1201",
            name: location ?? "",
            disambiguation,
          },
          results: [
            { id: "ent-test-1202", name: "Sample One", type, tags: [] },
            { id: "ent-test-1203", name: "Sample Two", type, tags: [] },
            { id: "ent-test-1204", name: "Sample Three", type, tags: [] },
          ],
        };
      },
      quotaLeft: async () => 40000,
    };
    await run(
      {
        city: "Los Angeles",
        neighbourhood: "Silver Lake",
        lens: { label: "Design forward", anchors: ["Sample Anchor"] },
        room: [],
        features: [],
      },
      {
        qloo: qloo as never,
        budget: { reserve: async () => null },
        emit: async (event) => {
          events.push(event);
        },
      },
    );
    expect(locations.slice(0, 2)).toEqual(["Silver Lake, Los Angeles", "Los Angeles"]);
    expect(events.find((event) => event.t === "relax")?.to).toBe("Los Angeles");
    expect(events.find((event) => event.t === "brief")?.scope).toBe(
      "Los Angeles",
    );
    expect(events.find((event) => event.t === "brief")?.paragraph).toContain(
      "Around Los Angeles",
    );
  });

  it("sends a neighbourhood with its city and spots an answer for the whole city", async () => {
    expect(withCity("Hyde Park", "Chicago")).toBe("Hyde Park, Chicago");
    expect(withCity("Hyde Park Chicago", "Chicago")).toBe("Hyde Park Chicago");
    expect(readAsCity("Hyde Park", "Hyde Park")).toBe(false);
    expect(readAsCity("Nashville", "Germantown")).toBe(true);
    const locations: (string | undefined)[] = [];
    const events: StageEvent[] = [];
    const qloo = {
      search: async () => ({
        results: [{ id: "ent-test-1301", name: "Sample Anchor", type: "artist", tags: [] }],
        cached: false,
      }),
      insights: async ({ type, location }: { type: string; location?: string }) => {
        locations.push(location);
        return {
          cached: false,
          locality: { id: "ent-test-1300", name: "Test City", disambiguation: "Test City, Test County" },
          results: [
            { id: "ent-test-1302", name: "Sample One", type, tags: [] },
            { id: "ent-test-1303", name: "Sample Two", type, tags: [] },
            { id: "ent-test-1304", name: "Sample Three", type, tags: [] },
          ],
        };
      },
      quotaLeft: async () => 40000,
    };
    await run(
      {
        city: "Test City",
        neighbourhood: "Old Quarter",
        lens: { label: "Design forward", anchors: ["Sample Anchor"] },
        room: [],
        features: [],
      },
      {
        qloo: qloo as never,
        budget: { reserve: async () => null },
        emit: async (event) => {
          events.push(event);
        },
      },
    );
    expect(locations[0]).toBe("Old Quarter, Test City");
    // No second brand call: the first answer was already the city's.
    expect(locations[1]).toBe("Old Quarter, Test City");
    expect(events.find((event) => event.t === "relax")).toMatchObject({
      to: "Test City",
      why: "Qloo read Old Quarter as Test City; using Test City",
    });
    expect(events.find((event) => event.t === "brief")?.scope).toBe("Test City");
  });

  it("asks again at city level for one list that is empty in the neighbourhood", async () => {
    const asked: string[] = [];
    const events: StageEvent[] = [];
    const three = (type: string) => [
      { id: "ent-test-1402", name: "Sample One", type, tags: [] },
      { id: "ent-test-1403", name: "Sample Two", type, tags: [] },
      { id: "ent-test-1404", name: "Sample Three", type, tags: [] },
    ];
    const qloo = {
      search: async (query: string) => ({
        results: [{ id: "ent-test-1401", name: query, type: "brand", tags: [] }],
        cached: false,
      }),
      insights: async ({ type, location }: { type: string; location?: string }) => {
        asked.push(`${type} @ ${location}`);
        const empty = type === "book" && location === "Wicker Park, Chicago";
        return {
          cached: false,
          locality: { id: "ent-test-1400", name: location ?? "", disambiguation: "Wicker Park, Chicago, Illinois" },
          results: empty ? [] : three(type),
        };
      },
      quotaLeft: async () => 40000,
    };
    await run(
      {
        city: "Chicago",
        neighbourhood: "Wicker Park",
        lens: { label: "Design forward", anchors: ["One", "Two", "Three"] },
        room: ["IKEA", "West Elm", "CB2", "Article", "Muji", "Wayfair"],
        features: [],
      },
      {
        qloo: qloo as never,
        budget: { reserve: async () => null },
        emit: async (event) => {
          events.push(event);
        },
      },
    );
    expect(asked).toContain("book @ Chicago");
    // Only the empty list goes wide; the others stay in the neighbourhood.
    expect(asked).not.toContain("artist @ Chicago");
    const books = events.find((event) => event.t === "section" && event.key === "books");
    expect(books).toMatchObject({ from: "Chicago" });
    expect(books && "items" in books ? books.items : []).toHaveLength(3);
    expect(events.some((event) => event.t === "error")).toBe(false);
    // A full room still gets its audit inside the 16 call limit.
    expect(events.filter((event) => event.t === "call")).toHaveLength(15);
    expect(events.find((event) => event.t === "brief")?.scope).toBe("Wicker Park");
  });

  it("shortens book display names and keeps the complete title in detail", () => {
    const title =
      "A thoughtful guide to comfortable rooms: notes on living well";
    const result = shortBook({
      id: "ent-test-1100",
      name: title,
      type: "book",
      tags: [],
    });
    expect(result.name).toBe("A thoughtful guide to comfortable rooms");
    expect(result.detail).toBe(title);
    const long = shortBook({
      id: "ent-test-1101",
      name: "A thoughtful guide to comfortable rooms and quiet details beyond the usual",
      type: "book",
      tags: [],
    });
    expect(long.name.length).toBeLessThanOrEqual(60);
    expect(long.detail).toBe(
      "A thoughtful guide to comfortable rooms and quiet details beyond the usual",
    );
  });

  it("keeps the full catalog names separate from resolved identifiers", () => {
    expect(HOME_BRANDS).toHaveLength(32);
    expect(HOME_BRANDS.every((name) => typeof name === "string")).toBe(true);
    expect(JSON.stringify(HOME_BRANDS)).not.toMatch(/ent-[a-z]+-\d+/);
  });

  it("defines the six requested presets and fixed feature list", () => {
    expect(PRESETS.map((item) => item.id)).toEqual([
      "east-nashville",
      "wicker-park",
      "hyde-park",
      "north-end-halifax",
      "kensington-market",
      "silver-lake",
    ]);
    expect(PRESETS[0].room).toEqual([
      "IKEA",
      "West Elm",
      "Pottery Barn",
      "CB2",
    ]);
    expect(PRESETS[2].lens.label).toBe("Classic comfort");
    expect(
      PRESETS.every((item) => item.flip.label !== item.lens.label),
    ).toBe(true);
    expect(FEATURES).toHaveLength(14);
    // The page reads preset.flip (public/app.js), so the payload must carry that exact field.
    const first = presetsPayload().presets[0] as unknown as Record<string, { label?: string }>;
    expect(first.flip?.label).toBe("Classic comfort");
    expect(Object.keys(presetsPayload())).toEqual([
      "presets",
      "lenses",
      "features",
    ]);
    expect(presetsPayload().lenses.map((lens) => lens.label)).toEqual([
      "Design forward",
      "Classic comfort",
    ]);
  });

  it("scores room items by share of catalog brands beaten", () => {
    const catalog = [0.9, 0.7, 0.5, 0.3, 0.1].map(
      (affinity, index) =>
        ({
          id: `ent-test-${String(index + 1).padStart(4, "0")}`,
          name: `Home Brand ${index + 1}`,
          type: "brand",
          affinity,
          tags: [],
        }) satisfies Entity,
    );
    const rows = catalogVerdicts(
      catalog,
      [
        { name: "Room Top", id: "ent-test-0006" },
        { name: "Room Middle", id: "ent-test-0007" },
        { name: "Room Low", id: "ent-test-0008" },
        { name: "Unscored", id: "ent-test-0009" },
        { name: "Unknown" },
      ],
      [
        {
          id: "ent-test-0006",
          name: "Room Top",
          type: "brand",
          affinity: 0.7,
          tags: [],
        },
        {
          id: "ent-test-0007",
          name: "Room Middle",
          type: "brand",
          affinity: 0.4,
          tags: [],
        },
        {
          id: "ent-test-0008",
          name: "Room Low",
          type: "brand",
          affinity: 0.2,
          tags: [],
        },
      ],
    );
    expect(rows.map((row) => row.verdict)).toEqual([
      "keep",
      "swap",
      "cut",
      "cut",
      "unknown",
    ]);
    expect(rows[0].better_than).toBe(0.6);
    expect(rows[0].of).toBe(5);
    expect(rows[3].reason).toBe("no pull here");
    expect(rows[1].swap?.id).toBe("ent-test-0001");
    expect(rows[4]).toMatchObject({ better_than: 0, of: 5 });
  });

  it("scores the room and cached catalog in one insights request", async () => {
    const catalog = Array.from({ length: 10 }, (_, index) => ({
      name: `Catalog Brand ${index + 1}`,
      id: `ent-test-${String(index + 1300).padStart(4, "0")}`,
    }));
    const auditRequests: string[][] = [];
    const events: {
      t: string;
      rows?: {
        better_than?: number;
        of?: number;
        verdict?: string;
        swap?: { id: string };
      }[];
    }[] = [];
    const qloo = {
      search: async (query: string, type?: string) => ({
        cached: true,
        results: [
          {
            id: query === "Room Brand" ? "ent-test-1299" : "ent-test-1298",
            name: query,
            type: type ?? "artist",
            tags: [],
          },
        ],
      }),
      insights: async ({
        type,
        resultIds,
      }: {
        type: string;
        resultIds?: string[];
      }) => {
        if (resultIds) auditRequests.push(resultIds);
        const results = resultIds
          ? resultIds.map((id, index) => ({
              id,
              name: `Scored ${id}`,
              type,
              affinity: id === "ent-test-1299" ? 0.5 : 0.9 - (index - 1) / 10,
              tags: [],
            }))
          : [0, 1, 2].map((index) => ({
              id: `ent-test-${String(1250 + index).padStart(4, "0")}`,
              name: `Sample ${index}`,
              type,
              affinity: 0.8,
              tags: [],
            }));
        return {
          cached: true,
          locality: {
            id: "ent-test-1201",
            name: "Test City",
            disambiguation: "Test City",
          },
          results,
        };
      },
      quotaLeft: async () => 40000,
    };
    await run(
      {
        city: "Test City",
        lens: { label: "Design forward", anchors: ["Sample Anchor"] },
        room: ["Room Brand"],
        features: [],
      },
      {
        qloo: qloo as never,
        catalog,
        budget: { reserve: async () => null },
        emit: async (event) => {
          events.push(event);
        },
      },
    );
    expect(auditRequests).toHaveLength(1);
    expect(auditRequests[0]).toHaveLength(11);
    expect(auditRequests[0]).toContain("ent-test-1299");
    expect(auditRequests[0]).toContain("ent-test-1300");
    expect(
      events.find((event) => event.t === "audit")?.rows?.[0],
    ).toMatchObject({
      better_than: 0.5,
      of: 10,
      verdict: "swap",
      swap: { id: "ent-test-1300" },
    });
  });

  it("lists only chosen features once for every set through size three", () => {
    const features = [
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
    const check = (picked: string[], start: number) => {
      const copy = composeTemplate({
        scope: "East Nashville",
        places: ["Test Cafe"],
        features: [...picked, ...picked],
      }).paragraph;
      for (const feature of features) {
        expect(copy.includes(feature)).toBe(picked.includes(feature));
        if (picked.includes(feature)) {
          expect(copy.split(feature)).toHaveLength(2);
        }
      }
      expect(scanText(copy)).toEqual([]);
      if (picked.length >= 2) expect(copy).toContain(" and ");
      expect(copy.match(/natural light/g)?.length ?? 0).toBe(
        picked.includes("natural light") ? 1 : 0,
      );
      expect(copy).toContain("Around East Nashville");
      if (picked.length === 3) return;
      for (let index = start; index < features.length; index++) {
        check([...picked, features[index]], index + 1);
      }
    };
    check([], 0);
  });

  it("uses the fixed model and parses reply content and measured usage", async () => {
    let receivedModel = "";
    let receivedInput: Record<string, unknown> = {};
    const writer = new BoundTextWriter({
      run: async (model, input) => {
        receivedModel = model;
        receivedInput = input as Record<string, unknown>;
        return {
          choices: [{ message: { content: "A concise line." } }],
          response: "Fallback line.",
          usage: { prompt_tokens: 3, completion_tokens: 4, neurons: 1.25 },
        };
      },
    });
    const reply = await writer.write("Prompt", { scope: "Halifax" }, 30);
    expect(receivedModel).toBe(MODEL_NAME);
    expect(receivedInput.chat_template_kwargs).toEqual({
      enable_thinking: false,
    });
    expect(reply).toEqual({
      content: "A concise line.",
      prompt_tokens: 3,
      completion_tokens: 4,
      neurons: 1.25,
    });
  });

  it("rejects malformed replies and removes hidden reasoning", async () => {
    const malformed = new BoundTextWriter({
      run: async () => ({ choices: {} }),
    });
    await expect(malformed.write("Prompt", {}, 20)).rejects.toThrow(
      "Invalid text reply",
    );
    const reasoning = new BoundTextWriter({
      run: async () => ({
        choices: [
          { message: { content: "<think>hidden</think> Visible line." } },
        ],
      }),
    });
    const reply = await reasoning.write("Prompt", {}, 20);
    expect(reply.content).toBe("Visible line.");
  });
});
