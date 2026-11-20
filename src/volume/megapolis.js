// «Объём»: фон «Мегаполис» — таблицы и кисти (правка без автопилота, 2026-11-20).
//
// Слова заказчика: «спроектировал новый вид фона "Мегаполис" — что-то типо
// такого» — и снимок большого города с высоты на закате: вдали плотная группа
// стеклянных небоскрёбов, ближе сплошная застройка, улицы.
//
// Модуль стоит **ниже** `backdrop.js` и о нём не знает: тот зовёт эти кисти и
// передаёт им свою проекцию (`point` — `volumeGroundPoint` с прицелом внутри) и
// правило светящихся окон (`lit` — `volumeCityWindowLit`). Иначе получился бы
// круг: фону нужны кисти, кистям — проекция фона. Таблицы здесь — **числа в
// метрах и градусах**; в места на земле их переводит `backdrop.js` теми же
// руками, что свои (`volumeAway`, `volumeBandNodes`), и отодвигает тем же
// множителем (`volumeBackdropPush`).
//
// ——— как это стоит кадру ———
//
// Нынешний «Город» рисует окно ближнего дома своим `fillRect` — полтораста
// заливок на дом. Здесь домов втрое больше, и приём другой: **все полосы
// остекления одной стены — один путь и одна заливка**, все светящиеся окна
// стены — второй путь и вторая заливка. Дом стоит семь заливок при любой
// этажности (две стены × стена, стекло, свет — и крыша), башня дальнего плана —
// четыре. Узнаваемых зданий здесь нет нарочно: это «большой город», а не
// открытка.

/** Высота этажа и шаг секции дома мегаполиса: по ним считается сетка окон. */
export const VOLUME_MEGA_FLOOR_MM = 3400;
export const VOLUME_MEGA_BAY_MM = 3600;
/** Этаж ниже этого на экране полосами не рисуется: полоса тоньше точки — шум. */
export const VOLUME_MEGA_BAND_PX = 1.6;
/** Окно у́же этого на экране поимённо не зажигается. */
export const VOLUME_MEGA_WINDOW_PX = 1.2;
/** Сколько окон стены проверяется на свет самое большее: дальше — через этаж. */
export const VOLUME_MEGA_LIT_MAX = 700;

/** Тона домов: бетон, стекло, панель, кирпич. Краски — в палитре часа. */
export const VOLUME_MEGA_TONES = Object.freeze(["concrete", "glass", "panel", "brick"]);

// Постоянный «случай» таблиц: одно и то же число для одной и той же пары —
// расстановка не меняется от запуска к запуску и от машины к машине.
function megaHash(index, salt) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Деловой кластер и малый кластер напротив: башни дальнего плана, силуэтами.
 * `[азимут°, дальность м, полуширина м, высота м, форма]`.
 *
 * Большой стоит в створе главного проспекта (азимут 30°) в 2,6–3,8 км: с земли
 * он виден над крышами, с высоты — целиком. Малый — напротив, чтобы город не
 * кончался в окне, которое смотрит в другую сторону.
 */
export const VOLUME_MEGA_TOWERS = Object.freeze([
  [14, 3300, 34, 230, "slab"],
  [18, 2900, 30, 300, "taper"],
  [22, 3600, 38, 190, "step"],
  [25, 2700, 26, 340, "spire"],
  [28, 3100, 32, 260, "wedge"],
  [31, 2650, 28, 372, "taper"],
  [34, 3400, 36, 210, "slab"],
  [37, 2800, 27, 310, "lean"],
  [40, 3200, 34, 250, "step"],
  [43, 2950, 25, 285, "spire"],
  [46, 3700, 40, 170, "slab"],
  [49, 3050, 30, 225, "wedge"],
  [52, 3500, 33, 195, "taper"],
  [205, 3400, 30, 180, "slab"],
  [210, 3000, 26, 250, "taper"],
  [215, 3300, 30, 205, "step"],
  [220, 2900, 24, 270, "spire"],
  [226, 3500, 32, 165, "wedge"],
]);

/**
 * Силуэт башни уровнями: `{z, l, r}` — доля высоты и левый с правым краем в
 * долях полуширины (−1…1). Тело — многоугольник по левым краям вверх и по
 * правым вниз; теневая половина и блик стекла — полосы по тем же уровням.
 */
