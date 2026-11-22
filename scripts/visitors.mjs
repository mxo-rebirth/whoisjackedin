// Prints the site's visit numbers. Run "npm run visitors", or "npm run visitors -- 365" for a year.
// It reads READ_SECRET from .env.local and never prints it.
import { localEnv, siteUrl } from '../lib/site.js';

const days = Number.parseInt(process.argv[2], 10) || 30;
const env = await localEnv();
const secret = env.READ_SECRET;
if (!secret || !env.MXO_SITE) {
  console.error('Put READ_SECRET and MXO_SITE (the live address) in .env.local.');
  process.exit(1);
}
const site = siteUrl(env);
const res = await fetch(`${site}/api/visitors?days=${days}`, { headers: { authorization: `Bearer ${secret}` } });
if (!res.ok) {
  // The site gives the same 401 for a wrong key and a missing one, so both causes are named.
  const hint = res.status === 401 ? ' READ_SECRET may be missing on the host, or differ from the one in .env.local.' : '';
  console.error(`The site answered ${res.status}.${hint}`);
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
console.log(`Browsers:  ${list(data.browsers ?? [])}`);
console.log(`Systems:   ${list(data.systems ?? [])}`);
