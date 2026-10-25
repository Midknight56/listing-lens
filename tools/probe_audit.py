"""Audit probe (25 Oct 2026), at most 7 Qloo calls: typed brand search for 4 room items, then score them by id
against the design anchors plus Nashville, and the same with no location. Raw answers to out/probe/."""
import json, urllib.parse
import kill_test as k
k.OUT = k.OUT.parent / 'probe'
k.calls, k.MAX_CALLS = 0, 7
anchors = urllib.parse.unquote(json.loads((k.OUT.parent / 'kill_test' / 'combo_East_Nashville.json').read_text(encoding='utf-8'))['url'].split('signal.interests.entities=')[1].split('&')[0])
ids = {}
for name in ['IKEA', 'Pottery Barn', 'West Elm', 'CB2']:
    r = k.get('/search', {'query': name, 'types': 'urn:entity:brand', 'take': '1'}, f'search brand {name}').get('results') or []
    if r: ids[r[0]['entity_id']] = r[0]['name']; print(f'{name} -> {r[0]["name"]} pop {r[0].get("popularity", 0):.3f}')
for label, extra in [('Nashville', {'signal.location.query': 'Nashville'}), ('no location', {})]:
    ents = k.top({'filter.type': 'urn:entity:brand', 'signal.interests.entities': anchors, 'filter.results.entities': ','.join(ids), 'feature.explainability': 'true', 'take': '8', **extra}, f'audit {label}')
    print(f'audit, anchors + {label}: ' + ', '.join(f"{e['name']} {(e.get('query') or {}).get('affinity', 0):.3f}" for e in ents))
print('calls', k.calls)
