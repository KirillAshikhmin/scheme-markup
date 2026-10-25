// «Объём»: час суток — одно непрерывное время, место объекта, настоящее место
// солнца и луны, фаза, погода в кадре (`volumeMood`).
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import {
  VOLUME_DAY_MIN,
  VOLUME_HORIZON_DEG,
  VOLUME_SUNRISE_MIN,
  VOLUME_SUNSET_MIN,
  volumeDayCosH,
  volumeDeclDeg,
  volumeWrapMinutes,
} from "../clockMath.js";
import { projectCoords, projectTopAzimuth } from "../model.js";
import { DEG, VOLUME_LAND_RGB, VOLUME_NIGHT_RGB } from "./measures.js";
import { volumeShare01, volumeTintCss, volumeTintRgb } from "./faces.js";
import { volumeMix } from "./shapes.js";
import {
  VOLUME_BIRCH_CROWN,
  VOLUME_BIRCH_MARK,
  VOLUME_BIRCH_TRUNK,
  VOLUME_BUSH,
  VOLUME_CITY_ASPHALT,
  VOLUME_CITY_ASPHALT_FAR,
  VOLUME_CITY_CARS,
  VOLUME_CITY_GLASS,
  VOLUME_CITY_LIT_MAX,
  VOLUME_CITY_MARK,
  VOLUME_CITY_ROOF,
  VOLUME_CITY_SIDE,
  VOLUME_CITY_SIDE_FAR,
  VOLUME_CITY_WALL,
  VOLUME_CITY_WALL_FAR,
  VOLUME_CLOUD,
  VOLUME_CLOUD_DARK,
  VOLUME_CROWN,
  VOLUME_CROWN_DARK,
  VOLUME_CROWN_FAR,
  VOLUME_HILL_FAR,
  VOLUME_HILL_NEAR,
  VOLUME_MOUNTAIN_FAR_ROCK,
  VOLUME_MOUNTAIN_FAR_SNOW,
  VOLUME_MOUNTAIN_ROCK,
  VOLUME_MOUNTAIN_SNOW,
  VOLUME_RIVER_FAR,
  VOLUME_RIVER_NEAR,
  VOLUME_ROAD_FAR,
  VOLUME_ROAD_NEAR,
  VOLUME_TRUNK,
  VOLUME_WILLOW,
  volumeBackdropKindOf,
} from "./palette.js";

// ——— час суток: одно непрерывное время (таск 181, G282) —————————————————
//
// Слова заказчика: «сразу заложи по фону что бы можно было указывать время
// суток и фон менялся, утро, день, вечер, ночь. при чем плавно менялся. на небе
// должно двигаться солнце днём и месяц ночью… ну и само собой в виде города
// должны загораться окна и т.д. как живой город, и внутри объекта меняться
// освещение». И отдельно: «ночь не сильно тёмная должна быть, что бы было
// понятно что ночь, но различимо всё».
//
// ——— это не четыре картинки ————————————————————————————————————————————
//
// Утро, день, вечер и ночь здесь — **слова, а не состояния**. Считается одно
// число: высота солнца над горизонтом в этот миг. Из неё выходит всё — цвет
// неба, тон комнаты, яркость окон города, звёзды, длина и сила тени, — и
// выходит непрерывно: ни одного `if (ночь)` в рисовании нет. Слово нужно
// только человеку в окне параметров, и считается оно по часам
// (`volumeDayPhase`), а не по высоте: «вечер» наступает в шесть, даже если небо
// ещё светлое.
//
// ——— где темнеет ———————————————————————————————————————————————————————
//
// Ночь — **не завеса поверх кадра**, а доля в цвете каждой грани
// (`volumeTintRgb` в `volumeFill`). Завеса была бы и дешевле, и неправильна
// сразу дважды: она легла бы на небо, которому ночью нужна темнота глубже
// комнатной, и она не дала бы **светящемуся** окну города остаться светящимся —
// а свет в окнах заказчик назвал прямо. Цена у доли в цвете нулевая: три
// умножения на грань в том же счёте, где уже считается светлота лампы.
//
// Потолок доли — `VOLUME_NIGHT_SHARE`. Было 0,45 — ответ на «ночь не сильно
// тёмная»; после сборки сценариев заказчик сказал: «сделай ночь темнее
// процентов на 40», и доля стала 0,63. Стена 216·212·204 ночью становится
// 91·95·110 — тёмной, но различимой, а метки, их контуры и рамка выделения не
// темнеют вовсе (контур и стрелка — линии, а линии часом не красятся). Ночь
// узнаётся небом и тоном, а светят её лампы и луна.
//
// ——— раз в секунду, а при стоячем времени — никогда ———————————————————
//
// Слово заказчика: «достаточно оптимизировано что бы было, не каждый кадр, а,
// хотя бы раз в секунду». Поэтому всё, что зависит от времени, собрано в один
// снимок — `volumeMood` — и считается не в кадре: поле просит его не чаще раза
// в секунду (`VOLUME_MOOD_MS`) и держит готовым. Кадр берёт готовые цвета и не
// считает про время ничего. При остановленном времени снимок считается **один
// раз**: ни пересчёта, ни перерисовки, ни таймера.

/** Чаще этого фон не пересчитывается — прямое требование заказчика. */
export const VOLUME_MOOD_MS = 1000;
/**
 * То же, но с отметкой «Плавные светила» (таск 192, G292): тридцать кадров в
 * секунду, слова заказчика — «обновляй не раз в секунду, а в 30FPS».
 *
 * Отметка меняет **только частоту** и больше ничего: тот же снимок, та же
 * арифметика, то же правило «при стоячем времени таймера нет вовсе». 33 мс — не
 * круглое число нарочно: 1000/30 = 33,33, и округлять его вверх значило бы
 * отдать заказчику 30,3 кадра вместо 30.
 */
