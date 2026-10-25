export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const sectionNames = { brands: 'Brands to show', books: 'Coffee table books', playlist: 'Open house playlist', places: 'Local favourites' };
const verdictNames = { keep: 'Keep', swap: 'Swap', cut: 'Cut', unknown: 'Not in Qloo' };
const finite = (n) => Number.isFinite(Number(n)) ? Number(n) : null;
const score = (n) => finite(n) === null ? 'No score' : finite(n).toFixed(3);

export function modeLabel(event = {}) {
  if (event.mode === 'live') return 'Live';
  if (event.mode === 'template') return "Plain text mode: today's writing budget is spent";
  if (event.mode === 'cache') return 'From cache';
  if (event.mode === 'replay') {
    const date = event.recorded_at ? new Date(event.recorded_at).toLocaleDateString() : '';
    return date ? `Recorded on ${date}` : 'Recorded brief';
  }
  if (event.mode === 'off') return 'Qloo off';
  return '';
}

export function runSummary(events = []) {
  const usage = [...events].reverse().find((e) => e?.t === 'usage');
  const calls = events.filter((e) => e?.t === 'call').length;
  const cached = usage && Number.isFinite(Number(usage.qloo_cached))
    ? Number(usage.qloo_cached) : events.filter((e) => e?.t === 'call' && e.cached).length;
  return `${calls} Qloo calls, ${cached} cached`;
}

function auditHtml(rows = []) {
  const values = Array.isArray(rows) ? rows : [];
  if (!values.length) return '';
  const valuesWithScore = values.map((row) => finite(row.affinity)).filter((n) => n !== null);
  const min = valuesWithScore.length ? Math.min(...valuesWithScore) : 0;
  const max = valuesWithScore.length ? Math.max(...valuesWithScore) : 1;
  const low = Math.max(0, min - 0.01);
  const span = Math.max(0.0001, max - low);
  const rowsHtml = values.map((row) => {
    const verdict = verdictNames[row.verdict] ? row.verdict : 'unknown';
    const affinity = finite(row.affinity);
    const width = affinity === null ? 0 : Math.max(0, Math.min(100, ((affinity - low) / span) * 100));
    const swap = row.swap?.name ? escapeHtml(row.swap.name) : 'None';
    return `<tr><td>${escapeHtml(row.name)}</td><td><span class="verdict ${verdict}">${verdictNames[verdict]}</span></td><td><span class="score-track" aria-hidden="true"><span class="score-fill" style="width:${width.toFixed(1)}%"></span></span><span class="score-number">${score(affinity)}</span></td><td>${swap}</td></tr>`;
  }).join('');
  return `<section class="audit-section"><h2>Room audit</h2><table class="audit-table"><thead><tr><th>In the room</th><th>Call</th><th>Affinity</th><th>Swap to</th></tr></thead><tbody>${rowsHtml}</tbody></table><p class="small">Score scale: ${score(low)} to ${score(max)}</p></section>`;
}

