"""Preset scouting (25 Oct 2026), at most 10 Qloo calls: which neighbourhoods resolve right and return their own brand
list for the design anchors. Raw answers to out/probe/presets/ (ignored by git)."""
import json, urllib.parse
import kill_test as k
k.OUT = k.OUT.parent / 'probe' / 'presets'
k.calls, k.MAX_CALLS = 0, 10
anchors = urllib.parse.unquote(json.loads((k.OUT.parent.parent / 'kill_test' / 'combo_East_Nashville.json').read_text(encoding='utf-8'))['url'].split('signal.interests.entities=')[1].split('&')[0])
for hood in ['Wicker Park', 'Hyde Park, Chicago', 'Leslieville', 'North End, Halifax', 'Silver Lake', 'Williamsburg, Brooklyn', 'Capitol Hill, Seattle', 'Mile End', 'East Austin', 'Kensington Market']:
    body = k.get('/v2/insights', {'filter.type': 'urn:entity:brand', 'signal.location.query': hood, 'signal.interests.entities': anchors, 'take': '10'}, f'preset {hood}')
    ents = k.entities(body)
    loc = ((body.get('query') or {}).get('localities') or {}).get('signal') or {}
    print(f'{hood:24} {len(ents):2} results  -> {loc.get("disambiguation", "?")[:80]}')
print('calls', k.calls)