export const VOLUME_MOOD_SMOOTH_MS = Math.round(1000 / 30);

/**
 * Как часто пересчитывается снимок часа. **Один хозяин у этого числа**: поле
 * спрашивает здесь, а не выбирает само — иначе «раз в секунду» и «тридцать раз»
 * жили бы в двух местах.
 *
 * Цена названа числом (замер на объекте заказчика, 25 стен и 86 меток): снимок
 * часа — 7 мкс, грани тени дома — 16 мкс, а сам кадр — 400 мкс. То есть всё
 * время, которое зависит от часа, стоит 5% кадра, и делить снимок на «быстрое»
 * (светило) и «медленное» (тень, свет в окнах) незачем: деление сэкономило бы
 * 20 мкс из 440 и завело бы в сборке вторые часы.
 */
export function volumeMoodMs(smooth) {
  return smooth ? VOLUME_MOOD_SMOOTH_MS : VOLUME_MOOD_MS;
}
export const VOLUME_NIGHT_SHARE = 0.63;
/**
 * Ночь под полной луной (правка после сборки сценариев): «с полной луной можно
 * на 20% темнее текущего уровня» — то есть прежних 0,45 · 1,2. Между ней и
 * безлунной ночью доля идёт по фазе и высоте луны (`volumeMood`), и тянется
 * ночь под луной не к синему, а к серому — луна светит белым.
 */
export const VOLUME_MOON_NIGHT_SHARE = 0.54;
export const VOLUME_MOON_NIGHT_RGB = [40, 42, 50];
/**
 * Угловой размер месяца. Мельче солнца, но обоим он **нарисованный, а не
 * настоящий**: у настоящих светил радиус 0,26°, и в кадре с полем зрения 90°
 * это три точки — пятнышко, у которого не видно ни цвета, ни фазы. Место на
 * небе с таска 190 настоящее (`volumeSunAt`, `volumeMoonAt`), размер — нет, и
 * это разные вопросы.
 */
export const VOLUME_MOON_SIZE_DEG = 1.9;
/**
 * Точек на каждую кромку месяца. Двадцать четыре — это шаг 7,5°: на диске в
 * двадцать точек экрана излома не видно, а ломаная остаётся дешёвой —
 * `volumeMoonShape` отдаёт 48 точек, и это весь счёт месяца в кадре.
 */
export const VOLUME_MOON_STEPS = 24;
/**
 * Тоньше этой освещённой доли месяц не рисуется вовсе — это и есть новолуние.
 * Сотая доля диска на двадцати точках экрана даёт волосок в четверть точки:
 * нарисованный, он читался бы соринкой на стекле, а не луной.
 */
export const VOLUME_MOON_THIN = 0.01;
/**
 * Дом без координат: широта и склонение, по которым идёт дуга, когда координат
 * у объекта нет. Равноденствие в средней полосе — то есть дуга настоящая, а
 * рассвет с закатом остаются словами заказчика (9:00 и 21:00), на которые она
 * растягивается. Разбор — у `volumeSkyPlace`.
 */
export const VOLUME_SITE_FALLBACK = { latDeg: 55, lonDeg: 0 };
/** Синодический месяц: от новолуния до новолуния. */
export const VOLUME_MOON_MONTH_DAYS = 29.530588853;
/**
 * Опорное новолуние — 6 января 2000 года, 18:14 UTC, в сутках от эпохи. От него
 * считается возраст луны, а из возраста — и фаза, и место на небе.
 */
export const VOLUME_MOON_EPOCH_DAY = Date.UTC(2000, 0, 6, 18, 14) / 86400000;

/** Доля в отрезке, зажатая по краям: ею считается всё непрерывное ниже. */
function volumeShare(value, from, to) {
  if (from === to) return value >= to ? 1 : 0;
  return Math.max(0, Math.min(1, (value - from) / (to - from)));
}

// ——— место объекта (таск 188) ——————————————————————————————————————————
//
// Координаты и направление верха чертежа — **свойства объекта** (решение
// заказчика в G283 и G284), и живут они в `project.site`. Объём их только
// читает, и читает **чужой дверью**: `projectCoords` и `projectTopAzimuth` —
// единственные хозяева этих полей, они же разбирают мусор и пустоту. Свой
// разбор здесь был бы вторым ответом на вопрос «где стоит дом», и разошёлся бы
// он ровно в тот день, когда формат поправят.
//
// Нет координат — рассвет и закат берутся умолчанием заказчика (9:00 и 21:00),
// нет направления — верх чертежа смотрит на север. Ни одного поля объём не
// создаёт: открыть объём у объекта без свойств — ноль изменений (G68).

/**
 * Место объекта: широта, долгота и направление верха чертежа (в градусах от
 * севера по часовой стрелке).
 */
export function volumeSiteOf(project) {
  const coords = projectCoords(project);
  return {
    latDeg: coords ? coords.lat : null,
    lonDeg: coords ? coords.lon : null,
    topDeg: projectTopAzimuth(project),
  };
}

/**
 * Как час называется. Отрезки считаются от рассвета и заката, а не от
 * полуночи: «утро» — это вокруг рассвета, а не «до двенадцати».
 *
 * При умолчании (9:00 и 21:00) выходит: ночь до 8, утро 8–12, день 12–18,
 * вечер 18–22, дальше снова ночь.
 */
