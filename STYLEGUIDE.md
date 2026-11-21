# Style Guide

How code is written in this repo. Plain JavaScript modules on Node 26. No framework, no TypeScript.

## Core Principles

Good code is built from small parts that explain themselves. Code that says what it wants, instead of spelling out every step, is easier to read and to change. The lint config checks most of the rules below.

- **[Say what, not how](https://github.com/getify/Functional-Light-JS/blob/40a68612275b23904c7b37abdb724b250bdf75e7/manuscript/ch1.md#readability)**: the code describes the result it wants, not each step to get there
- **[Don't change data in place](https://github.com/getify/Functional-Light-JS/blob/40a68612275b23904c7b37abdb724b250bdf75e7/manuscript/ch6.md#summary)**: make a new value instead of editing the old one
- **[Build big from small](https://github.com/ryanmcdermott/clean-code-javascript?tab=readme-ov-file#functions-should-do-one-thing)**: a larger function is made of smaller ones
- **[Names explain the code](https://blog.thepete.net/blog/2021/06/24/explaining-variable/)**: a reader can tell what something does from its name
- **[One job each](https://github.com/ryanmcdermott/clean-code-javascript?tab=readme-ov-file#solid)**: a function or module does one thing
- **One home for each thing**: every rule, constant or piece of state lives in one module. Other code imports it.
- **Measure first**: before adding a cache or a stored shortcut, check how big and slow the answer really is with years of made-up data

## Layout

| Folder | What is in it |
| --- | --- |
| `api/` | One function per endpoint. Each reads the request, calls `lib/` and answers. Nothing more. |
| `lib/` | Shared server code, one job per file |
| `lib/helpers/` | Helpers for the server's low-level work |
| `src/` | The browser side: `app.js` starts the page, `theme.js` sets colors before the page draws, `sw.js` is the offline worker, plus `index.html` |
| `src/page/` | The parts of the page, one file each |
| `src/helpers/` | Helpers for the page's own hard logic |
| `test/` | Tests, named `*.test.mjs`, and `support.mjs` with their shared setup and made-up answers |
| `scripts/` | Tools for the owner: `seed` and `visitors` |

Server files:

| File | Its job |
| --- | --- |
| `lib/keys.js` | Every name the data is saved under |
| `lib/archive.js` | Copying finished days to the archive bucket, and reading them back |
| `lib/time.js` | Time constants (`HOUR_MS`, `DAY_MS`, `DAY_S`) and `dayOf`, `daysBetween` |
| `lib/sources.js` | The list of servers and reading each status page |
| `lib/sampler.js` | The saved state, adding each reading to it, the minute log and the lock |
| `lib/stats.js` | The time ranges (`RANGES`) and building an answer from saved data |
| `lib/store.js` | The Redis database online and plain files locally, behind the same functions |
| `lib/status.js` | Deciding whether a server is up, down or unknown |
| `lib/site.js` | The site's own address (`siteUrl()`). The domain is written nowhere else. |
| `lib/auth.js` | `isOwner()` and `failed()` |
| `lib/request.js` | The checks every function makes first: `methodAllowed()` and `ownerAllowed()` |
| `lib/html.js` | `escapeHtml` |
| `lib/rewrite.js` | Applying the address and header rules from `vercel.json` on the local server |
| `lib/helpers/pattern.js` | Reading a rule's source into a regular expression |
| `lib/helpers/icons.js` | Drawing the app icons as PNG files |
| `lib/helpers/bucket.js` | Listing, reading and writing the archive bucket |
| `lib/helpers/s3-sign.js` | Signing requests to the bucket |
| `lib/helpers/in-order.js` | `inOrder()`, for steps that must not overlap |
| `lib/visits.js` | Visit lines and daily visit totals |

Page files:

| File | Its job |
| --- | --- |
| `src/page/dom.js` | Making elements: `$`, `el`, `html`, `link` and table helpers |
| `src/page/prefs.js` | `pref` and `setPref`, the only code that touches local storage |
| `src/page/state.js` | The current numbers, range and favourite, the order servers are listed in, and keeping open tabs in sync |
| `src/page/format.js` | Formatting numbers and dates |
| `src/page/look.js` | Each server's color and key, chart and table helpers, the uptime levels (`uptimeLevel`) |

## Naming

- `camelCase` for functions and variables, `UPPER_CASE` for fixed values. At least two letters, except `i`, `j` and `id`.
- A yes-or-no value reads like one: `isRange`, `counted`, `installed`
- A length of time says its unit: `SAMPLE_MS`, `DAY_S`, `RAW_KEEP_DAYS`
- Each storage key is built by one function or constant in `lib/keys.js` (`rawKey(day)`, `hoursKey(day)`, `STATE_KEY`) and never typed out again

## Functional Style

> ℹ️ We use the parts of functional programming that help, not all of it.

### Don't Change Data in Place

- Treat data as read-only
- Make new objects and arrays instead of editing existing ones
- Use spread, `map`, `filter`, `reduce`, `toSorted` and `toReversed` to get the new value

```js
// Good
const ordered = stats.servers.toSorted((a, b) => (b.id === favourite) - (a.id === favourite));

// Avoid: this reorders the shared list for everyone
const ordered = stats.servers.sort((a, b) => (b.id === favourite) - (a.id === favourite));
```

There is one deliberate exception. `applySample` edits the sampler's state directly, because the sampler owns that state and `collect` saves it straight after.

### Pure Functions

- A function doesn't change anything outside itself
- Its result depends only on what is passed in
- That includes the time: pass `now` in, don't call `Date.now()` inside the logic

```js
// Good
export const totalOf = (values) => (values.some(Boolean) ? values.reduce((sum, value) => sum + (value ? value.players : 0), 0) : null);

// Avoid
let total = 0;
const addToTotal = (values) => {
  values.forEach((value) => {
    total += value ? value.players : 0;
  });
};
```

### Array Methods Over Loops

- Build values with `map`, `filter`, `flatMap`, `reduce`, `some`, `every`, `find` and `findLast`
- Use `forEach` for side effects, like adding elements to the page or wiring buttons
- No `for` or `while` outside the helper folders. The linter enforces it (`functional/no-loop-statements`). Helpers may loop, see [Helpers](#helpers)

```js
// Good
const described = stats.servers.filter((server) => server.about?.glance);

// Avoid
const described = [];
for (let i = 0; i < stats.servers.length; i++) {
  if (stats.servers[i].about?.glance) described.push(stats.servers[i]);
}
```

## Keeping Code Simple

> The code should read like a good book. A function's name tells you what it does, so you don't have to read its body to follow along.

### Function Size

- At most 80 lines
- Not too many branches (`sonarjs/cognitive-complexity` 15)
- At most 5 parameters. Beyond that, pass one object.
- At most 2 levels of nesting

The linter enforces all four.

`renderPlayers` is a good example. It is short and only calls named steps: `syncControls`, `tracksOf`, `outageLines`, `seriesOf` and `renderPlayersTable`.

### Name the Condition

Put a long condition in a well-named variable:

```js
// Good
const recent = Boolean(last?.ok && last.players !== undefined && now - last.at <= CARRY_MS);
if (recent) save(last.online, last.players);

// Avoid
if (last?.ok && last.players !== undefined && now - last.at <= CARRY_MS) save(last.online, last.players);
```

### No Bare Numbers

- Give numbers and fixed strings a name
- Put the constant in the file that owns that topic. Time helpers live in `lib/time.js`.

```js
// Good
const CONFIRM_CHECKS = 15;
if (run.checks >= CONFIRM_CHECKS) confirm(run);

// Avoid
if (run.checks >= 15) confirm(run);
```

### One Ternary at a Time

Don't put a `? :` inside another one. Move the logic into a small named function.

```js
// Avoid
const label = status.counted ? (players ? `${players} online` : 'empty') : status.text;

// Good
const labelOf = (status, players) => {
  if (!status.counted) return status.text;
  return players ? `${players} online` : 'empty';
};
```

### Assignments and Classes

Don't assign inside an expression. Give `x ??= y` its own line. No classes and no `this`: a module holds functions and keeps its own private state.

### Helpers

A helper may use lower-level tricks, as long as the code that calls it stays clean.

**The idea**: the hard logic lives in helpers, and the page and the functions only put helpers together.

Inside a helper, these are fine:

- Changing a local array or object, when it is faster
- A plain loop, when it is faster or clearer, like a scanner that moves by different steps or math on typed arrays. Helpers live in `lib/helpers/` on the server and `src/helpers/` for the page, and `eslint.config.js` allows loops there, in the scripts and in the tests. Everything else stays without loops
- Side effects, if they stay inside the helper

**But**: what the helper returns is always a new value. Callers never get something the helper will change later.

- Never hand out an object or array that is still being changed
- Test helpers on their own

A helper is a place to tuck away detail, not an excuse for messy code.

## Data Flow

The minute log is the source of truth. Everything else is built from it as each reading comes in.

| Key | What it is | Kept for | Written by |
| --- | --- | --- | --- |
| `mxo:raw:<day>` | the log, one line per reading | 9 days | the sampler |
| `mxo:state` | the working state: current counts, records, outages, gaps, today's hours | always | the sampler |
| `mxo:hours:<day>` | the totals of one finished day | always | the sampler, once per day |
| `mxo:visits:<day>` | the visit log, one line per visit | 90 days | `api/hit.js` |
| `mxo:visitday:<day>` | daily visit totals | always | `api/hit.js` |
| `mxo:damaged:*` | a saved state that could not be read, kept aside | 30 days | `loadState` |
| `raw/`, `hours/`, `visits/` in the archive bucket | a copy of each finished day | always | the sampler, once the day is final |
| `mxo:lock` | held while a reading is being saved | seconds | the sampler |

Rules:

- **Only one place writes each key.** The page and `api/stats.js` only read.
- **A finished day is written once** and never changed. Once the log has expired, `mxo:hours:<day>` is the only record of that day.
- **Writes that belong together are sent together.** `store.write()` saves all of them or none.
- **Take the lock before reading** the state you are about to change. A run that gives up releases it.
- **A server only counts as down** after `CONFIRM_CHECKS` bad answers in a row. The stand-in lines written while waiting are corrected at that point.
- **Bad saved data doesn't break every request.** `parseSaved` checks its shape. If it is broken, `loadState` starts fresh and keeps the old copy under `mxo:damaged:*`.

## Checking Input

- Anything from the database, a file, a status page or the address bar is checked before use
- Only known query parameters are accepted. An unknown one gets an error, so nobody can create extra cached copies with it.
- Check keys with `Object.hasOwn(RANGES, range)`, never with `in`
- Status pages are refused when they are too large (`FEED_MAX_BYTES`)
- Owner-only endpoints call `isOwner(req)` first and answer 401 without it
- Errors go through `failed()`: the visitor sees a short, general message and the details go to the log

## Caching

| What | Kept for | Set in |
| --- | --- | --- |
| `/assets/app-<hash>.js` | a year, never re-checked | `vercel.json` |
| `/api/stats` and the page | 60 seconds on the host's servers | the function's `Cache-Control` header |
| Recent database reads | 30 seconds in memory | `mgetRecent` in `lib/store.js` |
| Answers inside the page | 60 seconds per range, loaded early when a range button is hovered or focused | `src/app.js` |
| Offline worker | the script from its cache first, everything else from the network first | `src/sw.js` |

- A new script gets a new file name, so nobody gets stuck on an old one. The offline worker deletes old scripts.
- Answers meant for one person are marked `private` and the offline worker doesn't keep them
- An error is never cached as if it were a real answer
- Change the offline worker's cache name whenever its rules change

## Browser

- **Build the page with `html()`, `el()` and `textContent`.** Never `innerHTML`, inline scripts or inline event handlers.
- **HTML built on the server** passes every value through `escapeHtml`
- **The content security policy** in `vercel.json` only allows scripts from the site itself. Adding any new source is a conscious change there.
- **The favourite comes first** in every list that is not ranked by a number: cards, tables, legends, hover boxes, the server picker, descriptions. Use `inViewOrder()` or `serversInView()` from `state.js`. `inViewOrder()` keeps each server's place in the saved data, so values are read from the right column. Rankings and lists ordered by time keep their own order.
- **Visitor choices** go through `pref` and `setPref`. The keys are listed at the top of `prefs.js`. A new key goes on that list and in the README's Privacy section.
- **Late answers are ignored**: only the answer for the range on screen gets drawn
- **Animations** stop when the visitor asks for less motion (`prefers-reduced-motion`). Keyboard focus stays visible and goes back to the same button after a redraw.
- **Colors and sizes** are CSS variables, set per theme and color in `index.html`

## Async Code

- Use `async` and `await`, not `.then()` chains
- Wait for the actual event or promise, never a guessed number of seconds. Timers are only for debouncing, animation, the once-a-minute schedule and boxes that appear after a delay.
- Use `void` only when nothing depends on the result

## Tests

```sh
npm run build    # the server tests need the built page
npm test
npm run lint
npm run dupes    # copied code
```

- Tests use `node:test` and `node:assert/strict`, nothing else
- Pure functions (`applySample`, `buildStats`, `daysOf`, `parseSaved`) are tested directly, including edge cases and broken input
- Tests pass the time in instead of reading the clock, so they pass on any day and around midnight UTC
- Tests never use the network: status pages are faked and the database is a temporary folder (`MXO_DATA_DIR`)
- Every fixed bug gets a test that fails without the fix
- A visual change isn't done until it has been looked at in a real browser, on a phone and a desktop width, in dark and light

## Lint

`npm run lint` runs ESLint with the settings in `eslint.config.js`:

| Plugin | What it checks |
| --- | --- |
| `@eslint/js` recommended | The basics, plus `eqeqeq`, `prefer-const`, `no-param-reassign` and `prefer-template` |
| `eslint-plugin-sonarjs` recommended | Likely bugs, functions that are too hard to follow, nested ternaries, assignments inside expressions, functions that always return the same value, slow regular expressions |
| `eslint-plugin-unicorn`, selected rules | Array methods that don't change the original, safe string replacing, modern APIs. The rest of this plugin is personal taste, so it is off. |
| `eslint-plugin-import-x` | Imports point to real files, no circular imports, no duplicates |
| `eslint-plugin-functional`, selected rules | No classes, no `this`, and no loops outside the low-level modules |

- Function size, parameters, nesting and complexity have hard limits (80 lines, 5 parameters, 2 levels, 15)
- There are no warnings, only errors, and an error blocks the commit
- `npm run dupes` (jscpd) finds copied code. None is allowed: a piece used twice moves to a shared helper, like `lib/request.js` for the checks every function makes, or `test/support.mjs` for the tests' setup
- Change rules in the config file, never with comments that switch the linter off
- Built and local-only folders are skipped in the config too
- When the replacement text in `replace` comes from data, pass it as a function (`replace(x, () => value)`). Otherwise a `$` in the data would be read as a special pattern.

## Comments and Docs

- A comment explains **why**, not what the code does. One line if possible.
- No history in comments: no dates, versions or "changed this" notes
- If a comment no longer matches the code, fix or delete it in the same change
- No semicolons in comments or the README
- The README is short and factual: features, data sources, commands, privacy and license. No walkthroughs or side remarks.
- The site's address, hosting accounts and people's names never appear in code, comments or docs

## Commits

- Conventional Commits, written as commands: `feat: add …`, `fix: mark …`, `refactor: split …`
- Pull request titles use the same format, typed by what the PR is mainly about. The description follows `.github/pull_request_template.md` and lists every feature and fix it carries.
- One commit per real step. Small follow-up fixes are merged into that commit before pushing.
- No names of users, accounts or other projects, and no AI credits
- Lint, dupes, build and tests pass before every commit. GitHub runs them again on every pull request (`.github/workflows/check.yml`)

## Things That Have Bitten Us

- **Delete old code as part of the change.** One-time migrations and old storage keys go once they have done their job. Don't keep backward compatibility nobody asked for.
- **Apps installed on a phone have their own storage**, separate from the browser. Anything they need at start belongs in the manifest's start address.
- **A scrolling row inside a flex layout needs `min-width: 0`** on its flex item, or it stretches the page instead of scrolling
- **All matching header rules in `vercel.json` apply**, not just the first. `server.js` copies this behavior with `headersFor`, so keep the two in step.
- **A new constant goes in the file that owns its topic**, not next to wherever it is first used
