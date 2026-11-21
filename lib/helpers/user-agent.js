// Short names for the browser and the system a visit came from, read from its user agent. A visit keeps only a
// one-letter code for each, never the user agent itself.

const APPLE = /iPhone|iPad|iPod|Macintosh/;

// The first match wins. Browsers built on another one name it too, so they come before it.
const BROWSERS = [
  // Links opened inside an app: Android marks its web views "; wv)", the apps on iPhones name themselves.
  { code: 'i', name: 'In-app', test: (agent) => /; wv\)|FBAN|FBAV|Instagram|GSA\//.test(agent) },
  { code: 'e', name: 'Edge', test: (agent) => /Edg(e|A|iOS)?\//.test(agent) },
  { code: 'o', name: 'Opera', test: (agent) => /OPR\/|Opera|OPT\/|OPiOS\//.test(agent) },
  { code: 'm', name: 'Samsung', test: (agent) => agent.includes('SamsungBrowser/') },
  { code: 'd', name: 'DuckDuckGo', test: (agent) => agent.includes('DuckDuckGo/') },
  { code: 'f', name: 'Firefox', test: (agent) => /Firefox\/|FxiOS\//.test(agent) },
  { code: 'c', name: 'Chrome', test: (agent) => /Chrome\/|CriOS\//.test(agent) },
  // Every browser on iPhones says Safari, so Safari's own Version/ marker decides, and only on Apple systems.
  { code: 's', name: 'Safari', test: (agent) => APPLE.test(agent) && agent.includes('Safari/') && agent.includes('Version/') },
];
const SYSTEMS = [
  { code: 'a', name: 'Android', test: (agent) => agent.includes('Android') },
  { code: 'i', name: 'iOS', test: (agent) => /iPhone|iPad|iPod/.test(agent) },
  { code: 'c', name: 'ChromeOS', test: (agent) => agent.includes('CrOS') },
  { code: 'w', name: 'Windows', test: (agent) => agent.includes('Windows') },
  { code: 'm', name: 'Mac', test: (agent) => /Macintosh|Mac OS X/.test(agent) },
  { code: 'l', name: 'Linux', test: (agent) => agent.includes('Linux') },
];
const OTHER = { code: 'x', name: 'Other' };

const match = (list, agent) => list.find((entry) => entry.test(String(agent ?? ''))) ?? OTHER;
const named = (list, code) => list.find((entry) => entry.code === code)?.name ?? OTHER.name;

/** The browser's short name, or "Other". Brave and Vivaldi present themselves as Chrome and count as Chrome. */
export const browserOf = (agent) => match(BROWSERS, agent).name;

/** The system's short name, or "Other". An iPad that presents itself as a Mac counts as a Mac. */
export const systemOf = (agent) => match(SYSTEMS, agent).name;

/** Two letters for a visit line: the browser's code, then the system's. */
export const agentCode = (agent) => `${match(BROWSERS, agent).code}${match(SYSTEMS, agent).code}`;

/** The browser and system names behind a visit line's two letters. */
export const namesOf = (code) => ({ browser: named(BROWSERS, code[0]), system: named(SYSTEMS, code[1]) });
