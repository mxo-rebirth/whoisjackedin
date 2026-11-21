// The number work behind the 3D characters: matrices for WebGL and the blending of the game's poses.
// It runs for every bone up to 30 times a second, so it works on typed arrays with plain loops.

export const BONES = 22;
/** A pose is a rotation for each bone (a quaternion, relative to the bone it hangs from), then where the hips are. */
export const POSE = BONES * 4 + 3;

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** 4x4 matrices, column by column, as WebGL wants them. */
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
export const move = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
export const aroundY = (a) => new Float32Array([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]);
export const aroundX = (a) => new Float32Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
export function lens(fovY, near, far, wide = 1) {
  const f = 1 / Math.tan(fovY / 2);
  return new Float32Array([f / wide, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}
// The game counts x the other way round from WebGL, so the model is mirrored once to look as it does in the game.
export const MIRROR = new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const IDENTITY = move(0, 0, 0);

/** One unmoved matrix per bone, for a model without bones. */
export function restingBones() {
  const all = new Float32Array(BONES * 16);
  for (let i = 0; i < BONES; i++) all.set(IDENTITY, i * 16);
  return all;
}

/** Writes a track's value at `ms` into `out` from `at` on, on a straight line between the two nearest keys. */
export function trackAt(track, ms, scale, out, at) {
  const { times, values, width } = track;
  let k = 0;
  while (k < times.length - 2 && times[k + 1] <= ms) k++;
  const next = Math.min(k + 1, times.length - 1);
  const share = next === k ? 0 : clamp((ms - times[k]) / (times[next] - times[k]), 0, 1);
  // The same rotation can be written two ways round. Take the short way between two of them.
  let same = 1;
  if (width === 4) {
    let dot = 0;
    for (let c = 0; c < 4; c++) dot += values[k * 4 + c] * values[next * 4 + c];
    if (dot < 0) same = -1;
  }
  for (let c = 0; c < width; c++) out[at + c] = (values[k * width + c] * (1 - share) + same * values[next * width + c] * share) * scale;
}

/** Moves `pose` towards `from` by `share` (1 leaves only `from`). */
export function blend(pose, from, share) {
  for (let bone = 0; bone < BONES; bone++) {
    let dot = 0;
    for (let c = 0; c < 4; c++) dot += pose[bone * 4 + c] * from[bone * 4 + c];
    const same = dot < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) pose[bone * 4 + c] = pose[bone * 4 + c] * (1 - share) + same * from[bone * 4 + c] * share;
  }
  for (let c = BONES * 4; c < POSE; c++) pose[c] = pose[c] * (1 - share) + from[c] * share;
}
