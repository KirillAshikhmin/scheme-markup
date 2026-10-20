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
import { WALL_SIDES, findWall, wallCornerMoves, wallElevation } from "../model.js";
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
 *
 * У участка (таск 197) в заголовке **две** меры: стена, по которой он идёт, и
 * сам участок парой углов. Назови только участок — и человек потеряет стену, а
 * метки он привязывает к стене (G202); назови только стену — и длина в
 * заголовке разойдётся с размерной цепочкой на листе.
 */
export function elevationTitle(elevation) {
  if (!elevation) return "";
  const parts = [
    elevation.partial
      ? text("elevation.section", {
          wall: elevation.name,
          name: elevation.sectionName,
          length: elevation.lengthMm,
        })
      : text("elevation.wall", { name: elevation.name, length: elevation.lengthMm }),
  ];
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
 * Два края листа — два поля (таск 197, требование G302): `"from"` — левый угол
 * участка, `"to"` — правый.
 */
export const ELEVATION_EDGES = ["from", "to"];

/**
 * Два поля с углами участка — по одному на край листа (таск 197, G302; правка
 * решения таска 179).
 *
 * Возвращает `[{edge, letter, label, hint, none, here, options}]` в порядке
 * `ELEVATION_EDGES`; `options` — `[{letter, wallId, side, cut, text}]`. Что с
 * чем связано стеной, считает модель (`wallCornerMoves`) по чертежу — здесь
 * только слова.
 *
 * **Где лево, а где право.** Поля называют **края листа**, а не концы стены:
 * слева в поле стоит тот угол, который нарисован слева на развёртке. Правило
 * устойчиво, потому что другого источника у него нет — буквы на краях размерной
 * цепочки (`fromLetter`, `toLetter`, таск 142) и есть эти два поля. Отсюда и
 * следствие, которое надо знать: кнопки «Слева/Справа» переворачивают лист, и
 * углы меняются полями вместе с ним. Это не перескок списка — на листе они
 * ровно там, где написаны.
 *
 * **Список считается от противоположного поля**, как и просил заказчик: в левом
 * поле те углы, что связаны стеной с правым, и наоборот. Поэтому смена угла —
 * это всегда «оставь тот, второй, и покажи участок до нового».
 *
 * **Отдельное поле «часть стены» (таск 179) не нужно и не заводится**: часть
 * стены это и есть пара углов, и теперь лист режется по ней. Второе поле о том
 * же дало бы два способа задать одно.
 *
 * Чистая и вынесена наружу: слова и порядок проверяются без браузера.
 */
export function elevationCorners(project, elevation) {
  if (!project || !elevation) return [];
  return ELEVATION_EDGES.map((edge) => {
    const letter = edge === "to" ? elevation.toLetter : elevation.fromLetter;
    const moves = wallCornerMoves(project, {
      wallId: elevation.wallId,
      side: elevation.side,
      fromLetter: elevation.fromLetter,
      toLetter: elevation.toLetter,
      edge,
    });
    return {
      edge,
      letter,
      label: strings.elevation[edge === "to" ? "cornerRight" : "cornerLeft"],
      hint: strings.elevation.cornerHint,
      none: strings.elevation.cornerNone,
      here: text("elevation.cornerHere", { letter }),
      options: moves.map((move) => ({
        letter: move.letter,
        wallId: move.wallId,
        side: move.side,
        cut: move.cut,
        // Буква главная, и она стоит первой: заказчик мыслит буквами, их же он
        // видит кружками на чертеже. Остальное — чем этот угол отличается от
        // двадцати других: у своей стены длиной участка, у чужой её именем.
        text: move.sameWall
          ? text("elevation.cornerSame", { letter: move.letter, length: move.lengthMm })
          : text("elevation.cornerOther", {
              letter: move.letter,
              wall: move.wallName,
              length: move.lengthMm,
            }),
      })),
    };
  });
}

/**
 * Создать полосу. Возвращает `{node, update, destroy}`; вызывающий сам кладёт
 * `node` туда, где у него план, и зовёт `update` на каждой правке.
 */
export function createElevationStrip({ onSide, onClose, onViews, views, onGrow, grow, onWall }) {
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
  // Два поля с углами участка (таск 197, G302) — своим рядом под заголовком, а
  // не в одной строке с кнопками: в шапке уже стоят заголовок, две отметки, две
  // кнопки сторон и «Закрыть», и пара списков выдавила бы их за край на
  // планшете. Ряд прячется вместе с полосой и перестраивается на каждой смене
  // участка.
  //
  // Выбранной записью стоит сам угол: «Л — этот угол». Поэтому поле отвечает и
  // на «где я», а не только на «куда перейти».
  const cutSelects = ELEVATION_EDGES.map((edge) =>
    uiEl("select", {
      class: "elev__cut",
      on: {
        change: (event) => {
          const picked = cutOptions[edge].get(event.target.value);
          // «Этот угол» — не переход: поле возвращается к нему само после
          // перестройки, и дёргать вызывающего незачем.
          if (picked) moveTo(picked);
          else syncCut();
        },
      },
    }),
  );
  const cutLabels = ELEVATION_EDGES.map((edge, index) =>
    uiEl("label", { class: "elev__cutrow" }, [
      uiEl("span", {
        class: "elev__cutlabel",
        text: strings.elevation[edge === "to" ? "cornerRight" : "cornerLeft"],
      }),
      cutSelects[index],
    ]),
  );
  const cutRow = uiEl("div", { class: "elev__cutbar" }, cutLabels);
  // Что стоит за каждой записью: ключ записи → `{wallId, side, cut}`. Держать
  // это в `value` целиком значило бы собирать и разбирать строку с четырьмя
  // полями — карта честнее и переживает любые буквы углов.
  const cutOptions = { from: new Map(), to: new Map() };
  const closeButton = uiIconButton("close", {
    title: strings.elevation.close,
    on: { click: () => onClose && onClose() },
  });
  const stage = uiEl("div", { class: "elev__stage" }, [canvas]);
  const node = uiEl("div", { class: "elev" }, [
    uiEl("div", { class: "elev__head" }, [title, viewsRow, growRow, ...sideButtons, closeButton]),
    cutRow,
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
  // Последние доводы `update`: полоса перерисовывает себя сама, когда участок
  // сменился внутри той же стены. Вызывающему там нечего менять — ни выделение,
  // ни сторона не поехали, — и дёргать его состояние ради своего же листа
  // значило бы заводить участок в состоянии сеанса на обе поверхности.
  let last = null;
  // Показанный участок: пара углов и стена, на которой она посчитана. Живёт у
  // полосы, потому что это её лист: выделение стены и сторона общие с планом и
  // мастерской, а на какой кусок стены человек смотрит — нет.
  let cut = null;
  let cutWallId = null;

  /**
   * Перестроить ряд углов. Зовётся на каждой смене участка: связи считаются от
   * чертежа, и после правки стены список обязан стать другим.
   */
  function syncCut() {
    const ready = Boolean(last && last.project && shown);
    cutRow.hidden = !ready;
    if (!ready) return;
    elevationCorners(last.project, shown).forEach((field, index) => {
      const select = cutSelects[index];
      const known = cutOptions[field.edge];
      known.clear();
      select.replaceChildren(uiEl("option", { value: "here", text: field.here }));
      for (const option of field.options) {
        const key = option.letter + ":" + option.wallId + ":" + option.side;
        known.set(key, { wallId: option.wallId, side: option.side, cut: option.cut });
        select.append(uiEl("option", { value: key, text: option.text }));
      }
      // Выбранным всегда стоит угол этого края листа: поле говорит, где человек,
      // а выбор уводит с него, и залипшая чужая запись врала бы о том, что
      // открыто.
      select.value = "here";
      // Связанных углов нет — поле погашено с причиной, а не притворяется
      // рабочим.
      select.disabled = field.options.length === 0;
      cutLabels[index].title = field.options.length === 0 ? field.none : field.hint;
    });
  }

  /**
   * Показать участок, выбранный в поле.
   *
   * Участок внутри той же стены полоса показывает сама; участок на другой стене
   * — через вызывающего: выделение стены общее с планом и чертежом, и
   * расходиться им нельзя. Пара углов при этом уже отложена, и `update`
   * подхватит её, как только выделение дойдёт обратно.
   */
  function moveTo(picked) {
    cut = picked.cut;
    cutWallId = picked.wallId;
    const samePlace = shown && picked.wallId === shown.wallId && picked.side === shown.side;
    if (!samePlace && onWall) onWall({ wallId: picked.wallId, side: picked.side });
    else show();
  }

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
    last = { project, wallId, side, place, fieldHeight };
    return show();
  }

  // Нарисовать то, что отложено в `last` и `cut`. Отделено от `update` ради
  // одного: смена участка внутри стены не меняет у вызывающего ничего, и
  // перерисовать себя полоса обязана сама.
  function show() {
    const { project, wallId, side, place, fieldHeight } = last || {};
    const wall = wallId ? findWall(project, wallId) : null;
    if (!wall) {
      node.hidden = true;
      shown = null;
      cutRow.hidden = true;
      return null;
    }
    // Выделили другую стену — участок прежней с ней не поедет: буквы у него
    // чужие, и показывать «участок Л-Ю» на стене БВ было бы враньём.
    if (cutWallId !== wallId) {
      cut = null;
      cutWallId = null;
    }
    const view = WALL_SIDES.includes(side) ? side : WALL_SIDES[0];
    shown = wallElevation(project, wallId, view, cut);
    node.hidden = !shown;
    if (!shown) return null;
    node.classList.toggle("elev--top", place === "top");
    node.classList.toggle("elev--bottom", place !== "top");
    node.style.setProperty("--elev-height", Math.round(elevationHeight(fieldHeight)) + "px");
    title.textContent = elevationTitle(shown);
    // Ряд углов — от показанного участка: что с чем связано стеной, считает
    // модель по чертежу (G302).
    syncCut();
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
