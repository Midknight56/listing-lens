import { diffBriefs, modeLabel, renderBrief, renderDiff, renderPlain, runSummary } from './render.js';

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
const formDetails = $('#form-details');
const paletteStyle = $('#palette-style');

const FEATURES = ['natural light', 'open kitchen', 'front porch', 'home office', 'garden', 'fireplace', 'hardwood floors', 'walk in closet', 'updated bath', 'big windows', 'high ceilings', 'patio', 'workshop', 'reading nook'];
let catalogue = { presets: [], lenses: [], features: FEATURES };
let room = [];
let selectedPreset = null;
let selectedPresetData = null;
let requestState = null;
let activeEvents = [];
let baselineEvents = null;
let briefId = null;
let busy = false;
let currentLens = null;
let otherLens = null;
let plainEvent = null;

const localPresets = [
  { label: 'Design forward', city: 'Nashville', neighbourhood: 'East Nashville', hint: 'Warm craft and local finds', lens: { label: 'Design forward', anchors: ['Herman Miller', 'Kinfolk', 'Khruangbin'] }, room: ['IKEA', 'Pottery Barn', 'West Elm', 'CB2'] },
  { label: 'Classic comfort', city: 'Nashville', neighbourhood: '12 South', hint: 'Familiar forms, fresh detail', lens: { label: 'Classic comfort', anchors: ['Ralph Lauren', 'House Beautiful', 'Norah Jones'] }, room: ['IKEA', 'Pottery Barn', 'West Elm', 'CB2'] },
  { label: 'Design forward', city: 'Chicago', neighbourhood: 'Hyde Park', hint: 'Collected, bookish character', lens: { label: 'Design forward', anchors: ['Herman Miller', 'Kinfolk', 'Khruangbin'] }, room: ['IKEA', 'Pottery Barn', 'West Elm', 'CB2'] },
  { label: 'Classic comfort', city: 'Chicago', neighbourhood: 'Wicker Park', hint: 'Soft layers with city spirit', lens: { label: 'Classic comfort', anchors: ['Ralph Lauren', 'House Beautiful', 'Norah Jones'] }, room: ['IKEA', 'Pottery Barn', 'West Elm', 'CB2'] },
  { label: 'Design forward', city: 'Halifax', neighbourhood: 'North End', hint: 'A calm coastal palette', lens: { label: 'Design forward', anchors: ['Studio K', 'Paper Moon', 'Harbor Radio'] }, room: ['IKEA', 'Pottery Barn', 'West Elm', 'CB2'] },
  { label: 'Classic comfort', city: 'Halifax', neighbourhood: '', hint: 'Easy pieces, grounded feel', lens: { label: 'Classic comfort', anchors: ['Ralph Lauren', 'House Beautiful', 'Norah Jones'] }, room: ['IKEA', 'Pottery Barn', 'West Elm', 'CB2'] },
];
const runSteps = ['Plan', 'Buyer', 'Place', 'Sections', 'Room', 'Audit', 'Write'];

const palette = new URLSearchParams(location.search).get('palette');
if (['linen', 'sage', 'harbour', 'walnut'].includes(palette)) { paletteStyle.href = `/palettes/${palette}.css`; paletteStyle.disabled = false; }
if (matchMedia('(max-width: 899px)').matches) formDetails.open = false;

