// Полоса развёртки выделенной стены (таск 129, требование G179).
//
// Слова заказчика: «сделай функцию выделения стены и что бы её развёртка
// отображалась сверху схемы и на чертеже и на основной схеме». Поэтому полоса
// лежит **поверх плана**, а не в отдельном окне: человек смотрит на стену и на
// её развёртку одновременно, не теряя из виду ни того ни другого.
//
// **Один кирпич на две поверхности.** Холст и мастерская создают по своей
// полосе, но код у неё один — как у слоя чертежа в таске 127. Рисует её
// `render.drawElevation` в любой прямоугольник любого холста, поэтому выгрузка
// развёртки в PNG и на лист по ГОСТ (следующий таск) обойдётся тем же вызовом
// с другим `ctx`.
//
// **Полоса не закрывает свою стену.** Где ей быть — решает вызывающий и
// говорит словом `place`: стена в нижней половине поля — полоса сверху, и
// наоборот. Правило простое, но без него полоса регулярно накрывала бы ровно
// то, ради чего её открыли.
import { markSpareLine } from "../markSpare.js";
import { WALL_SIDES, findWall, wallElevation } from "../model.js";
import { drawElevation } from "../render.js";
import { strings, text } from "../strings.js";
import { uiButton, uiEl, uiIconButton } from "./ui.js";

// Высота полосы: столько нужно развёртке, чтобы в ней читались и размеры, и
// подписи меток. Больше доли поля она не берёт — иначе план, над которым она
// лежит, перестаёт быть виден.
//
// Триста точек, а не двести: у стены квартиры отношение сторон около трёх к
// одному, и в двухстах точках высоты развёртка занимала треть ширины полосы, а
// остальное пустовало — видно на снимке живого прогона.
export const ELEVATION_HEIGHT_PX = 300;
export const ELEVATION_MAX_SHARE = 0.42;

/**
 * Где показать полосу, чтобы она не закрыла свою стену: `"top"` или
 * `"bottom"`. `at` — середина стены в пикселях поля, `height` — высота поля.
 *
 * Чистая и вынесена наружу ради теста: промах здесь — это полоса поверх той
 * самой стены, которую открыли, и ловить его глазами на каждой стене дорого.
 */
export function elevationPlace(at, height) {
  if (!(height > 0) || !Number.isFinite(at)) return "bottom";
  return at > height / 2 ? "top" : "bottom";
}

/** Сколько места займёт полоса в поле такой высоты. */
export function elevationHeight(fieldHeight) {
  const limit = Math.max(1, Number(fieldHeight) || 0) * ELEVATION_MAX_SHARE;
  return Math.max(120, Math.min(ELEVATION_HEIGHT_PX, limit));
}

/**
 * Строка заголовка: что за стена, из какой она комнаты и какой стороной
 * повёрнута. Чистая — слова проверяются без браузера.
 *
 * Имя стены (G200) стоит первым: им стену и называют. Длина осталась рядом —
 * имя отвечает «какая стена», длина «сколько в ней».
 */
export function elevationTitle(elevation) {
  if (!elevation) return "";
  const parts = [text("elevation.wall", { name: elevation.name, length: elevation.lengthMm })];
  if (elevation.roomName) parts.push(elevation.roomName);
  return parts.join(" · ");
}

/**
 * Что сказать под развёрткой: про высоту, про пустую стену и про вещи,
 * подтянутые до читаемого размера.
 *
 * `drawn` — то, что вернула отрисовка (`render.drawElevation`). Подтянута вещь
 * или нет, зависит от масштаба развёртки, а масштаб знает только отрисовка:
 * одна и та же розетка на короткой стене нарисована почти в масштабе, а на
 * длинной — крупнее. Поэтому эта часть подписи приходит оттуда, а не считается
 * заново по данным (дефект D25).
 */
