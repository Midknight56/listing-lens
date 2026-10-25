"""Day 1 kill test, round 3: the written fallback, city level (Nashville against Chicago). Budget left: 5 of 40.

P3 at city level: the same 8 brands (4 from each city's round 1 list) scored under each city.
Info: the buyer's anchors plus each city, to see if the city still moves a taste-led list (the real product call).
"""
import json
import kill_test as k

k.calls = 35
k.MAX_CALLS = 40
load = lambda f: k.ids(k.entities(json.loads((k.OUT / f).read_text(encoding='utf-8'))['body']))
nash, chi = load('Nashville_brand.json'), load('Chicago_brand.json')
print(f'P1 city against city, brand top 10: {k.overlap(nash, chi):.0%}; artist {k.overlap(load("Nashville_artist.json"), load("Chicago_artist.json")):.0%}; book {k.overlap(load("Nashville_book.json"), load("Chicago_book.json")):.0%}')
pool = nash[:4] + [i for i in chi if i not in nash][:4]
scored = {}
for city in ['Nashville', 'Chicago']:
    ents = k.top({'filter.type': 'urn:entity:brand', 'signal.location.query': city, 'filter.results.entities': ','.join(pool), 'take': '8'}, f'r3 score {city}')
    scored[city] = {e.get('entity_id'): (e.get('query') or {}).get('affinity') for e in ents}
    print(f'  {city}: {len(ents)} of 8 scored: ' + ', '.join(f"{'N' if e.get('entity_id') in nash[:4] else 'C'} {(e.get('query') or {}).get('affinity') or 0:.3f}" for e in ents))
anchors = json.loads((k.OUT / 'combo_East_Nashville.json').read_text(encoding='utf-8'))['url'].split('signal.interests.entities=')[1].split('&')[0]
import urllib.parse
anchors = urllib.parse.unquote(anchors)
combo = {}
for city in ['Nashville', 'Chicago']:
    ents = k.top({'filter.type': 'urn:entity:brand', 'signal.location.query': city, 'signal.interests.entities': anchors, 'feature.explainability': 'true', 'take': '10'}, f'r3 combo {city}')
    combo[city] = k.ids(ents)
    print(f'  anchors + {city}: {len(ents)}: ' + ', '.join(f"{e.get('name')} {(e.get('query') or {}).get('affinity') or 0:.2f}" for e in ents[:6]))
print(f'Anchors + city, Nashville against Chicago: {k.overlap(combo["Nashville"], combo["Chicago"]):.0%}')
print(f'Qloo calls used in total: {k.calls}')