export function volumeMegaLevels(shape) {
  if (shape === "taper") return [{ z: 0, l: -1, r: 1 }, { z: 1, l: -0.55, r: 0.55 }];
  if (shape === "step") {
    return [
      { z: 0, l: -1, r: 1 },
      { z: 0.56, l: -1, r: 1 },
      { z: 0.56, l: -0.7, r: 0.7 },
      { z: 0.82, l: -0.7, r: 0.7 },
      { z: 0.82, l: -0.42, r: 0.42 },
      { z: 1, l: -0.42, r: 0.42 },
    ];
  }
  if (shape === "spire") {
    return [
      { z: 0, l: -0.9, r: 0.9 },
      { z: 0.84, l: -0.9, r: 0.9 },
      { z: 0.9, l: -0.3, r: 0.3 },
      { z: 0.9, l: -0.06, r: 0.06 },
      { z: 1, l: -0.02, r: 0.02 },
    ];
  }
  if (shape === "wedge") return [{ z: 0, l: -1, r: 1 }, { z: 0.78, l: -1, r: 1 }, { z: 1, l: -1, r: -0.2 }];
  if (shape === "lean") return [{ z: 0, l: -1, r: 0.8 }, { z: 1, l: -0.5, r: 1 }];
  return [{ z: 0, l: -1, r: 1 }, { z: 1, l: -1, r: 1 }];
}

/**
 * Две гряды крыш по всему кругу — застройка, слившаяся в зубчатую кромку.
 * `rises` — высоты в метрах через равные доли круга; рисуются **ступенями**, а
 * не скатами: кромка города плоская и угловатая, этим она и отличается от
 * холмов «Природы».
 */
export const VOLUME_MEGA_SKYLINE = Object.freeze([
  { far: true, awayM: 1900, rises: Array.from({ length: 72 }, (unused, index) => 26 + Math.round(megaHash(index, 1) * 46)) },
  { far: false, awayM: 1150, rises: Array.from({ length: 60 }, (unused, index) => 18 + Math.round(megaHash(index, 2) * 34)) },
]);

/** Проспекты, кольцевая и река: `{widthM, river?, points: [[азимут°, дальность м]]}`. */
export const VOLUME_MEGA_STREETS = Object.freeze([
  // Главный проспект — в створ делового кластера.
  { widthM: 26, points: [[30, 46], [30, 120], [30, 260], [30, 520], [30, 1000], [30, 1700]] },
  // Поперечный: две половины по разные стороны от дома.
  { widthM: 20, points: [[122, 52], [121, 130], [120, 300], [120, 620], [120, 1100]] },
  { widthM: 20, points: [[302, 52], [301, 130], [300, 300], [300, 620], [300, 1100]] },
  // Кольцевая в двухстах метрах.
  { widthM: 18, points: Array.from({ length: 25 }, (unused, index) => [index * 15, 212]) },
  // Река с набережной — дугой по одной стороне.
  { widthM: 70, river: true, points: [[150, 900], [165, 640], [182, 520], [200, 470], [220, 500], [240, 620], [256, 880]] },
]);

const MEGA_AVENUES_AZ = [30, 120, 300];

function megaOffStreet(az, away) {
  if (away > 196 && away < 230) return false;
  for (const street of MEGA_AVENUES_AZ) {
    const gap = Math.abs(((az - street + 540) % 360) - 180);
    // Чем ближе дом, тем шире в градусах сама улица.
    if (gap < 4 + 600 / away) return false;
  }
  // Русло реки.
  if (az > 145 && az < 262 && away > 420 && away < 960) return false;
  return true;
}

/**
 * Дома: `[азимут°, дальность м, полуширина м, глубина м, высота м, тон]`.
 *
 * Ближний ряд писан рукой — это то, что видно в окно первым: три стеклянные
 * башни выше любой квартиры и дома через улицу. Средний план — кварталы по
 * всему кругу, расставленные постоянным «случаем» мимо улиц и реки; в секторе
 * 90–190° — спальный район из панельных пластин.
 */
