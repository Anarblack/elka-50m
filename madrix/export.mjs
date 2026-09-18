// Экспорт пикселей ёлки для MADRIX 5 (Patch Editor → File → Import Fixture List…).
// Координаты берутся из того же генератора, что и 3D-модель: блок <script id="treegen"> в ../index.html.
//
//   node madrix/export.mjs [--H 50] [--D 18] [--tier 1.4] [--pitch 0.15] [--zone 3]
//                          [--voxel 0.3] [--cols 240] [--rows 200] [--front 51.5]
//
// --front — азимут главной точки обзора в градусах (как в модели: 0° = +X, 90° = +Z).
// Эта сторона ёлки будет в центре 2D-развёртки и спереди (Z = 1) в 3D.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const src = html.match(/<script id="treegen">([\s\S]*?)<\/script>/)?.[1];
if(!src) throw new Error('В index.html не найден блок <script id="treegen">');
const { generateTree, planPatch } = new Function(`${src}\nreturn { generateTree, planPatch };`)();

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, +v]));
const P = { H: 50, D: 18, tier: 1.4, pitch: 0.15, zone: 3, quality: 'high', ...pick(args, ['H', 'D', 'tier', 'pitch', 'zone']) };
const VOXEL = args.voxel ?? 0.3, COLS = args.cols ?? 240, ROWS = args.rows ?? 200;
const FRONT = (args.front ?? Math.atan2(78, 62)*180/Math.PI)*Math.PI/180;   // по умолчанию — стартовый ракурс модели
function pick(o, keys){ return Object.fromEntries(keys.filter(k => Number.isFinite(o[k])).map(k => [k, o[k]])); }

const gen = generateTree(P);
const patch = planPatch(gen);
const n = gen.rnd.length;

// Системы координат MADRIX: X слева направо, Y сверху вниз, Z спереди назад, всё с 1.
const f = [Math.cos(FRONT), Math.sin(FRONT)];          // от ёлки к зрителю (плоскость XZ модели)
const right = [f[1], -f[0]];                           // вправо для зрителя
const px = i => gen.px[i*3], py = i => gen.px[i*3 + 1], pz = i => gen.px[i*3 + 2];

// 2D: цилиндрическая развёртка, фронт в центре, шов сзади
const map2d = new Int32Array(n*2);
for(let i = 0; i < n; i++){
  let rel = Math.atan2(pz(i), px(i)) - FRONT;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const col = Math.min(COLS, Math.max(1, Math.floor((-rel/(2*Math.PI) + 0.5)*COLS) + 1));
  const row = Math.min(ROWS, Math.max(1, Math.floor((gen.H - py(i))/gen.H*ROWS) + 1));
  map2d[i*2] = col; map2d[i*2 + 1] = row;
}

// 3D: вокселы, повернутые так, чтобы фронт смотрел на зрителя MADRIX
const u = new Float32Array(n), d = new Float32Array(n);
let uMin = Infinity, dMax = -Infinity, yMax = -Infinity;
for(let i = 0; i < n; i++){
  u[i] = px(i)*right[0] + pz(i)*right[1];
  d[i] = px(i)*f[0] + pz(i)*f[1];
  uMin = Math.min(uMin, u[i]); dMax = Math.max(dMax, d[i]); yMax = Math.max(yMax, py(i));
}
const map3d = new Int32Array(n*3);
for(let i = 0; i < n; i++){
  map3d[i*3] = Math.floor((u[i] - uMin)/VOXEL) + 1;
  map3d[i*3 + 1] = Math.floor((yMax - py(i))/VOXEL) + 1;
  map3d[i*3 + 2] = Math.floor((dMax - d[i])/VOXEL) + 1;
}

// Имена: T05-B0123-P007 — ярус, ветка, номер пикселя в ветке; звезда — STAR1/STAR2
const inBranch = new Int32Array(n);
const names = new Array(n);
for(const b of gen.branches){
  for(let k = 0; k < b.count; k++){
    const i = b.start + k;
    inBranch[i] = k + 1;
    names[i] = b.star ? `STAR${b.id - gen.stats.branches + 1}-P${pad(k + 1, 3)}`
                      : `T${pad(b.tier + 1, 2)}-B${pad(b.id + 1, 4)}-P${pad(k + 1, 3)}`;
  }
}
function pad(v, w){ return String(v).padStart(w, '0'); }

const PRODUCT = 'Pixel RGB 12mm';
const MADRIX_HEAD = 'Product,Display Name,Fixture ID,Position X,Position Y,Position Z,DMX Universe,DMX Channel';
const rows2d = [MADRIX_HEAD], rows3d = [MADRIX_HEAD];
for(let i = 0; i < n; i++){
  const tail = `${patch.uni[i]},${patch.ch[i]}`;
  rows2d.push(`${PRODUCT},${names[i]},${i + 1},${map2d[i*2]},${map2d[i*2 + 1]},1,${tail}`);
  rows3d.push(`${PRODUCT},${names[i]},${i + 1},${map3d[i*3]},${map3d[i*3 + 1]},${map3d[i*3 + 2]},${tail}`);
}

