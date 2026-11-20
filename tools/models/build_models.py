# Turns a game character into a small bust for the web: points, normals, texture coordinates, triangles and textures.
# Usage: build_models.py <game dir> <out dir> <name>=<resource path of the .moa> ...
import json, math, os, struct, sys, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rez import Rez

G, OUT = sys.argv[1], sys.argv[2]
rez = Rez(G)
os.makedirs(os.path.join(OUT, 'textures'), exist_ok=True)
MANIFEST = {}  # web file -> (full-size PNG, longest side on the web)

# ---------- meshes ----------
def mesh(data):
    """Points and triangles of a mesh's most detailed version. The layout of a point varies from mesh to mesh
    (bone weights, a second texture coordinate), so every sensible layout is tried and checked for sanity."""
    chunk, nv, nt = struct.unpack_from('<III', data, 0x17)
    end = 0x1b + chunk
    sane = lambda v, limit: v == v and abs(v) < limit
    fits = []
    for stride in range(32, 68, 4):
        for extra in range(0, 120, 4) if True else ():
            pass
        for extra in range(0, 120):
            start = end - nt * 6 - extra - nv * stride
            if start < 0x2b:
                break
            idx = struct.unpack_from('<%dH' % (nt * 3), data, start + nv * stride)
            if max(idx) >= nv:
                continue
            pos = [struct.unpack_from('<3f', data, start + i * stride) for i in range(nv)]
            if not all(sane(c, 400) for p in pos for c in p) or max(max(p) for p in pos) - min(min(p) for p in pos) < 0.5:
                continue
            for noff in range(12, stride - 16, 4):
                nrm = [struct.unpack_from('<3f', data, start + i * stride + noff) for i in range(nv)]
                if sum(1 for n in nrm if abs(math.sqrt(sum(c * c for c in n)) - 1) > 0.05) > nv * 0.05:
                    continue
                uv = [struct.unpack_from('<2f', data, start + i * stride + noff + 12) for i in range(nv)]
                if not all(sane(c, 16) for t in uv for c in t):
                    continue
                # A true layout has normals that agree with the way its triangles face.
                agree, counted = 0.0, 0
                for t in range(0, len(idx), 3):
                    a, b, c = pos[idx[t]], pos[idx[t + 1]], pos[idx[t + 2]]
                    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2]); v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
                    f = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
                    size = math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2])
                    if size < 1e-6:
                        continue
                    n = [sum(nrm[idx[t + k]][j] for k in range(3)) for j in range(3)]
                    agree += abs(f[0] * n[0] + f[1] * n[1] + f[2] * n[2]) / (size * 3)
                    counted += 1
                if counted < nt * 0.5:
                    continue
                fits.append((round(-agree / counted, 2), extra, stride, noff, start, [p + n + t for p, n, t in zip(pos, nrm, uv)], list(idx)))
    if not fits or min(f[0] for f in fits) > -0.35:
        raise ValueError(f'mesh layout not recognised (points {nv}, triangles {nt})')
    # Best agreement first, then the fewest unexplained bytes after the triangles.
    fits.sort(key=lambda f: (f[0], f[1]))
    _, _, stride, noff, start, verts, idx = fits[0]
    return verts, idx, skin_of(data, nv, stride, noff, start, start + nv * stride + nt * 6, end)

def bone_sets(data, after, end, nv):
    """The engine's "bone sets", which follow a mesh's triangles: the points are divided into runs, and each
    run names the up to four bones its points follow (255 for none). Returns [(first point, how many, bones)],
    or None when the bytes there are something else."""
    if end - after < 16:
        return None
    n = struct.unpack_from('<I', data, after)[0]
    if not 0 < n < 256 or end - after != 4 + 12 * n:
        return None
    sets = [struct.unpack_from('<HH4B', data, after + 4 + 12 * k) for k in range(n)]
    # The runs cover every point once, and name only bones the skeleton has.
    at = 0
    for first, count, *bones in sorted(sets):
        if first != at or any(b != 255 and b >= len(BONES) for b in bones):
            return None
        at += count
    return [(first, count, bones) for first, count, *bones in sets] if at == nv else None