export function elevationNote(elevation, drawn) {
  if (!elevation) return "";
  const notes = [];
  if (!elevation.heightKnown) notes.push(text("elevation.noHeight", { height: elevation.heightShownMm }));
  const empty =
    elevation.openings.length === 0 && elevation.marks.length === 0 && elevation.objects.length === 0;
  if (empty) notes.push(strings.elevation.empty);
  const blind = elevation.marks.filter((mark) => mark.heightMm === null).length;
  if (blind > 0) notes.push(text("elevation.blind", { count: blind }));
  // Высота, взятая у типа, — это **догадка сборки**, пусть и хорошая: правило
  // объекта велит показывать её пользователю, а не выдавать за введённую
  // (таск 135, G192). Поправил у метки — число перестало быть умолчанием.
  //
  // Высота, пришедшая от группы (G203), догадкой **не** считается: её записал
  // человек у соседней метки той же группы и сам попросил распространить на
  // всех. Назови её умолчанием типа — и подпись соврала бы о том, чьё это
  // число. Поэтому считается не «не своя», а именно «от типа».
  const guessed = elevation.marks.filter((mark) => mark.heightMm !== null && mark.heightFrom === "type").length;
  if (guessed > 0) notes.push(text("elevation.guessed", { count: guessed }));
  const grown = drawn && drawn.grown > 0 ? drawn.grown : 0;
  if (grown > 0) notes.push(text("elevation.grown", { count: grown }));
  // Додуманная сторона габарита (G230). Слова заказчика: «да, и на развёртке
  // тоже пиши про додуманную сторону».
  //
  // Место — **здесь, в подписи под полосой**, и выбрано оно не за отсутствием
  // другого: под полосой уже стоят все новости одного рода — высота взята у
  // типа, вещь подтянута до читаемого размера, метка без высоты ушла полосой
  // под пол. Все они об одном: «вот это на чертеже — не то, что ты задал».
  // Догадка о стороне — та же новость, и стоять ей рядом, а не отдельной
  // плашкой: вторая плашка над планом закрыла бы ровно ту стену, ради которой
  // полосу открыли.
  //
  // Строка общая с объёмом (`markSpare.js`) — одна и та же вещь не должна
  // объясняться человеку двумя похожими фразами на двух поверхностях. Хвост с
  // объяснением здесь есть: подпись — абзац, места хватает.
  const spare = markSpareLine((drawn && drawn.spare) || [], { why: true });
  if (spare) notes.push(spare);
  return notes.join(" ");
}

/**
 * Создать полосу. Возвращает `{node, update, destroy}`; вызывающий сам кладёт
 * `node` туда, где у него план, и зовёт `update` на каждой правке.
 */
