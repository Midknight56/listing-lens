import { diffBriefs, escapeHtml, modeLabel, renderBrief, renderDiff, renderPlain, runSummary } from './render.js';

const $ = (s) => document.querySelector(s);
const form = $('#stage-form');
const city = $('#city');
const neighbourhood = $('#neighbourhood');
const anchors = [...document.querySelectorAll('.anchor')];
const roomInput = $('#room-input');
const runLog = $('#run-log');
const runLines = $('#run-lines');
const runSummaryNode = $('#run-summary');
const briefContent = $('#brief-content');
const presetsNode = $('#presets');
const lensChips = $('#lens-chips');
const roomChips = $('#room-chips');
const errorBox = $('#error-box');
const modeBadge = $('#mode-badge');
const shareButton = $('#share-button');
const printButton = $('#print-button');
const lensToggle = $('#lens-toggle');
const diffBox = $('#lens-diff');
const plainContent = $('#plain-content');
const plainView = $('#plain-view');
const briefView = $('#brief-view');
const featureNode = $('#feature-list');

const FEATURES = ['natural light', 'open kitchen', 'front porch', 'home office', 'garden', 'fireplace', 'hardwood floors', 'walk in closet', 'updated bath', 'big windows', 'high ceilings', 'patio', 'workshop', 'reading nook'];
let catalogue = { presets: [], lenses: [], features: FEATURES };
let room = [];
let selectedPreset = null;
let requestState = null;
let activeEvents = [];
let baselineEvents = null;
let briefId = null;
let busy = false;
let currentLens = null;
let otherLens = null;
let plainEvent = null;

