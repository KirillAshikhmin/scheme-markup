// «Объём»: векторная арифметика и грани — нормаль, тон по свету, заливка,
// грань и линия кадра, тень дома на земле.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import {
  DEG,
  VOLUME_LAND_RGB,
  VOLUME_LAYER_BODY,
  VOLUME_LAYER_SHADOW,
  VOLUME_LIGHT,
  VOLUME_NIGHT_RGB,
  VOLUME_SHADE_MAX,
  VOLUME_SHADE_MIN,
  VOLUME_SHADOW_RGB,
  VOLUME_SUN_AT,
  volumeClearAlpha,
  volumeNormalize,
} from "./measures.js";

/**
 * Нормаль грани по трём первым вершинам. Направление задаёт обход: у плановых
 * многоугольников, записанных по часовой на экране (ось `y` смотрит вниз),
 * «левая» нормаль ребра смотрит наружу — то же соглашение, что у стены
 * (`wallVectors`), и второго в сборке нет.
 */
export function volumeFaceNormal(points) {
  if (!points || points.length < 3) return { x: 0, y: 0, z: 1 };
  const [a, b, c] = points;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return volumeNormalize({ x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx });
}

/** Светлота грани по её направлению: одна формула, ни текстур, ни света. */
export function volumeShade(normal) {
  const dot = normal.x * VOLUME_LIGHT.x + normal.y * VOLUME_LIGHT.y + normal.z * VOLUME_LIGHT.z;
  return VOLUME_SHADE_MIN + ((VOLUME_SHADE_MAX - VOLUME_SHADE_MIN) * (dot + 1)) / 2;
}

/**
 * Час суток в цвете: материал, сведённый к тону ночи (таск 181, G282).
 *
 * **Единственное место, где темнеет вечер.** Им красится и грань сцены
 * (`volumeFill` ниже), и поле панорамы, и тень дома — а это три разные
 * поверхности, которые обязаны совпасть в тон: земля у дома, земля за ним и
 * её собственная тень. Разойдись у них счёт — дом снова «залетал» бы над
 * землёй, ровно как в G237, только теперь к ночи.
 *
 * `tint` — `{rgb, share}`: куда и насколько тянется цвет. `null` и нулевая
 * доля значат полдень, то есть цвет как написан.
 */
export function volumeTintRgb(rgb, tint) {
  const share = tint ? Math.max(0, Math.min(1, Number(tint.share) || 0)) : 0;
  if (!(share > 0)) return rgb;
  const to = tint.rgb || VOLUME_NIGHT_RGB;
  return [
    Math.round(rgb[0] * (1 - share) + to[0] * share),
    Math.round(rgb[1] * (1 - share) + to[1] * share),
    Math.round(rgb[2] * (1 - share) + to[2] * share),
  ];
}

/** Тот же час, но строкой холста: `rgb(...)` для заливок панорамы. */
export function volumeTintCss(rgb, tint) {
  return "rgb(" + volumeTintRgb(rgb, tint).join(",") + ")";
}

/**
 * Цвет грани: материал, умноженный на светлоту и сведённый к тону часа.
 *
 * `alpha` меньше единицы — грань просвечивает (вещь чертежа, таск 169), и
 * прозрачность пишется **в сам цвет**, а не в состояние холста: кадр от этого
 * не меняется ни одной строкой — рисование так и остаётся одной заливкой на
 * многоугольник (`volumeDraw`), и цена кадра та же самая.
 *
 * `tint` — час суток (таск 181). Он стоит здесь, а не завесой поверх кадра, и
 * это главное решение в освещении объёма: завеса легла бы и на небо, а небу
 * ночью нужна своя темнота, глубже комнатной, — и ни одна завеса не дала бы
 * **светящемуся** окну города остаться светящимся. Здесь же цена нулевая: три
 * умножения на грань в том же счёте, где уже считается светлота.
 */
export function volumeFill(rgb, shade, alpha = 1, tint = null, fog = null) {
  const hour = volumeTintRgb(rgb, tint);
  // Туман (правка «погода») — поверх светлоты: дальнее тонет в его цвете.
  const haze = fog ? volumeShare01(fog.share) : 0;
  const channel =
    haze > 0
      ? (value, index) => Math.max(0, Math.min(255, Math.round(value * shade * (1 - haze) + fog.rgb[index] * haze)))
      : (value) => Math.max(0, Math.min(255, Math.round(value * shade)));
  const parts = channel(hour[0], 0) + "," + channel(hour[1], 1) + "," + channel(hour[2], 2);
  if (!(alpha < 1)) return "rgb(" + parts + ")";
  return "rgba(" + parts + "," + Math.round(alpha * 100) / 100 + ")";
}

