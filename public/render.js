export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const sectionNames = { brands: 'Brands to show', books: 'Coffee table books', playlist: 'Open house playlist', places: 'Local favourites' };
const verdictNames = { keep: 'Keep', swap: 'Swap', cut: 'Cut', unknown: 'Not in Qloo' };
const verdictIcons = { keep: '✓', swap: '↗', cut: '×', unknown: '·' };
const finite = (n) => Number.isFinite(Number(n)) ? Number(n) : null;
const score = (n) => finite(n) === null ? 'No score' : finite(n).toFixed(3);

export function modeLabel(event = {}) {
  if (event.mode === 'live') return 'Live';
  if (event.mode === 'template') return "Plain text mode: today's writing budget is spent";
  if (event.mode === 'cache') return 'From cache';
  if (event.mode === 'replay') {
    // The date is a UTC day; read it as UTC, or a viewer west of Greenwich sees the day before.
    const date = event.recorded_at
      ? new Date(event.recorded_at).toLocaleDateString('en', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    return date ? `Recorded on ${date}` : 'Recorded brief';
  }
  if (event.mode === 'off') return 'Qloo off';
  return '';
}

export function runSummary(events = []) {
  const usage = [...events].reverse().find((e) => e?.t === 'usage');
  const calls = events.filter((e) => e?.t === 'call').length;
  const cached = usage && Number.isFinite(Number(usage.qloo_cached)) ? Number(usage.qloo_cached) : events.filter((e) => e?.t === 'call' && e.cached).length;
  return `${calls} Qloo calls, ${cached} cached`;
}

function auditHtml(rows = [], priorRows = [], bestPick = null, pickScores = [], present = false) {
  const values = Array.isArray(rows) ? rows : [];
  if (!values.length) return present ? '<section class="audit-section"><h2>Room audit</h2><p class="small">No brands to audit in this room.</p></section>' : '';
  const valuesWithScore = values.map((row) => finite(row.affinity)).filter((n) => n !== null);
  const pickValues = (pickScores || []).map(finite).filter((value) => value !== null);
  const allValues = [...valuesWithScore, ...pickValues];
  const low = Math.max(0, (allValues.length ? Math.min(...allValues) : 0) - 0.01);
  const best = finite(bestPick) ?? (valuesWithScore.length ? Math.max(...valuesWithScore) : 1);
  const span = Math.max(0.0001, best - low);
  const prior = new Map((priorRows || []).map((row) => [row.name, row.verdict]));
  const rowHtml = (row) => {
    const verdict = verdictNames[row.verdict] ? row.verdict : 'unknown';
    const affinity = finite(row.affinity);
    const width = affinity === null ? 0 : Math.max(0, Math.min(100, ((affinity - low) / span) * 100));
    const marker = Math.max(0, Math.min(100, ((best - low) / span) * 100));
    const swap = row.swap?.name ? `<span class="try-swap">Try ${escapeHtml(row.swap.name)} · ${score(row.swap.affinity)}</span>` : '';
    const was = prior.has(row.name) && prior.get(row.name) !== row.verdict ? `<span class="was-note">Was ${escapeHtml(verdictNames[prior.get(row.name)] || prior.get(row.name))}</span>` : '';
    const beats = finite(row.better_than) !== null && finite(row.of) !== null
      ? `<span class="beats-note">Beats ${Math.round(finite(row.better_than) * finite(row.of))} of ${finite(row.of)} home brands</span>` : '';
    const reason = typeof row.reason === 'string' && row.reason ? row.reason[0].toUpperCase() + row.reason.slice(1) : '';
    const rawScore = affinity === null && reason ? escapeHtml(reason) : affinity === null && verdict === 'cut' ? 'No pull here' : score(affinity);
    const scoreHtml = `<span class="score-track ${verdict}" role="img" aria-label="Affinity ${score(affinity)}"><span class="score-fill" style="width:${width.toFixed(1)}%"></span>${affinity === null ? '' : `<i class="score-marker" style="left:${marker.toFixed(1)}%"></i>`}</span><span class="score-number">${rawScore}</span>${beats}`;
    const pill = `<span class="verdict ${verdict}"><span class="verdict-icon" aria-hidden="true">${verdictIcons[verdict]}</span>${verdictNames[verdict]}</span>`;
    return { name: escapeHtml(row.name), pill, scoreHtml, swap, was };
  };
  const tableRows = values.map((row) => { const v = rowHtml(row); return `<tr><td>${v.name}${v.was}</td><td>${v.pill}</td><td>${v.scoreHtml}</td><td>${v.swap}</td></tr>`; }).join('');
  const cards = values.map((row) => { const v = rowHtml(row); return `<article class="audit-card"><div class="audit-card-top"><span class="audit-card-name">${v.name}${v.was}</span>${v.pill}</div>${v.scoreHtml}${v.swap}</article>`; }).join('');
  return `<section class="audit-section"><h2>Room audit</h2><table class="audit-table"><thead><tr><th>In the room</th><th>Call</th><th>Affinity</th><th>Try instead</th></tr></thead><tbody>${tableRows}</tbody></table><div class="audit-cards">${cards}</div><p class="small">Score scale ${score(low)} to ${score(best)}</p></section>`;
}

function cardsHtml(section) {
  const key = section.key;
  const title = sectionNames[key] || key;
  const items = Array.isArray(section.items) ? section.items : [];
  const body = section.thin || items.length < 3
    ? '<p class="thin">Thin data here</p>'
    : `<div class="result-grid">${items.map((item) => {
      // A card with no picture shows no box: an empty grey square reads as a broken image.
      const hasImage = typeof item.image === 'string' && item.image.trim() !== '';
      const image = hasImage ? `<img class="result-thumb" src="${escapeHtml(item.image)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : '';
      return `<article class="result-card${hasImage ? ' has-image' : ''}">${image}<h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.why || item.detail || 'A match for this lens and place.')}</p><span class="affinity">Affinity ${score(item.affinity)}</span></article>`;
    }).join('')}</div>`;
  const from = section.from ? `<p class="small section-from">From ${escapeHtml(section.from)}</p>` : '';
  return `<section class="result-section"><h2>${escapeHtml(title)}</h2>${from}${body}</section>`;
}

export function renderBrief(events = [], otherLens = '', priorEvents = []) {
  const list = Array.isArray(events) ? events : [];
  const brief = [...list].reverse().find((event) => event?.t === 'brief') || {};
  const audit = [...list].reverse().find((event) => event?.t === 'audit') || {};
  const brandPicks = [...list].reverse().find((event) => event?.t === 'section' && event.key === 'brands')?.items || [];
  const bestPick = brandPicks.map((item) => finite(item.affinity)).filter((value) => value !== null).reduce((best, value) => Math.max(best, value), -Infinity);
  const relax = [...list].reverse().find((event) => event?.t === 'relax');
  const run = list.find((event) => event?.t === 'run') || {};
  const priorAudit = [...(priorEvents || [])].reverse().find((event) => event?.t === 'audit')?.rows || [];
  const sections = new Map();
  for (const event of list) if (event?.t === 'section') sections.set(event.key, event);
  const keys = ['brands', 'books', 'playlist', 'places'];
  const scope = relax?.to || brief.scope || '';
  const from = relax?.from ? `<span class="from-neighbourhood"> from ${escapeHtml(relax.from)}</span>` : '';
  const scopeHeader = scope ? `<p class="scope-line">${escapeHtml(scope)}${from}</p>` : '';
  const lensSwitch = brief.lens ? `<div class="lens-segment" aria-label="Choose a lens"><span class="current">${escapeHtml(brief.lens)}</span>${otherLens ? `<button type="button" data-lens-switch>${escapeHtml(otherLens)}</button>` : ''}</div>` : '';
  const header = `<header class="result-header">${scopeHeader}<p class="header-lens">${escapeHtml(brief.lens || 'Listing brief')}</p><span class="header-mode">${escapeHtml(modeLabel(run))}</span></header>`;
  const notice = relax?.why ? `<p class="run-notice">${escapeHtml(relax.why)}</p>` : '';
  const content = `${header}${notice}${lensSwitch}${auditHtml(audit.rows, priorAudit, Number.isFinite(bestPick) ? bestPick : null, brandPicks.map((item) => item.affinity), Boolean(audit.rows))}${keys.map((key) => cardsHtml(sections.get(key) || { key, items: [], thin: true })).join('')}${brief.intro ? `<p class="brief-intro">${escapeHtml(brief.intro)}</p>` : ''}${brief.paragraph ? `<section class="listing-copy"><h2>Listing paragraph</h2><p id="listing-paragraph" class="paragraph">${escapeHtml(brief.paragraph)}</p><div class="action-row"><button type="button" data-copy-paragraph>Copy</button><span class="small">Written by ${brief.written_by === 'model' ? 'model' : 'template'}</span></div></section>` : ''}`;
  return content || '<p class="empty-note">Choose a preset or enter a place to begin.</p>';
}

function sectionDiff(a, b, key) {
  const section = (events) => [...(events || [])].reverse().find((e) => e?.t === 'section' && e.key === key);
  const left = section(a)?.items || [], right = section(b)?.items || [];
  const names = (items) => items.map((item) => String(item.name ?? ''));
  const oldNames = names(left), newNames = names(right);
  const oldPos = new Map(oldNames.map((name, i) => [name, i + 1]));
  const newPos = new Map(newNames.map((name, i) => [name, i + 1]));
  const added = newNames.filter((name) => !oldPos.has(name));
  const dropped = oldNames.filter((name) => !newPos.has(name));
  const moved = newNames.filter((name) => oldPos.has(name) && oldPos.get(name) !== newPos.get(name))
    .map((name) => ({ name, from: oldPos.get(name), to: newPos.get(name), delta: oldPos.get(name) - newPos.get(name) }));
  return { key, added, dropped, moved };
}

export function diffBriefs(a = [], b = []) {
  const audit = (events) => [...events].reverse().find((event) => event?.t === 'audit')?.rows || [];
  const leftAudit = new Map(audit(a).map((row) => [row.name, row.verdict]));
  const changedAudit = audit(b).filter((row) => leftAudit.has(row.name) && leftAudit.get(row.name) !== row.verdict)
    .map((row) => ({ name: row.name, from: leftAudit.get(row.name), to: row.verdict }));
  return { sections: ['brands', 'books', 'playlist', 'places'].map((key) => sectionDiff(a, b, key)), audit: changedAudit };
}

export function renderDiff(diff) {
  const labels = { brands: 'Brands', books: 'Books', playlist: 'Playlist', places: 'Local favourites' };
  const blocks = (diff?.sections || []).map((section) => {
    const moved = section.moved.map((item) => ({ name: item.name, label: `${item.delta > 0 ? 'Up' : 'Down'} ${Math.abs(item.delta)}` }));
    const chips = [
      ...section.added.map((name) => `<span class="diff-chip new">New ${escapeHtml(name)}</span>`),
      ...section.dropped.map((name) => `<span class="diff-chip out">Out ${escapeHtml(name)}</span>`),
      ...moved.map((item) => `<span class="diff-chip">${escapeHtml(item.label)} ${escapeHtml(item.name)}</span>`),
    ];
    return `<div class="diff-block"><h3>${escapeHtml(labels[section.key] || section.key)}</h3><div class="diff-chips">${chips.join('') || '<span class="diff-chip">No change</span>'}</div></div>`;
  }).join('');
  const changed = diff?.audit || [];
  return `<h2>Lens difference</h2>${blocks}<div class="diff-block"><h3>Audit changes</h3>${changed.length ? changed.map((row) => `<p class="diff-line">${escapeHtml(row.name)}: ${escapeHtml(verdictNames[row.from] || row.from)} to ${escapeHtml(verdictNames[row.to] || row.to)}</p>`).join('') : '<p class="diff-line">No verdict changes</p>'}</div>`;
}

/** What the Qloo off tab says when no picks came back: the server's own error text, or a plain fallback. */
export function plainNote(events = []) {
  const error = (Array.isArray(events) ? events : []).find((event) => event?.t === 'error' && typeof event.text === 'string' && event.text);
  return error ? error.text : 'Qloo off picks are not available yet.';
}
export function renderPlain(event = {}, qlooEvents = []) {
  const brands = Array.isArray(event.brands) ? event.brands : [];
  const places = Array.isArray(event.places) ? event.places : [];
  const qloo = new Map(), qlooSections = new Map();
  for (const e of qlooEvents) if (e?.t === 'section') { qlooSections.set(e.key, e.items || []); if (e.key === 'brands') for (const item of e.items || []) qloo.set(String(item.name).toLowerCase(), item); }
  const brandRows = brands.map((item) => `<li>${escapeHtml(item.name)} <span class="small">${item.found === false ? 'Not in Qloo' : `Qloo ${score(item.qloo_affinity ?? qloo.get(String(item.name).toLowerCase())?.affinity)}`}</span></li>`).join('');
  const placeRows = places.map((item) => `<li>${escapeHtml(item.name)} <span class="small">${item.found === false ? 'Not found in this area' : 'Found in this area'}</span></li>`).join('');
  const qlooBrands = (qlooSections.get('brands') || []).map((item) => `<li>${escapeHtml(item.name)} <span class="small">${score(item.affinity)}</span></li>`).join('');
  const qlooPlaces = (qlooSections.get('places') || []).map((item) => `<li>${escapeHtml(item.name)} <span class="small">${score(item.affinity)}</span></li>`).join('');
  return `<h2>Qloo off picks</h2><div class="result-grid"><section><h3>Qloo off</h3><h3>Brands</h3><ul>${brandRows || '<li>No picks yet</li>'}</ul><h3>Places</h3><ul>${placeRows || '<li>No picks yet</li>'}</ul></section><section><h3>Qloo picks</h3><h3>Brands</h3><ul>${qlooBrands || '<li>No picks yet</li>'}</ul><h3>Places</h3><ul>${qlooPlaces || '<li>No picks yet</li>'}</ul></section></div>`;
}