export const VOLUME_MEGA_BLOCKS = Object.freeze([
  [8, 96, 13, 22, 172, 1],
  [58, 118, 16, 18, 48, 0],
  [86, 84, 12, 14, 36, 3],
  [146, 104, 22, 13, 62, 2],
  [178, 132, 15, 24, 214, 1],
  [226, 92, 14, 15, 42, 0],
  [262, 126, 18, 14, 54, 3],
  [332, 108, 14, 20, 148, 1],
  [350, 150, 20, 13, 44, 0],
  ...Array.from({ length: 120 }, (unused, index) => {
    const az = (index * 360) / 120 + (megaHash(index, 3) - 0.5) * 3;
    const away = 245 + megaHash(index, 4) * 600;
    const panel = az > 90 && az < 190;
    const tall = megaHash(index, 5);
    const height = panel ? 52 + tall * 28 : 16 + tall * tall * 70;
    const tone = panel ? 2 : megaHash(index, 6) < 0.2 ? 1 : megaHash(index, 6) < 0.62 ? 0 : 3;
    return megaOffStreet(az, away)
      ? [az, Math.round(away), Math.round(panel ? 20 + megaHash(index, 7) * 10 : 10 + megaHash(index, 7) * 12), Math.round(12 + megaHash(index, 8) * 6), Math.round(height), tone]
      : null;
  }).filter(Boolean),
]);

/** Машины у главного проспекта и деревья вдоль него: `[азимут°, дальность м, высота м]`. */
export const VOLUME_MEGA_CARS = Object.freeze([
  [20, 60, 1.5],
  [22, 68, 1.6],
  [24, 78, 1.5],
  [37, 64, 2.9],
  [39, 82, 1.6],
  [41, 100, 1.5],
  [112, 70, 1.6],
  [128, 88, 2.9],
  [294, 74, 1.5],
  [308, 96, 1.6],
]);

export const VOLUME_MEGA_GREENS = Object.freeze([
  [15, 54, 8],
  [45, 58, 9],
  [70, 62, 7],
  [104, 60, 8],
  [138, 66, 9],
  [200, 58, 7],
  [246, 64, 9],
  [282, 60, 8],
  [318, 56, 7],
  [344, 70, 9],
]);

// Точка стены по долям: `fx` — вдоль верхней кромки, `fy` — сверху вниз.
function megaSpot(left, right, footLeft, footRight, fx, fy) {
  const topX = left.x + (right.x - left.x) * fx;
  const topY = left.y + (right.y - left.y) * fx;
  const lowX = footLeft.x + (footRight.x - footLeft.x) * fx;
  const lowY = footLeft.y + (footRight.y - footLeft.y) * fx;
  return { x: topX + (lowX - topX) * fy, y: topY + (lowY - topY) * fy };
}

function megaQuad(ctx, a, b, c, d) {
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
}

/** Краски дома по его тону: стена, бок, полосы остекления, крыша. */
export function volumeMegaPaint(palette, tone) {
  const mega = palette.mega;
  if (tone === 1) return { wall: mega.glass, side: mega.glassSide, band: mega.glassBand, roof: mega.roof };
  if (tone === 2) return { wall: mega.panel, side: mega.panelSide, band: palette.glass, roof: mega.roof };
  if (tone === 3) return { wall: mega.brick, side: mega.brickSide, band: palette.glass, roof: mega.roof };
  return { wall: palette.wall, side: palette.wallSide, band: palette.glass, roof: palette.roof };
}

/**
 * Дом мегаполиса — коробка: до двух видимых стен и крыша.
 *
 * `point(x, y, z)` — проекция фона, `at` — место камеры в плане, `lit(seed,
 * floor, bay, share)` — светится ли окно. Число заливок не зависит от
 * этажности — см. шапку.
 */