def skin_of(data, nv, stride, noff, start, after, end):
    """For each point, the bones it follows and how strongly: [(bone number, weight), ...].
    Clothes and bodies come with bone sets (see bone_sets): a point stores its weights for its run's bones, all
    but the last, between its position and its normal. Without these a moving figure's clothes tear: they
    cannot be guessed from where the points lie.
    Other meshes store the weights and up to four bone numbers there. Those numbers index a short list of the
    skeleton's bones that sits right before the points. A rigid mesh follows a single bone, named in the same
    place. None when none of these is found."""
    sets = bone_sets(data, after, end, nv)
    count = struct.unpack_from('<I', data, 0x23)[0] - 1  # weights kept per point: one fewer than the bones a triangle may use
    if sets and 0 <= count <= 3 and noff == 12 + 4 * count:
        skin = [None] * nv
        for first, n, bones in sets:
            for i in range(first, first + n):
                weights = list(struct.unpack_from('<%df' % count, data, start + i * stride + 12)) if count else []
                weights.append(max(0.0, 1.0 - sum(weights)))
                skin[i] = [(bones[k], w) for k, w in enumerate(weights) if w > 0.001 and bones[k] != 255]
        if all(skin):
            return skin
    bones = None
    for n in range(1, 40):
        if start - 4 * n - 4 < 0x2b:
            break
        if struct.unpack_from('<I', data, start - 4 * n - 4)[0] == n:
            ids = struct.unpack_from('<%dI' % n, data, start - 4 * n)
            if all(i < 64 for i in ids):
                bones = ids
    if noff <= 12:
        one = struct.unpack_from('<I', data, start - 4)[0]
        return [[(one, 1.0)]] * nv if one < 64 else None
    if bones is None:
        return None
    count = (noff - 16) // 4
    skin = []
    for i in range(nv):
        at = start + i * stride + 12
        weights = list(struct.unpack_from('<%df' % count, data, at)) if count else []
        weights.append(max(0.0, 1.0 - sum(weights)))
        numbers = data[at + 4 * count:at + 4 * count + 4]
        skin.append([(bones[numbers[k]], w) for k, w in enumerate(weights) if w > 0.001 and numbers[k] < len(bones)])
    return skin

# ---------- skeleton ----------
def bone_matrix(data, bone):
    """Where a bone sits in the body, as a 4x4 matrix. Head and hands are separate models that hang off one."""
    at = data.find(bytes([len(bone)]) + bone.encode())
    return [struct.unpack_from('<4f', data, at + 1 + len(bone) + 4 + r * 16) for r in range(4)]

BONES = ['Null', 'translation', 'Torso', 'Upper_Torso', 'Neck', 'Head', 'Left_shoulder', 'Left_armu', 'Left_arml', 'Left_hand', 'Right_shoulder', 'Right_armu',
         'Right_arml', 'Right_hand', 'Left_pelvis', 'Left_legu', 'Left_legl', 'Left_foot', 'Right_pelvis', 'Right_legu', 'Right_legl', 'Right_foot']

def skeleton_of(data):
    """For each of BONES: its parent's place in the list (-1 for the first), where its joint sits when the
    figure stands neutral, how far that is from the parent's joint in the parent's own axes (`offset`), and
    the matrix that takes a point of the neutral figure into the bone's own axes (`inverse`, as WebGL wants it)."""
    bones, world = [], []
    for bone in BONES:
        at = data.find(bytes([len(bone)]) + bone.encode())
        number, parent = struct.unpack_from('<HH', data, at + 1 + len(bone))
        parent = -1 if parent == 0xffff else parent
        m = [struct.unpack_from('<4f', data, at + 1 + len(bone) + 4 + r * 16) for r in range(4)]
        world.append(m)
        # A bone's matrix is a turn and a move, so its inverse is the turn transposed and the move turned back.
        inverse = [[m[c][r] for c in range(3)] + [0.0] for r in range(3)]
        inverse.append([-sum(m[3][k] * m[r][k] for k in range(3)) for r in range(3)] + [1.0])
        offset = m[3][:3]
        if parent >= 0:
            up = world[parent]
            offset = [sum((m[3][k] - up[3][k]) * up[r][k] for k in range(3)) for r in range(3)]
        bones.append(dict(name=bone, parent=parent, joint=[round(c, 2) for c in m[3][:3]], offset=[round(c, 3) for c in offset],
                          inverse=[round(c, 5) for row in inverse for c in row]))
    return bones

