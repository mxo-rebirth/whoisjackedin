// The rewrite rules of vercel.json, applied the way the host applies them, for the local server and the tests.

/**
 * A rule's source as a pattern, read the way the host reads it: "(regex)" is a group, ":name(regex)" a group whose
 * match fills ":name" in the destination, and everything else is matched as written.
 */
function sourcePattern(source) {
  const names = [];
  let body = '';
  let i = 0;
  while (i < source.length) {
    const named = /^:(\w+)\(/.exec(source.slice(i));
    if (named || source[i] === '(') {
      const start = i + (named ? named[0].length : 1);
      let depth = 1;
      let j = start;
      for (; j < source.length && depth; j++) depth += source[j] === '(' ? 1 : source[j] === ')' ? -1 : 0;
      names.push(named ? named[1] : null);
      body += `(${source.slice(start, j - 1)})`;
      i = j;
    } else {
      body += source[i].replace(/[.*+?^${}|[\]\\/]/g, '\\$&');
      i += 1;
    }
  }
  return { regex: new RegExp(`^${body}$`), names };
}

/** The headers every matching rule adds to an answer, in the order of the rules, so a later one wins. */
export function headersFor(rules, pathname) {
  const headers = {};
  for (const rule of rules ?? []) if (sourcePattern(rule.source).regex.test(pathname)) for (const { key, value } of rule.headers) headers[key] = value;
  return headers;
}

/**
 * The address after the rewrites. As at the host, the query of the original address is kept, captured
 * parts fill ":name" in the destination, and a cookie that a rule looks for is handed on as a query value.
 */
export function rewrite(rules, url, cookies) {
  for (const rule of rules ?? []) {
    const { regex, names } = sourcePattern(rule.source);
    const match = regex.exec(url.pathname);
    if (!match) continue;
    const needs = (rule.has ?? []).filter((condition) => condition.type === 'cookie');
    if (!needs.every((condition) => condition.key in cookies)) continue;
    let destination = rule.destination;
    names.forEach((name, i) => {
      if (name) destination = destination.replaceAll(`:${name}`, encodeURIComponent(match[i + 1]));
    });
    const next = new URL(destination, url);
    for (const [name, value] of url.searchParams) if (!next.searchParams.has(name)) next.searchParams.set(name, value);
    for (const condition of needs) next.searchParams.set(condition.key, cookies[condition.key]);
    return next;
  }
  return url;
}
