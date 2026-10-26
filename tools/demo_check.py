"""Runs three presets and one typed request against the app and says PASS or FAIL for each.

    python tools/demo_check.py                         the local `wrangler dev` on port 8787
    python tools/demo_check.py https://<host> 3        three rounds against a deployed Worker

A run passes when it has no error, all four sections, an audit with at least 3 verdicts, a paragraph that has no
banned term, and (when live) at least 8 Qloo calls. The typed request changes its room each round, so it cannot come
from the run cache: round 1 must have at least one live run or the check fails. A preset may answer from the cache;
the mode is printed.
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:8787'
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 1
HEADERS = {'Content-Type': 'application/json', 'User-Agent': 'listing-lens-demo-check/1.0'}
# A short copy of the scan's list, so the check does not trust the code it checks.
BANNED = ['family', 'families', 'kids', 'children', 'singles', 'couple', 'young', 'retiree', 'seniors', 'adults only',
          'students', 'christian', 'church', 'exclusive', 'safe neighborhood', 'perfect for', 'ideal for', 'man cave']
ROOMS = [['IKEA', 'West Elm', 'Pottery Barn', 'CB2'], ['Crate & Barrel', 'IKEA', 'Article', 'West Elm'],
         ['Restoration Hardware', 'CB2', 'IKEA', 'Room & Board'], ['Wayfair', 'West Elm', 'Herman Miller', 'IKEA']]


def stage(body: dict) -> list:
    req = urllib.request.Request(BASE + '/api/stage', data=json.dumps(body).encode(), headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            text = r.read().decode()
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        if not text.lstrip().startswith('{'):
            return [{'t': 'error', 'text': f'HTTP {e.code}: {text[:80]}'}]
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def judge(events: list) -> list[str]:
    faults = []
    mode = events[0].get('mode') if events else None
    if any(e['t'] == 'error' for e in events):
        faults.append('error: ' + next(e['text'] for e in events if e['t'] == 'error'))
    sections = {e['key'] for e in events if e['t'] == 'section' and e.get('items')}
    if len(sections) < 4:
        faults.append(f'sections {sorted(sections)}')
    rows = next((e['rows'] for e in events if e['t'] == 'audit'), [])
    if sum(1 for r in rows if r.get('verdict') in ('keep', 'swap', 'cut')) < 3:
        faults.append(f'{len(rows)} audit rows')
    brief = next((e for e in events if e['t'] == 'brief'), {})
    text = (brief.get('intro', '') + ' ' + brief.get('paragraph', '')).lower()
    if not brief.get('paragraph'):
        faults.append('no paragraph')
    hits = [w for w in BANNED if f' {w} ' in f' {text} '.replace('.', ' ').replace(',', ' ')]
    if hits:
        faults.append(f'banned words {hits}')
    calls = [e for e in events if e['t'] == 'call']
    if mode in ('live', 'template') and len(calls) < 8:
        faults.append(f'{len(calls)} Qloo calls')
    if not events or events[-1].get('t') != 'done':
        faults.append('no done event')
    return faults


def main() -> None:
    presets = json.load(urllib.request.urlopen(urllib.request.Request(BASE + '/api/presets', headers=HEADERS)))['presets'][:3]
    failed = 0
    for rnd in range(1, ROUNDS + 1):
        typed = {'city': 'Chicago', 'neighbourhood': 'Wicker Park', 'lens': {'label': 'Typed', 'anchors': ['Herman Miller', 'Kinfolk', 'Khruangbin']},
                 'room': ROOMS[(rnd - 1 + int(time.time() // 86400)) % len(ROOMS)][:3 + rnd % 2], 'features': ['natural light', 'front porch']}
        bodies = [{k: p[k] for k in ('city', 'neighbourhood', 'lens', 'room', 'features')} | {'preset': p['id']} for p in presets] + [typed]
        live = 0
        for i, body in enumerate(bodies, 1):
            t0 = time.time()
            events = stage(body)
            faults = judge(events)
            mode = events[0].get('mode') if events else '?'
            live += mode == 'live'
            failed += bool(faults)
            usage = next((e for e in events if e['t'] == 'usage'), {})
            print(f"round {rnd} run {i}: {'FAIL ' + '; '.join(faults) if faults else 'PASS'} | mode {mode} | "
                  f"{usage.get('qloo_upstream', 0)} upstream + {usage.get('qloo_cached', 0)} cached Qloo | "
                  f"{usage.get('neurons', 0)} neurons | {time.time() - t0:.1f}s")
        if rnd == 1 and not live:
            print('round 1: FAIL no live run')
            failed += 1
    print('ALL PASS' if not failed else f'{failed} FAILED')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
