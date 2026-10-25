"""Day 1 kill test: does Qloo's location signal tell one neighbourhood's taste from another's?

Run once. At most 40 Qloo calls (a hard counter stops the run before call 41). Raw answers go to out/kill_test/
(ignored by git: Qloo's hackathon guide says its response data stays out of a public repo). Prints only numbers.

Pass rules, written before the first run (25 Oct 2026):
  P1  Two neighbourhoods of one city share under 70% of their top 10 (by entity id). Required for brand on every
      same-city pair, and for book and artist on at least one same-city pair each.
  P2  Each neighbourhood's top 10 differs from its city's top 10: overlap under 80% for at least 2 of the 3 types.
  P3  The same 8 brands scored with filter.results.entities under two blocks of one city come back in a different
      rank order, or with affinities that differ by 0.02 or more on at least 3 of the 8.
Fallback if it fails: rerun P2 and P3 at city level (Nashville against Chicago); still flat means Read the Room.

Usage: python tools/kill_test.py
"""
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://hackathon.api.qloo.com'
KEY_FILE = pathlib.Path(r'C:\Users\User\.cloudflare\qloo-hackathon-api-key.local.txt')
OUT = pathlib.Path(__file__).resolve().parent.parent / 'out' / 'kill_test'
MAX_CALLS = 40

CITIES = {
    'Nashville': ['East Nashville', '12 South', 'Germantown, Nashville'],
    'Chicago': ['Wicker Park', 'Hyde Park, Chicago'],
}
TYPES = ['brand', 'book', 'artist']
# Taste anchors for the combined check (location plus a buyer's three loves). Info only, not a pass rule.
ANCHORS = ['Herman Miller', 'Kinfolk', 'Khruangbin']

calls = 0
headers_seen = {}


def key() -> str:
    return KEY_FILE.read_text(encoding='utf-8-sig').splitlines()[0].strip()


def get(path: str, params: dict, label: str) -> dict:
    global calls
    if calls >= MAX_CALLS:
        sys.exit(f'STOP: the {MAX_CALLS} call budget is spent before {label}')
    url = BASE + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'X-Api-Key': key(), 'Accept': 'application/json'})
    for attempt in range(4):
        try:
            calls += 1
            with urllib.request.urlopen(req, timeout=20) as res:
                body = json.loads(res.read().decode('utf-8'))
                if not headers_seen:
                    headers_seen.update({k: v for k, v in res.headers.items()})
                status = res.status
            break
        except urllib.error.HTTPError as e:
            if not headers_seen:
                headers_seen.update({k: v for k, v in e.headers.items()})
            text = e.read().decode('utf-8', 'replace')[:300].replace(key(), '[redacted]')
            print(f'  {label}: HTTP {e.code} {text}')
            body, status = {'error': e.code, 'text': text}, e.code
            break
        except (urllib.error.URLError, OSError) as e:
            # This PC drops about 1 new connection in 10 (WinError 10048, MACHINE.md). Nothing was sent: retry.
            calls -= 1
            print(f'  {label}: connection failed ({e}), retry {attempt + 1}')
            time.sleep(1.5)
    else:
        sys.exit(f'STOP: no connection for {label}')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / (label.replace(' ', '_').replace(',', '') + '.json')).write_text(json.dumps({'status': status, 'url': path + '?' + urllib.parse.urlencode(params), 'body': body}, indent=1), encoding='utf-8')
    time.sleep(0.4)
    return body


def entities(body: dict) -> list:
    return ((body.get('results') or {}).get('entities') or []) if isinstance(body.get('results'), dict) else []


def top(path_params: dict, label: str) -> list:
    return entities(get('/v2/insights', path_params, label))


def ids(ents: list, n: int = 10) -> list:
    return [e.get('entity_id') for e in ents[:n]]


def overlap(a: list, b: list) -> float:
    if not a or not b:
        return float('nan')
    return len(set(a) & set(b)) / max(len(a), len(b))