// ——— грани ———————————————————————————————————————————————————————————————
//
// Грань — плоский многоугольник в миллиметрах чертежа плюс третья ось: `z`
// отсчитывается от пола вверх. `layer` — ярус отрисовки (см. выше), `both`
// помечает двустороннюю грань (дверное полотно, брусок рамы).

export function volumeFace(points, rgb, options = {}) {
  const normal = options.normal || volumeFaceNormal(points);
  return {
    p: points,
    n: normal,
    rgb,
    layer: options.layer === undefined ? VOLUME_LAYER_BODY : options.layer,
    both: Boolean(options.both),
    // Грань без затенения (G237): цвет берётся как написан. Это земля — она
    // освещена тем же небом, что поле панорамы, и обязана совпасть с ним в
    // тон, а лампа сцены увела бы её вдвое в темноту.
    flat: Boolean(options.flat),
    // Грань просвечивает (таск 169): вещь чертежа — и тюль шторы (таск 189).
    // Признак доезжает до двух мест и больше никуда: до цвета (`volumeFill`
    // отдаёт `rgba`) и до взгляда (`volumeSightAt` сквозь такую грань смотрит
    // дальше — но не сквозь метку, см. там). Порядок прозрачная грань не
    // меняет: он и так точен в каждом пикселе — см. `volumeOrderTree`.
    clear: Boolean(options.clear),
    // **Насколько** просвечивает: доля своего цвета (таск 189). У плотной
    // грани единица, у ткани шторы 0,6, у вещи 0,4 — считает это одно место
    // (`volumeClearAlpha`), а кадр берёт готовое число.
    alpha: volumeClearAlpha(options.clear),
    // Чья это грань: по ней кадр отвечает, во что попал клик (таск 148).
    // У стен, пола и вещей чертежа хозяина нет — и попадать в них незачем.
    markId: options.markId || null,
    // Чья это клавиша (таск 177, G274): по ней кадр отвечает, в какой **канал**
    // попал клик. Стоит только у клавиш выключателя — у рамки, у корпуса и у
    // любой другой грани `null`, и щелчок по ним значит «вся метка», как
    // значил.
    channel: options.channel === undefined ? null : options.channel,
    // Чьё это полотно: по нему кадр отвечает, какую дверь открывает E (G207).
    // Есть только у полотна и его ручки — больше ни у чего в сцене.
    doorId: options.doorId || null,
    // С какого этажа стопки пришла грань (таск 232). Ставит его
    // `volumeFloorFaces`, и по нему кадр решает, достаются ли грани хозяева:
    // на чужом этаже их нет. Объявлено **здесь**, а не приписывается потом:
    // приписанное поле меняет породу всех граней сцены, и сборка стопки на
    // объекте заказчика дорожала от этого на 2–3 мс.
    floor: null,
    // **Может светиться** (таск 09 сценариев, G06): тело модели, откуда идёт
    // свет, — абажур, свечение, экран (`lit` в `objectModels/*`). Горит ли оно,
    // решает кадр по состоянию дома (`volumeFrame(…, live)`); без имитации
    // признак не читает никто, и кадр тот же, что до таска.
    lit: Boolean(options.lit),
    // Какая лампа устройства зажигает грань (правка после сборки сценариев):
    // звезда ели горит от второй, гирлянда — от первой. `null` — от любой.
    bulb: Number.isInteger(options.bulb) ? options.bulb : null,
    // **Чья комната** (таск 09 сценариев, история 2.12): ключ помещения
    // (`volumeRoomKey`) у пола, потолка, стороны стены, смотрящей в комнату, и у
    // вещей в ней. По нему кадр светлит ночью комнату, где горит свет. Улица,
    // наружные стороны стен и всё, чему комнату не назвать, — `null`.
    room: options.room || null,
    // **Вещь** (правка после сборки сценариев): грань вещи чертежа или тела
    // метки — мебель, корпус устройства, ткань шторы. Физический свет кладёт на
    // неё пятна ламп и окон, как на пол и стены: «сделай что бы физический
    // свет подсвечивал объекты (мебель)». Ставит его сборка сцены
    // (`volumeTagThing`); объявлено здесь, чтобы порода граней не менялась.
    // У вещи чертежа это её id — своей тени на себе она не получает.
    thing: false,
  };
}