export function volumeDayPhase(minutes, times) {
  const rise = times ? Number(times.riseMin) : VOLUME_SUNRISE_MIN;
  const set = times ? Number(times.setMin) : VOLUME_SUNSET_MIN;
  const now = volumeWrapMinutes(minutes);
  const inside = (from, to) => {
    const a = volumeWrapMinutes(from);
    const b = volumeWrapMinutes(to);
    return a <= b ? now >= a && now < b : now >= a || now < b;
  };
  if (inside(rise - 60, rise + 180)) return "morning";
  if (inside(set - 180, set + 60)) return "evening";
  if (inside(rise + 180, set - 180)) return "day";
  return "night";
}

/**
 * Сторона света панорамы из стороны света по компасу.
 *
 * У панорамы `az` — угол в осях чертежа: ноль смотрит вправо по листу, 90° —
 * вниз. У компаса ноль на севере и счёт по часовой стрелке. Верх листа смотрит
 * на `topDeg` (таск 188), значит вправо по листу — это `topDeg + 90°`, и
 * перевод выходит один:
 *
 *     az = компас − topDeg − 90°
 *
 * Проверка: верх на север (`topDeg` = 0), полдень, солнце на юге (компас 180°)
 * — `az` = 90°, то есть вниз по листу. Ровно туда, куда на чертеже с севером
 * вверху смотрит юг.
 */
export function volumePanoramaAz(compassDeg, topDeg = 0) {
  return (((Number(compassDeg) - (Number(topDeg) || 0) - 90) % 360) + 360) % 360;
}

// ——— настоящее место светил (таск 190, G288) ————————————————————————————
//
// Слова заказчика: «почему солнце и луна так низко над горизонтом? это их
// реальное положение по координатам или просто так нарисовал? Надо сделать
// реальное».
//
// До этого таска высота была **числом** (14°), а дуга — половиной синусоиды от
// рассвета к закату. Теперь высота и сторона света считаются по дате, времени и
// координатам объекта, и счёт у солнца с месяцем **один** (`volumeBodyAt`):
// меняются только склонение и часовой угол.
//
// ——— чем считается ————————————————————————————————————————————————————
//
// Склонение — наклон оси, помноженный на синус долготы светила по эклиптике
// (`volumeDeclDeg`); долготу солнца даёт день года (`volumeSunLonDeg`, формула
// Купера, та же, что считала рассвет в таске 181). Высота и азимут — из
// сферического треугольника «полюс — зенит — светило»:
//
//     sin h = sin φ · sin δ + cos φ · cos δ · cos H
//     cos A = (sin δ − sin h · sin φ) / (cos h · cos φ),   A → 360 − A после полудня
//
// где `φ` — широта, `δ` — склонение, `H` — часовой угол (ноль в полдень, 15° на
// час), `A` — азимут от севера по часовой. Из этого и выходит то, чего просил
// заказчик: в Москве 21 июня солнце в полдень стоит на 57°, а 21 декабря — на
// 11°, и обе цифры совпадают со справочными.
//
// ——— почему рассвет сходится ровно ——————————————————————————————————————
//
// Рассвет и закат (таск 181) считаются из **того же** склонения и того же
// горизонта `h₀` = −0,833°: в минуту рассвета `cos H = cos H₀`, то есть высота
// ровно `h₀`. Высота светила на небе отсчитывается от этого же горизонта
// (`height = h − h₀`), поэтому её ноль приходится ровно на рассвет и закат из
// подписи окна — тождеством, а не подгонкой. Проверено тестом до 10⁻⁶ градуса.
//
// ——— без координат ——————————————————————————————————————————————————————
//
// Координат нет — остаются слова заказчика: 9:00 и 21:00. Дуга при этом всё
// равно настоящая: дом ставится на широту 55° в равноденствие
// (`VOLUME_SITE_FALLBACK`), а часовой угол **растягивается** на окно
// 9:00…21:00 — `H = H₀ · (t − полдень) / половина дня`. С координатами половина
// дня и есть `H₀/15` часов, растяжка обращается в единицу, и формула остаётся
// одна на оба случая.

/**
 * Где дом и куда у него смотрит день: широта, склонение, солнечный полдень,
 * половина дня и шаг часового угла.
 *
 * Собирается из `volumeDayTimes`, а чего там нет — берётся умолчанием. Это
 * важно: `times` часто составляют руками (стенд, тест, старый вызов), и такой
 * объект обязан давать настоящую дугу, а не падать.
 */
export function volumeSkyPlace(times) {
  const riseMin = times && Number.isFinite(Number(times.riseMin)) ? Number(times.riseMin) : VOLUME_SUNRISE_MIN;
  const setMin = times && Number.isFinite(Number(times.setMin)) ? Number(times.setMin) : VOLUME_SUNSET_MIN;
  const bySite = Boolean(times && times.bySite && Number.isFinite(Number(times.latDeg)));
  const latDeg = bySite ? Number(times.latDeg) : VOLUME_SITE_FALLBACK.latDeg;
  const declDeg = bySite ? Number(times.declDeg) : 0;
  const sunLonDeg = bySite ? Number(times.sunLonDeg) : 0;
  const noonMin = bySite && Number.isFinite(Number(times.noonMin)) ? Number(times.noonMin) : (riseMin + setMin) / 2;
  const halfMin = (setMin - riseMin) / 2;
  // Шаг часового угла: сколько градусов приходится на минуту. По координатам
  // выходит ровно 0,25° — то есть 15° в час, настоящая угловая скорость; без
  // них окно заказчика растягивает ту же дугу.
  const cosH = volumeDayCosH(latDeg, declDeg);
  const riseAngleDeg = (Math.acos(Math.max(-1, Math.min(1, cosH))) / DEG) || 0;
  return {
    latDeg,
    declDeg,
    sunLonDeg,
    noonMin,
    halfMin,
    hourScale: halfMin > 0 ? riseAngleDeg / halfMin : 0.25,
    dayNumber: times && Number.isFinite(Number(times.dayNumber)) ? Number(times.dayNumber) : 0,
    tzHours: times && Number.isFinite(Number(times.tzHours)) ? Number(times.tzHours) : 0,
  };
}

