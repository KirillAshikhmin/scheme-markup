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
import { volumeCityWindowLit, volumeGroundAim, volumeGroundPoint } from "./backdrop.js";
import { volumeDrawMegaBox, volumeMegaPaint } from "./megapolis.js";

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
  for (const wing of house.wings) {
    const outside =
      wing.side === "west"
        ? eye.x < wing.maxX
        : wing.side === "east"
          ? eye.x > wing.minX
          : wing.side === "north"
            ? eye.y < wing.maxY
            : eye.y > wing.minY;
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
    pass: eye.z > house.ceilingMm ? "after" : "before",
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
  const point = (x, y, z) => volumeGroundPoint(aim, x, y, z);
  const paint = volumeMegaPaint(mood.palette, 0);
  let drawn = 0;
  for (const part of volumeHouseParts(house, camera.at, roofOff)) {
    if (part.pass !== pass) continue;
    volumeDrawMegaBox(
      ctx,
      point,
      camera.at,
      { ...housePlan(part.rect), bottomMm: part.bottomMm, topMm: part.topMm, floors: part.floors, paint, seed: 900 + drawn, roof: part.roof },
      mood,
      volumeCityWindowLit,
    );
    drawn += 1;
  }
  return drawn;
}