function markCustom() { if (selectedPreset) { selectedPreset = null; drawPresets(); } }
function textNode(tag, text, cls) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
function drawRooms() {
  roomChips.replaceChildren();
  room.forEach((name, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'remove-chip'; button.setAttribute('aria-label', `Remove ${name}`);
    const label = document.createElement('span'); label.textContent = '×'; button.append(document.createTextNode(name), label);
    button.addEventListener('click', () => { room.splice(index, 1); drawRooms(); markCustom(); }); roomChips.append(button);
  });
}
function drawPresets() {
  presetsNode.replaceChildren();
  catalogue.presets.forEach((preset) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chip'; button.textContent = preset.label; button.setAttribute('aria-pressed', String(selectedPreset === preset.id));
    button.addEventListener('click', () => applyPreset(preset)); presetsNode.append(button);
  });
}
function drawLenses() {
  lensChips.replaceChildren();
  catalogue.lenses.forEach((lens) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chip'; button.textContent = lens.label; button.setAttribute('aria-pressed', String(currentLens?.label === lens.label));
    button.addEventListener('click', () => { currentLens = lens; anchors.forEach((input, i) => { input.value = lens.anchors?.[i] || ''; }); markCustom(); drawLenses(); }); lensChips.append(button);
  });
}
function applyPreset(preset) {
  selectedPreset = preset.id; city.value = preset.city || ''; neighbourhood.value = preset.neighbourhood || '';
  currentLens = preset.lens || null; anchors.forEach((input, i) => { input.value = currentLens?.anchors?.[i] || ''; });
  room = [...(preset.room || [])].slice(0, 6); drawRooms(); drawLenses(); drawPresets();
  const selected = new Set(preset.features || []); featureNode.querySelectorAll('input').forEach((input) => { input.checked = selected.has(input.value); });
}
function drawFeatures() {
  featureNode.replaceChildren();
  (catalogue.features?.length ? catalogue.features : FEATURES).forEach((feature) => {
    const label = document.createElement('label'); label.className = 'check-label';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = feature; input.addEventListener('change', () => { if (featureNode.querySelectorAll('input:checked').length > 6) input.checked = false; markCustom(); });
    label.append(input, document.createTextNode(feature)); featureNode.append(label);
  });
}
async function loadPresets() {
  try { const response = await fetch('/api/presets'); if (!response.ok) throw new Error(); catalogue = { ...catalogue, ...await response.json() }; }
  catch { catalogue = { ...catalogue, presets: [] }; }
  drawPresets(); drawLenses(); drawFeatures();
}
function collectRequest() {
  const typed = anchors.map((input) => input.value.trim()).filter(Boolean).slice(0, 3);
  const selectedFeatures = [...featureNode.querySelectorAll('input:checked')].map((input) => input.value).slice(0, 6);
  const lens = { label: currentLens?.label || 'Typed loves', anchors: typed };
  return { city: city.value.trim(), neighbourhood: neighbourhood.value.trim(), lens, room: [...room], features: selectedFeatures, ...(selectedPreset ? { preset: selectedPreset } : {}) };
}
function resetRun() {
  activeEvents = []; runLines.replaceChildren(); runSummaryNode.textContent = 'Run log'; runLog.open = true; errorBox.hidden = true; errorBox.textContent = '';
  briefContent.innerHTML = '<p class="empty-note">Building the brief…</p>'; modeBadge.hidden = true; diffBox.hidden = true; diffBox.replaceChildren();
}
function logEvent(event) {
  const t = event.t;
  let message = '';
  if (t === 'call') message = `Call ${event.n}: ${event.what || event.path}${event.cached ? ' from cache' : ''}`;
  if (t === 'resolved') message = `${event.kind}: ${event.name} as ${event.as}`;
  if (t === 'relax') message = `${event.why || `Using ${event.to} for better local data`}. This brief uses ${event.to}.`;
  if (t === 'fallback') message = `Writing fallback: ${event.why}`;
  if (!message) return;
  const line = textNode('p', message, `log-line${t === 'relax' ? ' relax' : ''}`); runLines.append(line);
  if (t === 'relax') runSummaryNode.textContent = `${runSummary(activeEvents)} · ${message}`;
}
function handleEvent(event) {
  activeEvents.push(event); logEvent(event);
  if (event.t === 'run') { briefId = event.id || briefId; modeBadge.textContent = modeLabel(event); modeBadge.hidden = !modeBadge.textContent; }
  if (event.t === 'error') { errorBox.textContent = event.text || 'The brief could not be made. Try a preset.'; errorBox.hidden = false; }
  if (event.t === 'brief' || event.t === 'section' || event.t === 'audit') briefContent.innerHTML = renderBrief(activeEvents);
  if (event.t === 'plain') { plainEvent = event; plainContent.innerHTML = renderPlain(event, activeEvents); }
  if (event.t === 'done') {
    briefContent.innerHTML = renderBrief(activeEvents); runSummaryNode.textContent = runSummary(activeEvents);
    const relax = activeEvents.find((e) => e.t === 'relax');
    if (relax) runSummaryNode.textContent += ` · ${relax.why || `This brief uses ${relax.to}`}`;
    runLog.open = false;
    shareButton.hidden = !briefId; printButton.hidden = false;
    otherLens = catalogue.lenses.find((lens) => lens.label !== requestState?.lens?.label) || null;
    lensToggle.hidden = !otherLens || !briefId;
    if (otherLens) lensToggle.textContent = `See it for ${otherLens.label}`;
  }
}
async function readNdjson(response, callback) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  for (;;) {
    const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let index; while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1); if (line) callback(JSON.parse(line)); }
    if (done) break;
  }
  if (buffer.trim()) callback(JSON.parse(buffer));
}
async function postRun(url, body, { reset = true } = {}) {
  if (busy) return;
  busy = true; form.querySelector('.primary-button').disabled = true;
  if (reset) resetRun();
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok || !response.body) { const info = await response.json().catch(() => ({})); throw new Error(info.error || 'The brief could not start. Try a preset.'); }
    await readNdjson(response, handleEvent);
  } catch (error) { errorBox.textContent = error instanceof Error ? error.message : 'The brief could not start. Try a preset.'; errorBox.hidden = false; }
  finally { busy = false; form.querySelector('.primary-button').disabled = false; }
}
form.addEventListener('submit', (event) => {
  event.preventDefault(); const request = collectRequest();
  if (!request.city || request.lens.anchors.length < 1) { errorBox.textContent = 'Add a city and at least one love to continue.'; errorBox.hidden = false; return; }
  requestState = request; baselineEvents = null; postRun('/api/stage', request);
});
$('#add-room').addEventListener('click', () => {
  const value = roomInput.value.trim(); if (!value || room.length >= 6) return;
  room.push(value); roomInput.value = ''; drawRooms(); markCustom();
});
roomInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('#add-room').click(); } });
city.addEventListener('input', markCustom); neighbourhood.addEventListener('input', markCustom); anchors.forEach((input) => input.addEventListener('input', markCustom));
featureNode.addEventListener('change', markCustom);
briefContent.addEventListener('click', async (event) => {
  if (!event.target.matches('[data-copy-paragraph]')) return;
  try { await navigator.clipboard.writeText($('#listing-paragraph').textContent); event.target.textContent = 'Copied'; } catch { event.target.textContent = 'Copy unavailable'; }
});
shareButton.addEventListener('click', async () => {
  const url = `${location.origin}/s/${encodeURIComponent(briefId)}`;
  try { await navigator.clipboard.writeText(url); shareButton.textContent = 'Link copied'; } catch { shareButton.textContent = 'Copy unavailable'; }
});
printButton.addEventListener('click', () => window.print());
lensToggle.addEventListener('click', async () => {
  if (!briefId || !otherLens || busy) return;
  baselineEvents = activeEvents.slice(); const originalRequest = requestState;
  const flipped = { ...originalRequest, lens: otherLens, ...(selectedPreset ? { preset: selectedPreset } : {}) };
  requestState = flipped; activeEvents = []; runLines.replaceChildren(); runSummaryNode.textContent = 'Run log'; runLog.open = true;
  await postRun('/api/stage', flipped, { reset: false });
  if (activeEvents.some((event) => event.t === 'done') && baselineEvents) { diffBox.innerHTML = renderDiff(diffBriefs(baselineEvents, activeEvents)); diffBox.hidden = false; }
  requestState = originalRequest; currentLens = originalRequest.lens; otherLens = flipped.lens; lensToggle.textContent = `See it for ${otherLens.label}`;
});
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', async () => {
  const plain = button.dataset.tab === 'plain';
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
  briefView.hidden = plain; plainView.hidden = !plain;
  if (plain && briefId && !plainEvent && !busy) {
    plainContent.textContent = 'Loading picks…';
    try { const response = await fetch('/api/plain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: briefId }) }); if (!response.ok || !response.body) throw new Error(); await readNdjson(response, handleEvent); }
    catch { plainContent.textContent = 'Qloo off picks are not available yet.'; }
  }
}));
async function loadShared(id) {
  form.hidden = true; runLog.hidden = true; document.querySelector('.tabs').hidden = true;
  try {
    const response = await fetch(`/api/brief/${encodeURIComponent(id)}`); if (!response.ok) throw new Error();
    const saved = await response.json(); requestState = saved.request; briefId = id; activeEvents = Array.isArray(saved.events) ? saved.events : [];
    const run = activeEvents.find((event) => event.t === 'run'); if (run) { modeBadge.textContent = modeLabel(run); modeBadge.hidden = false; }
    briefContent.innerHTML = renderBrief(activeEvents); printButton.hidden = false;
  } catch { errorBox.textContent = 'This brief could not be found.'; errorBox.hidden = false; }
}
async function loadDev() {
  try { const response = await fetch('/dev/sample-run.ndjson'); if (!response.ok) throw new Error(); await readNdjson(response, handleEvent); }
  catch { errorBox.textContent = 'The sample brief could not be loaded.'; errorBox.hidden = false; }
}
await loadPresets();
drawFeatures();
const shareMatch = location.pathname.match(/^\/s\/([^/]+)$/);
if (new URLSearchParams(location.search).has('dev')) await loadDev();
else if (shareMatch) await loadShared(decodeURIComponent(shareMatch[1]));