/** Часовой угол солнца в эту минуту: ноль в полдень, восток в минусе. */
export function volumeHourAngleDeg(minutes, place) {
  const now = volumeWrapMinutes(minutes);
  // Минуты от полудня **ближним путём** через сутки: полдень по долготе может
  // стоять и у полуночи, и путь «через вчера» тогда короче.
  const away = volumeWrapMinutes(now - place.noonMin + VOLUME_DAY_MIN / 2) - VOLUME_DAY_MIN / 2;
  return away * place.hourScale;
}

/**
 * Светило на небе: высота над горизонтом и сторона света по компасу.
 *
 * Счёт один на солнце и на месяц — у них разные склонение и часовой угол, а
 * треугольник тот же. Второго такого счёта в сборке быть не должно: разойдись
 * они, тень поехала бы от одного солнца, а свет в окнах от другого.
 */
export function volumeBodyAt(latDeg, declDeg, hourDeg) {
  const lat = Number(latDeg) * DEG;
  const decl = Number(declDeg) * DEG;
  const hour = (((Number(hourDeg) + 180) % 360) + 360) % 360 - 180;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hour * DEG);
  const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  const flat = Math.cos(altDeg * DEG) * Math.cos(lat);
  // В зените (и на полюсе) азимут не определён вовсе: делить не на что. Там
  // берётся полдень — юг в северном полушарии, север в южном.
  const cosAz =
    Math.abs(flat) < 1e-9 ? (lat >= 0 ? -1 : 1) : (Math.sin(decl) - Math.sin(altDeg * DEG) * Math.sin(lat)) / flat;
  const azDeg = Math.acos(Math.max(-1, Math.min(1, cosAz))) / DEG;
  return { altDeg, compassDeg: hour > 0 ? 360 - azDeg : azDeg };
}

/**
 * Где солнце в этот миг.
 *
 * `height` — высота над горизонтом в градусах, и она **уходит в минус**: ею
 * считается вся плавность (сумерки, звёзды, тон комнаты, тень), и обрыв на нуле
 * дал бы ступеньку ровно там, где её лучше всего видно. Ноль высоты — рассвет и
 * закат из подписи окна, ровно те же минуты.
 *
 * Полярный день и полярная ночь выходят из формулы сами: высота просто не
 * пересекает нуль ни разу за сутки. Отдельных ветвей под них больше нет — и это
 * не упрощение, а честность, потому что ветвь говорила бы то же самое.
 */
export function volumeSunAt(minutes, times, topDeg = 0) {
  const place = volumeSkyPlace(times);
  const hourDeg = volumeHourAngleDeg(minutes, place);
  const at = volumeBodyAt(place.latDeg, place.declDeg, hourDeg);
  const height = at.altDeg - VOLUME_HORIZON_DEG;
  return { up: height > 0, height, rise: height, az: volumePanoramaAz(at.compassDeg, topDeg), hourDeg };
}

/**
 * Где месяц и какой он.
 *
 * **Своим путём, а не солнечной дугой** (прямое слово тикета). Всё выходит из
 * одного числа — возраста луны в её месяце (`volumeMoonAgeDays`):
 *
 *   - **элонгация** `360° · возраст / месяц` — насколько луна ушла от солнца к
 *     востоку. Она же двигает луну по небу: часовой угол у неё солнечный минус
 *     элонгация, и за сутки она отстаёт от солнца на 12,2° — то есть всходит
 *     почти на час позже, чем вчера, как и положено;
 *   - **склонение** — та же эклиптика, что у солнца, только долгота своя:
 *     солнечная плюс элонгация. За месяц луна обходит её целиком, поэтому
 *     ходит она то высоко, то низко, а не по одной борозде;
 *   - **фаза** — `edge = cos(элонгация)`, подписанная полуось внутренней кромки
 *     серпа. Новолуние даёт +1 (кромка села на лимб, светить нечему),
 *     четверть — 0 (кромка прямая), полнолуние — −1 (кромка ушла на другой
 *     лимб, диск полон). Освещённая доля из неё же: `(1 − edge)/2`.
 *
 * **Точность.** Это правдоподобие, а не эфемериды, и вот чем за него заплачено:
 * луна идёт средним движением, без эвекции и вариации (до ±6° по долготе),
 * наклон её орбиты в 5,1° опущен (склонение заужено до ±23,4° вместо ±28,6°),
 * параллакса нет. Отсюда: фаза верна до четверти суток возраста, восход и заход
 * — до часа, высота — до пяти градусов. Для кадра, где месяц нарисован в семь
 * раз крупнее настоящего, этого довольно: видно, что серп растёт и убывает, что
 * полная луна стоит всю ночь, а молодая садится вслед за солнцем.
 */
export function volumeMoonAt(minutes, times, topDeg = 0) {
  const place = volumeSkyPlace(times);
  const ageDays = volumeMoonAgeDays(place.dayNumber, minutes, place.tzHours);
  const elongDeg = (360 * ageDays) / VOLUME_MOON_MONTH_DAYS;
  const declDeg = volumeDeclDeg(place.sunLonDeg + elongDeg);
  const at = volumeBodyAt(place.latDeg, declDeg, volumeHourAngleDeg(minutes, place) - elongDeg);
  const height = at.altDeg - VOLUME_HORIZON_DEG;
  const edge = Math.cos(elongDeg * DEG);
  return {
    up: height > 0,
    height,
    rise: height,
    az: volumePanoramaAz(at.compassDeg, topDeg),
    ageDays,
    elongDeg,
    edge,
    lit: (1 - edge) / 2,
  };
}