# ---------- moves ----------
# Sets of moves: what the page calls each move, and the game's animation for it. The game keeps a set of
# animations per mood. "regal" is the one that stands with the hands behind the back. Women have their own.
MOVE_SETS = {
    'regal': ('resource/characters/shared/animations/', {
        'stand': 'stand_regal', 'idle1': 'stand_idle3_regal', 'idle2': 'stand_idle4_regal',
        'wave': 'stand_emote_wave', 'bow': 'stand_emote_bow', 'clap': 'stand_emote_clap', 'cheer': 'stand_emote_cheer',
        'nod': 'stand_emote_nod', 'no': 'stand_emote_shakehead', 'shrug': 'stand_emote_shrug', 'point': 'stand_emote_pointf',
        'salute': 'stand_emote_salute', 'beckon': 'stand_emote_beckon', 'laugh': 'stand_emote_laugh',
        'thumbsup': 'stand_emote_thumbsup', 'kneel': 'stand_emote_kneel', 'crossarms': 'stand_emote_crossarms',
        'dance': 'stand_emote_russdance',
    }),
    # The calm ones: a bust has to keep its head in the picture, and the others bend down or look far behind.
    'woman': ('resource/characters/shared-female/animations/', {'stand': 'stand', 'idle1': 'stand_idle5', 'idle2': 'stand_idle2'}),
}
# The moves put the hips where a man's are. Other bodies stand this much higher or lower.
HIPS_OF_A_MAN = 4.3

def animation(data):
    """An .ana file: (loops, length in ms, bones). Each bone is a list of keys (time in ms, position or None,
    rotation as a quaternion x y z w or None). Rotations are relative to the parent bone. Only the hips
    (the second bone) really move; the other positions repeat the bone lengths of the body the animation was
    made on."""
    kind, length = struct.unpack_from('<BH', data, 0x10)
    at = 0x17
    if kind & 1:
        # Things that happen along the way (sounds, hand shapes, faces). Not used here.
        count = data[at]
        at += 1
        for _ in range(count):
            at += 4 + struct.unpack_from('<H', data, at + 2)[0]
    count = struct.unpack_from('<H', data, at)[0]
    at += 2
    bones = []
    for _ in range(count):
        at += 3 + data[at + 2]
        keys = []
        for _ in range(struct.unpack_from('<H', data, at + 8)[0]):
            flags, time = struct.unpack_from('<BH', data, at + 10)
            at += 3
            position = rotation = None
            if flags & 5:
                position = struct.unpack_from('<3f', data, at + 10)
                at += 12
            if flags & 10:
                rotation = struct.unpack_from('<4f', data, at + 10)
                at += 16
            keys.append((time, position, rotation))
        at += 10
        bones.append(keys)
    if at != len(data) or len(bones) != len(BONES):
        raise ValueError('not an animation of this skeleton')
    return bool(kind & 2), length, bones

def between(a, b, share):
    return [x + (y - x) * share for x, y in zip(a, b)]

def turn_between(a, b, share):
    if sum(x * y for x, y in zip(a, b)) < 0:
        b = [-c for c in b]
    return between(a, b, share)

def degrees_apart(a, b):
    same = abs(sum(x * y for x, y in zip(a, b))) / math.sqrt(sum(x * x for x in a) * sum(x * x for x in b))
    return 2 * math.degrees(math.acos(min(1.0, same)))

