// «Объём»: видно, что работает — диоды, струи воздуха, дуги колонки, шкалы
// датчика климата, гирлянда ели.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { VOLUME_STAR_RGB } from "./measures.js";
import { volumeFace, volumeLine } from "./faces.js";

// ——— видно, что работает (правка после сборки сценариев) ————————————————————
//
// Слова заказчика: «Вентиляция не видно когда работает, розетка тоже, и
// выключатель. и наверняка почти всё так, кроме света. На вентиляции должны
// быть потоки воздуха как пример, и на всех так. На выключателях можно диодик
// на кнопке канала снизу разместить, на розетке сверху справа светодиод
// активности и т.д. придумай как визуально отличать работающие от отключенных
// устройств».
//
// Свет светится, телевизор горит экраном, штора едет — у остальных признака не
// было вовсе. Признаков два, и оба — грани кадра, а не сцены: состояние дома
// меняется без пересборки (`volumeFrame(…, extra)`).
//
//   — **диод** — кружок на лице вещи. У выключателя — под каждой клавишей, по
//     её реле: горит — нагрузка канала включена, тёмный — выключена. У розетки —
//     справа сверху, тоже горит или тёмный. У остального — справа сверху, только
//     пока есть что сказать: зелёный — включено, оранжевый — греет, голубой —
//     охлаждает или кран открыт, красный — датчик сработал или замок заперт;
//   — **поток** — линии со стрелкой от лица вещи: воздух вентиляции и бризера,
//     холодный и тёплый воздух кондиционера (он стекает вниз), дуги звука у
//     колонки. Длина — по скорости и громкости.
//
// Светится и то и другое своим цветом, без тона часа: ночью диод в тёмной
// комнате виден, как виден настоящий.

/** Цвета диодов. */
export const VOLUME_LED_ON_RGB = [70, 230, 120];
export const VOLUME_LED_KEY_RGB = [110, 205, 255];
export const VOLUME_LED_OFF_RGB = [58, 62, 70];
export const VOLUME_LED_ALERT_RGB = [255, 72, 60];
export const VOLUME_LED_HEAT_RGB = [255, 150, 50];
export const VOLUME_LED_COOL_RGB = [100, 190, 255];
/** Цвета потоков. */
const VOLUME_FLOW_COLOR = {
  air: "rgba(200, 228, 255, 0.9)",
  cool: "rgba(120, 200, 255, 0.95)",
  heat: "rgba(255, 165, 85, 0.95)",
  sound: "rgba(236, 236, 255, 0.85)",
};
/**
 * Радиус диода — крупнее настоящего: в два-три миллиметра его не видно уже с
 * двух шагов, а признак нужен, чтобы видеть с порога комнаты.
 */
function volumeLedRadius(face) {
  return Math.max(5, Math.min(12, 0.09 * Math.min(face.widthMm, face.heightMm)));
}

/** Насколько диод поднят над лицом: перед ним, а не в нём. */
const VOLUME_LED_LIFT_MM = 1.5;
const VOLUME_LED_SIDES = 8;

/**
 * Признаки работы для кадра: диоды и потоки вещей сцены по состоянию дома —
 * `live` как у `volumeLiveLight` (`simLiveOf` с видом знака). Свет, экран и
 * штора своё уже показывают и признаков не получают.
 */
export function volumeLiveSigns(scene, live, out = []) {
  if (!scene || !live || live.size === 0) return out;
  for (const place of scene.marks || []) {
    if (!place || !place.markId) continue;
    const item = live.get(place.markId);
    if (!item) continue;
    // Правки после сборки сценариев: огоньки гирлянды у ели и столбики шкал у
    // датчика климата.
    const view = place.view ? place.view.name : null;
    if (view === "xmasTree") {
      volumeSignGarland(place, item, out);
      continue;
    }
    if (view === "climateSensor" && place.face) {
      volumeSignScales(place, item, out);
      continue;
    }
    if (!place.face) continue;
    if (item.kind === "light" || item.kind === "tv" || item.kind === "curtain") continue;
    volumeSignLeds(place, item, out);
    if (item.flow) volumeSignFlow(place, item.flow, out);
  }
  return out;
}

// ——— шкалы датчика климата и гирлянда ели (правки после сборки сценариев) ———
//
// Слова заказчика: «Датчики климата (метку) изображай как 3 шкалы вертикальных
// как на ртутном градуснике. С реальным значением в комнате расположения» и «у
// которой можно включить гирлянду и звезду наверху». Трубки шкал и ярусы ели —
// тела модели; столбики и огоньки — грани кадра, как диоды: значения меняются
// без пересборки сцены.