function cardsHtml(section) {
  const key = section.key;
  const title = sectionNames[key] || key;
  const items = Array.isArray(section.items) ? section.items : [];
  const body = section.thin || items.length < 3
    ? '<p class="thin">Thin data here</p>'
    : `<div class="result-grid">${items.map((item) => `<article class="result-card"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.why || item.detail || 'A match for this lens and place.')}</p><span class="affinity">${score(item.affinity)}</span></article>`).join('')}</div>`;
  return `<section class="result-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

export function renderBrief(events = []) {
  const list = Array.isArray(events) ? events : [];
  const brief = [...list].reverse().find((event) => event?.t === 'brief') || {};
  const audit = [...list].reverse().find((event) => event?.t === 'audit') || {};
  const sections = new Map();
  for (const event of list) if (event?.t === 'section') sections.set(event.key, event);
  const keys = ['brands', 'books', 'playlist', 'places'];
  const content = `${brief.intro ? `<p class="brief-intro">${escapeHtml(brief.intro)}</p>` : ''}${brief.scope ? `<p class="scope-line">${escapeHtml(brief.scope)}${brief.lens ? ` · ${escapeHtml(brief.lens)}` : ''}</p>` : ''}${auditHtml(audit.rows)}${keys.map((key) => cardsHtml(sections.get(key) || { key, items: [], thin: true })).join('')}${brief.paragraph ? `<section class="listing-copy"><h2>Listing paragraph</h2><p id="listing-paragraph" class="paragraph">${escapeHtml(brief.paragraph)}</p><div class="action-row"><button type="button" data-copy-paragraph>Copy</button><span class="small">Written by ${brief.written_by === 'model' ? 'model' : 'template'}</span></div></section>` : ''}`;
  return content || '<p class="empty-note">Choose a preset or enter a place to begin.</p>';
}

function sectionDiff(a, b, key) {
  const section = (events) => [...(events || [])].reverse().find((e) => e?.t === 'section' && e.key === key);
  const left = section(a)?.items || [];
  const right = section(b)?.items || [];
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
  const line = (label, items) => `<p class="diff-line"><strong>${label}:</strong> ${items.length ? items.map((v) => escapeHtml(v)).join(', ') : 'None'}</p>`;
  const blocks = (diff?.sections || []).map((section) => {
    const moved = section.moved.map((item) => `${escapeHtml(item.name)} ${item.delta > 0 ? '↑' : '↓'} ${Math.abs(item.delta)}`);
    return `<div class="diff-block"><h3>${escapeHtml(labels[section.key] || section.key)}</h3>${line('New in', section.added)}${line('Dropped out', section.dropped)}${line('Moved', moved)}</div>`;
  }).join('');
  const changed = diff?.audit || [];
  return `<h2>Lens difference</h2>${blocks}<div class="diff-block"><h3>Audit changes</h3>${changed.length ? changed.map((row) => `<p class="diff-line">${escapeHtml(row.name)}: ${escapeHtml(verdictNames[row.from] || row.from)} to ${escapeHtml(verdictNames[row.to] || row.to)}</p>`).join('') : '<p class="diff-line">No verdict changes</p>'}</div>`;
}

export function renderPlain(event = {}, qlooEvents = []) {
  const brands = Array.isArray(event.brands) ? event.brands : [];
  const places = Array.isArray(event.places) ? event.places : [];
  const qloo = new Map();
  const qlooSections = new Map();
  for (const e of qlooEvents) if (e?.t === 'section') {
    qlooSections.set(e.key, e.items || []);
    if (e.key === 'brands') for (const item of e.items || []) qloo.set(String(item.name).toLowerCase(), item);
  }
  const brandRows = brands.map((item) => {
    const found = item.found !== false;
    const match = qloo.get(String(item.name).toLowerCase());
    return `<li>${escapeHtml(item.name)} <span class="small">${found ? `Qloo ${score(item.qloo_affinity ?? match?.affinity)}` : 'Not in Qloo'}</span></li>`;
  }).join('');
  const placeRows = places.map((item) => `<li>${escapeHtml(item.name)} <span class="small">${item.found === false ? 'Not found in this area' : 'Found in this area'}</span></li>`).join('');
  const qlooBrands = (qlooSections.get('brands') || []).map((item) => `<li>${escapeHtml(item.name)} <span class="small">${score(item.affinity)}</span></li>`).join('');
  const qlooPlaces = (qlooSections.get('places') || []).map((item) => `<li>${escapeHtml(item.name)} <span class="small">${score(item.affinity)}</span></li>`).join('');
  return `<h2>Qloo off picks</h2><div class="result-grid"><section><h3>Qloo off</h3><h3>Brands</h3><ul>${brandRows || '<li>No picks yet</li>'}</ul><h3>Places</h3><ul>${placeRows || '<li>No picks yet</li>'}</ul></section><section><h3>Qloo picks</h3><h3>Brands</h3><ul>${qlooBrands || '<li>No picks yet</li>'}</ul><h3>Places</h3><ul>${qlooPlaces || '<li>No picks yet</li>'}</ul></section></div>`;
}
