# Who is jacked in: MxO Server Stats

Live player counts for The Matrix Online community servers.

## Features

- Players online now, per server and in total, with 24-hour and all-time peaks
- Player history chart with zoom, outages dotted
- Daily numbers, weekly pattern, busiest hours, uptime and outages
- Server descriptions
- Dark and light themes, green or blue
- Installable as a PWA, works offline
- `?range=` (`1h`, `24h`, `7d`, `30d`, `all`) opens a time range, `?gaps` lists short status-page blips

## Data

Each server's public status page is read once a minute:

| Server | Status page |
|---|---|
| Rejacked | `https://mxo-rejacked.com/api/launcher/v1` |
| MxO Revived | `https://mxorevived.com/api/server-status` |
| MxOEmu | `https://mxoemu.info/api/servers` |
| openMXO | `https://openmxo.com/forum/map/presence` (player count only) |

Discord member counts come from each server's invite link, once an hour. A server counts as down after 15 minutes without a live answer.

## Development

Node 26.

```sh
npm install
npm start        # http://127.0.0.1:5177, readings saved under data/kv
npm test         # run npm run build first for the server tests
npm run lint
```

With made-up history:

```sh
npm run seed -- /tmp/mxo-demo
MXO_DATA_DIR=/tmp/mxo-demo MXO_NO_TIMER=1 npm start
```

`PORT` and `HOST` are supported. `npm run visitors` reads `CRON_SECRET` and `MXO_SITE` (the live address) from `.env.local`.

## Deployment

1. Deploy the folder with a Redis REST database (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) and random `CRON_SECRET` and `VISIT_SECRET` values
2. Call `https://<your-site>/api/collect` every minute with `Authorization: Bearer <CRON_SECRET>`

The page's own address comes from the host's production domain, or from `MXO_SITE` if set.

Without the database there is no history.

## Privacy

A visit is stored as the time, country, device type, referrer and a daily-changing fingerprint, deleted after 90 days. No IP addresses, no tracking cookies. Daily totals are kept, and `npm run visitors -- 365` shows them.

The browser keeps the theme, color, "Together" switch, favourite server, range, last numbers and dismissed boxes in its local storage. None of it is sent to the site.

## License

The code is MIT licensed, see [LICENSE](LICENSE). Charts by Apache ECharts (Apache 2.0). The build collects every bundled package's license into `/assets/licenses.txt`.

The Matrix Online is a trademark of Warner Bros. Entertainment Inc. This fan project is not affiliated with or endorsed by Warner Bros. or any of the server teams.
