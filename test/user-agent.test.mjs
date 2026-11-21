// The short browser and system names a visit is counted under, and the two letters a visit line keeps for them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentCode, browserOf, namesOf, systemOf } from '../lib/helpers/user-agent.js';

const AGENTS = [
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari', 'iOS'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1', 'Chrome', 'iOS'],
  ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36', 'Chrome', 'Android'],
  ['Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36', 'Samsung', 'Android'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 Edg/142.0', 'Edge', 'Windows'],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0', 'Firefox', 'Linux'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 OPR/124.0', 'Opera', 'Windows'],
  ['Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36', 'Chrome', 'ChromeOS'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari', 'Mac'],
  // Links opened inside the Facebook app, on Android and on an iPhone.
  ['Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/500.0;]', 'In-app', 'Android'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0]', 'In-app', 'iOS'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15', 'DuckDuckGo', 'iOS'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 OPT/5.0', 'Opera', 'iOS'],
  // Safari's marks outside Apple systems are not Safari.
  ['Mozilla/5.0 (Linux; U; Android 4.0.3; de-de; GT-I9100 Build/IML74K) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30', 'Other', 'Android'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 Epiphany/46', 'Other', 'Linux'],
  ['Mozilla/5.0 (PlayStation 5 7.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15', 'Other', 'Other'],
  // An iPad asking for desktop pages presents itself as a Mac.
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari', 'Mac'],
  ['SomethingNew/1.0', 'Other', 'Other'],
];

test('each browser and system is named, the ones built on another one included', () => {
  for (const [agent, browser, system] of AGENTS) assert.deepEqual([browserOf(agent), systemOf(agent)], [browser, system], agent);
});

test('the two letters a visit line keeps give the same names back', () => {
  for (const [agent, browser, system] of AGENTS) assert.deepEqual(namesOf(agentCode(agent)), { browser, system }, agent);
  assert.equal(agentCode(AGENTS[2][0]), 'ca');
  assert.deepEqual(namesOf('??'), { browser: 'Other', system: 'Other' });
});
