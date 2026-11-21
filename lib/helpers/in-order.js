// Steps that must not overlap, such as writes to the same file.

/** Runs `step` on each item, one after the other, and gives back the results in the same order. */
export async function inOrder(items, step) {
  const results = [];
  for (const item of items) results.push(await step(item));
  return results;
}
