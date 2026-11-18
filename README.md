# Who is jacked in: MxO server stats

A small fan page that shows how many people are playing on the Matrix Online community servers right now: Rejacked, MxO Revived, MxOEmu and openMXO. It isn't connected to any of them, and it says so before sending anyone to their sites.

👉 https://whoisjackedin.com

The code lives in the private repo `hesitancy9996/whoisjackedin`, and the site is the Vercel project `whoisjackedin`.

## What you'll see

- Who's online now, on each server and in total, plus the 24-hour and all-time peaks
- A chart of players over time. Point at it for numbers, drag across it to zoom. Outages show as a dotted line
- Day-by-day numbers, a weekly pattern, the busiest hours, uptime and past outages
- A short description of each server
- Dark and light themes, in green or blue

Two handy extras for the address: `?range=7d` opens a time range (`1h`, `24h`, `7d`, `30d`, `all`), and `?gaps` also lists short blips where a server's status page didn't answer clearly.

The page calls players "operatives", like the game did.

## Where the numbers come from

Every server has a public status page that its own site or launcher reads. This site reads the same ones once a minute:

| Server | Status page |
|---|---|
| Rejacked | `https://mxo-rejacked.com/api/launcher/v1` |
| MxO Revived | `https://mxorevived.com/api/server-status` |
| MxOEmu | `https://mxoemu.info/api/servers` |
| openMXO | `https://openmxo.com/forum/map/presence` (only the number of players is used, never who they are) |

Discord member counts come from each server's public invite link, once an hour.

A server only counts as down after 15 bad answers in a row, about 15 minutes. A status page can say "maintenance" for a few minutes while everyone is still playing, so short blips don't count.

## Run it on your computer

You need Node 26. Run `npm install` once, then:

```sh
npm start
```

and open http://127.0.0.1:5177. It reads the real servers once a minute and saves the readings under `data/kv`.

Want to see it with made-up history (and a few outages) instead?

```sh
npm run seed -- /tmp/mxo-demo
MXO_DATA_DIR=/tmp/mxo-demo MXO_NO_TIMER=1 npm start
```

You can also set `PORT`, and `HOST=0.0.0.0` to open it to your network.

The local server runs the same code as Vercel, so if it works here, it works there.

## Tests

```sh
npm test
```

Nothing to install. One group starts the local server, so run `npm run build` first or it is skipped.

## Put it online yourself

1. `vercel deploy --prod`
2. In the Vercel dashboard, add an Upstash Redis database to the project, then deploy again
3. Add a `CRON_SECRET` with a long random value
4. At a service like cron-job.org, call `https://<your-site>/api/collect` every minute with the header `Authorization: Bearer <CRON_SECRET>`

Without the database the page still works. It just has no history.

Commits must use an email that Vercel can match to your GitHub account, or Vercel blocks the deploy.

## Staying free

Checked 17 November 2026: the every-minute reading uses about 175,000 of Upstash's 500,000 commands a month, and about 43,000 of Vercel's 1,000,000 requests. The rest is for visitors. Answers are cached for a minute, so please do the sums again before making that shorter.

The "All" view goes back one year. Older data is kept, so extend the view before November 2027.

## Privacy

Each visit is saved as one short line: the time, the country, phone or desktop, where the visitor came from, and a fingerprint that changes every day. No addresses, no tracking cookies, and lines are deleted after 90 days. `npm run visitors` shows the totals (it needs `CRON_SECRET` in `.env.local`).

The browser itself remembers the theme, the color and the "Together" switch (three cookies), the chosen range, the last numbers, and "Remember my choice" in the link box.

## Where things are

- `lib/sources.js`: the servers, how to read each one, and their descriptions (written from each team's own posts in November 2026; update them by hand)
- `lib/core.js`: taking readings and working out the numbers
- `lib/store.js`: saving, in Redis online and in files on your computer
- `api/`: the site's addresses
- `src/`: the page. `src/app.js` loads the numbers, `src/page/` draws each part
- `scripts/`: the seeder and the visit counter
- `test/`: the tests