export function volumeDrawMegaBlock(ctx, point, at, block, index, hour, lit) {
  const paint = volumeMegaPaint(hour.palette, block.tone);
  const len = Math.hypot(block.x, block.y) || 1;
  const fx = block.x / len;
  const fy = block.y / len;
  const ux = -fy;
  const uy = fx;
  const deep = block.deepMm / 2;
  const corner = (alongSign, deepSign) => ({
    x: block.x + ux * block.halfMm * alongSign + fx * deep * deepSign,
    y: block.y + uy * block.halfMm * alongSign + fy * deep * deepSign,
  });
  const plan = [corner(1, -1), corner(-1, -1), corner(-1, 1), corner(1, 1)];
  const wides = [block.halfMm * 2, block.deepMm, block.halfMm * 2, block.deepMm];
  const shown = [];
  for (let side = 0; side < 4; side += 1) {
    const from = plan[side];
    const to = plan[(side + 1) % 4];
    // Обход коробки по кругу: наружу смотрит правый перпендикуляр ребра.
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    if ((to.y - from.y) * (at.x - mx) - (to.x - from.x) * (at.y - my) <= 0) continue;
    const left = point(from.x, from.y, block.heightMm);
    const right = point(to.x, to.y, block.heightMm);
    const footLeft = point(from.x, from.y, 0);
    const footRight = point(to.x, to.y, 0);
    if (!left || !right || !footLeft || !footRight) continue;
    shown.push({ side, wide: wides[side], left, right, footLeft, footRight, depth: Math.hypot(mx - at.x, my - at.y) });
  }
  if (shown.length === 0) return;
  shown.sort((one, two) => two.depth - one.depth);
  const share = hour.cityLit;
  for (const wall of shown) {
    const { left, right, footLeft, footRight } = wall;
    // Ближняя из двух стен — лицо, дальняя — бок: бок темнее.
    ctx.fillStyle = wall === shown[shown.length - 1] ? paint.wall : paint.side;
    ctx.beginPath();
    megaQuad(ctx, left, right, footRight, footLeft);
    ctx.fill();
    const tall = Math.max(Math.abs(footLeft.y - left.y), Math.abs(footRight.y - right.y));
    const floorPx = tall / block.floors;
    if (floorPx < VOLUME_MEGA_BAND_PX) continue;
    const pad = 0.04;
    const cellY = (1 - pad * 2) / block.floors;
    // Остекление — полоса на этаж, все полосы стены одним путём.
    ctx.fillStyle = paint.band;
    ctx.beginPath();
    for (let floor = 0; floor < block.floors; floor += 1) {
      const top = pad + cellY * (floor + 0.2);
      const low = top + cellY * 0.56;
      megaQuad(
        ctx,
        megaSpot(left, right, footLeft, footRight, pad, top),
        megaSpot(left, right, footLeft, footRight, 1 - pad, top),
        megaSpot(left, right, footLeft, footRight, 1 - pad, low),
        megaSpot(left, right, footLeft, footRight, pad, low),
      );
    }
    ctx.fill();
    if (!(share > 0)) continue;
    const bays = Math.max(2, Math.round(wall.wide / VOLUME_MEGA_BAY_MM));
    const across = Math.hypot(right.x - left.x, right.y - left.y) / bays;
    if (across < VOLUME_MEGA_WINDOW_PX) continue;
    const cellX = (1 - pad * 2) / bays;
    // Светящиеся окна — вторым путём. На очень большой стене проверяется
    // каждый второй этаж: зажжённых от этого вдвое меньше, а заливка та же.
    const step = block.floors * bays > VOLUME_MEGA_LIT_MAX ? 2 : 1;
    const seed = index * 4 + wall.side;
    let any = false;
    ctx.beginPath();
    for (let floor = 0; floor < block.floors; floor += step) {
      const top = pad + cellY * (floor + 0.2);
      const low = top + cellY * 0.56;
      for (let bay = 0; bay < bays; bay += 1) {
        if (!lit(seed, floor, bay, share)) continue;
        const from = pad + cellX * (bay + 0.14);
        const to = from + cellX * 0.72;
        megaQuad(
          ctx,
          megaSpot(left, right, footLeft, footRight, from, top),
          megaSpot(left, right, footLeft, footRight, to, top),
          megaSpot(left, right, footLeft, footRight, to, low),
          megaSpot(left, right, footLeft, footRight, from, low),
        );
        any = true;
      }
    }
    if (any) {
      ctx.fillStyle = hour.palette.mega.light;
      ctx.fill();
    }
  }
  // Крыша видна сверху — с высокого этажа город и состоит из крыш.
  const top = plan.map((spot) => point(spot.x, spot.y, block.heightMm));
  if (top.every(Boolean)) {
    ctx.fillStyle = paint.roof;
    ctx.beginPath();
    megaQuad(ctx, top[0], top[1], top[2], top[3]);
    ctx.fill();
  }
}

/**
 * Башня дальнего плана — **силуэт поперёк взгляда**: тело, теневая половина,
 * блик стекла и ночные огни. С трёх километров объём не читается, а плоскость
 * стоит четыре заливки вместо семи.
 */
