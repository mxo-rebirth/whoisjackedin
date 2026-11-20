// The rewrite rules of vercel.json, applied the way the host applies them, for the local server and the tests.

/** A rule's source as a pattern. ":name(regex)" captures a part of the path under that name. */
function sourcePattern(source) {
  const names = [];
  const body = source.replace(/[.*+?^${}|[\]\\]/g, (c) => (c === '(' || c === ')' ? c : `\\${c}`)).replace(/:(\w+)\(([^)]*)\)/g, (_, name, regex) => {
    names.push(name);
    return `(${regex.replace(/\\/g, '')})`;
  });
  return { regex: new RegExp(`^${body}$`), names };
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
    names.forEach((name, i) => (destination = destination.replaceAll(`:${name}`, encodeURIComponent(match[i + 1]))));
    const next = new URL(destination, url);
    for (const [name, value] of url.searchParams) if (!next.searchParams.has(name)) next.searchParams.set(name, value);
    for (const condition of needs) next.searchParams.set(condition.key, cookies[condition.key]);
    return next;
  }
  return url;
}