/**
 * Возраст луны в сутках от новолуния: 0 … 29,53.
 *
 * Считается от опорного новолуния средним месяцем. Настоящие новолуния гуляют
 * вокруг среднего на ±0,3 суток — это 4° фазы, то есть толщина серпа у
 * новолуния, и в кадре такая разница не читается.
 */
export function volumeMoonAgeDays(dayNumber, minutes, tzHours = 0) {
  const day = Number(dayNumber) + (volumeWrapMinutes(minutes) - (Number(tzHours) || 0) * 60) / VOLUME_DAY_MIN;
  const age = (day - VOLUME_MOON_EPOCH_DAY) % VOLUME_MOON_MONTH_DAYS;
  return age < 0 ? age + VOLUME_MOON_MONTH_DAYS : age;
}

/**
 * Куда у месяца смотрит освещённый край: угол от «вверх по экрану» по часовой
 * стрелке.
 *
 * Считается **по настоящим местам обоих светил**, а не назначается: рожки серпа
 * обязаны смотреть прочь от солнца, где бы оно ни стояло — в том числе под
 * горизонтом, откуда подсвечивает молодой месяц снизу.
 *
 * Счёт — три вектора в плоскости неба у месяца: сам месяц `m`, зенит и сторона
 * роста азимута. Направление на солнце, из которого вычтена составляющая вдоль
 * `m`, и даёт освещённую сторону; её угол меряется от зенита. Камера объёма не
 * кренится, поэтому зенит на экране — это «вверх», и угол переносится в кадр
 * как есть.
 */
export function volumeMoonTiltDeg(sun, moon) {
  const dir = (body) => {
    const alt = (Number(body && body.rise) || 0) * DEG;
    const az = (Number(body && body.az) || 0) * DEG;
    const flat = Math.cos(alt);
    return { x: flat * Math.cos(az), y: flat * Math.sin(az), z: Math.sin(alt), az, alt };
  };
  const m = dir(moon);
  const s = dir(sun);
  const dot = s.x * m.x + s.y * m.y + s.z * m.z;
  // Солнце за вычетом составляющей вдоль месяца — это и есть «куда светит».
  const px = s.x - dot * m.x;
  const py = s.y - dot * m.y;
  const pz = s.z - dot * m.z;
  // Зенит в той же плоскости и сторона роста азимута (на экране — вправо).
  const uz = 1 - m.z * m.z;
  const ux = -m.z * m.x;
  const uy = -m.z * m.y;
  const rx = -Math.sin(m.az);
  const ry = Math.cos(m.az);
  const up = px * ux + py * uy + pz * uz;
  const right = px * rx + py * ry;
  return Math.atan2(right, up) / DEG;
}

/**
 * Очерк месяца: замкнутая ломаная вокруг его середины, в точках экрана.
 *
 * **Одна формула на весь круг фаз** (G290) — и это же починка дефекта D48
 * («вместо серпа две пересекающиеся дуги, фигура похожа на линзу»). Прежний
 * месяц рисовался двумя окружностями в одном пути с разным обходом: внутренняя
 * вырезала дыру, но торчала за пределы диска, и торчащий кусок правило непустого
 * обхода заливало — отсюда вторая дуга, выгнутая не в ту сторону.
 *
 * У настоящего серпа кромки две и обе лежат на диске:
 *
 *   - **внешняя** — сам лимб, полуокружность радиуса `R`;
 *   - **внутренняя** — терминатор, то есть окружность раздела света и тени,
 *     повёрнутая к нам ребром: на картинке это **полуэллипс** с той же большой
 *     полуосью `R` и малой `edge · R`.
 *
 * `edge` приходит со знаком (`volumeMoonAt`), и знак — это и есть весь круг
 * фаз: `+1` новолуние, `0` четверть (полуось нулевая, кромка — прямая), `−1`
 * полнолуние. Обе кромки считаются **одной** записью `(edge·R·cos u, R·sin u)`,
 * поэтому через четверть фигура проходит без скачка: полуось меняет знак, а
 * ломаная остаётся той же.
 *
 * `tiltDeg` поворачивает очерк так, чтобы освещённая сторона смотрела на солнце
 * (`volumeMoonTiltDeg`): рожки растущего и убывающего смотрят в разные стороны
 * сами, без ветвей «растёт или убывает».
 */
export function volumeMoonShape(radius, edge, tiltDeg = 0, steps = VOLUME_MOON_STEPS) {
  const turn = Number(tiltDeg) * DEG;
  // Орт освещённой стороны и орт поперёк неё (у экрана ось `y` смотрит вниз).
  const lit = { x: Math.sin(turn), y: -Math.cos(turn) };
  const across = { x: Math.cos(turn), y: Math.sin(turn) };
  const out = [];
  const put = (along, side) => {
    out.push({ x: lit.x * along + across.x * side, y: lit.y * along + across.y * side });
  };
  const count = Math.max(4, Math.round(steps));
  const cut = Math.max(-1, Math.min(1, Number(edge)));
  // Лимб: от рожка к рожку через самую освещённую точку.
  for (let index = 0; index <= count; index += 1) {
    const u = -Math.PI / 2 + (Math.PI * index) / count;
    put(radius * Math.cos(u), radius * Math.sin(u));
  }
  // Терминатор: обратно, той же записью со своей полуосью.
  for (let index = count - 1; index >= 1; index -= 1) {
    const u = -Math.PI / 2 + (Math.PI * index) / count;
    put(radius * cut * Math.cos(u), radius * Math.sin(u));
  }
  return out;
}

/**
 * Насколько стемнело: доля тона ночи в каждой грани.
 *
 * Начинает темнеть не на закате, а когда солнце уже низко (6°): в жизни
 * золотой час темнее полудня, и ступенька ровно на горизонте читалась бы
 * выключателем. Потолок — `VOLUME_NIGHT_SHARE`: «сделай ночь темнее
 * процентов на 40».
 */
