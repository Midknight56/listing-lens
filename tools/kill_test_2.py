"""Day 1 kill test, round 2 (the same 40 call budget: round 1 used 28, so this round may use 12).

Round 1 finding: named neighbourhoods resolve (East Nashville, Wicker Park) but return 0 entities for some types, and
'12 South' resolved to Sector 12, Delhi. Round 2 sends the block as a WKT point (signal.location, docs: 'WKT POINT,
POLYGON or a single Qloo ID', valid for all ten types; no radius, so Qloo's own density discovery picks the size).
Same pass rules as round 1 (P1 under 70% top 10 overlap between blocks, P2 under 80% against the city, P3 the same 8
brands rank or score differently), on brand and artist. City level fallback (Nashville against Chicago) at the end.
"""
import sys
import kill_test as k

k.calls = 28
k.MAX_CALLS = 40
POINTS = {  # lon lat. East Nashville is Qloo's own centre for that locality (round 1 answer).
    'East Nashville': 'POINT(-86.7597205 36.1725564)',
    '12South': 'POINT(-86.7894 36.1247)',
    'Germantown': 'POINT(-86.7880 36.1800)',
}
lists = {}
for name, wkt in POINTS.items():
    ents = k.top({'filter.type': 'urn:entity:brand', 'signal.location': wkt, 'take': '10'}, f'r2 {name} brand')
    lists[(name, 'brand')] = k.ids(ents)
    print(f'{name:16} brand {len(ents)}: ' + ', '.join(f"{e.get('name')} {(e.get('query') or {}).get('affinity', 0):.2f}" for e in ents[:4]))
for name in ['East Nashville', '12South']:
    ents = k.top({'filter.type': 'urn:entity:artist', 'signal.location': POINTS[name], 'take': '10'}, f'r2 {name} artist')
    lists[(name, 'artist')] = k.ids(ents)
    print(f'{name:16} artist {len(ents)}')

import json, pathlib
city = json.loads((k.OUT / 'Nashville_brand.json').read_text(encoding='utf-8'))['body']
city_ids = k.ids(k.entities(city))
city_art = k.ids(k.entities(json.loads((k.OUT / 'Nashville_artist.json').read_text(encoding='utf-8'))['body']))
print('\nP1 block against block (brand):')
names = list(POINTS)
for i in range(3):
    for j in range(i + 1, 3):
        print(f'  {names[i]} / {names[j]}: {k.overlap(lists[(names[i], "brand")], lists[(names[j], "brand")]):.0%}')
print(f'  artist East Nashville / 12South: {k.overlap(lists[("East Nashville", "artist")], lists[("12South", "artist")]):.0%}')
print('P2 block against Nashville city:')
for n in names:
    print(f'  {n} brand: {k.overlap(lists[(n, "brand")], city_ids):.0%}')
for n in ['East Nashville', '12South']:
    print(f'  {n} artist: {k.overlap(lists[(n, "artist")], city_art):.0%}')

pool = []
for key in [('East Nashville', 'brand'), ('12South', 'brand'), ('Germantown', 'brand')]:
    for i in lists[key]:
        if i and i not in pool:
            pool.append(i)
pool = pool[:4] + [i for i in city_ids if i not in pool][:4]
print('\nP3 the same 8 brands scored under two points:')
scored = {}
for n in ['East Nashville', '12South']:
    ents = k.top({'filter.type': 'urn:entity:brand', 'signal.location': POINTS[n], 'filter.results.entities': ','.join(pool), 'take': '8'}, f'r2 score {n}')
    scored[n] = {e.get('entity_id'): (e.get('query') or {}).get('affinity') for e in ents}
    print(f'  {n}: {len(ents)} of 8 scored: ' + ', '.join(f'{(v or 0):.3f}' for v in scored[n].values()))
a, c = scored['East Nashville'], scored['12South']
common = [i for i in pool if a.get(i) is not None and c.get(i) is not None]
gaps = [abs(a[i] - c[i]) for i in common]
same = [i for i in a if i in common] == [i for i in c if i in common]
print(f'  common {len(common)}, same order {same}, gaps >= 0.02: {sum(g >= 0.02 for g in gaps)}, largest {max(gaps) if gaps else 0:.3f}')
print(f'\nQloo calls used in total: {k.calls}')
