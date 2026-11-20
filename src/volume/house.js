// «Объём»: дом, в котором стоит квартира (правка без автопилота, 2026-11-20).
//
// Слова заказчика: «если объект квартира, то как раз мы не на земле же, а
// где-то наверху в доме. Ну и, естественно, дом тоже отрисовать».
//
// Дом — **не грани сцены**, а рисунок фона: коробки с окнами той же кистью,
// что у домов «Мегаполиса» (`volumeDrawMegaBox`), по контуру `scene.house`
// (`volume/scene.js`, `volume/floors.js`). В дерево порядка он не идёт — его
// плоскости совпали бы с наружными гранями стен квартиры и дали бы резы по
// всей сцене. Порядок с квартирой решают три вопроса на кадр:
//
//   — **низ** (от земли до пола квартиры) рисуется до сцены;
//   — **верх** (от её потолка до крыши дома) — после сцены, если глаз выше
//     потолка квартиры, иначе до: снизу и изнутри его закрывает квартира;
//   — **сосед** за глухой стороной — после сцены, если глаз по его сторону от
//     грани габарита, иначе до.
//
// «Снять крышу» снимает и верх дома, и соседей: остаётся постамент с открытой
// планировкой, в которую можно заглянуть сверху.
import { volumeCityWindowLit, volumeGroundAim } from "./backdrop.js";
import { volumeDrawMegaBox, volumeMegaPaint, volumeMegaPath } from "./megapolis.js";

// ——— коридор этажа за входной дверью (правка 2026-11-20) ————————————————————
//
// Слова заказчика: «Из входной двери мы то видим стену с окнами то улицу.
// Сделай там просто коридор небольшой с дверьми в разные стороны, штук 5».
//
// Коридор — тот же рисунок, что и дом: пол, потолок и три стены с пятью
// дверями, написанные до сцены, так что видно их только в проём входной двери.
// Свет в нём свой и постоянный (светит — значит часом не красится): ночью из
// тёмной прихожей дверь открывается в освещённый коридор, как и бывает.

/** Коридор: сколько он тянется в каждую сторону от двери, его глубина и двери. */
export const VOLUME_HALL_HALF_MM = 4600;
export const VOLUME_HALL_DEEP_MM = 2200;
export const VOLUME_HALL_DOOR_MM = { width: 900, height: 2050 };
const HALL_WALL = "#d8d2c8";
const HALL_SIDE = "#c9c2b7";
const HALL_FLOOR = "#8d8880";
const HALL_CEILING = "#efece6";
const HALL_DOOR = "#8a6a4a";
const HALL_HANDLE = "#d9d5cc";

/**
 * Грани коридора: `[{color, points}]` в миллиметрах сцены, в порядке рисования.
 * Чистая — по ней идёт и кадр, и тест. `entry` — вход квартиры
 * (`scene.house.entry`), `heightMm` — высота потолка.
 */
export function volumeHallFaces(entry, heightMm) {
  if (!entry || !(heightMm > 0)) return [];
  const out = entry.out;
  const along = { x: -out.y, y: out.x };
  const at = (side, deep, z) => ({ x: entry.x + along.x * side + out.x * deep, y: entry.y + along.y * side + out.y * deep, z });
  const L = VOLUME_HALL_HALF_MM;
  const D = VOLUME_HALL_DEEP_MM;
  const H = heightMm;
  const faces = [
    { color: HALL_FLOOR, points: [at(-L, 0, 0), at(L, 0, 0), at(L, D, 0), at(-L, D, 0)] },
    { color: HALL_CEILING, points: [at(-L, 0, H), at(L, 0, H), at(L, D, H), at(-L, D, H)] },
    { color: HALL_WALL, points: [at(-L, D, 0), at(L, D, 0), at(L, D, H), at(-L, D, H)] },
    { color: HALL_SIDE, points: [at(-L, 0, 0), at(-L, D, 0), at(-L, D, H), at(-L, 0, H)] },
    { color: HALL_SIDE, points: [at(L, 0, 0), at(L, D, 0), at(L, D, H), at(L, 0, H)] },
  ];
  const half = VOLUME_HALL_DOOR_MM.width / 2;
  const tall = Math.min(VOLUME_HALL_DOOR_MM.height, H - 100);
  // Три двери напротив и по одной в торцах — пять квартир на площадке.
  for (const middle of [-2900, 0, 2900]) {
    faces.push({ color: HALL_DOOR, points: [at(middle - half, D - 8, 0), at(middle + half, D - 8, 0), at(middle + half, D - 8, tall), at(middle - half, D - 8, tall)] });
    faces.push({ color: HALL_HANDLE, points: [at(middle + half - 150, D - 16, 980), at(middle + half - 60, D - 16, 980), at(middle + half - 60, D - 16, 1040), at(middle + half - 150, D - 16, 1040)] });
  }
  for (const side of [-1, 1]) {
    const x = side * (L - 8);
    faces.push({ color: HALL_DOOR, points: [at(x, D / 2 - half, 0), at(x, D / 2 + half, 0), at(x, D / 2 + half, tall), at(x, D / 2 - half, tall)] });
  }
  return faces;
}

/**
 * Стоит ли глаз в коридоре этажа (правка 2026-11-20, дефект заказчика: «пока
 * мы внутри помещения, то видим комнату на этаже, но стоит выйти за дверь — и
 * всё пропадает»). Вышедший за порог остаётся **внутри дома**: коридор
 * рисуется по-прежнему, а соседняя секция и верх дома его не закрывают.
 * Запас в полметра — на толщину стены и на шаг через порог.
 */