export function createElevationStrip({ onSide, onClose, onViews, views, onGrow, grow }) {
  const canvas = uiEl("canvas", { class: "elev__canvas" });
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  const title = uiEl("span", { class: "elev__title" });
  const note = uiEl("p", { class: "elev__note" });
  const sideButtons = WALL_SIDES.map((side) =>
    uiButton(strings.elevation["side_" + side], {
      class: "ui-btn elev__side",
      title: strings.elevation.sideHint,
      on: { click: () => onSide && onSide(side) },
    }),
  );
  // Отметка «изображения» — на самом окне развёртки, как предложил заказчик
  // (таск 135, G187: «можно прямо на окне с развёрткой»). Личная настройка
  // браузера, как слои и шрифт схемы; в объект не попадает.
  const viewsBox = uiEl("input", { type: "checkbox" });
  viewsBox.checked = views !== false;
  viewsBox.addEventListener("change", () => onViews && onViews(viewsBox.checked));
  const viewsRow = uiEl("label", { class: "elev__views", title: strings.elevation.viewsHint }, [
    viewsBox,
    uiEl("span", { text: strings.elevation.views }),
  ]);
  // Нижняя граница масштаба мелких вещей (таск 179, дефект D42) — отметка
  // рядом с «изображениями», и это не случайное соседство: обе о том, **чем**
  // нарисована вещь на листе, обе личные настройки браузера и обе уходят в
  // выгрузку. Умолчание у неё снятое: заказчик сказал «рисуй всё в реальном
  // масштабе», и честный лист — то, что видишь, не спросив ни о чём.
  const growBox = uiEl("input", { type: "checkbox" });
  growBox.checked = grow === true;
  growBox.addEventListener("change", () => onGrow && onGrow(growBox.checked));
  const growRow = uiEl("label", { class: "elev__views", title: strings.elevation.growHint }, [
    growBox,
    uiEl("span", { text: strings.elevation.grow }),
  ]);
  const closeButton = uiIconButton("close", {
    title: strings.elevation.close,
    on: { click: () => onClose && onClose() },
  });
  const stage = uiEl("div", { class: "elev__stage" }, [canvas]);
  const node = uiEl("div", { class: "elev" }, [
    uiEl("div", { class: "elev__head" }, [title, viewsRow, growRow, ...sideButtons, closeButton]),
    stage,
    note,
  ]);
  // **Полоса не отдаёт своё нажатие дальше** (дефект D24). На холсте она лежит
  // в прозрачном для указателя слое, в мастерской — внутри поля чертежа, и во
  // втором случае нажатие на кнопку всплывало бы в обработчик поля: клик по
  // «Закрыть» ставил бы вершину стены. Правило одно и живёт у самой полосы —
  // чинить это на каждой поверхности по-своему значило бы завести две разные
  // починки одной беды.
  for (const kind of ["pointerdown", "pointerup", "dblclick", "wheel"]) {
    node.addEventListener(kind, (event) => event.stopPropagation());
  }
  node.hidden = true;
  let shown = null;
  let withViews = views !== false;
  let withGrow = grow === true;

  function paint() {
    if (!ctx || !shown || node.hidden) return;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const drawn = drawElevation(ctx, shown, { x: 0, y: 0, width, height }, { views: withViews, grow: withGrow });
    // Подпись дописывается **после** рисования: сколько вещей подтянуто до
    // читаемого размера, известно только от масштаба, а масштаб развёртка
    // подбирает сама по своему полю (дефект D25). Поле меняется — меняется и
    // приписка, потому что `paint` зовётся и на каждой смене размера.
    setNote(drawn);
  }

  function setNote(drawn) {
    note.textContent = shown ? elevationNote(shown, drawn) : "";
    note.hidden = note.textContent === "";
  }

  /**
   * Показать развёртку выделенной стены. `wallId` пустой — полоса прячется:
   * пустой развёртки на экране не бывает (G68).
   */
  function update({ project, wallId, side, place, fieldHeight, views: shownViews, grow: shownGrow }) {
    if (shownViews !== undefined) {
      withViews = shownViews !== false;
      viewsBox.checked = withViews;
    }
    if (shownGrow !== undefined) {
      withGrow = shownGrow === true;
      growBox.checked = withGrow;
    }
    const wall = wallId ? findWall(project, wallId) : null;
    if (!wall) {
      node.hidden = true;
      shown = null;
      return null;
    }
    const view = WALL_SIDES.includes(side) ? side : WALL_SIDES[0];
    shown = wallElevation(project, wallId, view);
    node.hidden = !shown;
    if (!shown) return null;
    node.classList.toggle("elev--top", place === "top");
    node.classList.toggle("elev--bottom", place !== "top");
    node.style.setProperty("--elev-height", Math.round(elevationHeight(fieldHeight)) + "px");
    title.textContent = elevationTitle(shown);
    // Без приписки о подтянутых вещах: её допишет `paint` ниже, когда масштаб
    // станет известен. Здесь — чтобы полоса не мелькала пустой подписью.
    setNote(null);
    sideButtons.forEach((button, index) => {
      button.className = "ui-btn elev__side" + (WALL_SIDES[index] === view ? " is-on" : "");
    });
    paint();
    return shown;
  }

  function destroy() {
    node.remove();
    shown = null;
  }

  return { node, update, repaint: paint, destroy };
}
