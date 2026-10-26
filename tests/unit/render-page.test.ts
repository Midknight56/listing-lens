import { describe, expect, it } from 'vitest';
import { diffBriefs, escapeHtml, modeLabel, renderBrief, renderDiff, renderPlain, runSummary } from '../../public/render.js';

describe('Staging Brief render functions', () => {
  it('escapes user supplied text', () => {
    expect(escapeHtml('<script title="x">&\'')).toBe('&lt;script title=&quot;x&quot;&gt;&amp;&#39;');
    expect(renderBrief([{ t: 'brief', intro: '<img src=x>', paragraph: '<b>text</b>', written_by: 'template' }])).not.toContain('<img');
  });

  it('renders audit pills, the raw score and each result section', () => {
    const html = renderBrief([
      { t: 'audit', rows: [{ name: 'Desk', affinity: 0.90712, verdict: 'keep', better_than: 0.6, of: 30 }, { name: 'Shelf', verdict: 'unknown' }] },
      ...['brands', 'books', 'playlist', 'places'].map((key) => ({ t: 'section', key, items: [
        { name: 'Pick One', affinity: 0.8765, why: 'Because of a love' }, { name: 'Pick Two', affinity: 0.83 }, { name: 'Pick Three', affinity: 0.81 },
      ] })),
      { t: 'brief', paragraph: 'A place to enjoy.', written_by: 'template', scope: 'Halifax' },
    ]);
    expect(html).toContain('Keep</span>');
    expect(html).toContain('Not in Qloo</span>');
    expect(html).toContain('0.907');
    expect(html).toContain('Beats 18 of 30 home brands');
    expect(html).toContain('Brands to show');
    expect(html).toContain('Coffee table books');
    expect(html).toContain('Open house playlist');
    expect(html).toContain('Local favourites');
    expect(html).toContain('Written by template');
  });

  it('says when one list came from the whole city', () => {
    const items = [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }];
    expect(renderBrief([{ t: 'section', key: 'books', items, from: 'Chicago' }])).toContain('From Chicago');
    expect(renderBrief([{ t: 'section', key: 'books', items }])).not.toContain('section-from');
  });

  it('shows thin data for short sections', () => {
    expect(renderBrief([{ t: 'section', key: 'places', items: [{ name: 'One' }] }])).toContain('Thin data here');
  });

  it('computes list changes, rank movement and audit verdict changes', () => {
    const a = [
      { t: 'section', key: 'brands', items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
      { t: 'audit', rows: [{ name: 'Desk', verdict: 'keep' }] },
    ];
    const b = [
      { t: 'section', key: 'brands', items: [{ name: 'C' }, { name: 'A' }, { name: 'D' }] },
      { t: 'audit', rows: [{ name: 'Desk', verdict: 'swap' }] },
    ];
    const diff = diffBriefs(a, b);
    expect(diff.sections[0]).toEqual({ key: 'brands', added: ['D'], dropped: ['B'], moved: [{ name: 'C', from: 3, to: 1, delta: 2 }, { name: 'A', from: 1, to: 2, delta: -1 }] });
    expect(diff.audit).toEqual([{ name: 'Desk', from: 'keep', to: 'swap' }]);
    expect(renderDiff(diff)).toContain('Up 2 C');
    expect(renderDiff(diff)).toContain('Keep to Swap');
  });

  it('renders the scope, relaxed neighbourhood, verdict marker, and changed verdict history', () => {
    const html = renderBrief([
      { t: 'run', mode: 'replay' },
      { t: 'section', key: 'brands', items: [{ name: 'Top pick', affinity: 0.92 }] },
      { t: 'relax', from: 'East Nashville', to: 'Nashville', why: 'Local data is thin' },
      { t: 'audit', rows: [{ name: 'Chair', affinity: 0.88, verdict: 'swap' }] },
      { t: 'brief', scope: 'Nashville', lens: 'Classic comfort' },
    ], 'Design forward', [{ t: 'audit', rows: [{ name: 'Chair', verdict: 'keep' }] }]);
    expect(html).toContain('Nashville');
    expect(html).toContain('from East Nashville');
    expect(html).toContain('data-lens-switch');
    expect(html).toContain('Was Keep');
    expect(html).toContain('score-marker');
    expect(html).toContain('Local data is thin');
    expect(html).not.toContain('Using Nashville for this brief');
  });

  it('leaves the empty swap cell blank and explains a cut with no score', () => {
    const html = renderBrief([{ t: 'audit', rows: [{ name: 'Chair', verdict: 'cut' }] }]);
    expect(html).toContain('No pull here');
    expect(html).not.toContain('—');
  });

  it('says a kept room brand is one of the buyer loves, with no score or rank', () => {
    const html = renderBrief([{ t: 'audit', rows: [{ name: 'Pottery Barn', verdict: 'keep', reason: 'one of their loves' }] }]);
    expect(html).toContain('One of their loves');
    expect(html).not.toContain('No pull here');
    expect(html).not.toContain('Beats');
  });

  it('renders lazy thumbnails, and no empty box when a pick has no image', () => {
    const html = renderBrief([{ t: 'section', key: 'brands', items: [
      { name: 'A', affinity: 0.9, image: 'https://images.example.invalid/a.jpg' },
      { name: 'B', affinity: 0.8 }, { name: 'C', affinity: 0.7 },
    ] }]);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).not.toContain('result-thumb-empty');
    expect(html.match(/class="result-card has-image"/g)).toHaveLength(1);
  });

  it('provides synthetic flip and running development event sets', async () => {
    const fs = await import('node:fs/promises');
    const flip = (await fs.readFile(new URL('../../public/dev/sample-flip.ndjson', import.meta.url), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const running = (await fs.readFile(new URL('../../public/dev/sample-running.ndjson', import.meta.url), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(flip.find((event) => event.t === 'brief').lens).toBe('Classic comfort');
    expect(flip.at(-1).t).toBe('done');
    expect(running.some((event) => event.t === 'call')).toBe(true);
    expect(running.some((event) => event.t === 'done')).toBe(false);
  });

  it('labels all run modes and summarizes calls and cache use', () => {
    expect(modeLabel({ mode: 'live' })).toBe('Live');
    expect(modeLabel({ mode: 'template' })).toContain('Plain text mode');
    expect(modeLabel({ mode: 'cache' })).toBe('From cache');
    expect(modeLabel({ mode: 'replay', recorded_at: '2026-10-25' })).toContain('Recorded on');
    expect(modeLabel({ mode: 'off' })).toBe('Qloo off');
    expect(runSummary([{ t: 'call' }, { t: 'call' }, { t: 'usage', qloo_cached: 1 }])).toBe('2 Qloo calls, 1 cached');
  });

  it('renders plain picks with Qloo scores and missing places', () => {
    const html = renderPlain({ brands: [{ name: 'Chair Co', qloo_affinity: 0.84321, found: true }], places: [{ name: 'Quiet Cafe', found: false }] });
    expect(html).toContain('Chair Co');
    expect(html).toContain('0.843');
    expect(html).toContain('Not found in this area');
  });

  it('shows the calm note when an audit has no rows', () => {
    expect(renderBrief([{ t: 'audit', rows: [] }])).toContain('No brands to audit in this room.');
  });

  it('loads a synthetic event stream fixture with made up ids', async () => {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(new URL('../../public/dev/sample-run.ndjson', import.meta.url), 'utf8');
    const events = content.trim().split('\n').map((line) => JSON.parse(line));
    expect(events[0].t).toBe('run');
    expect(events.at(-1).t).toBe('done');
    expect(events.some((event) => event.t === 'relax')).toBe(true);
    expect(events.filter((event) => event.t === 'call')).toHaveLength(8);
    expect(JSON.stringify(events)).toContain('ent-test-');
  });
});

describe('recorded date', () => {
  it('shows the UTC day a brief was recorded, even for a viewer west of Greenwich', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/Halifax';
    try {
      expect(modeLabel({ mode: 'replay', recorded_at: '2026-10-25' })).toBe('Recorded on Oct 25, 2026');
    } finally {
      process.env.TZ = before;
    }
  });
});
