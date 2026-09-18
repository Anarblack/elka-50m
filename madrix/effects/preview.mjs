// Грубый транслятор MAS → JS + заглушки API MADRIX, чтобы посмотреть кадры эффектов.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const DIR = new URL('.', import.meta.url).pathname;
const W = 240, H = 200, T = [2.5, 6.0];
function transpile(src){
  let s = src.replace(/\r/g, '').split('\n').filter(l => !l.startsWith('@')).join('\n');
  s = s.replace(/const\s+(float|int)\s+/g, 'const ');
  s = s.replace(/^color\s+col;/m, 'let col = {r:0,g:0,b:0};');
  s = s.replace(/\b(float|int)\s+(\w+)\[\];/g, 'let $2 = [];');
  s = s.replace(/^(float|void|int)\s+(\w+)\(([^)]*)\)\s*\n?\s*\{/gm, (m, t, name, params) =>
    `function ${name}(${params.split(',').map(p => p.trim().split(/\s+/).pop()).filter(Boolean).join(', ')}) {`);
  s = s.replace(/\b(float|int)\s+(?=[A-Za-z_]\w*\s*(=|;|,))/g, 'let ');
  return s;
}
const png = (w, h, rgb) => {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for(const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const raw = Buffer.alloc((w*3 + 1)*h);
  for(let y = 0; y < h; y++){ raw[y*(w*3 + 1)] = 0; rgb.copy(raw, y*(w*3 + 1) + 1, y*w*3, (y + 1)*w*3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const files = readdirSync(DIR).filter(f => f.endsWith('.mas')).sort();
const GAP = 6, OW = files.length*(W + GAP), OH = T.length*(H + GAP);
const out = Buffer.alloc(OW*OH*3, 40);
files.forEach((f, fi) => T.forEach((t, ti) => {
  const buf = Buffer.alloc(W*H*3);
  const api = {
    GetMatrixWidth: () => W, GetMatrixHeight: () => H, GetEffectTime: () => Math.round(t*1000),
    SetPixel: (c, x, y) => { if(x < 0 || y < 0 || x >= W || y >= H) throw new Error(`SetPixel вне матрицы ${x},${y}`); const o = (y*W + x)*3; buf[o] = c.r; buf[o+1] = c.g; buf[o+2] = c.b; },
    BLACK: {r:0,g:0,b:0}, sin: Math.sin, cos: Math.cos, sqrt: Math.sqrt, pow: Math.pow, abs: Math.abs, round: Math.round,
    fmod: (a, b) => a % b, fmax: Math.max, fmin: Math.min, fclamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  };
  const js = transpile(readFileSync(`${DIR}/${f}`, 'utf8'));
  const run = new Function(...Object.keys(api), `${js}\nreturn { InitEffect, RenderEffect };`)(...Object.values(api));
  run.InitEffect(); run.RenderEffect();
  for(let y = 0; y < H; y++) buf.copy(out, ((ti*(H + GAP) + y)*OW + fi*(W + GAP))*3, y*W*3, (y + 1)*W*3);
  let lit = 0; for(let i = 0; i < buf.length; i++) if(buf[i] > 60) lit++;
  if(ti === 0) console.log(f.padEnd(28), 'ok, ярких каналов', lit);
}));
writeFileSync(DIR + 'preview.png', png(OW, OH, out));