/** Пределы шкал: температура, влажность, CO₂ — и где у каждой середина трубки. */
export const VOLUME_SCALES = Object.freeze([
  { key: "t", from: -10, to: 40, x: -0.28, rgb: [226, 58, 46] },
  { key: "rh", from: 0, to: 100, x: 0, rgb: [62, 142, 236] },
  { key: "co2", from: 400, to: 2000, x: 0.28, rgb: null },
]);
/** Где в трубке столбик: низ и полная высота, доли высоты лица. */
const VOLUME_SCALE_BOTTOM = 0.14;
const VOLUME_SCALE_SPAN = 0.72;
/** Цвет CO₂ по уровню: свежо, душно, плохо. */
export function volumeCo2Rgb(ppm) {
  const value = Number(ppm) || 0;
  if (value < 800) return [72, 190, 92];
  if (value < 1200) return [232, 188, 44];
  return [226, 62, 44];
}

/** Прямоугольник на лице вещи: доли ширины `x1…x2` от середины и высоты `z1…z2` от низа. */
function volumeFaceRect(place, x1, x2, z1, z2, rgb, glowing, out) {
  const face = place.face;
  const at = (fx, fz) => ({
    x: face.origin.x + face.u.x * fx * face.widthMm + face.v.x * (fz - 0.5) * face.heightMm + face.normal.x * VOLUME_LED_LIFT_MM,
    y: face.origin.y + face.u.y * fx * face.widthMm + face.v.y * (fz - 0.5) * face.heightMm + face.normal.y * VOLUME_LED_LIFT_MM,
    z: face.origin.z + face.u.z * fx * face.widthMm + face.v.z * (fz - 0.5) * face.heightMm + face.normal.z * VOLUME_LED_LIFT_MM,
  });
  const normal = { x: face.normal.x, y: face.normal.y, z: face.normal.z };
  const rect = volumeFace([at(x1, z1), at(x2, z1), at(x2, z2), at(x1, z2)], rgb, { normal, flat: glowing, markId: place.markId });
  if (glowing) rect.led = true;
  out.push(rect);
}

/**
 * Столбики шкал: доля трубки — значение в пределах шкалы. Чего датчик не
 * меряет — у той трубки столбика нет. Под каждой трубкой шарик её цвета.
 */
function volumeSignScales(place, item, out) {
  const values = item.climate || {};
  for (const scale of VOLUME_SCALES) {
    const value = values[scale.key];
    if (value === undefined || value === null || !Number.isFinite(Number(value))) continue;
    const share = Math.max(0.02, Math.min(1, (Number(value) - scale.from) / (scale.to - scale.from)));
    const rgb = scale.rgb || volumeCo2Rgb(value);
    volumeFaceRect(place, scale.x - 0.035, scale.x + 0.035, VOLUME_SCALE_BOTTOM, VOLUME_SCALE_BOTTOM + VOLUME_SCALE_SPAN * share, rgb, true, out);
    volumeLed(place, scale.x, 0.5 - 0.075, rgb, true, out);
  }
}

/**
 * Хвоя ели — два конуса модели (`objectModels/light.js`): низ, верх и радиус
 * основания в долях габарита. Огоньки гирлянды лежат на их поверхности.
 */
const VOLUME_TREE_CONES = Object.freeze([
  { from: 0.08, to: 0.64, r: 0.5 },
  { from: 0.4, to: 0.92, r: 0.36 },
]);
/** Ряды огоньков: доля высоты и сколько их в ряду. */
const VOLUME_GARLAND_ROWS = Object.freeze([
  { z: 0.15, count: 8 },
  { z: 0.27, count: 7 },
  { z: 0.39, count: 6 },
  { z: 0.5, count: 6 },
  { z: 0.62, count: 5 },
  { z: 0.73, count: 4 },
  { z: 0.83, count: 3 },
]);
const VOLUME_GARLAND_RGB = Object.freeze([
  [255, 70, 60],
  [255, 206, 64],
  [90, 220, 110],
  [80, 160, 255],
]);
const VOLUME_GARLAND_OFF_RGB = [60, 64, 70];
const VOLUME_STAR_OFF_RGB = [150, 126, 52];
/** Размер огонька и насколько он отстоит от хвои, мм; размер звезды — доля роста. */
const VOLUME_GARLAND_BULB_MM = 48;
const VOLUME_GARLAND_OUT_MM = 14;
const VOLUME_STAR_SHARE = 0.055;

/** Радиус хвои на доле высоты `z` — наружный из двух конусов. */
function volumeTreeRadius(z) {
  let best = 0;
  for (const cone of VOLUME_TREE_CONES) {
    if (z < cone.from || z > cone.to) continue;
    best = Math.max(best, (cone.r * (cone.to - z)) / (cone.to - cone.from));
  }
  return best;
}

