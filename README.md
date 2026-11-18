# MxO stats

A fan-made page that shows how many people are playing on the Matrix Online community servers (private servers run by fans): Rejacked, MxO Revived, MxOEmu and openMXO. The page is independent of all of them and says so: it does not vouch for their software.

Live at https://whoisjackedin.com

## What it shows

- Who is online right now, per server and in total, next to the 24-hour peak and the all-time peak
- A ranking by players and by uptime
- A chart of players over time, as lines or stacked. It shows averages, so the lines stay calm. Point at it to read the numbers next to the names, drag across it to zoom in for more detail
- The most players seen each day
- A table per server, by day or by month, with the peak, the average and how much each changed. Click a heading to sort
- A weekly pattern: which weekdays and hours are busy
- A 90-day strip that shows how much each server was online
- The busiest hours of the day
- Past outages
- A short description of each server

The page calls players "operatives", as the game did.

## Where the numbers come from

Each server has a small public status page that its own website or launcher reads. This page reads the same thing once a minute.

| Server | Address | What it tells us |
|---|---|---|
| Rejacked | `https://mxo-rejacked.com/api/launcher/v1` | online or not, player count, launcher version |
| MxO Revived | `https://mxorevived.com/api/server-status` | status, player count |
| MxOEmu | `https://mxoemu.info/api/servers` | status, player count, players by district |
| openMXO | `https://openmxo.com/forum/map/presence` | state of the server, and a list whose length is the player count (the list itself is never read or kept) |

The Discord member counts come from each Discord's public invite link, once an hour.

## How it decides a server is down

- One odd answer is not enough. The page shows the last known number and keeps checking.
- A server counts as down after 15 bad answers in a row, which is about 15 minutes. A status feed can say "maintenance" for a few minutes while everyone is still jacked in, so shorter spells are not outages.
- Until then the last real number is used. If the outage turns out to be real, those borrowed readings are taken back out of the day's totals.
- An "asked too often" reply is ignored.
- If the page cannot refresh, it keeps showing the last data and says from when it is.

## How it runs

The site is on Vercel's free plan.

- The page is `src/index.html` and `src/app.js`. The charts are drawn with Apache ECharts. `npm run build` packs both into `public/`, small and with no source maps.
- Days are counted in the visitor's own time zone, to the nearest hour.
- The page arrives with the current numbers already in it: `api/page` fills them into the built page and the result is cached for a minute. Search engines and link previews get them too. The browser then keeps them fresh, once a minute.
- `api/stats` gives the page its numbers.
- `api/collect` takes one reading of all the servers.
- Readings are saved in an Upstash Redis database on its free plan.
- A free cron service calls `api/collect` every minute. Vercel's free plan can only do that once a day by itself.

## Set it up yourself

1. Deploy it: `vercel deploy --prod`
2. Add storage: in the Vercel dashboard, add an Upstash Redis database to the project, then deploy again.
3. Set a secret: add `CRON_SECRET` to the project, with a long random text as its value.
4. Add the cron job: at a service such as cron-job.org, call `https://<your-site>/api/collect` every minute with the header `Authorization: Bearer <CRON_SECRET>`.

Without storage the page still works. It shows live numbers and no history.

## Run it on your own computer

```sh
npm start
```

Run `npm install` once before the first start. Then open http://127.0.0.1:5177. It needs Node 26. Readings are saved in files under `data/kv`.

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `5177` | Port of the page |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to open it to your network |
| `MXO_DATA_DIR` | `./data/kv` | Where the readings are saved |

## Staying on the free plans

Checked on 17 November 2026.

- Upstash's free plan holds 250 MB and allows 500,000 commands a month. The history that is kept for good grows by about half a megabyte a year, so storage is not the limit. Taking a reading every minute uses about 175,000 commands a month.
- Vercel's Hobby plan allows 1,000,000 requests and 1,000,000 function runs a month. The every-minute reading uses about 43,000 of each.
- The rest is visitors. The numbers only change once a minute, so the page asks for them once a minute and the answers are cached for a minute. Do not make either shorter without doing the sums again.
- The "All" view reaches back one year. Older hourly totals are still stored. Extend the view before November 2027.

## Visits

The page tells the site once when it opens. The site saves one short line for that visit: the time, the country, phone or desktop, the site the visitor came from, and a short fingerprint that changes every day. No tracking cookies are set and no addresses are kept. The only cookie is `theme`, which remembers a visitor's choice of dark or light. Lines are kept for 90 days.

Once an hour the last 30 days are added up, and the foot of the page shows the totals: visits, how many countries they came from, and the share made on phones.

```sh
npm run visitors
```

prints the numbers. It needs `CRON_SECRET` in `.env.local`.

## What is saved

- Every reading, kept for 9 days. This feeds the 1 hour, 24 hour and 7 day views. After that only the hourly totals remain.
- Hourly totals, kept for good. They are tiny, about half a megabyte a year. This feeds the 30 day and "All" views, the day-by-day numbers, the weekly pattern, the busiest hours and the uptime strip.
- The latest answers, the records and the outage list.

## Files

- `lib/sources.js`: the servers, how to read each one, and their descriptions
- `lib/store.js`: saving and loading, in Redis on Vercel and in files on your computer
- `lib/core.js`: taking readings and working out the numbers
- `lib/visits.js`: counting visits
- `lib/page.js`: puts the current numbers into the page before it is sent
- `api/`: the addresses the site answers on
- `scripts/visitors.mjs`: prints the visit numbers
- `src/`: the page and its script
- `build.mjs`: packs the page into `public/`
- `tools/models/`: turns characters and animations from a game install into those files. Run `sh tools/models/make.sh "<game folder>"`
- `server.js`: runs the site on your own computer

## Server descriptions

The texts in "The servers" section are in `lib/sources.js`. They were written from each team's own posts in November 2026. Change them by hand when something changes.