def thin(keys, apart, mix, limit):
    """Drops the keys that the page can work out from their neighbours, to within `limit`. keys: [(time, value)]."""
    keep = {0, len(keys) - 1}
    spans = [(0, len(keys) - 1)]
    while spans:
        a, b = spans.pop()
        worst, at = 0.0, None
        for i in range(a + 1, b):
            off = apart(mix(keys[a][1], keys[b][1], (keys[i][0] - keys[a][0]) / (keys[b][0] - keys[a][0])), keys[i][1])
            if off > worst:
                worst, at = off, i
        if worst > limit:
            keep.add(at)
            spans += [(a, at), (at, b)]
    if len(keep) == 2 and all(apart(keys[0][1], key[1]) <= limit for key in keys):
        keep = {0}
    return [keys[i] for i in sorted(keep)]

def build_moves(rez, out, which):
    """One file with every move of a set: a JSON header, then 16-bit numbers. A track is its key times in ms
    followed by its values: four numbers per rotation (a quaternion times 32767), three per hip position
    (1/50 cm). Returns the file's name."""
    file = f'moves-{which}.bin'
    if os.path.exists(os.path.join(out, file)):
        return file
    folder, moves = MOVE_SETS[which]
    clips, numbers = {}, []
    def track(keys, scale):
        at = len(numbers)
        numbers.extend(key[0] for key in keys)
        numbers.extend(max(-32767, min(32767, round(c * scale))) for key in keys for c in key[1])
        return [len(keys), at]
    for name, source in moves.items():
        loops, length, bones = animation(rez.read(folder + source + '.ana'))
        turns = []
        for keys in bones:
            unit = [(t, [c / math.sqrt(sum(x * x for x in q)) for c in q]) for t, _, q in keys if q]
            turns.append(track(thin(unit, degrees_apart, turn_between, 0.5), 32767))
        path = track(thin([(t, p) for t, p, _ in bones[1] if p], math.dist, between, 0.15), 50)
        clips[name] = dict(ms=length, loop=loops, turns=turns, path=path)
        print(f'   move {name:10s} {source:24s} {length:5d} ms, {sum(n for n, _ in turns):4d} turns kept')
    text = json.dumps(dict(clips=clips), separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    blob = struct.pack('<%dh' % len(numbers), *numbers)
    open(os.path.join(out, file), 'wb').write(struct.pack('<I', len(text)) + text + blob)
    print(f'{file}: {len(clips)} moves, {4 + len(text) + len(blob)} bytes')
    return file

def nearest_bones(verts, bones):
    """For a body part that names no bones (the neck skin, the shoes): each point follows the bone it is
    nearest to. A bone reaches from its joint to the joints of the bones that hang off it. At a tie the bone
    further out wins, so a shoe follows the foot, not the shin."""
    reach = []
    for i, bone in enumerate(bones):
        if i < 2:
            continue
        ends = [other['joint'] for other in bones if other['parent'] == i and other['joint'] != bone['joint']]
        reach.append((i, bone['joint'], ends or [bone['joint']]))
    def away(p, a, b):
        ab = [b[k] - a[k] for k in range(3)]
        along = sum(ab[k] * ab[k] for k in range(3))
        t = max(0.0, min(1.0, sum((p[k] - a[k]) * ab[k] for k in range(3)) / along)) if along else 0.0
        return sum((p[k] - a[k] - t * ab[k]) ** 2 for k in range(3))
    skin = []
    for v in verts:
        best, least = 0, 1e18
        for i, joint, ends in reach:
            d = min(away(v, joint, end) for end in ends)
            if d <= least + 1e-6:
                best, least = i, d
        skin.append([(best, 1.0)])
    return skin

def place(verts, m):
    out = []
    for x, y, z, nx, ny, nz, u, v in verts:
        out.append((x * m[0][0] + y * m[1][0] + z * m[2][0] + m[3][0], x * m[0][1] + y * m[1][1] + z * m[2][1] + m[3][1], x * m[0][2] + y * m[1][2] + z * m[2][2] + m[3][2],
                    nx * m[0][0] + ny * m[1][0] + nz * m[2][0], nx * m[0][1] + ny * m[1][1] + nz * m[2][1], nx * m[0][2] + ny * m[1][2] + nz * m[2][2], u, v))
    return out

# ---------- textures ----------
def rgb565(c):
    r, g, b = (c >> 11) & 31, (c >> 5) & 63, c & 31
    return ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2))

