# Staging Brief

Staging Brief writes a short brief for staging a home for sale. You give it the place, three things a likely buyer loves, the
furniture brands already in the room and what the home has. It asks Qloo's taste graph what people with those loves
also like near that home, then comes back with a room audit, a short shopping and mood list, and a listing paragraph.

Try it: https://listing-lens.midknight-labs.workers.dev

## What a run looks like

1. Pick an example, say East Nashville with the Design forward lens (Herman Miller, Kinfolk, Khruangbin), a room of
   IKEA, West Elm, Pottery Barn and CB2, and a home with natural light and a front porch.
2. The run log opens and lists every Qloo call as it happens.
3. Qloo has thin data for East Nashville, so the brief says so on screen and uses Nashville. A neighbourhood is always
   sent with its city ("Hyde Park, Chicago"), and an answer for the wrong place (Silver Lake, North Carolina) is caught
   and relaxed to the typed city in the same way.
4. The room audit scores each brand in the room against about 30 home brands for this buyer, in one Qloo call. Each
   row says keep, swap or cut, with "Beats 18 of 22 home brands" under the bar, and a swap names the best scoring home
   brand that is not in the room yet.
5. Four lists follow: brands, books, a playlist and places nearby, each with Qloo's own reason, such as "Because they
   love Khruangbin (35%)".
6. The listing paragraph opens with the home's own features and then names a few of the places, with a word or two
   from each place's note.
7. Flip the lens to Classic comfort and the page shows what changed.
8. "Qloo off" asks the same writer for picks with no taste data, then looks each one up in Qloo. You see which picks
   Qloo knows and how they score.

## How it uses Qloo

| Qloo call | What Staging Brief does with it |
| --- | --- |
| `GET /search` | Turns each love into an entity, and each room brand into a brand (`types=urn:entity:brand`). |
| `GET /v2/insights` | Walks the graph from the loves to brands, books, artists and places, with `signal.location.query` for the place and `filter.location.query` to keep places local. |
| `GET /v2/insights` with `filter.results.entities` | Scores the room's brands and the home brand list together for the room audit. |
| `feature.explainability` | Gives each pick its share per love, shown as the reason line. |

The same calls are an MCP server at `/mcp` (Streamable HTTP) with three tools: `resolve`, `place_taste` and
`audit_room`.

## Fair housing

A listing must not say who should live in a home. Staging Brief keeps people out of every step.

* The buyer lens is only things people love: brands, books, music. It never sends an age, a gender or a household to
  Qloo, and the code has no field for one.
* Every love is scanned before any call. "Perfect for families" is refused with a plain reason.
* Every written line is scanned again before it is shown. A line that describes people, a household or a faith, or
  makes a claim like "safe neighborhood", is replaced by a plain template line, and the run log names the word that was
  caught. Schools and places of worship are left out of the places list.
* The writer may only name places Qloo returned. Any other capitalised name sends the line back to the template.

## Limits

Each limit is set so the app costs nothing to run.

| Limit | Value | Why it is safe |
| --- | --- | --- |
| Qloo calls a day, all visitors | 500 | 500 x 27 days = 13,500, 27% of the key's 50,000 a month |
| Qloo calls a day, one visitor | 48 | 3 fresh runs x 16 calls a run |
| Fresh runs a day, one visitor | 3 | Examples replay a recorded run for free after that |
| Writing a day, this app | 450 neurons | Inside a 9,500 shared allowance, under Cloudflare's free 10,000 neurons a day |
| Monthly Qloo floor | 3,000 calls left | Below it, no live calls; examples replay |

A run that cannot go live (a limit, the floor, or Qloo not answering) replays the example's recorded brief and shows
the date it was recorded.

## Run it yourself

You need Node 24 and a Cloudflare account. Put your own Qloo key in `.dev.vars` as `QLOO_KEY`, with a
`SESSION_SECRET` and a `WARM_TOKEN` of your choice.

```bash
npm ci
```

```bash
npx wrangler d1 migrations apply listing-lens --local
```

```bash
npx wrangler dev
```

Tests:

```bash
npm run gate
```

```bash
node tools/e2e.mjs http://127.0.0.1:8787
```

```bash
node tools/phones.mjs http://127.0.0.1:8787
```

## Licence

MIT. See `LICENSE`.