export function volumeDrawMegaTower(ctx, point, tower, index, hour, lit) {
  const mega = hour.palette.mega;
  const len = Math.hypot(tower.x, tower.y) || 1;
  const ux = -tower.y / len;
  const uy = tower.x / len;
  const levels = volumeMegaLevels(tower.shape);
  const spot = (fraction, z) => point(tower.x + ux * tower.halfMm * fraction, tower.y + uy * tower.halfMm * fraction, tower.heightMm * z);
  // Полоса силуэта между долями `from`…`to` его ширины на каждом уровне.
  const band = (from, to) => {
    const leftSide = [];
    const rightSide = [];
    for (const level of levels) {
      const wide = level.r - level.l;
      const a = spot(level.l + wide * from, level.z);
      const b = spot(level.l + wide * to, level.z);
      if (!a || !b) return false;
      leftSide.push(a);
      rightSide.push(b);
    }
    ctx.beginPath();
    ctx.moveTo(leftSide[0].x, leftSide[0].y);
    for (let at = 1; at < leftSide.length; at += 1) ctx.lineTo(leftSide[at].x, leftSide[at].y);
    for (let at = rightSide.length - 1; at >= 0; at -= 1) ctx.lineTo(rightSide[at].x, rightSide[at].y);
    ctx.closePath();
    return true;
  };
  if (!band(0, 1)) return;
  ctx.fillStyle = mega.towers[index % mega.towers.length];
  ctx.fill();
  if (band(0.58, 1)) {
    ctx.fillStyle = mega.towerShade;
    ctx.fill();
  }
  if (band(0.2, 0.3)) {
    ctx.fillStyle = mega.towerGlint;
    ctx.fill();
  }
  const share = hour.cityLit;
  if (!(share > 0)) return;
  // Ночные огни: редкие окна по телу одним путём и красный огонь на верхушке.
  const foot = spot(0, 0);
  const crown = spot((levels[levels.length - 1].l + levels[levels.length - 1].r) / 2, 1);
  if (!foot || !crown) return;
  const dot = Math.max(1, Math.abs(foot.y - crown.y) / 90);
  let any = false;
  ctx.beginPath();
  for (let row = 0; row < 22; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      if (!lit(index + 400, row, col, share)) continue;
      const z = 0.06 + (row / 22) * 0.74;
      const at = spot(-0.62 + col * 0.3, z);
      if (!at) continue;
      ctx.rect(at.x - dot / 2, at.y - dot / 2, dot, dot);
      any = true;
    }
  }
  if (any) {
    ctx.fillStyle = mega.light;
    ctx.fill();
  }
  ctx.fillStyle = mega.beacon;
  ctx.fillRect(crown.x - dot * 0.6, crown.y - dot * 0.6, dot * 1.2, dot * 1.2);
}

/**
 * Гряда крыш: ступени, а не скаты. Узел держит свою высоту до следующего —
 * получается кромка плоских крыш разной высоты.
 */
export function volumeDrawMegaSkyline(ctx, point, ridge, color) {
  const nodes = ridge.nodes;
  let run = null;
  const runs = [];
  for (let index = 0; index <= nodes.length; index += 1) {
    const node = nodes[index % nodes.length];
    const next = nodes[(index + 1) % nodes.length];
    const foot = point(node.x, node.y, 0);
    const crest = point(node.x, node.y, node.heightMm);
    const edge = point(next.x, next.y, node.heightMm);
    const edgeFoot = point(next.x, next.y, 0);
    if (!foot || !crest || !edge || !edgeFoot) {
      run = null;
      continue;
    }
    if (!run) {
      run = [];
      runs.push(run);
    }
    run.push({ foot, crest, edge, edgeFoot });
  }
  ctx.fillStyle = color;
  for (const line of runs) {
    ctx.beginPath();
    ctx.moveTo(line[0].foot.x, line[0].foot.y);
    for (const step of line) {
      ctx.lineTo(step.crest.x, step.crest.y);
      ctx.lineTo(step.edge.x, step.edge.y);
    }
    const last = line[line.length - 1];
    ctx.lineTo(last.edgeFoot.x, last.edgeFoot.y);
    ctx.closePath();
    ctx.fill();
  }
}
