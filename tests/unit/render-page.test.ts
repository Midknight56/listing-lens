import { describe, expect, it } from 'vitest';
import { diffBriefs, escapeHtml, modeLabel, renderBrief, renderDiff, renderPlain, runSummary } from '../../public/render.js';

describe('Listing Lens render functions', () => {
  it('escapes user supplied text', () => {
    expect(escapeHtml('<script title="x">&\'')).toBe('&lt;script title=&quot;x&quot;&gt;&amp;&#39;');
    expect(renderBrief([{ t: 'brief', intro: '<img src=x>', paragraph: '<b>text</b>', written_by: 'template' }])).not.toContain('<img');
  });

  it('renders audit pills, the raw score and each result section', () => {
    const html = renderBrief([
      { t: 'audit', rows: [{ name: 'Desk', affinity: 0.90712, verdict: 'keep' }, { name: 'Shelf', verdict: 'unknown' }] },
      ...['brands', 'books', 'playlist', 'places'].map((key) => ({ t: 'section', key, items: [
        { name: 'Pick One', affinity: 0.8765, why: 'Because of a love' }, { name: 'Pick Two', affinity: 0.83 }, { name: 'Pick Three', affinity: 0.81 },
      ] })),
      { t: 'brief', paragraph: 'A place to enjoy.', written_by: 'template', scope: 'Halifax' },
    ]);
    expect(html).toContain('>Keep</span>');
    expect(html).toContain('>Not in Qloo</span>');
    expect(html).toContain('0.907');
    expect(html).toContain('Brands to show');
    expect(html).toContain('Coffee table books');
    expect(html).toContain('Open house playlist');
    expect(html).toContain('Local favourites');
    expect(html).toContain('Written by template');
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
    expect(renderDiff(diff)).toContain('↑ 2');
    expect(renderDiff(diff)).toContain('Keep to Swap');
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
