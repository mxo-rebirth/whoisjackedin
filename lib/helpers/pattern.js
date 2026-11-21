// Reads the source of a rewrite rule into a regular expression, the way the host reads it.

/**
 * A rule's source as a pattern: "(regex)" is a group, ":name(regex)" a group whose match fills ":name" in the
 * destination, and everything else is matched as written.
 */
export function sourcePattern(source) {
  const names = [];
  let body = '';
  let i = 0;
  while (i < source.length) {
    const named = /^:(\w+)\(/.exec(source.slice(i));
    if (named || source[i] === '(') {
      const start = i + (named ? named[0].length : 1);
      const end = closingParen(source, start);
      names.push(named ? named[1] : null);
      body += `(${source.slice(start, end)})`;
      i = end + 1;
    } else {
      body += source[i].replaceAll(/[.*+?^${}|[\]\\/]/g, String.raw`\$&`);
      i += 1;
    }
  }
  return { regex: new RegExp(`^${body}$`), names };
}

/** Where the group opened just before `start` closes, counting the groups inside it. */
function closingParen(source, start) {
  let depth = 1;
  for (let j = start; j < source.length; j++) {
    if (source[j] === '(') depth += 1;
    if (source[j] === ')') depth -= 1;
    if (!depth) return j;
  }
  return source.length;
}
