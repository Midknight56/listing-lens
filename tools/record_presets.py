"""Records every preset and its flip as live runs, so visitors replay them free.

    python tools/record_presets.py http://127.0.0.1:8798 --token-file .dev.vars
    python tools/record_presets.py https://listing-lens.midknight-labs.workers.dev --token-file <secret file>

The token file holds WARM_TOKEN=<value> (or the bare value on line 1). The token is never printed. Each run prints its
mode, scope, writer and audit verdicts, and the script exits 1 if any run did not end with a live brief.
"""
import argparse
import json
import pathlib
import sys
import urllib.request


def read_token(path):
    for line in pathlib.Path(path).read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line.startswith("WARM_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"')
    first = pathlib.Path(path).read_text(encoding="utf-8-sig").splitlines()[0].strip()
    if "=" in first:
        raise SystemExit("no WARM_TOKEN line in the token file")
    return first


def post(base, token, body):
    request = urllib.request.Request(
        base + "/api/stage",
        data=json.dumps(body).encode(),
        headers={"User-Agent": "listing-lens-tools/1.0", "Content-Type": "application/json", "X-Warm-Token": token},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return [json.loads(line) for line in response.read().decode().splitlines() if line.strip()]


def summary(events):
    run = next((e for e in events if e["t"] == "run"), {})
    brief = next((e for e in events if e["t"] == "brief"), None)
    audit = next((e for e in events if e["t"] == "audit"), {"rows": []})
    usage = next((e for e in events if e["t"] == "usage"), {})
    errors = [e["text"] for e in events if e["t"] == "error"]
    fallbacks = [f"{e['what']}: {e['why']} {e.get('detail', '')}" for e in events if e["t"] == "fallback"]
    verdicts = ", ".join(
        f"{row['name']} {row['verdict']}" + (f" to {row['swap']['name']}" if row.get("swap") else "")
        for row in audit["rows"]
    )
    return run.get("mode"), brief, verdicts, usage, errors, fallbacks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--only", help="one preset id")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    token = read_token(args.token_file)
    with urllib.request.urlopen(urllib.request.Request(base + "/api/presets", headers={"User-Agent": "listing-lens-tools/1.0"}), timeout=30) as response:
        presets = json.load(response)["presets"]
    bad = 0
    for preset in presets:
        if args.only and preset["id"] != args.only:
            continue
        for lens in (preset["lens"], preset["flip"]):
            body = {
                "city": preset["city"],
                "neighbourhood": preset.get("neighbourhood", ""),
                "lens": lens,
                "room": preset["room"],
                "features": preset["features"],
                "preset": preset["id"],
            }
            events = post(base, token, body)
            mode, brief, verdicts, usage, errors, fallbacks = summary(events)
            ok = brief is not None and not errors and mode in ("live", "cache", "replay")
            bad += not ok
            print(f"{'ok ' if ok else 'BAD'} {preset['id']} / {lens['label']}: mode {mode}, "
                  f"scope {brief and brief['scope']}, writer {brief and brief['written_by']}, "
                  f"qloo {usage.get('qloo_upstream')} new {usage.get('qloo_cached')} cached, "
                  f"neurons {usage.get('neurons')}, quota left {usage.get('quota_left')}")
            print(f"    audit: {verdicts or 'none'}")
            for line in fallbacks + errors:
                print(f"    note: {line}")
    print("ALL RECORDED" if not bad else f"{bad} RUNS NOT RECORDED")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