def texture(data):
    fmt, mips, w, h = struct.unpack_from('<IIHH', data, 0x18)
    body = data[38:]
    px = bytearray(w * h * 4)
    if len(body) >= w * h * 4:
        raw = body[:w * h * 4]
        px[0::4], px[1::4], px[2::4], px[3::4] = raw[2::4], raw[1::4], raw[0::4], raw[3::4]
        return w, h, px
    mode = 1 if (fmt & 0xff) == 0x02 else 3 if (fmt & 0xff) == 0x03 else 5
    step = 8 if mode == 1 else 16
    for by in range(h // 4):
        for bx in range(w // 4):
            block = body[(by * (w // 4) + bx) * step:][:step]
            cblock = block if mode == 1 else block[8:]
            c0, c1, bits = struct.unpack('<HHI', cblock)
            a, b = rgb565(c0), rgb565(c1)
            if mode != 1 or c0 > c1:
                table = [a + (255,), b + (255,), tuple((2 * p + q) // 3 for p, q in zip(a, b)) + (255,), tuple((p + 2 * q) // 3 for p, q in zip(a, b)) + (255,)]
            else:
                table = [a + (255,), b + (255,), tuple((p + q) // 2 for p, q in zip(a, b)) + (255,), (0, 0, 0, 0)]
            if mode == 5:
                a0, a1 = block[0], block[1]
                abits = int.from_bytes(block[2:8], 'little')
                at = [a0, a1] + ([((7 - i) * a0 + i * a1) // 7 for i in range(1, 7)] if a0 > a1 else [((5 - i) * a0 + i * a1) // 5 for i in range(1, 5)] + [0, 255])
                alphas = [at[(abits >> (3 * i)) & 7] for i in range(16)]
            elif mode == 3:
                alphas = [((int.from_bytes(block[:8], 'little') >> (4 * i)) & 15) * 17 for i in range(16)]
            else:
                alphas = None
            for i in range(16):
                r, g, bl, al = table[(bits >> (2 * i)) & 3]
                o = ((by * 4 + i // 4) * w + bx * 4 + i % 4) * 4
                px[o:o + 4] = bytes([r, g, bl, alphas[i] if alphas else al])
    return w, h, px

def png(path, w, h, rgba):
    def chunk(tag, d):
        return struct.pack('>I', len(d)) + tag + d + struct.pack('>I', zlib.crc32(tag + d))
    rows = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b''))

# ---------- one character ----------
def build(name, moa_path, full=False, moves=None):
    """`full` keeps the whole figure, hands included; otherwise only the bust is kept. With `moves` (a set from
    MOVE_SETS) every point also names the bones it follows, so the page can play the game's moves on it."""
    posed = bool(moves)
    moa = rez.read(moa_path)
    # The list is a run of records. A part's record is: mesh id, a material marker, a four-letter material
    # name, then its textures in a fixed order (BASE, SPEC, BUMP, CMAP, DECL) and its tint colors.
    MARK = bytes.fromhex('210200a0')
    events = []
    for i in range(len(moa) - 3):
        rid = struct.unpack_from('<I', moa, i)[0]
        if moa[i + 4:i + 8] == MARK and rid in rez.by_id and rez.name(rid).lower().endswith('.mga'):
            at = i + 4
            ids = {}
            for k, tag in enumerate((b'BASE', b'SPEC', b'BUMP', b'CMAP', b'DECL')):
                if moa[at + 9 + k * 8:at + 13 + k * 8] == tag:
                    tid = struct.unpack_from('<I', moa, at + 13 + k * 8)[0]
                    ids[tag] = tid if tid in rez.by_id else None
            def color(tag):
                found = moa.find(tag + b'\x03', at, at + 140)
                return struct.unpack_from('<3f', moa, found + 5) if found >= 0 else (1.0, 1.0, 1.0)
            events.append(['mesh', rid, rez.name(rid), ids.get(b'BASE'), ids.get(b'CMAP'), i, (moa[at + 4:at + 8].decode('latin-1'), color(b'CMC1'), color(b'CMC2'))])
        elif rid >= 0x01000000 and rid in rez.by_id:
            file = rez.name(rid).lower()
            if file.endswith('.tbl') and ('head' in file or 'hand' in file):
                events.append(['space', 'Head' if 'head' in file else 'Left_hand' if 'handl' in file else 'Right_hand'])
            elif file.endswith('.ska') and not any(e[0] == 'ska' for e in events):
                events.append(['ska', rid])
    ska = next(e[1] for e in events if e[0] == 'ska')
    skeleton = rez.read(ska)
    head = bone_matrix(skeleton, 'Head')
    head_y = head[3][1]
    space, parts, textures = 'body', [], {}
    low, high = 1e9, -1e9
    for e in events:
        if e[0] == 'space':
            space = e[1]
            continue
        if e[0] != 'mesh' or (not full and space not in ('body', 'Head')):
            continue
        if e[3] is None and e[4] is not None:
            guess = rez.by_path.get(rez.by_id[e[4]][2].lower().replace('_alpha.txa', '.txa'))
            e[3] = guess[0] if guess else None
        if e[3] is None and 'eye' in e[2].lower():
            e[3] = rez.by_path['resource/characters/shared/textures/head/eyebrown.txa'][0]
        if e[3] is None:
            print(f'   no texture named for {e[2]}')
            continue
        try:
            verts, idx, skin = mesh(rez.read(e[1]))
        except (ValueError, KeyError, struct.error) as err:
            print(f'   skipped {e[2]}: {err}')
            continue
        if space != 'body':
            verts = place(verts, bone_matrix(skeleton, space))
            # A head or a hand follows one bone as a whole.
            skin = [[(BONES.index(space), 1.0)]] * len(verts)
        elif posed and (skin is None or all(b == 0 for follow in skin for b, _ in follow)):
            skin = nearest_bones(verts, skeleton_of(skeleton))
        if posed:
            # Each point also carries up to four bones and their weights, so the page can pose the figure.
            wide = []
            for v, follow in zip(verts, skin or [[]] * len(verts)):
                follow = sorted(follow, key=lambda f: -f[1])[:4]
                total = sum(w for _, w in follow) or 1.0
                follow = [(b, w / total) for b, w in follow] or [(0, 1.0)]
                follow += [(0, 0.0)] * (4 - len(follow))
                wide.append(tuple(v) + tuple(float(b) for b, _ in follow) + tuple(w for _, w in follow))
            verts = wide
        # keep the bust: triangles that reach above the chest line
        cut = -1e9 if full else head_y - 26
        keep = [t for t in range(0, len(idx), 3) if max(verts[idx[t + k]][1] for k in range(3)) > cut]
        if not keep:
            print(f'   below the bust: {e[2]} (y {min(v[1] for v in verts):.0f}..{max(v[1] for v in verts):.0f})')
            continue
        used = sorted({idx[t + k] for t in keep for k in range(3)})
        low = min(low, min(verts[i][1] for i in used))
        high = max(high, max(verts[i][1] for i in used))
        remap = {old: new for new, old in enumerate(used)}
        tex_name = os.path.splitext(rez.name(e[3]))[0].lower()
        shader, c1, c2 = e[6]
        # The material says whether a part is see-through. Going by the name is wrong: some hair is solid.
        cutout = shader in ('ALPH', 'PSCA')
        plain = shader[:2] in ('SK', 'SC') or shader in ('ALPH', 'LEFL', 'DEFA')
        key = (e[3], cutout, None if plain else (shader, c1, c2, e[4]))
        if key not in textures:
            w, h, px = texture(rez.read(e[3]))
            if not plain:
                # The game colors cloth per material: one or two tints, placed by a mask.
                mask = texture(rez.read(e[4])) if e[4] else None
                for y in range(h):
                    for x in range(w):
                        o = (y * w + x) * 4
                        if mask:
                            mo = ((y * mask[1] // h) * mask[0] + x * mask[0] // w) * 4
                            first, second = mask[2][mo] / 255, mask[2][mo + 3] / 255
                            t = [(1 + (c1[k] - 1) * first) * (1 - second) + c2[k] * second for k in range(3)]
                        else:
                            t = c1
                        for k in range(3):
                            px[o + k] = min(255, int(px[o + k] * t[k]))
            cutout = cutout and min(px[3::4]) < 128
            if not cutout:
                px[3::4] = b'\xff' * (w * h)
            tex_name = tex_name if plain else f'{name}_{tex_name}'
            file = f'{tex_name}.{"png" if cutout else "jpg"}'
            side = 128 if cutout or max(w, h) <= 128 else 256
            if cutout:
                # See-through textures are shrunk here, weighting each color by how solid it is. Otherwise the
                # color of the empty parts (often white) leaks into the hair. They are then copied as they are.
                while max(w, h) > side:
                    small = bytearray((w // 2) * (h // 2) * 4)
                    for y in range(h // 2):
                        for x in range(w // 2):
                            four = [((2 * y + dy) * w + 2 * x + dx) * 4 for dy in (0, 1) for dx in (0, 1)]
                            solid = sum(px[o + 3] for o in four)
                            o2 = (y * (w // 2) + x) * 4
                            for k in range(3):
                                small[o2 + k] = sum(px[o + k] * px[o + 3] for o in four) // solid if solid else 0
                            small[o2 + 3] = solid // 4
                    w, h, px = w // 2, h // 2, small
                for o in range(0, len(px), 4):
                    if px[o + 3] == 0:
                        px[o:o + 3] = b'\0\0\0'
                side = 0
            png(os.path.join(OUT, 'textures', f'{tex_name}.png'), w, h, px)
            MANIFEST[file] = (f'{tex_name}.png', side)
            textures[key] = (file, w, h, cutout)
        parts.append(dict(mesh=e[2], space=space, tex=textures[key][0], alpha=textures[key][3], verts=[verts[i] for i in used], idx=[remap[idx[t + k]] for t in keep for k in range(3)]))
        print(f'   {space:4s} {e[2]:24s} {shader} points {len(used):4d} tris {len(keep):4d} texture {textures[key][0]}')
    # one binary file: a JSON header, then all numbers as 32-bit floats and 16-bit indices
    header = dict(headY=round(head_y, 2), headZ=round(head[3][2], 2), parts=[])
    if full:
        header.update(full=True, low=round(low, 1), high=round(high, 1))
    if posed:
        # The skeleton and the file of moves, for the page to pose the model with.
        bones = skeleton_of(skeleton)
        header.update(bones=bones, floatsPerPoint=16, moves=build_moves(rez, OUT, moves), lift=round(bones[1]['joint'][1] - HIPS_OF_A_MAN, 2))
    blob = b''
    for p in parts:
        flat = [c for v in p['verts'] for c in v]
        header['parts'].append(dict(tex=p['tex'], alpha=p['alpha'], points=len(p['verts']), indices=len(p['idx']), floats=len(blob), ))
        blob += struct.pack('<%df' % len(flat), *flat)
        header['parts'][-1]['shorts'] = len(blob)
        blob += struct.pack('<%dH' % len(p['idx']), *p['idx'])
        blob += b'\0' * (-len(blob) % 4)
    text = json.dumps(header, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    open(os.path.join(OUT, f'{name}.bin'), 'wb').write(struct.pack('<I', len(text)) + text + blob)
    print(f'{name}: {len(parts)} parts, {sum(len(p["verts"]) for p in parts)} points, {4 + len(text) + len(blob)} bytes, head at y {head_y:.1f}')

for item in sys.argv[3:]:
    name, path = item.split('=', 1)
    # "name:full:regal=..." keeps the whole figure and gives it the regal moves. "name:bust:woman=..." keeps
    # the bust and gives it a woman's moves. A plain "name=..." is a bust that only turns as a whole.
    name, _, options = name.partition(':')
    kind, _, moves = options.partition(':')
    print(name, path)
    build(name, path, kind == 'full', moves or None)
with open(os.path.join(OUT, 'textures.txt'), 'w') as f:
    for file, (source, side) in sorted(MANIFEST.items()):
        f.write(f'{file} {source} {side}\n')