/**
 * **Линия в сцене**: ломаная, которая не заливается, а обводится (таск 148).
 *
 * Заведена ради двух вещей, которые гранями не рисуются: контур изображения
 * объекта на лицевой стороне вещи и стрелка связи. И то и другое — **рисунок**,
 * а не поверхность: толщина у него в экранных точках, иначе контур розетки в
 * трёх метрах пропадает вовсе, а в полуметре превращается в кляксу.
 *
 * `normal` необязательна: с ней линия отсекается по направлению, как грань
 * (контур на лицевой стороне не виден с изнанки), без неё видна всегда —
 * стрелке связи так и надо.
 */
export function volumeLine(points, color, options = {}) {
  return {
    p: points,
    line: true,
    color,
    width: options.width === undefined ? 1.4 : options.width,
    closed: Boolean(options.closed),
    dash: options.dash || null,
    arrow: Boolean(options.arrow),
    n: options.normal || null,
    layer: options.layer === undefined ? VOLUME_LAYER_BODY : options.layer,
    markId: options.markId || null,
    floor: null,
  };
}

export function volumeAt(point, z) {
  return { x: point.x, y: point.y, z };
}

/**
 * Куда уходит тень точки, поднятой на `heightMm` (D43).
 *
 * Кладёт её **солнце, нарисованное на небе** (`VOLUME_SUN_AT`), и это
 * единственный разумный хозяин: тень, лежащая не в ту сторону от видимого
 * солнца, кричит о подделке громче, чем её отсутствие.
 *
 * Лампа сцены (`VOLUME_LIGHT`) для этого не годится вовсе, и это стоит сказать
 * прямо: у неё отрицательная `z` и светлее всех грань, **смотрящая вниз** (так
 * сделано нарочно — «пол темнее потолка», требование заказчика ещё из таска
 * 146). Светит она, выходит, снизу — а свет снизу тени на земле не кладёт.
 * Лампа красит грани, солнце кладёт тень; смешивать их нельзя.
 *
 * Длина — из высоты солнца над горизонтом: `h / tg(rise)`. При 14° стена
 * 2800 мм даёт тень 11 230 мм — длинную, как и положено низкому солнцу.
 * Направление — ровно прочь от солнца: `az + 180°`.
 *
 * `at` — где солнце стоит **сейчас** (таск 181): с идущим временем оно ходит
 * по небу, и тень ходит за ним. Умолчание — полдень при верхе чертежа на
 * север (`VOLUME_SUN_AT`), и по нему же считается вынос земляной плиты: плита
 * обязана держать тень в любой час, а размер её — часть сцены, которую нельзя
 * пересобирать каждую секунду. Поэтому высота солнца для тени **снизу не
 * опускается ниже полуденной** (`VOLUME_SUN_AT.rise`): тень не длиннее той, на
 * которую плита рассчитана, а у горизонта она не тянется в бесконечность, а
 * гаснет — см. `volumeShadowFaces`.
 */
export function volumeShadowShift(heightMm, at = VOLUME_SUN_AT) {
  const want = Number(at && at.rise);
  const rise = Math.max(Number(VOLUME_SUN_AT.rise) || 1, Number.isFinite(want) ? want : 0) * DEG;
  const reach = Number(heightMm) / Math.tan(rise);
  const away = (Number(at && at.az) || 0) + 180;
  if (!Number.isFinite(reach)) return { x: 0, y: 0 };
  return { x: Math.cos(away * DEG) * reach, y: Math.sin(away * DEG) * reach };
}

/**
 * Силуэт тени прямой призмы: выпуклая оболочка её габарита и того же габарита,
 * сдвинутого на вынос тени. Одной только сдвинутой крышкой обойтись нельзя —
 * между стеной и её тенью осталась бы светлая щель, то есть ровно то «дом не
 * касается земли», от которого всё и затевалось.
 */
export function volumeShadowOutline(corners, heightMm, at = VOLUME_SUN_AT) {
  const shift = volumeShadowShift(heightMm, at);
  const points = [];
  for (const point of corners) {
    points.push({ x: point.x, y: point.y });
    points.push({ x: point.x + shift.x, y: point.y + shift.y });
  }
  return volumeHull(points);
}

