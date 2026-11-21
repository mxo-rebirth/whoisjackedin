// Turning 3D busts of game characters, drawn with WebGL from the game's own models. One hidden canvas draws
// each character in turn and copies it to plain canvases, so a character can appear more than once.

import { BONES, MIRROR, POSE, aroundX, aroundY, blend, clamp, lens, move, multiply, restingBones, trackAt } from './helpers/math3d.js';

const SIZE = 384; // a bust is drawn at this size, then copied to where it is shown
const SHOWN = 256; // pixel size of a bust's canvas on the page
// A whole figure gets a 3 by 5 picture with room for a raised arm or a jump: its height takes FILL of the
// picture and its feet stand FOOT above the bottom edge. The hidden canvas fits either size.
const FIGURE = [624, 1040];
const FIGURE_SHOWN = [480, 800];
const FILL = 0.741;
const FOOT = 0.029;
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// How the busts are drawn. 'code' shows them the way the Matrix is seen from outside: green light and
// scanlines, with no skin or cloth colors. 'game' shows them with the game's own colors.
const LOOK = 'code';

// The color the characters are drawn in: the darkest tone, the brightest and the glowing edge.
const TONES = {
  green: { dark: [0, 0.07, 0.03], bright: [0.5, 1, 0.68], rim: [0.25, 0.9, 0.5] },
  blue: { dark: [0, 0.035, 0.08], bright: [0.56, 0.8, 1], rim: [0.3, 0.62, 1] },
};
let tone = TONES.green;
/** Draws the characters in the page's color: 'green' or 'blue'. */
export function useTone(name) {
  tone = TONES[name] ?? TONES.green;
}

// The models are handed out only with the key from the visitor's link. The page gives it here first.
let key = '';
export function useKey(given) {
  key = given;
}
const fileUrl = (file) => `/api/model?f=${encodeURIComponent(file)}&k=${encodeURIComponent(key)}`;

