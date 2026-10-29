import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { askPlain, compareListings, listingFit, renderCompare, renderDiff, diffBriefs } from '../../public/render.js';

const items = (names: string[], scores: number[]) => names.map((name, i) => ({ name, affinity: scores[i] }));
const listing = (scope: string, places: number[], extra: Record<string, unknown>[] = [], audit = [{ name: 'IKEA', verdict: 'keep' }, { name: 'CB2', verdict: 'cut' }]) => [
  { t: 'run', id: scope, mode: 'replay' },
  ...extra,
  { t: 'section', key: 'brands', items: items([`${scope} Brand`, 'Shared Brand', 'Third'], [0.97, 0.95, 0.94]) },
  { t: 'section', key: 'books', items: items(['Book A', 'Book B', 'Book C'], [0.94, 0.93, 0.92]) },
  { t: 'section', key: 'playlist', items: items(['Song A', 'Song B', 'Song C'], [0.96, 0.95, 0.95]) },
  { t: 'section', key: 'places', items: items(places.map((_, i) => `${scope} Place ${i + 1}`), places) },
  { t: 'audit', rows: audit },
  { t: 'brief', scope, lens: 'Design forward', paragraph: 'A home.', written_by: 'model' },
  { t: 'done' },
];

describe('two listings, one buyer', () => {
  it('fills the three loves from the lens after a flip or a compare, not only the chip', () => {
    const app = readFileSync('public/app.js', 'utf8');
    expect(app).toMatch(/function showLens\(lens\)[^\n]*input\.value = lens\?\.anchors\?\.\[i\]/);
    expect(app).toMatch(/async function flipLens[\s\S]*showLens\(flipped\.lens\)/);
    expect(app).toMatch(/function showRequest[\s\S]{0,400}showLens\(request\.lens\)/);
  });

  it('reads each listing: where it is, how its local favourites score, and how much of the room stays', () => {
    const fit = listingFit(listing('Wicker Park', [0.938, 0.934, 0.932, 0.923]));
    expect(fit.scope).toBe('Wicker Park');
    expect(fit.places.mean).toBeCloseTo(0.93175, 4);
    expect(fit.places.count).toBe(4);
    expect(fit.kept).toBe(1);
    expect(fit.room).toBe(2);
    expect(fit.relaxed).toBe('');
  });

  it('names the listing whose local favourites score higher for this buyer, and counts what both share', () => {
    const a = listing('Hyde Park', [0.895, 0.883, 0.873, 0.832]);
    const b = listing('Wicker Park', [0.938, 0.934, 0.932, 0.923]);
    const compared = compareListings(a, b);
    expect(compared.winner).toBe('b');
    expect(compared.shared.brands).toEqual({ shared: 2, of: 3 });
    expect(compared.shared.places).toEqual({ shared: 0, of: 4 });
    const html = renderCompare(compared, diffBriefs(a, b));
    expect(html).toContain('Two listings, one buyer');
    expect(html).toContain('This buyer fits Wicker Park better');
    expect(html).toContain('0.932 against 0.871');
    expect(html).toContain('What moves');
    expect(html).not.toContain('Lens difference');
  });

  it('calls it even when the local favourites are within 0.005, and says when a place fell back to its city', () => {
    const a = listing('North End', [0.930, 0.930, 0.930]);
    const b = listing('Nashville', [0.932, 0.932, 0.932], [{ t: 'relax', from: 'Germantown', to: 'Nashville', why: 'thin' }]);
    const compared = compareListings(a, b);
    expect(compared.winner).toBe(null);
    const html = renderCompare(compared, diffBriefs(a, b));
    expect(html).toContain('About even for this buyer');
    expect(html).toContain('Germantown read as Nashville');
  });

  it('does not name a winner when a listing has too few local favourites to judge', () => {
    const compared = compareListings(listing('Hyde Park', [0.95]), listing('Wicker Park', [0.90, 0.90, 0.90]));
    expect(compared.winner).toBe(null);
    expect(renderCompare(compared, diffBriefs([], []))).toContain('Too few local favourites');
  });

  it('keeps the lens flip titled as before', () => {
    expect(renderDiff(diffBriefs([], []))).toContain('Lens difference');
  });

  it('offers the other example homes and runs the second listing as that example, so a recorded pair replays', () => {
    const app = readFileSync('public/app.js', 'utf8');
    const page = readFileSync('public/index.html', 'utf8');
    expect(page).toContain('id="compare-panel"');
    expect(page).toContain('Same buyer, another listing');
    expect(app).toMatch(/recorded \? \{ preset: other\.id \}/);
    expect(app).toContain('[other.lens, other.flip].some(sameLens)');
    expect(app).toContain('renderCompare(compareListings(');
  });
});

describe('the Qloo off tab answer', () => {
  const ndjson = (events: object[], status = 200) => ({ status, text: async () => events.map((e) => JSON.stringify(e)).join('\n') + '\n' });
  it('asks once more when the answer is lost or unreadable', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; if (calls === 1) return { status: 502, text: async () => '<html>error</html>' }; return ndjson([{ t: 'run' }, { t: 'plain', brands: [], places: [] }, { t: 'done' }]); };
    const answer = await askPlain(fetchImpl, 'id');
    expect(calls).toBe(2);
    expect(answer.plain).toBeTruthy();
  });
  it('does not ask again when the server refused in its own words', async () => {
    let calls = 0;
    const answer = await askPlain(async () => { calls++; return ndjson([{ t: 'error', text: 'You have opened the plain tab twice today.' }, { t: 'done' }], 429); }, 'id');
    expect(calls).toBe(1);
    expect(answer.note).toBe('You have opened the plain tab twice today.');
  });
  it('says plainly that the picks did not load after two lost answers', async () => {
    const answer = await askPlain(async () => { throw new Error('reset'); }, 'id');
    expect(answer.plain).toBe(null);
    expect(answer.note).toBe('Qloo off picks did not load. Tap Qloo off to try again.');
  });
});