/**
 * Грани тени дома в этот час (таск 181).
 *
 * `boxes` — габариты стен из сцены (`scene.shadowBoxes`), `shadow` — где стоит
 * солнце и насколько тень видна (`mood.shadow`).
 *
 * **Ярус у тени свой** (`VOLUME_LAYER_SHADOW`, дефект D49): она лежит выше
 * плиты и ниже полов. Дальностью это не решается — внутри яруса очередь считают
 * середины граней, и тень, уходящая от стены внутрь дома, оказывается то дальше
 * пола, то ближе него, от часа и от комнаты. Числа — у объявления яруса.
 *
 * **Гаснет тень цветом, а не прозрачностью.** Солнце у горизонта — тень
 * сводится к самой земле (`VOLUME_LAND_RGB`) и исчезает, ночью её нет вовсе.
 * Прозрачностью этого делать нельзя: тени соседних стен перекрываются, и в
 * углу дома вышло бы вдвое темнее, чем вдоль стены (та же причина, по которой
 * тень сплошная с таска 178).
 */
export function volumeShadowFaces(boxes, shadow, out = [], land = VOLUME_LAND_RGB) {
  const fade = shadow ? Math.max(0, Math.min(1, Number(shadow.fade))) : 1;
  if (!boxes || boxes.length === 0 || !(fade > 0)) return out;
  // Земля под тенью — земля времени года (правка «погода»): тень на снегу —
  // тот же снег, только темнее.
  const ground = land || VOLUME_LAND_RGB;
  const dark = ground === VOLUME_LAND_RGB ? VOLUME_SHADOW_RGB : ground.map((value) => Math.round(value * 0.72));
  const rgb = [
    Math.round(ground[0] + (dark[0] - ground[0]) * fade),
    Math.round(ground[1] + (dark[1] - ground[1]) * fade),
    Math.round(ground[2] + (dark[2] - ground[2]) * fade),
  ];
  const at = shadow ? { az: shadow.az, rise: shadow.rise } : VOLUME_SUN_AT;
  for (const box of boxes) {
    // `box.baseMm` — где лежит земля под этим габаритом (таск 202). У одной
    // схемы это ноль, у стопки этажей — пол нижнего этажа: тень кладут все
    // этажи разом, но ложится она на одну землю.
    const baseMm = Number(box.baseMm) || 0;
    out.push(
      volumeFace(
        volumeClockwise(volumeShadowOutline(box.corners, box.heightMm, at)).map((point) => volumeAt(point, baseMm)),
        rgb,
        { normal: { x: 0, y: 0, z: 1 }, layer: VOLUME_LAYER_SHADOW, flat: true },
      ),
    );
  }
  return out;
}

/** Выпуклая оболочка (обход Эндрю). Точек мало — восемь на стену. */
export function volumeHull(points) {
  const list = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (list.length < 3) return list;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source) => {
    const out = [];
    for (const point of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) out.pop();
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...half(list), ...half([...list].reverse())];
}

/**
 * Обход приводится к часовому на экране — тому единственному, при котором
 * «левая» нормаль ребра смотрит **наружу** (соглашение `volumeFaceNormal` и
 * `wallVectors`, второго в сборке нет). Зависеть это от того, в какую сторону
 * человек обводил комнату или ставил вещь, не должно.
 *
 * **Знак здесь был обратный, и это дефект, найденный замером D32** (таск 150):
 * функция возвращала обход против часовой, то есть у каждой призмы — у вещи
 * чертежа, у тела метки — боковые нормали смотрели **внутрь**. Следствие
 * видно глазами: ближняя сторона шкафа отсекалась как отвёрнутая, и вместо неё
 * рисовалась дальняя — сквозь переднюю стенку шкафа был виден его задник. У
 * плит пола и потолка нормаль задана прямо, поэтому их это не касалось, и
 * тестами не ловилось: они считали грани, а не их направление.
 *
 * Ось `y` смотрит вниз, и при этой формуле у часового на экране обхода сумма
 * **положительная**: проверено на квадрате, у которого наружу смотрят все
 * четыре нормали.
 */
export function volumeClockwise(corners) {
  let sum = 0;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    sum += corners[j].x * corners[i].y - corners[i].x * corners[j].y;
  }
  return sum >= 0 ? corners : [...corners].reverse();
}

export function volumeShare01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}