export function volumeHallHolds(house, eye) {
  const entry = house && house.entry;
  if (!entry || !eye) return false;
  const out = entry.out;
  const deep = (eye.x - entry.x) * out.x + (eye.y - entry.y) * out.y;
  const side = (eye.x - entry.x) * -out.y + (eye.y - entry.y) * out.x;
  return (
    deep >= -500 &&
    deep <= VOLUME_HALL_DEEP_MM &&
    Math.abs(side) <= VOLUME_HALL_HALF_MM &&
    eye.z >= house.floorMm &&
    eye.z <= house.ceilingMm
  );
}

function housePlan(rect) {
  // Обход по кругу, при котором наружу смотрит правый перпендикуляр ребра
  // (`volumeDrawMegaBox`): север, восток, юг, запад.
  return {
    plan: [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ],
    wides: [rect.maxX - rect.minX, rect.maxY - rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY],
  };
}

/**
 * Части дома и когда их рисовать: `[{name, rect, bottomMm, topMm, floors, pass}]`,
 * `pass` — `"before"` или `"after"` сцены. Чистая: по ней идут и кадр, и тест.
 */
export function volumeHouseParts(house, eye, roofOff = false) {
  if (!house) return [];
  const parts = [];
  const below = house.floor - 1;
  if (below > 0) {
    // Верх постамента виден, когда крыша снята: соседи убраны, и под ними — перекрытие.
    parts.push({ name: "low", rect: house.rect, bottomMm: house.groundMm, topMm: house.floorMm, floors: below, pass: "before", roof: true });
  }
  if (roofOff) return parts;
  // Глаз в коридоре этажа — он внутри дома: соседи и верх рисуются до сцены,
  // как для стоящего в квартире.
  const hall = volumeHallHolds(house, eye);
  for (const wing of house.wings) {
    const outside =
      !hall &&
      (wing.side === "west"
        ? eye.x < wing.maxX
        : wing.side === "east"
          ? eye.x > wing.minX
          : wing.side === "north"
            ? eye.y < wing.maxY
            : eye.y > wing.minY);
    parts.push({ name: "wing", rect: wing, bottomMm: house.floorMm, topMm: house.ceilingMm, floors: 1, pass: outside ? "after" : "before", roof: false });
  }
  const above = house.floors - house.floor;
  // Крыша дома есть всегда, даже когда квартира на последнем этаже: это
  // перекрытие с парапетом, и сверху дом им и кончается.
  parts.push({
    name: "high",
    rect: house.rect,
    bottomMm: house.ceilingMm,
    topMm: Math.max(house.roofMm, house.ceilingMm + 300),
    floors: Math.max(1, above),
    pass: !hall && eye.z > house.ceilingMm ? "after" : "before",
    roof: true,
  });
  return parts;
}

/**
 * Нарисовать дом вокруг квартиры: проход `"before"` — до сцены, `"after"` —
 * после неё. Дома нет (объект на земле без названного дома) — ничего.
 */
export function volumeDrawHouse(ctx, box, camera, mood, scene, pass, roofOff = false) {
  const house = scene && scene.house;
  if (!house || !mood || !mood.palette || !mood.palette.mega) return 0;
  // Проекция — в миллиметрах сцены: дом стоит там же, где квартира.
  const aim = volumeGroundAim(camera, box, 0);
  const paint = volumeMegaPaint(mood.palette, 0);
  let drawn = 0;
  for (const part of volumeHouseParts(house, camera.at, roofOff)) {
    if (part.pass !== pass) continue;
    volumeDrawMegaBox(
      ctx,
      aim,
      { ...housePlan(part.rect), bottomMm: part.bottomMm, topMm: part.topMm, floors: part.floors, paint, seed: 900 + drawn, roof: part.roof },
      mood,
      volumeCityWindowLit,
    );
    drawn += 1;
  }
  // Коридор — последним в проходе «до сцены»: он ближе соседей, которых
  // закрывает, и видно его только глазу, стоящему по квартирную сторону входа.
  const entry = house.entry;
  if (pass === "before" && entry) {
    const inside = (camera.at.x - entry.x) * entry.out.x + (camera.at.y - entry.y) * entry.out.y < 0;
    if ((inside && camera.at.z < house.ceilingMm) || volumeHallHolds(house, camera.at)) {
      // Стоящему в коридоре нужна и четвёртая стена — та, в которой дверь
      // квартиры: саму квартирную стену рисует сцена поверх, а там, где её нет
      // (вырез Г-образной квартиры), без этой стены была бы видна улица. Из
      // квартиры она не рисуется: легла бы в проём входной двери.
      const deep = (camera.at.x - entry.x) * entry.out.x + (camera.at.y - entry.y) * entry.out.y;
      const faces = volumeHallFaces(entry, house.ceilingMm);
      if (deep > 0) {
        const along = { x: -entry.out.y, y: entry.out.x };
        const corner = (side, z) => ({ x: entry.x + along.x * side, y: entry.y + along.y * side, z });
        faces.unshift({
          color: HALL_WALL,
          points: [corner(-VOLUME_HALL_HALF_MM, 0), corner(VOLUME_HALL_HALF_MM, 0), corner(VOLUME_HALL_HALF_MM, house.ceilingMm), corner(-VOLUME_HALL_HALF_MM, house.ceilingMm)],
        });
      }
      for (const face of faces) {
        ctx.beginPath();
        if (!volumeMegaPath(ctx, aim, face.points)) continue;
        ctx.fillStyle = face.color;
        ctx.fill();
      }
      drawn += 1;
    }
  }
  return drawn;
}
