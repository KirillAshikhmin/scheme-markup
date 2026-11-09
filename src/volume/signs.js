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
//   — **поток** — линии со стрелкой: воздух бризера — от лица в комнату,
//     вытяжки и вентиляции — в лицо (они забирают воздух, правка 2026-10-27),
//     холодный и тёплый воздух кондиционера (он стекает вниз), дуги звука у
//     колонки. Длина — по скорости и громкости. Чем вещь дышит — её лицо или
//     другая сторона тела (у вытяжки низ зонта, таск 259) — говорит
//     `volumeFlowRun`.
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
  intake: "rgba(200, 228, 255, 0.9)",
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
 *
 * `setpoints` — кому из приборов с табло показывать сейчас **заданную**
 * температуру, а не измеренную: `Set<markId>` от `volumeSetpointShow` или
 * `null` — всем показание (таск 257). Память «уставку меняли только что»
 * живёт у поверхности, а не здесь: кадр — чистая функция своих доводов.
 */
export function volumeLiveSigns(scene, live, out = [], setpoints = null) {
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
    // Цифровое табло (таск 257): у кого оно есть, сказано одной таблицей
    // `VOLUME_READOUT_PARTS`. Диода в углу такой прибор не получает — всё, что
    // он мог бы сказать диодом, написано на экране.
    if (view && VOLUME_READOUT_PARTS[view] && place.face) {
      volumeSignReadout(place, item, Boolean(setpoints && setpoints.has(place.markId)), out);
      continue;
    }
    if (!place.face) continue;
    if (item.kind === "light" || item.kind === "tv" || item.kind === "curtain") continue;
    volumeSignLeds(place, item, out);
    // Сцена нужна потоку, чтобы знать, что стоит у струи на пути
    // (`volumeFlowRun`): под зонтом вытяжки — плита.
    if (item.flow) volumeSignFlow(scene, place, item.flow, out);
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

// ——— цифровое табло термостата (таск 257, требование G398) ——————————————————
//
// Слова заказчика: «Термостат сделай цифровым (фото примерно так) и что бы он
// отображал значение температуры текущей, а при изменении целевой что бы
// 3 секунды отображалась целевая с какой-то пометкой. И индикатор нагрева».
//
// ——— почему грани кадра, а не тела и не картинка ———————————————————————————
//
// Предел тел метки — пять (`objectModelLimits`), а коробка стоит шесть граней:
// одна цифра съела бы весь предел, и это даже не считая второго разряда.
// Поэтому цифры — **плоские грани на лице тела**, как столбики шкал датчика
// климата и диоды соседей.
//
// Рядом живёт `volume/art.js` — тоже плоские грани на лице тела, — и второго
// такого механизма здесь не заводится **потому, что он не подходит**: грани
// картинки лежат в **сцене**, их геометрия и цвета посчитаны раз на сборку, а
// кадру остаётся решить, показывать ли их. Показание термостата меняется с
// каждым шагом климата, а уставка — под рукой человека; пересобирать ради
// числа сцену нельзя. Граница та же, что у шкал и диодов: неподвижное — в
// сцену (`art.js`), меняющееся — в кадр (этот модуль).
//
// ——— что на табло ————————————————————————————————————————————————————————
//
// Семисегментные цифры (сегмент — прямоугольник), знак градуса точкой справа
// сверху, знак нагрева тремя штрихами в столбике слева — как на образце
// заказчика, — и полоса-пометка под числом, пока показана уставка.
//
// **Пометка уставки — цвет и полоса разом**, и это решение, а не украшение.
// Цвет читается с шагу человека, а полоса — вблизи; порознь каждого мало:
// цвет без полосы ничего не называет (жёлтые цифры — это «теплее»?), полоса
// без цвета не видна с двух метров. Вместе они говорят одно и то же дважды.
//
// **Разрядов два**, и дробной части нет: на панели 86 мм третий разряд ужал бы
// цифру до нечитаемой, а задача таска ровно в том, чтобы число читалось.
// Уставка в 22,5 °C поэтому показывается как 23 — табло округляет, как
// округляет настоящее двухразрядное.
//
// **Раскладка — доли экрана**, а экран — тело модели по имени (`screen`).
// Своих долей лица у табло нет ни одной: подвинь кто-нибудь экран в описании —
// цифры поедут вместе с ним. Это то же правило, по которому у мерки один
// хозяин.

/** У кого на лице табло и каким телом задан его экран. */
const VOLUME_READOUT_PARTS = Object.freeze({ thermostat: "screen" });

/** Сколько настоящих миллисекунд показывается заданная температура. */
export const VOLUME_SETPOINT_MS = 3000;

/**
 * Цвет измеренной температуры и цвет заданной. Измеренная — холодный белый,
 * заданная — жёлтый: он уведён от оранжевого знака нагрева
 * (`VOLUME_LED_HEAT_RGB`) нарочно, иначе на табло оказалось бы два оранжевых
 * знака и читались бы они за одно.
 */
export const VOLUME_READOUT_RGB = [226, 238, 250];
export const VOLUME_SETPOINT_RGB = [255, 205, 70];

/**
 * Раскладка табло в долях экрана: `u` слева направо, `w` снизу вверх, 0…1.
 * Столбик знаков слева, число посередине, градус справа сверху.
 */
const VOLUME_READOUT_PLACE = Object.freeze({
  digits: { u: 0.24, width: 0.58, w: 0.18, height: 0.72 },
  // Щель между разрядами — доля места под оба разряда. Шире, чем кажется
  // нужным: к полутора метрам она сходится к точке экрана, и в узкой щели
  // соседние цифры сливаются в одно пятно (находка живого прогона).
  gap: 0.14,
  degree: { u: 0.9, width: 0.07, w: 0.78, height: 0.1 },
  // Знак нагрева: три штриха в столбике слева, как на образце.
  heat: { u: 0.035, width: 0.155, w: 0.18, height: 0.075, step: 0.11, rows: 3 },
  // Полоса под числом — пометка «это заданная, а не измеренная». Между нею и
  // нижним штрихом цифр оставлена щель в 0,07 высоты экрана (на панели 86 мм
  // это три с половиной миллиметра): встань полоса вплотную — слилась бы с
  // нижними сегментами в одну плиту (находка живого прогона).
  mark: { w: 0.025, height: 0.085 },
});

/**
 * Начертание цифры: какие сегменты горят. Буквы — обычные имена сегментов
 * семисегментного знака: `a` верх, `b` правый верх, `c` правый низ, `d` низ,
 * `e` левый низ, `f` левый верх, `g` перекладина.
 *
 * **Единица — восьмой штрих `i`, сплошная правая стойка** (слово заказчика
 * после живого прогона: «цифру 1 поправь, остальное ок»). У настоящего
 * семисегментного знака единица — это `b` и `c`, и щель между ними не видна,
 * потому что она там в волос. Здесь щель сделана **нарочно широкой** — иначе к
 * полутора метрам соседние цифры слипаются в пятно, — и у единицы её нечем
 * закрыть: перекладины `g` у неё нет, и вместо стойки получаются два обрубка.
 * Поэтому у единицы стойка одна, от низа `c` до верха `b`.
 *
 * Это **запись в таблице, а не ветка в рисовании**: рисование как перебирало
 * буквы начертания, так и перебирает, и прочие девять цифр от восьмого штриха
 * не меняются ни на грань — это держит тест.
 */
const VOLUME_DIGIT_SEGMENTS = Object.freeze([
  "abcdef",
  "i",
  "abged",
  "abgcd",
  "fgbc",
  "afgcd",
  "afgecd",
  "abc",
  "abcdefg",
  "abcdfg",
]);

/**
 * Толщина штриха и щель между штрихами — доли знака. Штрих **толстый
 * нарочно**: на экране он к двум шагам истончается до точки с небольшим, и
 * сглаживание съедает его раньше, чем сам знак. Щель при этом обязана остаться
 * видимой — иначе восьмёрка слипается в ноль.
 */
const VOLUME_DIGIT_BAR_H = 0.15;
const VOLUME_DIGIT_BAR_W = 0.25;
const VOLUME_DIGIT_GAP = 0.035;

/** Прямоугольники сегментов в долях знака: `[u1, u2, w1, w2]`. */
const VOLUME_DIGIT_RECTS = (() => {
  const h = VOLUME_DIGIT_BAR_H;
  const w = VOLUME_DIGIT_BAR_W;
  const gap = VOLUME_DIGIT_GAP;
  const high = [0.5 + h / 2 + gap, 1 - h - gap];
  const low = [h + gap, 0.5 - h / 2 - gap];
  return Object.freeze({
    a: [0, 1, 1 - h, 1],
    g: [0, 1, 0.5 - h / 2, 0.5 + h / 2],
    d: [0, 1, 0, h],
    f: [0, w, high[0], high[1]],
    b: [1 - w, 1, high[0], high[1]],
    e: [0, w, low[0], low[1]],
    c: [1 - w, 1, low[0], low[1]],
    // Стойка единицы: ровно `b` и `c`, сросшиеся через щель между ними. Границы
    // берутся у них же — разойдись числа, единица встала бы не на свою колонку
    // и не на свою высоту.
    i: [1 - w, 1, low[0], high[1]],
  });
})();

/**
 * Память показа уставки — своя у каждой поверхности, как память вспышки
 * нажатия (`simLiveMemo`) и разгорания света (`lightFadeMemo`). В объект не
 * идёт ничего: «уставку меняли только что» — состояние сеанса (ADR 015).
 */
export function volumeSetpointMemo() {
  return new Map();
}

/**
 * Кому показывать заданную температуру вместо измеренной: `{marks, until}` —
 * `Set<markId>` и ближайшие настоящие мс, когда показ погаснет (`null` —
 * гасить нечего, кадр по времени не нужен).
 *
 * **Три секунды — настоящие, а не имитации**, и выбор этот заметен. Часы
 * приложения умеют стоять и умеют идти с ускорением до ×960: в секундах
 * имитации показ у стоячих часов не погас бы никогда, а на ускорении промелькнул
 * бы за три миллисекунды. Табло — вещь интерфейса, и меряется оно тем же, чем
 * меряются вспышка нажатия (`SIM_LIVE_FLASH_MS`) и разгорание лампы
 * (`lightFadeLive`), — часами поверхности.
 *
 * Смена узнаётся **по самому числу**, а не по отметке времени из дома: уставка,
 * выставленная в то же значение, ничего не меняла, и мигать ей незачем. Первый
 * взгляд на метку показом не считается — иначе вход в режим зажигал бы табло
 * всех термостатов сразу.
 */
export function volumeSetpointShow(live, memo, now) {
  const marks = new Set();
  let until = null;
  if (!live || !memo) return { marks, until };
  for (const [markId, item] of live) {
    const target = item && Number.isFinite(Number(item.target)) ? Number(item.target) : null;
    if (target === null) {
      memo.delete(markId);
      continue;
    }
    const seen = memo.get(markId);
    if (seen === undefined) {
      memo.set(markId, { target, at: null });
      continue;
    }
    if (seen.target !== target) memo.set(markId, { target, at: now });
    const at = memo.get(markId).at;
    if (at === null) continue;
    const gone = at + VOLUME_SETPOINT_MS;
    if (gone <= now) continue;
    marks.add(markId);
    until = until === null ? gone : Math.min(until, gone);
  }
  // Метки, которых в доме больше нет, память не копит.
  for (const markId of [...memo.keys()]) if (!live.has(markId)) memo.delete(markId);
  return { marks, until };
}

/** Экран прибора — тело модели по имени из таблицы; `null` — табло не на чем рисовать. */
function volumeReadoutScreen(place) {
  const name = place.view ? VOLUME_READOUT_PARTS[place.view.name] : null;
  if (!name || !place.model) return null;
  const part = (place.model.parts || []).find((item) => item.name === name && item.kind === "box");
  return part || null;
}

/**
 * Разряды числа: два знака справа налево, `null` — разряд пуст. Ниже нуля —
 * перекладина вместо старшего разряда; больше двух разрядов табло не знает, и
 * число зажимается (настоящее двухразрядное ведёт себя так же).
 */
export function volumeReadoutDigits(value) {
  // Пусто — это не ноль: `Number(null)` даёт 0, и табло показало бы «0» там,
  // где показывать нечего.
  if (value === null || value === undefined || value === "") return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  if (number < 0) return ["-", String(Math.min(9, -number))];
  const held = Math.min(99, number);
  return held < 10 ? [null, String(held)] : String(held).split("");
}

/** Прямоугольник в долях экрана (`u` слева направо, `w` снизу вверх) — на лице. */
function volumeScreenRect(place, screen, u1, u2, w1, w2, rgb, out) {
  volumeFaceRect(
    place,
    screen.x + screen.width * u1,
    screen.x + screen.width * u2,
    screen.z + screen.height * w1,
    screen.z + screen.height * w2,
    rgb,
    true,
    out,
  );
}

/**
 * Табло прибора: число, градус, пометка уставки и знак нагрева. Выключенный
 * прибор табло не рисует вовсе — выключенный экран и в жизни тёмный, и без
 * дома он тёмный тоже: признаков работы у остановленного дома нет ни одного.
 */
function volumeSignReadout(place, item, setpoint, out) {
  const screen = volumeReadoutScreen(place);
  if (!screen || item.on !== true) return;
  const shown = setpoint && Number.isFinite(Number(item.target)) ? Number(item.target) : volumeReadoutValue(item);
  const digits = volumeReadoutDigits(shown);
  const rgb = setpoint ? VOLUME_SETPOINT_RGB : VOLUME_READOUT_RGB;
  const place0 = VOLUME_READOUT_PLACE;
  if (digits) {
    const cell = (place0.digits.width * (1 - place0.gap)) / 2;
    const step = place0.digits.width - cell;
    digits.forEach((sign, index) => {
      if (sign === null) return;
      const from = place0.digits.u + step * index;
      const strokes = sign === "-" ? "g" : VOLUME_DIGIT_SEGMENTS[Number(sign)] || "";
      for (const stroke of strokes) {
        const [u1, u2, w1, w2] = VOLUME_DIGIT_RECTS[stroke];
        volumeScreenRect(
          place,
          screen,
          from + cell * u1,
          from + cell * u2,
          place0.digits.w + place0.digits.height * w1,
          place0.digits.w + place0.digits.height * w2,
          rgb,
          out,
        );
      }
    });
    const degree = place0.degree;
    volumeScreenRect(place, screen, degree.u, degree.u + degree.width, degree.w, degree.w + degree.height, rgb, out);
    // Пометка: полоса под числом его же ширины. Вместе с цветом она и говорит,
    // что число — заданное.
    if (setpoint) {
      const mark = place0.mark;
      volumeScreenRect(
        place,
        screen,
        place0.digits.u,
        place0.digits.u + place0.digits.width,
        mark.w,
        mark.w + mark.height,
        rgb,
        out,
      );
    }
  }
  // Индикатор нагрева — свой знак, а не заливка экрана: три штриха слева, как
  // на образце. Горит, пока дом говорит, что прибор греет.
  if (item.heat === true) {
    const heat = place0.heat;
    for (let row = 0; row < heat.rows; row += 1) {
      const bottom = heat.w + heat.step * row;
      volumeScreenRect(place, screen, heat.u, heat.u + heat.width, bottom, bottom + heat.height, VOLUME_LED_HEAT_RGB, out);
    }
  }
}

/** Что показывает табло, когда уставку не меняли: измеренная температура или `null`. */
function volumeReadoutValue(item) {
  const value = item && item.climate ? item.climate.t : undefined;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

// ——— откуда вещь тянет воздух (таск 259, G401) ——————————————————————————————
//
// Слова заказчика: «почему у вытяжки стрелки идут сбоку, надо снизу».
//
// Струя идёт **по нормали того лица, которым вещь дышит**, и это правило одно
// на всех — ни «если вытяжка», ни «если вентиляция» в рисовании нет. Менялось
// не оно, а лицо: у бризера, вентиляции, кондиционера и колонки дышит лицо
// вещи (`place.face`, та же грань, на которой стоят диоды), а у вытяжки воздух
// входит **низом зонта** — и нормаль у этого лица смотрит вниз, поэтому
// `intake`, разворачивающий струю навстречу, сам поднимает её в зонт.
//
// Мировой вертикали в рисовании от этого не завелось: вниз смотрит нормаль
// лица, а не отдельный вектор, — и у потолочной вещи, которая и так лежит
// лицом к полу, лицо получается то же, что было (`face` ветки потолка в
// `volumeMarkPlacement` — это и есть низ её тела).
//
// Таблица — имена изображений, и она единственное место, где сказано, кто
// дышит не лицом. Новая такая вещь — строка в ней, а не ветка в рисовании.
const VOLUME_FLOW_SIDE = Object.freeze({ hood: "under" });
/** Щель между струёй и тем, из-под чего она поднимается, мм. */
const VOLUME_FLOW_GAP_MM = 50;
/** Короче этого струю не укорачивают: от неё осталась бы одна стрелка. */
const VOLUME_FLOW_MIN_MM = 120;

/**
 * Чем вещь дышит и докуда её струе можно дойти: `{face, reachMm}`. `reachMm`
 * равен `null` — предела нет, как не было (струя бризера уходит в комнату на
 * всю свою длину, и ничего под собой не спрашивает).
 *
 * Предел считается там, где лицо смотрит не в комнату: под зонтом вытяжки
 * стоит плита, и струя на всю длину начиналась бы внутри неё. Берётся верх
 * самого высокого габарита вещи чертежа под лицом (`scene.occluders` — те же
 * габариты, которыми вещи бросают тень) минус щель. Своя вещь не считается: у
 * прибора, собранного из вещи и метки, габарит — это он сам (таск 255).
 */
function volumeFlowRun(scene, place) {
  const side = place.view ? VOLUME_FLOW_SIDE[place.view.name] : null;
  const frame = place.frame;
  if (side !== "under" || !frame) return { face: place.face, reachMm: null };
  const face = {
    origin: { x: frame.at.x, y: frame.at.y, z: frame.bottomMm },
    u: { x: frame.u.x, y: frame.u.y, z: 0 },
    v: { x: frame.f.x, y: frame.f.y, z: 0 },
    normal: { x: 0, y: 0, z: -1 },
    widthMm: frame.widthMm,
    heightMm: frame.depthMm,
  };
  return { face, reachMm: volumeFlowClearMm(scene, place, face) };
}

/** Сколько свободно под лицом или `null` — под ним ничего не стоит. */
function volumeFlowClearMm(scene, place, face) {
  const halfU = face.widthMm / 2;
  const halfV = face.heightMm / 2;
  // Габарит повёрнутого прямоугольника в плане: вещь стоит под зонтом, а не
  // под его осями, и мерить пересечение по осям плана достаточно.
  const spanX = Math.abs(face.u.x) * halfU + Math.abs(face.v.x) * halfV;
  const spanY = Math.abs(face.u.y) * halfU + Math.abs(face.v.y) * halfV;
  let topMm = -Infinity;
  for (const occluder of (scene && scene.occluders) || []) {
    if (occluder.id === place.objectId || !(occluder.topMm < face.origin.z)) continue;
    if (occluder.box.minX > face.origin.x + spanX || occluder.box.maxX < face.origin.x - spanX) continue;
    if (occluder.box.minY > face.origin.y + spanY || occluder.box.maxY < face.origin.y - spanY) continue;
    topMm = Math.max(topMm, occluder.topMm);
  }
  if (topMm === -Infinity) return null;
  return Math.max(VOLUME_FLOW_MIN_MM, face.origin.z - topMm - VOLUME_FLOW_GAP_MM);
}

/**
 * Поток у лица, которым вещь дышит (`volumeFlowRun`). Воздух — три волнистые
 * струи по нормали этого лица со стрелкой на конце: у бризера от лица, у
 * вытяжки и вентиляции к лицу (`intake` — те же струи, пройденные навстречу,
 * стрелка упирается в решётку или в зонт); кондиционер — четыре струи от
 * нижнего края, стекающие вниз; звук — три дуги перед лицом.
 */
function volumeSignFlow(scene, place, flow, out) {
  const run = volumeFlowRun(scene, place);
  const face = run.face;
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
  const want = 300 + 600 * level;
  const length = run.reachMm === null ? want : Math.min(want, run.reachMm);
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
    if (flow.kind === "intake") points.reverse();
    out.push(volumeLine(points, color, { width: 1.6, arrow: true }));
  });
}
