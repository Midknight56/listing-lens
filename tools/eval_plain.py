"""The measured claim: for 20 places, the same writer with no taste data picks brands and places, and Qloo scores them.

    python tools/eval_plain.py <base url> --token-file <file with WARM_TOKEN=...> [--limit 20]

For each place it runs one brief (Design forward lens, a fixed room), then the Qloo off tab for that brief. It writes
every answer to out/eval/ (local only: Qloo response data never goes in the repo) and prints only totals:
  brands: mean Qloo affinity of the writer's own picks against Qloo's top four for the same buyer and place,
          and how many of the writer's picks Qloo could not score;
  places: how many of the writer's places are in Qloo's local list for that buyer.
The token is never printed. Each place costs one fresh run and one plain call inside the daily caps.
"""
import argparse
import json
import pathlib
import statistics
import sys
import urllib.request

PLACES = [
    ("Chicago", "Wicker Park"), ("Chicago", "Hyde Park"), ("Chicago", "Logan Square"), ("Toronto", "Kensington Market"),
    ("Toronto", "Leslieville"), ("Los Angeles", "Silver Lake"), ("Los Angeles", "Echo Park"), ("Brooklyn", "Williamsburg"),
    ("Brooklyn", "Park Slope"), ("Austin", "East Austin"), ("Portland", "Alberta Arts District"), ("Seattle", "Capitol Hill"),
    ("Denver", "RiNo"), ("Montreal", "Mile End"), ("Vancouver", "Mount Pleasant"), ("Halifax", "North End"),
    ("Philadelphia", "Fishtown"), ("San Francisco", "Mission District"), ("Nashville", "Germantown"),
    ("New Orleans", "Bywater"),
]
LENS = {"label": "Design forward", "anchors": ["Herman Miller", "Kinfolk", "Khruangbin"]}
ROOM = ["IKEA", "West Elm", "Pottery Barn", "CB2"]
OUT = pathlib.Path(__file__).resolve().parent.parent / "out" / "eval"


def read_token(path):
    rows = pathlib.Path(path).read_text(encoding="utf-8-sig").splitlines()
    line = next((row for row in rows if row.startswith("WARM_TOKEN=")), rows[0])
    return line.split("=", 1)[-1].strip()


def post(base, token, path, body):
    request = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Warm-Token": token},
    )
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            text = response.read().decode()
    except urllib.error.HTTPError as error:
        text = error.read().decode()
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    base, token = args.base.rstrip("/"), read_token(args.token_file)
    OUT.mkdir(parents=True, exist_ok=True)
    qloo_top, plain_scored, plain_unscored, plain_places, places_found, done = [], [], 0, 0, 0, 0
    for city, area in PLACES[: args.limit]:
        body = {"city": city, "neighbourhood": area, "lens": LENS, "room": ROOM, "features": ["natural light"]}
        stage = post(base, token, "/api/stage", body)
        run = next((e for e in stage if e["t"] == "run"), {})
        error = next((e["text"] for e in stage if e["t"] == "error"), None)
        if error or not run.get("id"):
            print(f"skip {area}, {city}: {error or 'no run id'}")
            continue
        plain = post(base, token, "/api/plain", {"id": run["id"]})
        picks = next((e for e in plain if e["t"] == "plain"), None)
        if not picks:
            print(f"skip {area}, {city}: plain gave {next((e.get('text') for e in plain if e['t'] == 'error'), 'nothing')}")
            continue
        (OUT / f"{area}-{city}.json".replace(" ", "_")).write_text(json.dumps({"stage": stage, "plain": plain}), encoding="utf-8")
        brands = next((e["items"] for e in stage if e["t"] == "section" and e["key"] == "brands"), [])
        qloo_top += [item["affinity"] for item in brands[:4] if isinstance(item.get("affinity"), (int, float))]
        for brand in picks["brands"]:
            if isinstance(brand.get("qloo_affinity"), (int, float)):
                plain_scored.append(brand["qloo_affinity"])
            else:
                plain_unscored += 1
        plain_places += len(picks["places"])
        places_found += sum(1 for place in picks["places"] if place.get("found"))
        done += 1
        print(f"ok   {area}, {city}")
    if not done:
        print("NO PLACES MEASURED")
        return 1
    brand_count = len(plain_scored) + plain_unscored
    print(f"\nplaces measured: {done}")
    print(f"Qloo's top four brands, mean affinity: {statistics.mean(qloo_top):.3f} ({len(qloo_top)} picks)")
    if plain_scored:
        print(f"writer's own brands that Qloo scored, mean affinity: {statistics.mean(plain_scored):.3f} ({len(plain_scored)} picks)")
    print(f"writer's brands Qloo could not score: {plain_unscored} of {brand_count}")
    print(f"writer's places in Qloo's local list: {places_found} of {plain_places}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