export function volumeNightShare(height) {
  return VOLUME_NIGHT_SHARE * volumeShare(Number(height) || 0, 6, -8);
}

/**
 * Небо по высоте солнца: верхний и нижний цвет растяжки.
 *
 * Небо **не красится часом** (`volumeTintRgb` к нему не применяется) — у него
 * свои цвета на каждую высоту, и ночью оно темнее комнаты нарочно: иначе ночь
 * не узнавалась бы, а комнату пришлось бы гасить до «ничего не видно».
 *
 * Полуденные цвета — ровно те, что были до таска 181: в полдень фон байт в
 * байт прежний.
 */
const VOLUME_SKY_KEYS = [
  { h: 14, top: [141, 191, 230], low: [220, 234, 244] },
  { h: 6, top: [132, 183, 226], low: [223, 231, 233] },
  { h: 1, top: [111, 159, 203], low: [206, 159, 114] },
  { h: -3, top: [60, 90, 134], low: [150, 104, 92] },
  { h: -7, top: [38, 58, 99], low: [74, 69, 104] },
  { h: -11, top: [15, 24, 48], low: [30, 42, 74] },
];

export function volumeSkyColors(height) {
  const value = Number(height) || 0;
  const keys = VOLUME_SKY_KEYS;
  if (value >= keys[0].h) return { top: keys[0].top, low: keys[0].low };
  for (let index = 1; index < keys.length; index += 1) {
    const upper = keys[index - 1];
    const lower = keys[index];
    if (value < lower.h) continue;
    const share = volumeShare(value, upper.h, lower.h);
    const mix = (a, b) => [
      Math.round(a[0] + (b[0] - a[0]) * share),
      Math.round(a[1] + (b[1] - a[1]) * share),
      Math.round(a[2] + (b[2] - a[2]) * share),
    ];
    return { top: mix(upper.top, lower.top), low: mix(upper.low, lower.low) };
  }
  const last = keys[keys.length - 1];
  return { top: last.top, low: last.low };
}

/** Цвет солнца: белое-жёлтое высоко, рыжее у горизонта. */
function volumeSunColors(height) {
  const share = volumeShare(Number(height) || 0, 10, 0);
  const mix = (a, b) => [
    Math.round(a[0] + (b[0] - a[0]) * share),
    Math.round(a[1] + (b[1] - a[1]) * share),
    Math.round(a[2] + (b[2] - a[2]) * share),
  ];
  const body = mix([255, 243, 196], [255, 164, 86]);
  const halo = mix([255, 243, 196], [255, 136, 70]);
  return { body: "rgb(" + body.join(",") + ")", halo: "rgba(" + halo.join(",") + ",0.35)" };
}

/**
 * Снимок часа: всё, что зависит от времени, в одном объекте.
 *
 * Считается не чаще раза в секунду и **не в кадре**. Кадр берёт отсюда готовые
 * цвета и готовое место светила; при стоячем времени снимок считается один раз
 * и живёт, пока человек не тронет часы.
 */
export function volumeMood(options = {}) {
  const times = options.times || { riseMin: VOLUME_SUNRISE_MIN, setMin: VOLUME_SUNSET_MIN };
  const topDeg = Number(options.topDeg) || 0;
  const minutes = volumeWrapMinutes(options.minutes === undefined ? VOLUME_DAY_MIN / 2 : options.minutes);
  const kind = volumeBackdropKindOf(options.kind);
  const sun = volumeSunAt(minutes, times, topDeg);
  const place = volumeMoonAt(minutes, times, topDeg);
  const share = volumeNightShare(sun.height);
  // Погода (правка после сборки сценариев): `weatherAt` из `weather.js`. Нет
  // её — снимок тот же, что до правки: лето и ясное небо, вызов в вызов.
  const weather = options.weather || null;
  const see = weather ? volumeShare01(weather.sun) : 1;
  const sky = volumeWeatherSky(volumeSkyColors(sun.height), weather, share);
  // Месяц виден не всегда, когда он над горизонтом: настоящая луна половину
  // месяца стоит в дневном небе и там не читается вовсе. Поэтому у него своя
  // яркость — от высоты **солнца**, как у звёзд, только порог выше: месяц
  // проступает уже в сумерках, когда звёзд ещё нет.
  const moon = {
    ...place,
    tiltDeg: volumeMoonTiltDeg(sun, place),
    glow: volumeShare(sun.height, 3, -4),
  };
  // Свет луны (правка после сборки сценариев): «слабое, и чем полнее луна, тем
  // сильнее, ну и белым светом» и «с полной луной можно на 20% темнее текущего
  // уровня. Динамически от фазы менять». Доля — освещённая часть диска на то,
  // видна ли луна и высоко ли стоит. Ею ночь снаружи светлее и белее — под
  // полной луной тьма `VOLUME_MOON_NIGHT_SHARE` вместо `VOLUME_NIGHT_SHARE`, — а
  // при физическом свете луна ещё и кладёт пятна в окна (`volumeMoonSpotFaces`).
  // Луну, как и солнце, закрывают тучи (`see`).
  const moonLight = {
    az: moon.az,
    rise: moon.rise,
    fade: moon.up ? volumeShare01(moon.lit) * moon.glow * volumeShare(moon.height, 1, 7) * see : 0,
  };
  let tint =
    moonLight.fade > 0
      ? {
          rgb: volumeMix(VOLUME_NIGHT_RGB, VOLUME_MOON_NIGHT_RGB, moonLight.fade),
          share: share * (1 - (1 - VOLUME_MOON_NIGHT_SHARE / VOLUME_NIGHT_SHARE) * moonLight.fade),
        }
      : { rgb: VOLUME_NIGHT_RGB, share };
  const season = weather && VOLUME_SEASON_PALETTE[weather.season] ? weather.season : "summer";
  if (weather) tint = volumeWeatherTint(tint, weather, share, season);
  return {
    minutes,
    times,
    topDeg,
    kind,
    phase: volumeDayPhase(minutes, times),
    sun,
    moon,
    moonLight,
    tint,
    sky: { top: "rgb(" + sky.top.join(",") + ")", low: "rgb(" + sky.low.join(",") + ")" },
    sunColors: volumeSunColors(sun.height),
    // Звёзды зажигаются после сумерек и только там, где небо уже тёмное; тучи
    // их закрывают.
    stars: volumeShare(sun.height, -2, -7) * (weather ? 1 - volumeShare01(weather.cloud) : 1),
    // Окна города: к ночи загораются, днём гаснут (слова заказчика «как живой
    // город»). Доля — сколько окон светится, а какие именно, решает не случай,
    // а сами окна (`volumeCityWindowLit`): иначе они мигали бы каждую секунду.
    cityLit: VOLUME_CITY_LIT_MAX * volumeShare(sun.height, 4, -6),
    // Тень дома: куда её кладёт солнце сейчас и насколько она видна. У
    // горизонта она не тянется в бесконечность, а гаснет — так же плавно, как
    // темнеет небо.
    shadow: { az: sun.az, rise: sun.rise, fade: sun.up ? volumeShare(sun.height, 1, 7) * see : 0 },
    palette: volumeBackdropPalette(tint, season),
    // Погода и время года — для неба, листвы, тумана и осадков.
    weather,
    season,
  };
}

