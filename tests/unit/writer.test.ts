import { describe, expect, it } from "vitest";
import {
  PARAGRAPH_PROMPT,
  run,
  writerFacts,
  type StageRequest,
} from "../../src/agent/run";
import type { TextReply } from "../../src/agent/model";
import { unknownName } from "../../src/agent/run";
import { ideas, PLAIN_PROMPT } from "../../src/app/plain";

const entity = (id: string, name: string, type: string, detail?: string) => ({
  id,
  name,
  type,
  affinity: 0.8,
  shares: [{ id: "ent-test-0001", share: 0.7 }],
  tags: [],
  ...(detail ? { detail } : {}),
});

const qloo = {
  search: async () => ({
    results: [entity("ent-test-0001", "Test Anchor", "artist")],
    cached: false,
  }),
  insights: async ({ type }: { type: string }) => ({
    results:
      type === "place"
        ? [
            entity("ent-test-0010", "Bluebird Room", type, "Italian dining with a long wine list."),
            entity("ent-test-0011", "Harbor Books", type, "Used book shop with reading chairs."),
            entity("ent-test-0012", "Quiet Bar", type, "Cocktail bar with low light."),
          ]
        : [
            entity("ent-test-0002", "Test Pick", type),
            entity("ent-test-0003", "Test Pick Two", type),
            entity("ent-test-0004", "Test Pick Three", type),
          ],
    cached: false,
    locality: { id: "ent-test-0005", name: "Test City", disambiguation: "Test City, State" },
  }),
};

const request: StageRequest = {
  city: "Test City",
  lens: { label: "Design forward", anchors: ["Test Anchor"] },
  room: [],
  features: ["natural light", "front porch"],
};

const budget = { reserve: async () => ({ settle: async () => {} }) };

async function stage(reply: (prompt: string) => TextReply) {
  const seen: { prompt: string; facts: unknown }[] = [];
  const events = await run(request, {
    qloo: qloo as never,
    writer: {
      write: async (prompt, facts) => {
        seen.push({ prompt, facts });
        return reply(prompt);
      },
    },
    budget: budget as never,
    emit: async () => {},
  });
  // The audit's own fallback (no catalog in this fixture) is not the writer's.
  const writing = events.filter(
    (event) => event.t === "fallback" && ["intro", "paragraph"].includes((event as { what: string }).what),
  );
  return { seen, events, writing };
}

const intro = "A bright home with natural light and a front porch in Test City.";
const paragraph =
  "The home has natural light and a front porch. In the area, Bluebird Room serves Italian dining, " +
  "Harbor Books sells used books and Quiet Bar pours cocktails.";

describe("writer facts", () => {
  it("keeps the home's features apart from the places near it", () => {
    const facts = writerFacts("Test City", true, ["patio", "patio"], [
      { name: "Bluebird Room", detail: "Italian dining." },
    ]);
    expect(facts).toEqual({
      area: "Test City",
      places_span: "city",
      home_features: ["patio"],
      nearby_places: [{ name: "Bluebird Room", about: "Italian dining." }],
    });
  });
  it("drops a place note that fails the fair housing scan", () => {
    const facts = writerFacts("Test City", false, [], [
      { name: "Test Cafe", detail: "A family friendly cafe." },
    ]);
    expect(facts.places_span).toBe("neighbourhood");
    expect(facts.nearby_places[0].about).toBe("");
  });
  it("tells the writer the places are not part of the home", () => {
    expect(PARAGRAPH_PROMPT).toContain("not part of the home");
    expect(PARAGRAPH_PROMPT).toContain("who the home suits");
    // Live drafts were caught for these on 25 Oct; the prompt steers away from them before the guards have to.
    expect(PARAGRAPH_PROMPT).toContain("ideal for or perfect for");
    expect(PARAGRAPH_PROMPT).toContain("nationality");
  });
});

describe("names check", () => {
  it("accepts a part of a joined word from a note", () => {
    const facts = ["New Sky Restaurant", "Chinese bistro offering Cantonese-style dishes"];
    expect(unknownName("Nearby, New Sky Restaurant serves Cantonese dishes.", facts)).toBeNull();
    expect(unknownName("Nearby, New Sky Restaurant serves Sichuan dishes.", facts)).toBe("Sichuan");
  });
});

describe("writer run", () => {
  it("sends the split facts and passes a draft that uses words from a place note", async () => {
    const { seen, events, writing } = await stage((prompt) => ({
      content: prompt === PARAGRAPH_PROMPT ? paragraph : intro,
      prompt_tokens: 1,
      completion_tokens: 1,
      finish: "stop",
    }));
    expect(seen).toHaveLength(2);
    expect(seen[1].facts).toMatchObject({
      home_features: ["natural light", "front porch"],
      nearby_places: [{ name: "Bluebird Room", about: "Italian dining with a long wine list." }, {}, {}],
    });
    expect(writing).toEqual([]);
    expect(events.find((event) => event.t === "brief")).toMatchObject({ paragraph, written_by: "model" });
  });
  it("never shows a reply that stopped at the token limit", async () => {
    const { events, writing } = await stage(() => ({
      content: "The home has natural light and a front porch near",
      prompt_tokens: 1,
      completion_tokens: 1,
      finish: "length",
    }));
    expect(writing.map((event) => (event as { why: string }).why)).toEqual(["cut short", "cut short"]);
    expect(events.find((event) => event.t === "brief")).toMatchObject({ written_by: "template" });
  });
  it("names the caught word in the run log", async () => {
    const { writing } = await stage((prompt) => ({
      content:
        prompt === PARAGRAPH_PROMPT
          ? "The home has natural light. It is perfect for families near Wrigley Room."
          : "A bright home near Wrigley Room in Test City.",
      prompt_tokens: 1,
      completion_tokens: 1,
      finish: "stop",
    }));
    expect(writing).toEqual([
      { t: "fallback", what: "intro", why: "names check", detail: "Wrigley" },
      { t: "fallback", what: "paragraph", why: "fair housing scan", detail: expect.stringContaining("famil") },
    ]);
  });
});

describe("plain picks", () => {
  it("drops names that only repeat the input and keeps the model's own", () => {
    const reply = JSON.stringify({
      brands: ["Herman Miller", "Muuto", "HAY", "Vitra", "Cassina"],
      places: ["Test City", "The Station Inn", "Lemon Grass", "The 5 Spot", "Bluebird Cafe"],
    });
    expect(ideas(reply, ["Test City", "Herman Miller", "IKEA"])).toEqual({
      brands: ["Muuto", "HAY", "Vitra", "Cassina"],
      places: ["The Station Inn", "Lemon Grass", "The 5 Spot", "Bluebird Cafe"],
    });
  });
  it("refuses a reply that is all echo", () => {
    const echo = JSON.stringify({
      brands: ["Herman Miller", "Kinfolk", "IKEA", "West Elm"],
      places: ["Test City", "Khruangbin", "Pottery Barn", "CB2"],
    });
    expect(
      ideas(echo, ["Test City", "Herman Miller", "Kinfolk", "Khruangbin", "IKEA", "West Elm", "Pottery Barn", "CB2"]),
    ).toBeNull();
    expect(PLAIN_PROMPT).toContain("Do not repeat");
  });
});