def main() -> None:
    lists = {}  # (place, type) -> ids
    for city, blocks in CITIES.items():
        for place in [city] + blocks:
            for t in TYPES:
                ents = top({'filter.type': 'urn:entity:' + t, 'signal.location.query': place, 'take': '10'}, f'{place} {t}')
                lists[(place, t)] = ids(ents)
                print(f'{place:24} {t:7} {len(ents)} results')

    print('\nP1 same-city neighbourhood overlap of top 10')
    p1 = {t: [] for t in TYPES}
    for city, blocks in CITIES.items():
        for i in range(len(blocks)):
            for j in range(i + 1, len(blocks)):
                for t in TYPES:
                    o = overlap(lists[(blocks[i], t)], lists[(blocks[j], t)])
                    p1[t].append(o)
                    print(f'  {blocks[i]} / {blocks[j]} {t}: {o:.0%}')
    p1_pass = all(o < 0.7 for o in p1['brand']) and all(any(o < 0.7 for o in p1[t]) for t in ('book', 'artist'))

    print('\nP2 neighbourhood against its city, top 10 overlap')
    p2_pass = True
    for city, blocks in CITIES.items():
        for b in blocks:
            os_ = [overlap(lists[(b, t)], lists[(city, t)]) for t in TYPES]
            under = sum(1 for o in os_ if o < 0.8)
            print(f'  {b} vs {city}: ' + ', '.join(f'{t} {o:.0%}' for t, o in zip(TYPES, os_)))
            p2_pass &= under >= 2

    print('\nP3 the same 8 brands scored under two blocks')
    pool = []
    for p in ['Nashville', 'East Nashville', '12 South']:
        for i in lists[(p, 'brand')]:
            if i and i not in pool:
                pool.append(i)
    eight = pool[:8]
    scored = {}
    for b in ['East Nashville', '12 South']:
        ents = top({'filter.type': 'urn:entity:brand', 'signal.location.query': b, 'filter.results.entities': ','.join(eight), 'take': '8'}, f'score {b}')
        scored[b] = {e.get('entity_id'): (e.get('query') or {}).get('affinity') for e in ents}
        print(f'  {b}: {len(ents)} of 8 scored')
    a, c = scored['East Nashville'], scored['12 South']
    order_a = [i for i in a]
    order_c = [i for i in c]
    common = [i for i in eight if i in a and i in c and a[i] is not None and c[i] is not None]
    diffs = [abs(a[i] - c[i]) for i in common]
    big = sum(1 for d in diffs if d >= 0.02)
    same_order = [i for i in order_a if i in common] == [i for i in order_c if i in common]
    print(f'  common {len(common)}, rank order same: {same_order}, affinity gaps >= 0.02: {big}, largest gap {max(diffs) if diffs else 0:.3f}')
    p3_pass = len(common) >= 6 and ((not same_order) or big >= 3)

    print('\nInfo: location plus three taste anchors (East Nashville against 12 South, brand)')
    anchor_ids = []
    for name in ANCHORS:
        res = get('/search', {'query': name, 'take': '1'}, f'search {name}').get('results') or []
        if res:
            anchor_ids.append(res[0].get('entity_id'))
            print(f'  {name} -> {res[0].get("name")} ({(res[0].get("types") or [""])[0]})')
    combo = {}
    for b in ['East Nashville', '12 South']:
        ents = top({'filter.type': 'urn:entity:brand', 'signal.location.query': b, 'signal.interests.entities': ','.join(anchor_ids), 'feature.explainability': 'true', 'take': '10'}, f'combo {b}')
        combo[b] = ids(ents)
    print(f'  overlap with anchors: {overlap(combo["East Nashville"], combo["12 South"]):.0%}; East Nashville with vs without anchors: {overlap(combo["East Nashville"], lists[("East Nashville", "brand")]):.0%}')

    print('\nRate limit headers on the first answer:')
    for k, v in headers_seen.items():
        if any(w in k.lower() for w in ('rate', 'limit', 'quota', 'remaining', 'retry', 'usage')):
            print(f'  {k}: {v}')
    print('  all header names: ' + ', '.join(sorted(headers_seen)))

    verdict = 'PASS' if (p1_pass and p2_pass and p3_pass) else 'FAIL'
    print(f'\nP1 {p1_pass}  P2 {p2_pass}  P3 {p3_pass}  ->  {verdict}   Qloo calls used: {calls}')


if __name__ == '__main__':
    main()