// ——— погода в кадре (правка после сборки сценариев) ————————————————————————
//
// Слова заказчика: «Зимой снег, осенью жёлтые листья и т.д. а так же небо —
// ясное, пасмурное, облачное. Может быть туман, снег и дождь». Что погода
// меняет в «Объёме»:
//
//   — **небо**: тучи сводят растяжку к серому, туман — к белёсому; солнце,
//     луна и звёзды за сплошными тучами не видны;
//   — **свет**: пасмурный день темнее ясного и серее (`volumeWeatherTint`),
//     тень дома и солнечные пятна гаснут по доле солнца (`weather.sun`);
//   — **время года**: земля, листва, кусты и холмы своим цветом
//     (`VOLUME_SEASON_PALETTE`), зимой лиственные деревья голые, а на елях снег;
//   — **туман**: всё снаружи тонет в нём по дальности (`tint.fog`);
//   — **осадки** — дождь и снег — рисует поле поверх кадра (`panels/volume.js`).

/** Насколько пасмурный день темнее ясного, и цвет этой тьмы — серый, а не синий. */
export const VOLUME_OVERCAST_DIM = 0.16;
export const VOLUME_OVERCAST_RGB = [92, 98, 108];
/** Дождь и снег темнят ещё, туман — чуть. */
const VOLUME_RAIN_DIM = 0.08;
const VOLUME_FOG_DIM = 0.06;
/** Туман: цвет, предел густоты и дальность, на которой он съедает треть цвета. */
export const VOLUME_FOG_RGB = [206, 210, 214];
const VOLUME_FOG_SHARE = 0.85;
/** Густота тумана над землёй — одна у фона ниже горизонта и у плиты сцены. */
export const VOLUME_FOG_GROUND = 0.75;
export const VOLUME_FOG_MM = 60000;
/** Серое небо под тучами и белёсое в тумане. */
const VOLUME_OVERCAST_SKY = { top: [156, 163, 172], low: [192, 197, 203] };

function volumeMixRgb(a, b, t) {
  return [0, 1, 2].map((index) => Math.round(a[index] + (b[index] - a[index]) * t));
}

/**
 * Небо по погоде: под тучами растяжка сводится к серому (ночью — к серому той
 * же темноты), в тумане — к его цвету.
 */
function volumeWeatherSky(sky, weather, share) {
  if (!weather) return sky;
  const cloud = volumeShare01(weather.cloud);
  const overcast = Math.max(0, (cloud - 0.5) / 0.5);
  const fog = volumeShare01(weather.fog);
  if (!(overcast > 0) && !(fog > 0)) return sky;
  // Темнота неба та же, что у часа: серая растяжка темнеет вместе с ночью.
  const dark = Math.min(1, share / VOLUME_NIGHT_SHARE);
  const shade = (rgb) => volumeMixRgb(rgb, [26, 30, 38], dark * 0.85);
  let top = volumeMixRgb(sky.top, shade(VOLUME_OVERCAST_SKY.top), overcast * 0.85);
  let low = volumeMixRgb(sky.low, shade(VOLUME_OVERCAST_SKY.low), overcast * 0.85);
  if (fog > 0) {
    top = volumeMixRgb(top, shade(VOLUME_FOG_RGB), fog * 0.7);
    low = volumeMixRgb(low, shade(VOLUME_FOG_RGB), fog * 0.95);
  }
  return { top, low };
}

/**
 * Тон часа по погоде: днём тучи, дождь и туман темнят и серят свет; ночью
 * темнее уже некуда — тон тот же. У тона появляются земля времени года
 * (`land`, ею красится плита сцены) и туман (`fog`), если он есть.
 */
