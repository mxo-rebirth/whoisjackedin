// The rewrite rules of vercel.json, applied the way the host applies them, for the local server and the tests.
import { sourcePattern } from './helpers/pattern.js';

/** The headers every matching rule adds to an answer, in the order of the rules, so a later one wins. */
export function headersFor(rules, pathname) {
  const matching = (rules ?? []).filter((rule) => sourcePattern(rule.source).regex.test(pathname));
  return Object.fromEntries(matching.flatMap((rule) => rule.headers.map(({ key, value }) => [key, value])));
}

/** The query of the address asked for carries over, without replacing what the destination sets itself. */
function keepQuery(next, url) {
  url.searchParams.forEach((value, name) => {
    if (!next.searchParams.has(name)) next.searchParams.set(name, value);
  });
}

/** The address one rule leads to, or null when the rule does not apply. */
function applyRule(rule, url, cookies) {
  const { regex, names } = sourcePattern(rule.source);
  const match = regex.exec(url.pathname);
  const needs = (rule.has ?? []).filter((condition) => condition.type === 'cookie');
  if (!match || !needs.every((condition) => Object.hasOwn(cookies, condition.key))) return null;
  const destination = names.reduce((text, name, i) => (name ? text.replaceAll(`:${name}`, () => encodeURIComponent(match[i + 1])) : text), rule.destination);
  const next = new URL(destination, url);
  keepQuery(next, url);
  needs.forEach((condition) => next.searchParams.set(condition.key, cookies[condition.key]));
  return next;
}

/**
 * The address after the rewrites. As at the host, the first rule that applies wins, the query of the original
 * address is kept, captured parts fill ":name" in the destination, and a cookie that a rule looks for is handed
 * on as a query value.
 */
export function rewrite(rules, url, cookies) {
  return (rules ?? []).reduce((found, rule) => found ?? applyRule(rule, url, cookies), null) ?? url;
}
