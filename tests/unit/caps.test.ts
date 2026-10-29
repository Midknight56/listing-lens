import { afterEach, describe, expect, it } from "vitest";
import { setClockForTest } from "../../src/limits";
import { counterKey, VisitorCaps, RunCallBudget } from "../../src/store/caps";
import { NeuronLedger } from "../../src/store/d1";
import { FakeD1 } from "./fake-d1";
import { run, type StageRequest } from "../../src/agent/run";
import { isOperator } from "../../src/app/stage";

class MemoryCounters {
  private values = new Map<string, number>();
  async get(key: string): Promise<number> {
    return this.values.get(key) ?? 0;
  }
  async put(key: string, value: number): Promise<void> {
    this.values.set(key, value);
  }
}

describe("daily limits", () => {
  afterEach(() => setClockForTest());
  it("uses normal visitor caps outside the judging window", async () => {
    for (const at of ["2026-11-01T12:00:00Z", "2026-11-07T00:00:00Z"]) {
      setClockForTest(() => Date.parse(at));
      const caps = new VisitorCaps(new MemoryCounters());
      for (let i = 0; i < 3; i++) expect(await caps.fresh("v" + at)).toBe(true);
      expect(await caps.fresh("v" + at)).toBe(false);
      for (let i = 0; i < 48; i++) expect(await caps.qloo("q" + at)).toBe(true);
      expect(await caps.qloo("q" + at)).toBe(false);
      for (let i = 0; i < 2; i++) expect(await caps.plain("p" + at)).toBe(true);
      expect(await caps.plain("p" + at)).toBe(false);
    }
  });
  it("uses raised visitor caps during the judging window and its exact end", async () => {
    for (const at of ["2026-11-02T00:00:00Z", "2026-11-05T23:00:00Z", "2026-11-06T11:59:00Z"]) {
      setClockForTest(() => Date.parse(at));
      const caps = new VisitorCaps(new MemoryCounters());
      for (let i = 0; i < 12; i++) expect(await caps.fresh("v" + at)).toBe(true);
      expect(await caps.fresh("v" + at)).toBe(false);
      for (let i = 0; i < 192; i++) expect(await caps.qloo("q" + at)).toBe(true);
      expect(await caps.qloo("q" + at)).toBe(false);
      for (let i = 0; i < 8; i++) expect(await caps.plain("p" + at)).toBe(true);
      expect(await caps.plain("p" + at)).toBe(false);
    }
    setClockForTest(() => Date.parse("2026-11-06T12:00:00Z"));
    const after = new VisitorCaps(new MemoryCounters());
    for (let i = 0; i < 3; i++) expect(await after.fresh("after")).toBe(true);
    expect(await after.fresh("after")).toBe(false);
  });
  it("uses the counter name as the durable object key and day as its counter", () => {
    expect(counterKey("2026-10-25:visitor-qloo:visitor-hash")).toEqual({
      day: "2026-10-25",
      name: "visitor-qloo:visitor-hash",
    });
  });
  it("allows three fresh visitor runs and refuses the fourth", async () => {
    const caps = new VisitorCaps(new MemoryCounters(), () => "day");
    expect(await caps.fresh("visitor")).toBe(true);
    expect(await caps.fresh("visitor")).toBe(true);
    expect(await caps.fresh("visitor")).toBe(true);
    expect(await caps.fresh("visitor")).toBe(false);
  });
  it("allows 48 Qloo questions per visitor", async () => {
    const caps = new VisitorCaps(new MemoryCounters(), () => "day");
    for (let i = 0; i < 48; i++) expect(await caps.qloo("visitor")).toBe(true);
    expect(await caps.qloo("visitor")).toBe(false);
  });
  it("allows 500 Qloo questions across all visitors", async () => {
    setClockForTest(() => Date.parse("2026-11-03T12:00:00Z"));
    const counters = new MemoryCounters(),
      caps = new VisitorCaps(counters, () => "day");
    for (let i = 0; i < 500; i++)
      expect(await caps.qloo("visitor-" + i)).toBe(true);
    expect(await caps.qloo("last")).toBe(false);
  });
  it("lets a recording run pass the visitor cap but never the daily total", async () => {
    const counters = new MemoryCounters(),
      caps = new VisitorCaps(counters, () => "day");
    for (let i = 0; i < 48; i++) expect(await caps.qloo("owner")).toBe(true);
    for (let i = 48; i < 500; i++) expect(await caps.operatorQloo()).toBe(true);
    expect(await caps.operatorQloo()).toBe(false);
    expect(await caps.qloo("someone-else")).toBe(false);
  });
  it("treats a request as a recording run only with the exact warm token", () => {
    const withToken = (token?: string) =>
      new Request("https://example.test/api/stage", token ? { headers: { "X-Warm-Token": token } } : {});
    expect(isOperator(withToken("secret-test"), { WARM_TOKEN: "secret-test" })).toBe(true);
    expect(isOperator(withToken("wrong"), { WARM_TOKEN: "secret-test" })).toBe(false);
    expect(isOperator(withToken(), { WARM_TOKEN: "secret-test" })).toBe(false);
    expect(isOperator(withToken(), {})).toBe(false);
    expect(isOperator(withToken("anything"), { WARM_TOKEN: "" })).toBe(false);
    const emptyHeader = new Request("https://example.test/api/stage", { headers: { "X-Warm-Token": "" } });
    expect(isOperator(emptyHeader, { WARM_TOKEN: "" })).toBe(false);
  });
  it("allows 16 Qloo questions per run", () => {
    const budget = new RunCallBudget();
    for (let i = 0; i < 16; i++) expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    expect(budget.used()).toBe(16);
  });
  it("uses template mode and makes no writing calls when a ledger reservation is refused", async () => {
    const db = new FakeD1();
    try {
      const ledger = new NeuronLedger(db, {
        app: "listing-lens",
        dailyCap: 73,
        accountCap: 500,
        day: () => "day",
      });
      db.insertCall("listing-lens", "day", 73);
      let textCalls = 0,
        mode = "live";
      const entity = (id: string, name: string, type: string) => ({
        id,
        name,
        type,
        affinity: 0.8,
        shares: [{ id: "ent-test-0001", share: 0.7 }],
        tags: [],
      });
      const qloo = {
        search: async () => ({
          results: [entity("ent-test-0001", "Test Anchor", "artist")],
          cached: false,
        }),
        insights: async ({ type }: { type: string }) => ({
          results: [
            entity("ent-test-0002", "Test Pick", type),
            entity("ent-test-0003", "Test Pick Two", type),
            entity("ent-test-0004", "Test Pick Three", type),
          ],
          cached: false,
          locality: {
            id: "ent-test-0005",
            name: "Test City",
            disambiguation: "Test City, State",
          },
        }),
      };
      const request: StageRequest = {
        city: "Test City",
        lens: { label: "Design forward", anchors: ["Test Anchor"] },
        room: [],
        features: [],
      };
      const events = await run(request, {
        qloo: qloo as never,
        writer: {
          write: async () => {
            textCalls++;
            return {
              content: "Test copy",
              prompt_tokens: 1,
              completion_tokens: 1,
            };
          },
        },
        budget: ledger,
        setMode: (value) => {
          mode = value;
        },
        emit: async () => {},
      });
      expect(mode).toBe("template");
      expect(textCalls).toBe(0);
      expect(
        events.some(
          (event) =>
            event.t === "fallback" && event.why === "writing budget spent",
        ),
      ).toBe(true);
    } finally {
      db.close();
    }
  });
  it("enforces the shared account cap", async () => {
    const db = new FakeD1();
    try {
      const ledger = new NeuronLedger(db, {
        app: "listing-lens",
        dailyCap: 500,
        accountCap: 100,
        reserve: 73,
        day: () => "day",
      });
      db.insertCall("another-app", "day", 28);
      expect(await ledger.reserve()).toBeNull();
    } finally {
      db.close();
    }
  });
});
