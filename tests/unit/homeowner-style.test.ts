import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStyle, renderHomeowner, styleLink } from '../../public/render.js';

const events = [
  { t: 'run', id: 'x', mode: 'replay' },
  { t: 'section', key: 'brands', items: [{ name: 'HAY', affinity: 0.97 }, { name: 'Muuto', affinity: 0.96 }, { name: 'Vitra', affinity: 0.95 }, { name: 'Ferm', affinity: 0.94 }, { name: 'Fifth', affinity: 0.93 }] },
  { t: 'section', key: 'books', items: [{ name: 'Kinfolk Home', affinity: 0.95 }, { name: 'Cabin Porn', affinity: 0.94 }] },
  { t: 'section', key: 'playlist', items: [{ name: 'Khruangbin', affinity: 0.97 }] },
  { t: 'section', key: 'places', items: [{ name: 'Dove Bar', affinity: 0.93 }] },
  { t: 'audit', rows: [
    { name: 'West Elm', verdict: 'keep', affinity: 0.95 },
    { name: 'IKEA', verdict: 'swap', affinity: 0.91, swap: { name: 'Design Within Reach', affinity: 0.96 } },
    { name: 'Restoration Hardware', verdict: 'cut' },
  ] },
  { t: 'brief', scope: 'Wicker Park', lens: 'Design forward', paragraph: 'Light pours across the oak floors.', written_by: 'model' },
  { t: 'done' },
];

describe('the homeowner print page', () => {
  it('reads as a plan for the owner, with the stager at the top and no scores or taste data words', () => {
    const html = renderHomeowner(events, 'Dana <Lee>');
    expect(html).toContain('Prepared by Dana &lt;Lee&gt;');
    expect(html).toContain('Staging plan for your home in Wicker Park');
    expect(html).toContain('West Elm');
    expect(html).toContain('Swap IKEA for Design Within Reach');
    expect(html).toContain('Take out Restoration Hardware');
    expect(html).toContain('Light pours across the oak floors.');
    expect(html).toContain('Ferm');
    expect(html).not.toContain('Fifth');
    for (const word of ['Qloo', 'ffinity', '0.9', 'Beats', 'lens']) expect(html).not.toContain(word);
  });

  it('leaves out the prepared by line when no name is given, and says so when the room is empty', () => {
    const html = renderHomeowner(events.filter((event) => event.t !== 'audit'), '  ');
    expect(html).not.toContain('Prepared by');
    expect(html).toContain('No pieces to change in this room.');
  });

  it('prints only the homeowner page in that mode, and the page offers it', () => {
    const css = readFileSync('public/style.css', 'utf8');
    const page = readFileSync('public/index.html', 'utf8');
    expect(css).toMatch(/body\.print-homeowner[^{]*\{[^}]*display: none/);
    expect(page).toContain('id="homeowner-button"');
    expect(page).toContain('id="homeowner-sheet"');
  });
});

describe('house styles', () => {
  it('saves a named lens in a share link and reads it back', () => {
    const link = styleLink('https://example.invalid', { label: 'Harbour House', anchors: ['Muji', 'Kinfolk', 'Bon Iver'] });
    expect(link.startsWith('https://example.invalid/?style=')).toBe(true);
    expect(parseStyle(new URL(link).search)).toEqual({ label: 'Harbour House', anchors: ['Muji', 'Kinfolk', 'Bon Iver'] });
  });

  it('refuses a broken or oversized style link instead of trusting it', () => {
    expect(parseStyle('?style=not-json')).toBe(null);
    expect(parseStyle('?style=' + encodeURIComponent(JSON.stringify({ label: 'X', anchors: ['Muji'] })))).toBe(null);
    expect(parseStyle('?style=' + encodeURIComponent(JSON.stringify({ label: 'Fine name', anchors: ['a', 'b', 'c', 'd'] })))).toBe(null);
    expect(parseStyle('?style=' + encodeURIComponent(JSON.stringify({ label: 'Fine name', anchors: ['Muji', 'x'.repeat(61)] })))).toBe(null);
    expect(parseStyle('')).toBe(null);
  });

  it('uses plain language for a dropped connection and dates shared briefs', () => {
    const app = readFileSync('public/app.js', 'utf8');
    expect(app).toMatch(/error instanceof TypeError \? 'The connection dropped\. Try again, or open an example\.'/);
    expect(app).toMatch(/async function loadShared[\s\S]{0,700}mode: 'replay', recorded_at: saved\.recorded_at/);
  });
  it('the page reads a style link on load and can copy one', () => {
    const app = readFileSync('public/app.js', 'utf8');
    expect(app).toContain('parseStyle(location.search)');
    expect(app).toContain('styleLink(location.origin');
  });
});
