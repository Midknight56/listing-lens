"""API shape probe for the spec (25 Oct 2026). At most 6 Qloo calls. Raw answers to out/probe/ (ignored by git).
1. Does POST /v2/insights take filter.results.entities.query as an array of names (one call scores the whole room)?
2. How wide is the affinity spread when the room is scored against 3 taste anchors plus a city?
3. Places, books and artists from anchors plus a city.
"""
import json, pathlib, time, urllib.request, urllib.error, urllib.parse
import kill_test as k
OUT = k.OUT.parent / 'probe'
OUT.mkdir(parents=True, exist_ok=True)
calls = 0
def post(body, label):
    global calls
    assert calls < 6
    calls += 1
    req = urllib.request.Request(k.BASE + '/v2/insights', data=json.dumps(body).encode(), method='POST',
        headers={'X-Api-Key': k.key(), 'Accept': 'application/json', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=25) as r: status, out = r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        status, out = e.code, {'text': e.read().decode('utf-8', 'replace')[:400].replace(k.key(), '[redacted]')}
    (OUT / f'{label}.json').write_text(json.dumps({'status': status, 'req': body, 'body': out}, indent=1), encoding='utf-8')
    time.sleep(0.4)
    return status, out
anchors = urllib.parse.unquote(json.loads((k.OUT / 'combo_East_Nashville.json').read_text(encoding='utf-8'))['url'].split('signal.interests.entities=')[1].split('&')[0]).split(',')
room = ['IKEA', 'Pottery Barn', 'West Elm', 'Restoration Hardware', 'CB2', 'Wayfair', 'Jonathan Adler', 'Room & Board']
def show(label, status, out):
    ents = ((out.get('results') or {}).get('entities') or []) if isinstance(out.get('results'), dict) else []
    print(f'{label}: HTTP {status}, {len(ents)} results')
    for e in ents[:8]:
        q = e.get('query') or {}
        print(f"   {e.get('name')[:34]:34} aff {q.get('affinity', 0):.3f} pop {e.get('popularity') or 0:.3f} expl {'y' if q.get('explainability') else 'n'}")
    if status != 200: print('   ', out)
for city in ['Nashville', 'Chicago']:
    s, o = post({'filter.type': 'urn:entity:brand', 'signal.location.query': city, 'signal.interests.entities': anchors,
                 'filter.results.entities.query': room, 'feature.explainability': True, 'take': 8}, f'room_{city}')
    show(f'room scored, anchors + {city}', s, o)
    if s != 200: break
for t, extra in [('place', {'filter.location.query': 'Nashville', 'filter.popularity.max': 0.95}), ('book', {'signal.location.query': 'Nashville'}), ('artist', {'signal.location.query': 'Nashville'})]:
    s, o = post({'filter.type': 'urn:entity:' + t, 'signal.interests.entities': anchors, 'feature.explainability': True, 'take': 6, **extra}, f'{t}_Nashville')
    show(f'{t}, anchors + Nashville', s, o)
print('calls', calls)
