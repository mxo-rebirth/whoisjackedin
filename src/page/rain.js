// The falling code behind the header: mirrored katakana and digits, as in the game, drawn as real text
// so it stays sharp on any screen. A device with no Japanese font gets the digits and signs only.
import { $ } from './dom.js';
import { fade, INK, stillPage, token } from './look.js';

export function startRain() {
  const canvas = $('rain');
  const ctx = canvas.getContext('2d');
  const CELL = 16;
  const KANA = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜﾝ';
  const PLAIN = '0123456789Z:.=*+-<>|';
  const FONT = `bold ${CELL}px "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", Meiryo, "MS Gothic", "Noto Sans CJK JP", "Noto Sans JP", monospace`;
  let drops = [];
  let w = 0;
  let h = 0;

  /** True when this device can draw katakana. Without a font for it, every glyph comes out as the same box. */
  const hasKana = () => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const look = (text) => {
      probe.clearRect(0, 0, 24, 24);
      probe.font = FONT;
      probe.fillText(text, 2, 18);
      return probe.getImageData(0, 0, 24, 24).data.join('');
    };
    return look('ﾊ') !== look('ﾘ') && look('ﾊ') !== look('\uffff');
  };

  const GLYPHS = hasKana() ? KANA + PLAIN : PLAIN;

  const resize = () => {
    const scale = Math.min(3, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * scale;
    canvas.height = h * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drops = Array.from({ length: Math.ceil(w / CELL) }, () => ({ row: Math.random() * -30 }));
  };
  /** One glyph, flipped left to right inside its cell. */
  const glyph = (column, row, color) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.translate((column + 1) * CELL, 0);
    ctx.scale(-1, 1);
    ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], CELL / 2, (row + 1) * CELL - 3);
    ctx.restore();
  };
  const step = () => {
    ctx.fillStyle = fade(INK.page, 0.09);
    ctx.fillRect(0, 0, w, h);
    ctx.font = FONT;
    ctx.textAlign = 'center';
    drops.forEach((drop, i) => {
      const row = Math.floor(drop.row);
      if (row >= 0) {
        // The glyph behind the newest one settles to green. The newest is nearly white.
        if (row > 0) {
          ctx.fillStyle = INK.page;
          ctx.fillRect(i * CELL, (row - 1) * CELL, CELL, CELL);
          glyph(i, row - 1, token('--rain'));
        }
        glyph(i, row, token('--rain-head'));
      }
      drop.row += 1;
      if (drop.row * CELL > h && Math.random() > 0.96) drop.row = 0;
    });
  };
  const run = () => {
    resize();
    window.addEventListener('resize', resize);
    // With reduced motion, draw one still frame and stop.
    if (stillPage) {
      Array.from({ length: 40 }).forEach(() => step());
      return;
    }
    let timer = setInterval(step, 75);
    document.addEventListener('visibilitychange', () => {
      clearInterval(timer);
      if (!document.hidden) timer = setInterval(step, 75);
    });
  };

  run();
}