const VERTEX = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec2 aUv;
attribute vec4 aBones;
attribute vec4 aWeights;
uniform mat4 uCamera;
uniform mat4 uTurn;
uniform mat4 uBone[${BONES}];
varying vec3 vNrm;
varying vec2 vUv;
void main() {
  // Each point follows up to four bones. A bust has no bones: it follows bone 0, which never moves.
  mat4 pose = aWeights.x * uBone[int(aBones.x)] + aWeights.y * uBone[int(aBones.y)] + aWeights.z * uBone[int(aBones.z)] + aWeights.w * uBone[int(aBones.w)];
  vNrm = (uTurn * pose * vec4(aNrm, 0.0)).xyz;
  vUv = aUv;
  gl_Position = uCamera * uTurn * pose * vec4(aPos, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D uTex;
uniform float uCut;
uniform float uCode;
uniform vec3 uDark;
uniform vec3 uBright;
uniform vec3 uRim;
varying vec3 vNrm;
varying vec2 vUv;
void main() {
  vec4 color = texture2D(uTex, vUv);
  // Hair uses the fourth channel as see-through. Its textures are thin, so all but the faintest part is made
  // solid, or dark hair turns grey on a light page.
  float see = 1.0;
  if (uCut > 0.0) {
    color.rgb /= max(color.a, 0.02);
    see = smoothstep(0.04, 0.5, color.a);
  }
  if (see < uCut) discard;
  vec3 n = normalize(vNrm);
  // Hair is made of thin strips, some seen from behind. Lit as they are, they would face away and take the full
  // edge light, showing as pale sheets. A strip seen from behind is lit as if it faced the viewer.
  if (n.z < 0.0) n = -n;
  float key = max(dot(n, normalize(vec3(-0.45, 0.5, 0.75))), 0.0);
  float fill = max(dot(n, normalize(vec3(0.7, 0.1, 0.5))), 0.0);
  float rim = pow(1.0 - max(n.z, 0.0), 2.0);
  vec3 lit = color.rgb * (0.46 + 0.72 * key + 0.2 * fill) + vec3(0.04, 0.16, 0.09) * rim * 0.35;
  if (uCode > 0.5) {
    // Only how light or dark a spot is survives. It is redrawn in the page's color, with a glowing edge and scanlines.
    float tone = dot(color.rgb, vec3(0.3, 0.59, 0.11)) * (0.4 + 0.8 * key + 0.25 * fill);
    lit = mix(uDark, uBright, smoothstep(0.02, 0.8, tone));
    lit += uRim * rim * 0.45;
    lit *= 0.8 + 0.2 * step(0.5, fract(gl_FragCoord.y / 3.0));
  }
  gl_FragColor = vec4(lit * see, see);
}`;

const models = new Map(); // name -> { shows, ready, parts, pivot, phase }
let gl = null;
let program = null;
let failed = false;
let running = false;

// Where the pointer is, for the busts that watch it. Null until it moves, and again when it leaves the page.
let pointer = null;
addEventListener('pointermove', (event) => (pointer = [event.clientX, event.clientY]), { passive: true });
document.documentElement.addEventListener('pointerleave', () => (pointer = null));
const RESTING = restingBones();

// Moves: the game's own animations, played on the bones of a model that has them.
const BLEND = 0.3; // seconds to ease from one move into the next
const ROUNDS = { dance: 3 }; // how many times a move that loops is played when asked for

/** A packed file: its header's length in 4 bytes, the JSON header, then the data from `base` on. */
async function fetchPacked(file, what) {
  const answer = await fetch(fileUrl(file));
  if (!answer.ok) throw new Error(`${what} answered ${answer.status}`);
  const data = await answer.arrayBuffer();
  const headerLength = new Uint32Array(data, 0, 1)[0];
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, headerLength)));
  return { data, header, base: 4 + headerLength };
}

/** Reads the file of moves: a JSON header, then 16-bit numbers. Each track is its key times, then its values. */
async function loadMoves(file) {
  const { data, header, base } = await fetchPacked(file, 'the moves file');
  const numbers = new Int16Array(data, base);
  const track = ([count, at], width) => ({ times: numbers.subarray(at, at + count), values: numbers.subarray(at + count, at + count + count * width), width });
  return Object.fromEntries(
    Object.entries(header.clips).map(([name, clip]) => [name, { name, seconds: clip.ms / 1000, loop: clip.loop, turns: clip.turns.map((turn) => track(turn, 4)), path: track(clip.path, 3) }]),
  );
}

/** The pose of a move `seconds` after it began. */
function poseAt(move, seconds, out) {
  const ms = move.loop ? (seconds % move.seconds) * 1000 : Math.min(seconds, move.seconds) * 1000;
  move.turns.forEach((track, bone) => trackAt(track, ms, 1 / 32767, out, bone * 4));
  trackAt(move.path, ms, 1 / 50, out, BONES * 4);
  return out;
}

/** Starts a move, easing into it from the pose the body is in. */
function play(body, move, seconds, rounds = 1) {
  body.playing = { move, since: seconds, rounds, from: body.posed ? Float32Array.from(body.pose) : null };
}

/**
 * The body's pose now: standing as its moves say, and now and then shifting or looking around. A move that was
 * asked for plays once, then it stands again.
 */
function poseNow(body, seconds) {
  const { moves } = body;
  if (!body.playing) play(body, moves.stand, seconds);
  let { move, since } = body.playing;
  const { rounds } = body.playing;
  if (move === moves.stand) {
    if (!still && seconds >= (body.restless ??= seconds + 5 + Math.random() * 6)) play(body, Math.random() < 0.5 ? moves.idle1 : moves.idle2, seconds);
  } else if (seconds - since >= move.seconds * rounds) {
    play(body, moves.stand, seconds);
    body.restless = seconds + 6 + Math.random() * 9;
  }
  ({ move, since } = body.playing);
  // With reduced motion the body does not breathe or shift: it holds the first moment of standing.
  poseAt(move, still && move === moves.stand ? 0 : seconds - since, body.pose);
  const eased = clamp((seconds - since) / BLEND, 0, 1);
  if (body.playing.from && eased < 1) blend(body.pose, body.playing.from, 1 - eased * eased * (3 - 2 * eased));
  body.posed = true;
  return body.pose;
}

const HEAD = 5; // where the head's bone is in every skeleton's list

/** One matrix per bone for a pose, for the points that follow it. Parents come before their children. */
function boneMatrices(body, pose) {
  const all = new Float32Array(BONES * 16);
  const world = [];
  const [lookAside, lookDown] = body.look;
  body.bones.forEach((bone, i) => {
    let [x, y, z, w] = pose.subarray(i * 4, i * 4 + 4);
    const length = Math.hypot(x, y, z, w) || 1;
    [x, y, z, w] = [x / length, y / length, z / length, w / length];
    // The hips go where the move puts them, raised for a body that stands taller. Every other bone keeps its own length.
    const at = i === 1 ? [pose[BONES * 4], pose[BONES * 4 + 1] + body.lift, pose[BONES * 4 + 2]] : bone.offset;
    const own = new Float32Array([
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
      at[0], at[1], at[2], 1,
    ]);
    world[i] = bone.parent >= 0 ? multiply(world[bone.parent], own) : own;
    if (i === HEAD && (lookAside || lookDown)) {
      // Looking at something: the head turns about its joint. The skin of the neck shares the turn along
      // its length, and the collar stays where it is.
      const [jx, jy, jz] = world[i].subarray(12, 15);
      world[i] = multiply(multiply(multiply(multiply(move(jx, jy, jz), aroundY(lookAside)), aroundX(lookDown)), move(-jx, -jy, -jz)), world[i]);
    }
    all.set(multiply(world[i], bone.inverse), i * 16);
  });
  return all;
}

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(SIZE, FIGURE[0]);
  canvas.height = Math.max(SIZE, FIGURE[1]);
  gl = canvas.getContext('webgl', { antialias: true, alpha: true });
  if (!gl) return false;
  const shader = (type, source) => {
    const made = gl.createShader(type);
    gl.shaderSource(made, source);
    gl.compileShader(made);
    if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(made));
    return made;
  };
  program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  return true;
}

function texture(file, arrived) {
  const made = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, made);
  // A plain skin tone stands in until the picture arrives.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([120, 110, 100, 255]));
  const picture = new Image();
  picture.addEventListener('load', () => {
    gl.bindTexture(gl.TEXTURE_2D, made);
    // Colors are stored already multiplied by how solid they are, so empty pixels cannot tint their neighbours.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    arrived();
  });
  // A picture that fails must not keep the character waiting.
  picture.addEventListener('error', arrived);
  picture.src = fileUrl(file);
  return made;
}

async function load(name, model) {
  const { data, header, base } = await fetchPacked(`${name}.bin`, 'the site');
  const textures = new Map();
  model.parts = header.parts.map((part) => {
    const points = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, points);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data, base + part.floats, part.points * (header.floatsPerPoint ?? 8)), gl.STATIC_DRAW);
    const triangles = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangles);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data, base + part.shorts, part.indices), gl.STATIC_DRAW);
    if (!textures.has(part.tex)) {
      // The character is shown once all its pictures are in, so it fades in whole instead of in patches.
      model.waiting += 1;
      textures.set(part.tex, texture(part.tex, () => (model.waiting -= 1)));
    }
    return { points, triangles, count: part.indices, texture: textures.get(part.tex), cut: part.alpha ? 0.08 : 0 };
  });
  // Solid parts first, then hair and glasses.
  model.parts.sort((a, b) => a.cut - b.cut);
  model.pivot = [0, header.headY + 7, header.headZ];
  if (header.bones) {
    // A model with bones is posed with the game's moves.
    header.bones.forEach((bone) => {
      bone.inverse = new Float32Array(bone.inverse);
    });
    model.body = { bones: header.bones, lift: header.lift ?? 0, pose: new Float32Array(POSE), look: [0, 0], moves: await loadMoves(header.moves) };
  }
  // A whole figure is framed from head to toe and turns about its middle.
  if (header.full) model.figure = { low: header.low, high: header.high, turned: 0.2, goal: 0.2 };
  model.ready = true;
}

function draw(model, seconds) {
  // How far to close on a target since this model was last drawn, getting most of the way in `time` seconds.
  // This keeps turns the same speed however often pictures are drawn.
  const passed = Math.min(0.1, seconds - (model.drawnAt ?? seconds));
  model.drawnAt = seconds;
  const towards = (time) => 1 - Math.exp(-passed / time);
  const [width, height] = model.figure ? FIGURE : [SIZE, SIZE];
  const { py, pz, yaw, nod, camera } = model.figure ? aimFigure(model, towards, width / height) : aimBust(model, seconds, towards);
  const turn = multiply(multiply(multiply(multiply(move(0, py, pz), aroundY(yaw)), aroundX(nod)), move(0, -py, -pz)), MIRROR);
  gl.viewport(0, 0, width, height);
  model.drawn = [width, height];
  gl.depthMask(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uCamera'), false, camera);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uTurn'), false, turn);
  gl.uniform1f(gl.getUniformLocation(program, 'uCode'), LOOK === 'code' ? 1 : 0);
  gl.uniform3fv(gl.getUniformLocation(program, 'uDark'), tone.dark);
  gl.uniform3fv(gl.getUniformLocation(program, 'uBright'), tone.bright);
  gl.uniform3fv(gl.getUniformLocation(program, 'uRim'), tone.rim);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uBone[0]'), false, model.body ? boneMatrices(model.body, poseNow(model.body, seconds)) : RESTING);
  drawParts(model);
}

/** A whole figure, framed from head to toe. It faces the way the visitor turned it and does not spin by itself. */
function aimFigure(model, towards, aspect) {
  const { figure } = model;
  const half = (figure.high - figure.low) / FILL / 2;
  const py = figure.low + half * (1 - 2 * FOOT);
  figure.turned += (figure.goal - figure.turned) * towards(0.17);
  return { py, pz: 0, yaw: figure.turned, nod: 0, camera: multiply(lens(0.42, 40, 1600, aspect), move(0, -py, -half / Math.tan(0.21))) };
}

/** Where a bust wants to look: a slow sway, or the pointer for one that watches it, as far as a neck allows. */
function wantedLook(model, seconds) {
  if (still) return [0.35, 0];
  if (model.watcher && pointer) {
    const box = model.watcher.getBoundingClientRect();
    return [clamp(Math.atan2(pointer[0] - (box.left + box.width / 2), 420), -0.75, 0.75), clamp(Math.atan2(pointer[1] - (box.top + box.height * 0.4), 900), -0.14, 0.2)];
  }
  return [0.5 * Math.sin(seconds * 0.55 + model.phase), 0.06 * Math.sin(seconds * 0.4 + model.phase * 2)];
}

function aimBust(model, seconds, towards) {
  const [, py, pz] = model.pivot;
  const [wantYaw, wantNod] = wantedLook(model, seconds);
  // It turns its head over a moment, not at once.
  model.look ??= [wantYaw, wantNod, wantYaw];
  model.look[0] += (wantYaw - model.look[0]) * towards(0.2);
  model.look[1] += (wantNod - model.look[1]) * towards(0.2);
  let [yaw, nod] = model.look;
  if (model.body) {
    // A bust with bones looks with its head, as a person does. The shoulders follow later, and only a little.
    model.look[2] += (yaw - model.look[2]) * towards(0.7);
    const shoulders = 0.3 * model.look[2];
    // The model is mirrored for the screen, so a turn to the side goes the other way round in its own space.
    model.body.look = [-(yaw - shoulders), nod];
    yaw = shoulders;
    nod = 0;
  }
  // Close enough that the head fills most of the picture, with the shoulders just in view.
  return { py, pz, yaw, nod, camera: multiply(lens(0.42, 20, 400), move(0, -(py - 2.5), -(pz + 84))) };
}

function drawParts(model) {
  const [aPos, aNrm, aUv, aBones, aWeights] = ['aPos', 'aNrm', 'aUv', 'aBones', 'aWeights'].map((name) => gl.getAttribLocation(program, name));
  const wide = model.body ? 64 : 32;
  model.parts.forEach((part) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, part.points);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, wide, 0);
    gl.enableVertexAttribArray(aNrm);
    gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, wide, 12);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, wide, 24);
    if (model.body) {
      gl.enableVertexAttribArray(aBones);
      gl.vertexAttribPointer(aBones, 4, gl.FLOAT, false, wide, 32);
      gl.enableVertexAttribArray(aWeights);
      gl.vertexAttribPointer(aWeights, 4, gl.FLOAT, false, wide, 48);
    } else {
      gl.disableVertexAttribArray(aBones);
      gl.vertexAttrib4f(aBones, 0, 0, 0, 0);
      gl.disableVertexAttribArray(aWeights);
      gl.vertexAttrib4f(aWeights, 1, 0, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.triangles);
    gl.bindTexture(gl.TEXTURE_2D, part.texture);
    gl.uniform1f(gl.getUniformLocation(program, 'uCut'), part.cut);
    // Hair is blended over what is already drawn and does not hide the strands behind it.
    gl.depthMask(part.cut === 0);
    gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
  });
}

let last = 0;
// With reduced motion nothing moves by itself, but what the visitor asks for (a drag, an emote) still plays.
let askedUntil = 0;
function frame(now) {
  requestAnimationFrame(frame);
  // About 30 pictures a second is plenty for a slow turn. With reduced motion, one a second keeps new busts filled in.
  if (document.hidden || now - last < (still && now > askedUntil ? 1000 : 33)) return;
  last = now;
  models.forEach((model) => {
    [...model.shows].filter((shown) => !shown.isConnected).forEach((canvas) => model.shows.delete(canvas));
    if (!model.ready || !model.shows.size) return;
    draw(model, now / 1000);
    paintShows(model);
  });
}

/** Copies the picture just drawn onto every canvas that shows this model. */
function paintShows(model) {
  // The picture sits in the bottom left corner of the hidden canvas.
  const [width, height] = model.drawn;
  model.shows.forEach((canvas) => {
    const pen = canvas.getContext('2d');
    pen.clearRect(0, 0, canvas.width, canvas.height);
    pen.drawImage(gl.canvas, 0, gl.canvas.height - height, width, height, 0, 0, canvas.width, canvas.height);
    // Drawn for the first time, with everything loaded: the page's styles fade it in from here.
    if (!model.waiting) canvas.classList.add('in');
  });
}

/** The model for a character, created and loaded the first time it is asked for. */
function modelFor(name) {
  let model = models.get(name);
  if (model) return model;
  model = { shows: new Set(), ready: false, waiting: 0, parts: [], pivot: [0, 78, 3], phase: models.size * 1.7, loading: Promise.resolve() };
  models.set(name, model);
  if (failed) return model;
  try {
    if (gl || setup()) model.loading = load(name, model).catch((err) => console.warn(`bust ${name}: ${err.message}`));
    else failed = true;
  } catch (err) {
    failed = true;
    console.warn(`busts are off: ${err.message}`);
  }
  return model;
}

/**
 * A canvas with the named character, empty until it loads and for good without WebGL. `watches` faces the pointer.
 * `whole` shows the full figure, turned by dragging, on a canvas larger than its box so raised arms fit.
 */
export function bust(name, title, { whole: wholeFigure = false, watches = false } = {}) {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = wholeFigure ? FIGURE_SHOWN : [SHOWN, SHOWN];
  canvas.setAttribute('aria-hidden', 'true');
  const model = modelFor(name);
  model.shows.add(canvas);
  // A character that is already loaded appears at once. Only its first arrival fades in.
  if (model.ready && !model.waiting) canvas.classList.add('in');
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
  if (!wholeFigure) {
    canvas.classList.add('face');
    if (title) canvas.title = title;
    if (watches) model.watcher = canvas;
    return canvas;
  }
  const box = document.createElement('span');
  box.className = 'figure';
  if (title) box.title = title;
  box.append(canvas);
  let from = null;
  box.addEventListener('pointerdown', (event) => {
    from = event.clientX;
    box.classList.add('held');
    // Keeps the drag going when the pointer leaves the box.
    try {
      box.setPointerCapture(event.pointerId);
    } catch {}
  });
  box.addEventListener('pointermove', (event) => {
    if (from === null || !model.figure) return;
    model.figure.turned += (event.clientX - from) * 0.012;
    model.figure.goal = model.figure.turned;
    from = event.clientX;
    askedUntil = performance.now() + 600;
  });
  ['pointerup', 'pointercancel'].forEach((type) => {
    box.addEventListener(type, () => {
      from = null;
      box.classList.remove('held');
    });
  });
  return box;
}

/** Resolves when the character has loaded, with whether it is a whole figure that can be told what to do. */
export async function figureReady(name) {
  const model = modelFor(name);
  await model.loading;
  return Boolean(model.ready && model.figure);
}

/** Tells a figure to do something: 'turn' (turn around) or one of the game's moves. False when it cannot. */
export function act(name, what) {
  const { figure, body } = models.get(name) ?? {};
  if (!figure || !body) return false;
  if (what === 'turn') {
    figure.goal += Math.PI;
    askedUntil = performance.now() + 1500;
    return true;
  }
  const move = Object.hasOwn(body.moves, what) && !['stand', 'idle1', 'idle2'].includes(what) ? body.moves[what] : null;
  if (!move) return false;
  const rounds = ROUNDS[what] ?? 1;
  play(body, move, performance.now() / 1000, rounds);
  askedUntil = performance.now() + (move.seconds * rounds + BLEND) * 1000 + 200;
  return true;
}
