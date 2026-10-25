import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("source formatting", () => {
  it("keeps every source line below 120 characters", async () => {
    const files = await typescriptFiles(join(process.cwd(), "src"));
    for (const file of files) {
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        expect(line.length, `${file}:${index + 1}`).toBeLessThan(120);
      });
    }
  });
});
