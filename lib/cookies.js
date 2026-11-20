// The cookies of a request, by name.
export const cookiesOf = (header) =>
  Object.fromEntries(
    String(header ?? '')
      .split(/;\s*/)
      .filter(Boolean)
      .map((pair) => [pair.split('=')[0], pair.slice(pair.indexOf('=') + 1)]),
  );