function volumeWeatherTint(tint, weather, share, season) {
  const day = 1 - Math.min(1, share / VOLUME_NIGHT_SHARE);
  const wet = Math.max(volumeShare01(weather.rain), volumeShare01(weather.snow));
  const fog = volumeShare01(weather.fog);
  const dim = (VOLUME_OVERCAST_DIM * (1 - volumeShare01(weather.sun)) + VOLUME_RAIN_DIM * wet + VOLUME_FOG_DIM * fog) * day;
  const base = volumeShare01(tint.share);
  const out = { rgb: tint.rgb, share: base };
  if (dim > 0) {
    const sum = base + dim;
    out.rgb = volumeMixRgb(tint.rgb, VOLUME_OVERCAST_RGB, dim / sum);
    out.share = Math.min(1, sum);
  }
  out.land = VOLUME_SEASON_PALETTE[season].land;
  if (fog > 0) out.fog = { rgb: volumeTintRgb(VOLUME_FOG_RGB, out), share: VOLUME_FOG_SHARE * fog, mm: VOLUME_FOG_MM };
  return out;
}

/**
 * Тон часа для вещей панорамы: одна палитра на весь фон, покрашенная один раз
 * вместе со снимком часа.
 *
 * Земля здесь — тот же `VOLUME_LAND_RGB`, что у земляной плиты сцены, и
 * покрашена она тем же `volumeTintRgb`: стык между землёй у дома и землёй за
 * ним не виден ни в полдень, ни в полночь (G237 держится и во времени).
 */
// Время года в палитре фона (правка после сборки сценариев): «Зимой снег,
// осенью жёлтые листья и т.д.». Лето — ровно прежние цвета, байт в байт: без
// погоды палитра та же, что до правки. Весной зелень светлее и на круглых
// деревьях цвет; осенью кроны жёлтые, рыжие и красные — у каждого дерева своя
// (`crowns`), — земля пожухлая; зимой земля, холмы и кусты под снегом,
// лиственные деревья голые (`bare`), а на ели — снег, река подо льдом.
export const VOLUME_SEASON_PALETTE = Object.freeze({
  spring: {
    land: [128, 168, 90],
    crown: "#6fa64a",
    crownFar: "#86a873",
    bush: "#79a852",
    birchCrown: "#8cbf5a",
    willow: "#93c062",
    hillFar: "#a9c7b0",
    hillNear: "#93b88a",
    blossom: ["#f4e9ee", "#f2c6d6"],
  },
  summer: { land: VOLUME_LAND_RGB },
  autumn: {
    land: [150, 145, 84],
    crown: "#d9a62e",
    crownFar: "#b89a5c",
    bush: "#b8862f",
    birchCrown: "#e3c03a",
    willow: "#c9b048",
    hillFar: "#b9b597",
    hillNear: "#a8a170",
    crowns: ["#d9a62e", "#d9822b", "#b5492a", "#c9b33a", "#6f8f3c"],
  },
  winter: {
    land: [230, 234, 239],
    bush: "#dde3e8",
    hillFar: "#d5dbe1",
    hillNear: "#c9d1d8",
    roadNear: "#c4c1bc",
    roadFar: "#dedbd6",
    riverNear: "#c3d4df",
    riverFar: "#e2eaef",
    bare: true,
    snow: "#f2f5f8",
  },
});

export function volumeBackdropPalette(tint, season = "summer") {
  const css = (hex) => volumeTintCss(volumeHexRgb(hex), tint);
  const look = VOLUME_SEASON_PALETTE[season] || VOLUME_SEASON_PALETTE.summer;
  const pick = (key, fallback) => css(look[key] || fallback);
  return {
    land: volumeTintCss(look.land || VOLUME_LAND_RGB, tint),
    cloud: css(VOLUME_CLOUD),
    cloudDark: css(VOLUME_CLOUD_DARK),
    trunk: css(VOLUME_TRUNK),
    crown: pick("crown", VOLUME_CROWN),
    crownFar: pick("crownFar", VOLUME_CROWN_FAR),
    crownDark: css(VOLUME_CROWN_DARK),
    bush: pick("bush", VOLUME_BUSH),
    birchTrunk: css(VOLUME_BIRCH_TRUNK),
    birchMark: css(VOLUME_BIRCH_MARK),
    birchCrown: pick("birchCrown", VOLUME_BIRCH_CROWN),
    willow: pick("willow", VOLUME_WILLOW),
    roadNear: pick("roadNear", VOLUME_ROAD_NEAR),
    roadFar: pick("roadFar", VOLUME_ROAD_FAR),
    riverNear: pick("riverNear", VOLUME_RIVER_NEAR),
    riverFar: pick("riverFar", VOLUME_RIVER_FAR),
    hillFar: pick("hillFar", VOLUME_HILL_FAR),
    hillNear: pick("hillNear", VOLUME_HILL_NEAR),
    crowns: look.crowns ? look.crowns.map(css) : null,
    blossom: look.blossom ? look.blossom.map(css) : null,
    bare: look.bare === true,
    snowCap: look.snow ? css(look.snow) : null,
    rock: css(VOLUME_MOUNTAIN_ROCK),
    rockFar: css(VOLUME_MOUNTAIN_FAR_ROCK),
    snow: css(VOLUME_MOUNTAIN_SNOW),
    snowFar: css(VOLUME_MOUNTAIN_FAR_SNOW),
    wall: css(VOLUME_CITY_WALL),
    wallFar: css(VOLUME_CITY_WALL_FAR),
    wallSide: css(VOLUME_CITY_SIDE),
    wallSideFar: css(VOLUME_CITY_SIDE_FAR),
    glass: css(VOLUME_CITY_GLASS),
    roof: css(VOLUME_CITY_ROOF),
    asphalt: css(VOLUME_CITY_ASPHALT),
    asphaltFar: css(VOLUME_CITY_ASPHALT_FAR),
    mark: css(VOLUME_CITY_MARK),
    car: VOLUME_CITY_CARS.map((hex) => css(hex)),
  };
}

/** `#rrggbb` в тройку чисел: палитра фона писана цветами, а час считает числами. */
export function volumeHexRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
