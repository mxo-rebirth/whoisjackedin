// Prints the site's visit numbers. Run "npm run visitors", or "npm run visitors -- 365" for a year.
// It reads CRON_SECRET from .env.local and never prints it.
import { readFile } from 'node:fs/promises';

const site = process.env.MXO_SITE ?? 'https://whoisjackedin.com';
const days = Number.parseInt(process.argv[2], 10) || 30;
const env = await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => '');
const secret = process.env.CRON_SECRET ?? /^CRON_SECRET="?([^"\n]+)"?$/m.exec(env)?.[1];
if (!secret) {
  console.error('CRON_SECRET is not set. Put it in .env.local.');
  process.exit(1);
}
const res = await fetch(`${site}/api/visitors?days=${days}`, { headers: { authorization: `Bearer ${secret}` } });
if (!res.ok) {
  console.error(`The site answered ${res.status}.`);
  process.exit(1);
}
const data = await res.json();
const list = (pairs) => pairs.map(([name, n]) => `${name} ${n}`).join(', ') || 'none yet';
console.log(`Last ${data.days} days: ${data.visits} visits by ${data.visitors} visitors (counted per day)\n`);
console.log('Day         Visits  Visitors');
for (const day of data.perDay.filter((d) => d.visits)) console.log(`${day.day}  ${String(day.visits).padStart(6)}  ${String(day.visitors).padStart(8)}`);
console.log(`\nCountries: ${list(data.countries)}`);
console.log(`Came from: ${list(data.referrers)}`);
console.log(`Devices:   ${list(data.devices)}`);