const KIND = ['branch', 'twig', 'star'];
const rowsM = ['id,name,x_m,y_m,z_m,angle_deg,tier,branch,kind,pixel_in_branch,controller,controller_port,port,universe,channel'];
for(let i = 0; i < n; i++){
  const b = gen.branches[gen.owner[i]], p = patch.ports[patch.port[i]];
  const ang = ((Math.atan2(pz(i), px(i))*180/Math.PI) + 360) % 360;
  rowsM.push([i + 1, names[i], px(i).toFixed(3), py(i).toFixed(3), pz(i).toFixed(3), ang.toFixed(1),
    b.star ? '' : b.tier + 1, b.id + 1, KIND[gen.kind[i]], inBranch[i], p.ctrl, p.portInCtrl, p.index + 1, patch.uni[i], patch.ch[i]].join(','));
}

const rowsP = ['controller,controller_port,port,universe_first,universe_last,pixels,type,tiers,branches'];
for(const p of patch.ports){
  rowsP.push([p.ctrl, p.portInCtrl, p.index + 1, p.uniFirst, p.uniLast, p.count, p.star ? 'star' : 'tree',
    p.star ? '' : `${p.tierMin + 1}-${p.tierMax + 1}`, `${p.branchMin + 1}-${p.branchMax + 1}`].join(','));
}

const files = {
  'elka50_madrix_2d_cylinder.csv': rows2d,
  'elka50_madrix_3d.csv': rows3d,
  'elka50_pixels_meters.csv': rowsM,
  'elka50_ports.csv': rowsP,
};
for(const [name, rows] of Object.entries(files)) writeFileSync(join(here, name), rows.join('\r\n') + '\r\n', 'utf8');

// ---------- самопроверка: читаем MADRIX-файлы обратно ----------
function check(name, dims){
  const lines = readFileSync(join(here, name), 'utf8').trim().split(/\r?\n/);
  if(lines[0] !== MADRIX_HEAD) throw new Error(`${name}: неверный заголовок`);
  const seen = new Set(), cells = new Map(), perPort = new Map();
  let maxX = 0, maxY = 0, maxZ = 0;
  for(const line of lines.slice(1)){
    const c = line.split(',');
    if(c.length !== 8) throw new Error(`${name}: ${c.length} колонок в строке «${line}»`);
    const [x, y, z, uni, ch] = c.slice(3).map(Number);
    if(![x, y, z, uni, ch].every(Number.isInteger) || x < 1 || y < 1 || z < 1) throw new Error(`${name}: плохие числа «${line}»`);
    if(ch < 1 || ch > 508 || (ch - 1) % 3) throw new Error(`${name}: канал ${ch} вне RGB-сетки`);
    const key = `${uni}/${ch}`;
    if(seen.has(key)) throw new Error(`${name}: адрес ${key} занят дважды`);
    seen.add(key);
    const port = Math.floor((uni - 1)/4);
    perPort.set(port, (perPort.get(port) || 0) + 1);
    const cell = `${x}/${y}/${z}`;
    cells.set(cell, (cells.get(cell) || 0) + 1);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const over = [...perPort.values()].filter(v => v > 680).length;
  if(over) throw new Error(`${name}: ${over} портов больше 680 пикселей`);
  if(lines.length - 1 !== n) throw new Error(`${name}: ${lines.length - 1} строк вместо ${n}`);
  const shared = [...cells.values()].filter(v => v > 1).reduce((s, v) => s + v, 0);
  return { size: `${maxX}×${maxY}${dims === 3 ? '×' + maxZ : ''}`, cells: cells.size, shared };
}
const c2 = check('elka50_madrix_2d_cylinder.csv', 2);
const c3 = check('elka50_madrix_3d.csv', 3);

const fmt = v => v.toLocaleString('ru-RU');
console.log(`Ёлка ${P.H} м, Ø${P.D} м, шаг ${P.pitch*100} см, зона ${P.zone} м`);
console.log(`Пикселей: ${fmt(n)} (ёлка ${fmt(gen.stats.treePixels)}, звезда ${fmt(gen.stats.starPixels)}), веток ${fmt(gen.stats.branches)}, ярусов ${gen.stats.tiers}`);
console.log(`Патч: портов ${patch.ports.length}, юниверсов ${patch.universes} (номера 1…${patch.ports.at(-1).uniLast}), контроллеров по 16 портов: ${patch.controllers}`);
console.log(`2D-развёртка: сетка ${c2.size}, занято ячеек ${fmt(c2.cells)}, пикселей в общих ячейках ${fmt(c2.shared)}`);
console.log(`3D-вокселы ${VOXEL} м: сетка ${c3.size}, занято ${fmt(c3.cells)}, пикселей в общих вокселах ${fmt(c3.shared)}`);
console.log(`Проверка пройдена: адреса уникальны, каналы в сетке RGB, порты ≤ 680, координаты ≥ 1. Файлы — в ${here}`);