function markCustom() { if (selectedPreset || selectedPresetData) { selectedPreset = null; selectedPresetData = null; drawPresets(); } }
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
  (catalogue.presets.length ? catalogue.presets : (new URLSearchParams(location.search).has('dev') ? localPresets : [])).forEach((preset) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'preset-card'; button.setAttribute('aria-pressed', String(selectedPreset === preset.id));
    button.dataset.presetId = preset.id || '';
    button.dataset.presetLabel = preset.label || `${preset.neighbourhood || preset.city || ''}`;
    const cityLine = textNode('span', preset.city || '', 'preset-city');
    const neighbourhoodLine = textNode('span', preset.neighbourhood || 'City wide', 'preset-neighbourhood');
    const lens = textNode('strong', preset.lens?.label || preset.label || 'A point of view', 'preset-lens');
    const hint = textNode('span', preset.hint || `A brief for ${preset.city || 'your city'}`, 'preset-hint');
    button.append(cityLine, neighbourhoodLine, lens, hint);
    // A tap on an example starts its brief at once: on a phone the form is folded away, so filling it alone looks dead.
    button.addEventListener('click', () => { applyPreset(preset); form.requestSubmit(); }); presetsNode.append(button);
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
  selectedPreset = preset.id || null; selectedPresetData = preset; city.value = preset.city || ''; neighbourhood.value = preset.neighbourhood || '';
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
  if (!catalogue.presets.length && new URLSearchParams(location.search).has('dev')) catalogue.presets = localPresets;
  if (!catalogue.lenses.length) {
    const lenses = catalogue.presets.flatMap((preset) => [preset.lens, preset.flip]).filter(Boolean);
    catalogue.lenses = [...new Map(lenses.map((lens) => [lens.label, lens])).values()];
  }
  drawPresets(); drawLenses(); drawFeatures();
}
function collectRequest() {
  const typed = anchors.map((input) => input.value.trim()).filter(Boolean).slice(0, 3);
  const selectedFeatures = [...featureNode.querySelectorAll('input:checked')].map((input) => input.value).slice(0, 6);
  const lens = { label: currentLens?.label || 'Typed loves', anchors: typed };
  return { city: city.value.trim(), neighbourhood: neighbourhood.value.trim(), lens, room: [...room], features: selectedFeatures, ...(selectedPreset ? { preset: selectedPreset } : {}) };
}
function resetRun() {
  activeEvents = []; plainEvent = null; plainContent.replaceChildren(); runLines.replaceChildren(); runSummaryNode.textContent = 'Run log'; runLog.open = true; errorBox.hidden = true; errorBox.textContent = '';
  briefContent.innerHTML = '<p class="empty-note">Building the brief…</p>'; modeBadge.hidden = true; diffBox.hidden = true; diffBox.replaceChildren();
}
function logEvent(event) {
  if (event.t === 'done') return;
  const completed = new Set();
  if (activeEvents.some((e) => e.t === 'plan')) completed.add(0);
  if (activeEvents.some((e) => e.t === 'resolved' && e.kind === 'anchor')) completed.add(1);
  if (activeEvents.some((e) => e.t === 'resolved' && e.kind === 'scope')) completed.add(2);
  if (activeEvents.filter((e) => e.t === 'section').length >= 3) completed.add(3);
  if (activeEvents.some((e) => e.t === 'resolved' && e.kind === 'room')) completed.add(4);
  if (activeEvents.some((e) => e.t === 'audit')) completed.add(5);
  if (activeEvents.some((e) => e.t === 'brief')) completed.add(6);
  const activeIndex = Math.min(6, completed.size ? Math.max(...completed) + 1 : 0);
  runLines.replaceChildren();
  const list = document.createElement('ol'); list.className = 'timeline';
  runSteps.forEach((label, index) => {
    const item = document.createElement('li');
    if (completed.has(index)) item.classList.add('done'); else if (index === activeIndex) item.classList.add('active');
    const dot = document.createElement('span'); dot.className = 'step-dot';
    item.append(dot, document.createTextNode(label)); list.append(item);
  });
  runLines.append(list);
}
function handleEvent(event) {
  activeEvents.push(event); logEvent(event);
  if (event.t === 'run') { briefId = event.id || briefId; modeBadge.textContent = modeLabel(event); modeBadge.hidden = !modeBadge.textContent; }
  if (event.t === 'error') { errorBox.textContent = event.text || 'The brief could not be made. Try a preset.'; errorBox.hidden = false; }
  if (event.t === 'brief' || event.t === 'section' || event.t === 'audit' || event.t === 'relax') briefContent.innerHTML = renderBrief(activeEvents, otherLens?.label || '', baselineEvents || []);
  if (event.t === 'plain') { plainEvent = event; plainContent.innerHTML = renderPlain(event, activeEvents); }
  if (event.t === 'done') {
    const completedBrief = [...activeEvents].reverse().find((e) => e.t === 'brief');
    const activeLens = completedBrief?.lens || requestState?.lens?.label;
    otherLens = selectedPresetData?.flip?.label !== activeLens ? (selectedPresetData?.flip || null) : null;
    otherLens ||= catalogue.lenses.find((lens) => lens.label !== activeLens) || null;
    briefContent.innerHTML = renderBrief(activeEvents, otherLens?.label || '', baselineEvents || []); runSummaryNode.textContent = runSummary(activeEvents);
    runLog.open = false;
    shareButton.hidden = !briefId; printButton.hidden = false;
    lensToggle.hidden = true;
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
    // A refusal still comes as run log lines, so its own words (which love was refused, which city was not found) show.
    const streamed = /ndjson/.test(response.headers.get('Content-Type') || '');
    if ((!response.ok && !streamed) || !response.body) { const info = await response.json().catch(() => ({})); throw new Error(info.error || 'The brief could not start. Try a preset.'); }
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
async function flipLens() {
  if (!briefId || !otherLens || busy) return;
  baselineEvents = activeEvents.slice(); const originalRequest = requestState;
  const flipped = { ...originalRequest, lens: otherLens };
  requestState = flipped; activeEvents = []; runLines.replaceChildren(); runSummaryNode.textContent = 'Run log'; runLog.open = true;
  await postRun('/api/stage', flipped, { reset: false });
  if (activeEvents.some((event) => event.t === 'done') && baselineEvents) {
    diffBox.innerHTML = renderDiff(diffBriefs(baselineEvents, activeEvents)); diffBox.hidden = false;
    requestState = flipped; currentLens = flipped.lens; otherLens = originalRequest.lens;
    briefContent.innerHTML = renderBrief(activeEvents, otherLens.label, baselineEvents || []);
  } else requestState = originalRequest;
}
lensToggle.addEventListener('click', flipLens);
briefContent.addEventListener('click', (event) => { if (event.target.closest('[data-lens-switch]')) flipLens(); });
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', async () => {
  const plain = button.dataset.tab === 'plain';
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
  briefView.hidden = plain; plainView.hidden = !plain;
  if (plain && briefId && !plainEvent && !busy) {
    plainContent.textContent = 'Asking the same model with no Qloo';
    try {
      const response = await fetch('/api/plain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: briefId }) });
      if (!response.ok || !response.body) throw new Error();
      await readNdjson(response, (event) => {
        if (event.t === 'plain') { plainEvent = event; plainContent.innerHTML = renderPlain(event, activeEvents); }
        if (event.t === 'error') plainContent.textContent = event.text || 'These picks are not available right now.';
      });
    } catch { plainContent.textContent = 'Qloo off picks are not available yet.'; }
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
  try {
    const params = new URLSearchParams(location.search);
    const file = params.has('running') ? 'sample-running.ndjson' : 'sample-run.ndjson';
    if (params.has('running')) runLog.open = true;
    const response = await fetch(`/dev/${file}`); if (!response.ok) throw new Error(); await readNdjson(response, handleEvent);
    if (params.has('flip') && activeEvents.some((event) => event.t === 'done')) {
      baselineEvents = activeEvents.slice();
      const flipResponse = await fetch('/dev/sample-flip.ndjson');
      if (flipResponse.ok) {
        const flipText = await flipResponse.text();
        const flippedEvents = flipText.trim().split('\n').map((line) => JSON.parse(line));
        activeEvents = flippedEvents;
        otherLens = { label: 'Design forward' };
        briefContent.innerHTML = renderBrief(activeEvents, otherLens.label, baselineEvents);
        diffBox.innerHTML = renderDiff(diffBriefs(baselineEvents, activeEvents)); diffBox.hidden = false;
      }
    }
  }
  catch { errorBox.textContent = 'The sample brief could not be loaded.'; errorBox.hidden = false; }
}
await loadPresets();
drawFeatures();
const shareMatch = location.pathname.match(/^\/s\/([^/]+)$/);
if (new URLSearchParams(location.search).has('dev')) await loadDev();
else if (shareMatch) await loadShared(decodeURIComponent(shareMatch[1]));