/** Круг огонька в точке `centre`, лицом по `n`. */
function volumeBulbFace(centre, n, sizeMm, rgb, glowing, markId) {
  const side = { x: -n.y, y: n.x, z: 0 };
  const points = [];
  for (let corner = 0; corner < VOLUME_LED_SIDES; corner += 1) {
    const a = (corner / VOLUME_LED_SIDES) * Math.PI * 2;
    const r = sizeMm / 2;
    points.push({
      x: centre.x + side.x * Math.cos(a) * r,
      y: centre.y + side.y * Math.cos(a) * r,
      z: centre.z + Math.sin(a) * r,
    });
  }
  const face = volumeFace(points, rgb, { normal: n, flat: glowing, markId });
  if (glowing) face.led = true;
  return face;
}

/**
 * Гирлянда и звезда ели: огоньки горят, пока горит первая лампа, звезда —
 * пока вторая; выключенные — тёмные огоньки на хвое и тусклое золото звезды.
 * Звезда — две пятиконечные грани накрест: её видно с любой стороны.
 */
function volumeSignGarland(place, item, out) {
  const frame = place.frame;
  if (!frame || !(frame.heightMm > 0)) return;
  const garland = Boolean(item.lamps ? item.lamps[0] > 0 : item.on);
  const star = Boolean(item.lamps ? item.lamps[1] > 0 : item.on);
  const width = Math.min(frame.widthMm, frame.depthMm);
  let index = 0;
  for (const row of VOLUME_GARLAND_ROWS) {
    const radius = volumeTreeRadius(row.z) * width + VOLUME_GARLAND_OUT_MM;
    for (let step = 0; step < row.count; step += 1) {
      const angle = ((step + row.z * 5) / row.count) * Math.PI * 2;
      const n = { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
      const centre = { x: frame.at.x + n.x * radius, y: frame.at.y + n.y * radius, z: frame.bottomMm + frame.heightMm * row.z };
      const rgb = garland ? VOLUME_GARLAND_RGB[index % VOLUME_GARLAND_RGB.length] : VOLUME_GARLAND_OFF_RGB;
      out.push(volumeBulbFace(centre, n, VOLUME_GARLAND_BULB_MM, rgb, garland, place.markId));
      index += 1;
    }
  }
  const size = frame.heightMm * VOLUME_STAR_SHARE;
  const top = { x: frame.at.x, y: frame.at.y, z: frame.bottomMm + frame.heightMm * 0.95 };
  for (const turn of [0, Math.PI / 2]) {
    const u = { x: Math.cos(turn), y: Math.sin(turn) };
    const points = [];
    for (let corner = 0; corner < 10; corner += 1) {
      const a = Math.PI / 2 + (corner * Math.PI) / 5;
      const r = corner % 2 === 0 ? size : size * 0.45;
      points.push({ x: top.x + u.x * Math.cos(a) * r, y: top.y + u.y * Math.cos(a) * r, z: top.z + Math.sin(a) * r });
    }
    const face = volumeFace(points, star ? VOLUME_STAR_RGB : VOLUME_STAR_OFF_RGB, {
      normal: { x: -u.y, y: u.x, z: 0 },
      both: true,
      flat: star,
      markId: place.markId,
    });
    if (star) face.led = true;
    out.push(face);
  }
}

/** Диод в точке лица `(fx, fy)` — доли ширины и высоты от середины, `fy` вниз. */
function volumeLed(place, fx, fy, rgb, glowing, out) {
  const face = place.face;
  const radius = volumeLedRadius(face);
  const centre = {
    x: face.origin.x + face.u.x * fx * face.widthMm - face.v.x * fy * face.heightMm,
    y: face.origin.y + face.u.y * fx * face.widthMm - face.v.y * fy * face.heightMm,
    z: face.origin.z + face.u.z * fx * face.widthMm - face.v.z * fy * face.heightMm,
  };
  const points = [];
  for (let side = 0; side < VOLUME_LED_SIDES; side += 1) {
    const angle = (side / VOLUME_LED_SIDES) * Math.PI * 2;
    const a = Math.cos(angle) * radius;
    const b = Math.sin(angle) * radius;
    points.push({
      x: centre.x + face.u.x * a + face.v.x * b + face.normal.x * VOLUME_LED_LIFT_MM,
      y: centre.y + face.u.y * a + face.v.y * b + face.normal.y * VOLUME_LED_LIFT_MM,
      z: centre.z + face.u.z * a + face.v.z * b + face.normal.z * VOLUME_LED_LIFT_MM,
    });
  }
  // Обход — против часовой, если смотреть с лица: нормаль грани смотрит туда
  // же, куда лицо, и отбор по нормали показывает диод спереди.
  const normal = { x: face.normal.x, y: face.normal.y, z: face.normal.z };
  const led = volumeFace(points, rgb, { normal, flat: glowing, markId: place.markId });
  // Горящий диод светится своим цветом (`volumeLiveFill`), тёмный — обычная
  // грань в тоне часа и комнаты.
  if (glowing) led.led = true;
  out.push(led);
  return radius;
}

function volumeSignLeds(place, item, out) {
  const face = place.face;
  const margin = (mm) => mm / Math.max(1, face.heightMm);
  const marginX = (mm) => mm / Math.max(1, face.widthMm);
  const radius = volumeLedRadius(face);
  // Выключатель: диод под каждой клавишей — по реле её канала.
  const keys = place.model ? (place.model.parts || []).filter((part) => Number.isInteger(part.channel)) : [];
  if (item.keys && keys.length > 0) {
    for (const key of keys) {
      const on = item.keys[key.channel] === true;
      const fx = key.x + key.width / 2;
      const fy = 0.5 - key.z - margin(radius + 5);
      volumeLed(place, fx, fy, on ? VOLUME_LED_KEY_RGB : VOLUME_LED_OFF_RGB, on, out);
    }
    return;
  }
  const corner = (rgb, glowing) =>
    volumeLed(place, 0.5 - marginX(radius + 7), -0.5 + margin(radius + 7), rgb, glowing, out);
  if (item.kind === "outlet" || item.keys) {
    corner(item.on ? VOLUME_LED_ON_RGB : VOLUME_LED_OFF_RGB, item.on);
    return;
  }
  if (item.alert || item.locked) {
    corner(VOLUME_LED_ALERT_RGB, true);
    return;
  }
  if (!item.on) return;
  const flow = item.flow ? item.flow.kind : null;
  corner(flow === "heat" ? VOLUME_LED_HEAT_RGB : flow === "cool" ? VOLUME_LED_COOL_RGB : VOLUME_LED_ON_RGB, true);
}

/**
 * Поток от лица вещи. Воздух — три волнистые струи по нормали лица со стрелкой
 * на конце; кондиционер — четыре струи от нижнего края, стекающие вниз; звук —
 * три дуги перед лицом.
 */
function volumeSignFlow(place, flow, out) {
  const face = place.face;
  const n = face.normal;
  const u = face.u;
  const v = face.v;
  const level = Math.max(0.2, Math.min(1, Number(flow.level) || 0));
  const color = VOLUME_FLOW_COLOR[flow.kind] || VOLUME_FLOW_COLOR.air;
  const at = (fx, fy) => ({
    x: face.origin.x + u.x * fx * face.widthMm - v.x * fy * face.heightMm,
    y: face.origin.y + u.y * fx * face.widthMm - v.y * fy * face.heightMm,
    z: face.origin.z + u.z * fx * face.widthMm - v.z * fy * face.heightMm,
  });
  const move = (point, by) => ({ x: point.x + by.x, y: point.y + by.y, z: point.z + by.z });
  const scale = (vector, k) => ({ x: vector.x * k, y: vector.y * k, z: vector.z * k });
  if (flow.kind === "sound") {
    const centre = at(0, 0);
    for (let ring = 1; ring <= 3; ring += 1) {
      const radius = (60 + 55 * ring) * (0.6 + 0.4 * level);
      const points = [];
      for (let step = 0; step <= 8; step += 1) {
        const angle = (-0.6 + (1.2 * step) / 8) * 1;
        points.push(move(centre, move(scale(n, Math.cos(angle) * radius), scale(u, Math.sin(angle) * radius))));
      }
      out.push(volumeLine(points, color, { width: 1.6 }));
    }
    return;
  }
  const length = 300 + 600 * level;
  const down = { x: 0, y: 0, z: -1 };
  const falls = flow.kind === "cool" || flow.kind === "heat";
  const starts = falls ? [-0.36, -0.12, 0.12, 0.36].map((fx) => at(fx, 0.45)) : [-0.25, 0, 0.25].map((fx) => at(fx, 0));
  starts.forEach((start, index) => {
    const points = [];
    for (let step = 0; step <= 10; step += 1) {
      const s = step / 10;
      let point = move(start, scale(n, 8 + s * length));
      if (falls) point = move(point, scale(down, s * s * length * 0.7));
      else point = move(point, scale(v, Math.sin(s * Math.PI * 3 + index * 1.7) * 22));
      points.push(point);
    }
    out.push(volumeLine(points, color, { width: 1.6, arrow: true }));
  });
}
