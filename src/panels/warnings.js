// Предупреждения объекта: всё, что нашёл `model.validate`, одним списком со
// счётчиком в шапке.
//
// До этого таска `validate` считался и выбрасывался: повторы номеров,
// потерянные связи и типы со смешанными метками никто не видел. Панель их
// показывает и приводит к виновнику на плане — но не правит: решение за
// пользователем, и «починить всё» здесь нет и не будет.
//
// Здесь же живут вопросы о виде типа, которые до этого задавало модальное
// окно при открытии объекта (таск 46). На слабо размеченном объекте это была
// простыня на полтора десятка строк поверх плана; строкой панели тот же вопрос
// ждёт, пока до него дойдут руки. Отметка «разобрано» как была в объекте
// (`type.kindGuessed`), так и осталась: она уезжает вместе с файлом.
import { layoutAllows, PANEL_IDS, registerPanel } from "../app.js";
import {
  closeTypeKindReview,
  findGroup,
  findMark,
  findOutline,
  findPlacement,
  findScheme,
  findType,
  typeKindOf,
  typeKindReview,
  updateType,
  validate,
} from "../model.js";
import { strings, text } from "../strings.js";
import { canvasCommit } from "../canvas.js";
import { uiButton, uiDialogDepth, uiEl, uiIcon, uiIconButton } from "./ui.js";
// Подводит холст к метке — тем же занят поиск в шапке и список меток.
import { marksCenteredView } from "./marks.js";
// Переключатель вида типа — тот же, что в справочнике: два вида, две кнопки.
import { typesKindSwitch } from "./types.js";

// Кто виновник предупреждения. Код проблемы знает только `ref`, а что это за
// идентификатор — знание здесь: в модели ссылка нарочно без типа, чтобы
// `validate` оставался таблицей правил, а не картой интерфейса.
export const WARNING_TARGETS = {
  duplicateCode: "type",
  typeWithoutCategory: "type",
  counterBehind: "type",
  typeKindMixed: "type",
  markWithoutType: "mark",
  markWithoutScheme: "mark",
  markWithoutRoom: "mark",
  emptyPoints: "mark",
  shortLine: "mark",
  controlsMissing: "mark",
  repeatedNumber: "mark",
  outlineWithoutScheme: "outline",
  outlineWithoutRoom: "outline",
  shortOutline: "outline",
  placementWithoutEquipment: "placement",
  placementWithoutMark: "placement",
  placementLinkMissing: "placement",
  smallGroup: "group",
  groupAcrossSchemes: "group",
};

// Ошибки сверху, вопросы о виде снизу: сперва то, что сломано, потом то, что
// сделано намеренно, и только потом то, о чём спрашивают.
export const WARNING_LEVELS = ["error", "warning", "ask"];

function warningMarkPlace(project, markId) {
  const mark = markId ? findMark(project, markId) : null;
  if (!mark) return null;
  const point = Array.isArray(mark.points) && mark.points.length > 0 ? mark.points[0] : null;
  return { markId: mark.id, schemeId: mark.schemeId || null, typeId: mark.typeId || null, point };
}

// Тип: виновник — сам тип, но смотреть пользователю на метки. У смешанного
// типа ведём к метке не того вида: она и есть то, о чём предупреждение.
function warningTypePlace(project, typeId, code) {
  const type = findType(project, typeId);
  if (!type) return null;
  const kind = typeKindOf(project, typeId);
  const marks = project.marks.filter((mark) => mark.typeId === typeId);
  const wrong = code === "typeKindMixed" ? marks.find((mark) => mark.kind !== kind) : null;
  const place = warningMarkPlace(project, (wrong || marks[0] || {}).id);
  return { markId: null, schemeId: null, point: null, ...(place || {}), typeId };
}

/**
 * Где искать виновника предупреждения: метка, тип, контур и схема, на которой
 * это лежит. Чистая функция — по ней и проверяется, что переход ведёт куда
 * надо. `null` — перехода нет (виновник уже не существует).
 */
export function warningPlace(project, problem) {
  if (!project || !problem || !problem.ref) return null;
  const target = WARNING_TARGETS[problem.code];
  if (target === "mark") return warningMarkPlace(project, problem.ref);
  if (target === "type") return warningTypePlace(project, problem.ref, problem.code);
  if (target === "group") {
    const group = findGroup(project, problem.ref);
    if (!group) return null;
    const first = (group.markIds || []).map((id) => warningMarkPlace(project, id)).find(Boolean);
    return first || null;
  }
  if (target === "outline") {
    const outline = findOutline(project, problem.ref);
    if (!outline) return null;
    const points = Array.isArray(outline.points) ? outline.points : [];
    return {
      markId: null,
      typeId: null,
      outlineId: outline.id,
      schemeId: outline.schemeId || null,
      point: points.length > 0 ? points[0] : null,
    };
  }
  if (target === "placement") {
    const placement = findPlacement(project, problem.ref);
    return placement ? warningMarkPlace(project, placement.markId) : null;
  }
  return null;
}

/**
 * Список для панели: группы одинаковых предупреждений, внутри — по одной
 * строке на случай. Чистая функция от объекта — её и считает панель, один раз
 * на правку объекта, а не на кадр отрисовки.
 *
 * `{ total, level, groups: [{ key, code, level, title, count, items }] }`
 */
export function warningsModel(project) {
  if (!project) return { total: 0, level: "ok", groups: [] };
  const byCode = new Map();
  for (const problem of validate(project)) {
    const level = problem.kind === "warning" ? "warning" : "error";
    const key = level + ":" + problem.code;
    if (!byCode.has(key)) byCode.set(key, { key, code: problem.code, level, items: [] });
    const group = byCode.get(key);
    group.items.push({
      key: key + ":" + (problem.ref || group.items.length),
      code: problem.code,
      level,
      message: problem.message,
      place: warningPlace(project, problem),
    });
  }
  const groups = [...byCode.values()]
    .sort((a, b) => WARNING_LEVELS.indexOf(a.level) - WARNING_LEVELS.indexOf(b.level))
    .map((group) => ({
      ...group,
      count: group.items.length,
      title: text("warnings.groups." + group.code, { count: group.items.length }),
    }));

  // Вопросы о виде — отдельной группой в конце: это не поломка объекта, а
  // ответ, которого ждут от пользователя.
  const kinds = typeKindReview(project);
  if (kinds.length > 0) {
    groups.push({
      key: "ask:typeKind",
      code: "typeKind",
      level: "ask",
      count: kinds.length,
      title: text("warnings.kindGroup", { count: kinds.length }),
      items: kinds.map((row) => ({
        key: "ask:typeKind:" + row.typeId,
        code: "typeKind",
        level: "ask",
        typeId: row.typeId,
        typeCode: row.code,
        typeName: row.name,
        kind: typeKindOf(project, row.typeId),
        message: row.reason === "mixed" ? strings.warnings.kindMixed : strings.warnings.kindNoMarks,
        place: warningTypePlace(project, row.typeId, "typeKind"),
      })),
    });
  }

  const total = groups.reduce((sum, group) => sum + group.count, 0);
  return { total, level: total === 0 ? "ok" : groups[0].level, groups };
}

function mountWarningsPanel(host, api) {
  const { getState, setState, subscribe, notify } = api;
  let model = warningsModel(null);
  let open = false;
  // Раскрытые группы помнятся по ключу: правка объекта не должна схлопывать
  // список, который пользователь только что раскрыл.
  const expanded = new Set();
  // Метка, к которой ведём: картинка новой схемы приходит не мгновенно, и
  // холст вписывает план, когда её дождётся, — тогда центрируем ещё раз.
  let pending = null;

  const count = uiEl("span", { class: "warnings__count" });
  const toggle = uiIconButton("warning", {
    class: "ui-btn warnings__toggle",
    label: strings.warnings.open,
    title: strings.warnings.openHint,
    on: { click: () => setOpen(!open) },
  });
  toggle.setAttribute("aria-expanded", "false");
  const drop = uiEl("div", { class: "warnings__drop" });
  drop.hidden = true;
  host.replaceChildren(toggle, drop);

  function setOpen(value) {
    open = Boolean(value);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    drop.hidden = !open;
    if (open) renderDrop();
    else drop.replaceChildren();
  }

  // ——— переход к виновнику ————————————————————————————————————————————

  function center(place) {
    const state = getState();
    if (!place || !place.point || !place.schemeId || state.schemeId !== place.schemeId) return false;
    const scheme = findScheme(state.project, place.schemeId);
    if (!scheme) return false;
    setState({ view: marksCenteredView(scheme, { points: [place.point] }, state.view) });
    return true;
  }

  function jump(place) {
    if (!place) return;
    const state = getState();
    if (!state.project) return;
    const patch = {};
    if (place.markId) {
      patch.selectedMarkIds = [place.markId];
      patch.selectedOutlineId = null;
    } else if (place.outlineId) {
      patch.selectedOutlineId = place.outlineId;
      patch.selectedMarkIds = [];
    }
    // Тип виновника делается выбранным: следующая правка в панели инструментов
    // и в справочнике окажется про него.
    if (place.typeId) patch.activeTypeId = place.typeId;
    if (place.schemeId && state.schemeId !== place.schemeId) patch.schemeId = place.schemeId;
    setState(patch);
    // Список закрывается: он занимает середину экрана, а подведённая метка
    // оказалась бы ровно под ним. Открыть его снова — один клик по счётчику,
    // и он на прежнем месте.
    setOpen(false);
    pending = place;
    queueMicrotask(() => {
      if (pending === place && center(place)) pending = null;
    });
  }

  // ——— правка вида типа ————————————————————————————————————————————————

  function setKind(typeId, kind) {
    const project = getState().project;
    if (!project) return;
    try {
      canvasCommit(project, updateType(project, typeId, { kind }).project, strings.history.typeKind);
    } catch (error) {
      notify(error && error.message ? error.message : String(error), "error");
    }
  }

  function dismissKinds() {
    const project = getState().project;
    if (!project) return;
    const cleared = closeTypeKindReview(project);
    if (cleared.project === project) return;
    canvasCommit(project, cleared.project, strings.history.typeKindReview);
  }

  // ——— отрисовка ————————————————————————————————————————————————————————

  function levelDot(level) {
    return uiEl("span", { class: "warnings__dot warnings__dot--" + level, attrs: { "aria-hidden": "true" } });
  }

  function problemRow(item) {
    const row = uiEl(
      "button",
      {
        class: "warnings__row warnings__row--" + item.level,
        type: "button",
        title: item.place ? strings.warnings.hint : item.message,
        on: { click: () => jump(item.place) },
      },
      [levelDot(item.level), uiEl("span", { class: "warnings__text", text: item.message })],
    );
    // Виновника уже нет — вести некуда, и обещать переход нечестно.
    row.disabled = !item.place;
    return row;
  }

  // Строка вопроса о виде: сам вопрос ведёт к меткам типа, переключатель
  // отвечает на него. Ответ — команда справочника `updateType`, та же, что в
  // окне до этого таска: панель своей правки объекта не знает.
  function kindRow(item) {
    return uiEl("div", { class: "warnings__row warnings__row--ask warnings__row--kind" }, [
      uiEl(
        "button",
        {
          class: "warnings__jump",
          type: "button",
          title: strings.warnings.hint,
          on: { click: () => jump(item.place) },
        },
        [
          levelDot(item.level),
          uiEl("span", { class: "warnings__code", text: item.typeCode }),
          uiEl("span", { class: "warnings__text", text: item.typeName }),
          uiEl("span", { class: "warnings__why", text: item.message }),
        ],
      ),
      typesKindSwitch({
        kind: item.kind,
        // Выбранное руками — уже не догадка, и подтверждение того же вида тоже
        // ответ: строка уходит, отметка снимается с типа и уезжает в файл.
        allowSame: true,
        sameTitle: strings.warnings.kindConfirm,
        onPick: (value) => setKind(item.typeId, value),
      }),
    ]);
  }

  function groupNode(group) {
    const single = group.count === 1;
    const items = group.items.map((item) => (item.code === "typeKind" ? kindRow(item) : problemRow(item)));
    if (single && group.level !== "ask") return items[0];
    // Свёрнуто по умолчанию — в том числе вопросы о виде: полтора десятка
    // строк, развёрнутых самими собой, и были той простынёй, из-за которой
    // список уехал из модального окна сюда.
    const isOpen = expanded.has(group.key);
    const body = uiEl("div", { class: "warnings__items" }, items);
    body.hidden = !isOpen;
    const chevron = uiIcon("chevron");
    chevron.classList.add("warnings__chevron");
    const head = uiEl(
      "button",
      {
        class: "warnings__group warnings__row--" + group.level + (isOpen ? " is-open" : ""),
        type: "button",
        title: isOpen ? strings.warnings.collapse : strings.warnings.expand,
        attrs: { "aria-expanded": isOpen ? "true" : "false" },
        on: {
          click: () => {
            if (expanded.has(group.key)) expanded.delete(group.key);
            else expanded.add(group.key);
            renderDrop();
          },
        },
      },
      [levelDot(group.level), uiEl("span", { class: "warnings__text", text: group.title }), chevron],
    );
    // Вопросы о виде можно закрыть разом — тем же, чем их закрывала кнопка
    // «Понятно» в прежнем окне. Кнопка живёт внутри раскрытой группы: закрыть
    // разом то, чего не видел, — не ответ.
    if (group.level === "ask") {
      body.prepend(uiEl("p", { class: "warnings__why warnings__kindHint", text: strings.warnings.kindHint }));
      body.append(
        uiEl("div", { class: "warnings__foot" }, [
          uiButton(strings.warnings.kindAll, {
            title: strings.warnings.kindAllHint,
            on: { click: () => dismissKinds() },
          }),
        ]),
      );
    }
    return uiEl("div", { class: "warnings__section" }, [head, body]);
  }

  function renderDrop() {
    if (!open) return;
    // Список переписывается целиком на каждую правку объекта; место, до
    // которого пользователь долистал, при этом не теряется.
    const scroll = drop.scrollTop;
    renderDropBody();
    drop.scrollTop = scroll;
  }

  function renderDropBody() {
    if (model.total === 0) {
      const icon = uiIcon("ok");
      icon.classList.add("warnings__okIcon");
      drop.replaceChildren(
        uiEl("div", { class: "warnings__ok" }, [
          icon,
          uiEl("p", { class: "warnings__okTitle", text: strings.warnings.okTitle }),
          uiEl("p", { class: "warnings__why", text: strings.warnings.okText }),
        ]),
      );
      return;
    }
    drop.replaceChildren(
      uiEl("p", { class: "warnings__head", text: strings.warnings.title }),
      ...model.groups.map((group) => groupNode(group)),
      uiEl("p", { class: "warnings__why warnings__hint", text: strings.warnings.hint }),
    );
  }

  function renderToggle() {
    const level = model.level;
    toggle.classList.toggle("is-error", level === "error");
    toggle.classList.toggle("is-warning", level === "warning");
    toggle.classList.toggle("is-ask", level === "ask");
    toggle.classList.toggle("is-ok", level === "ok");
    const icon = uiIcon(level === "ok" ? "ok" : "warning");
    count.textContent = model.total > 0 ? String(model.total) : "";
    toggle.replaceChildren(icon, count);
    const label = model.total > 0 ? strings.warnings.open : strings.warnings.okLabel;
    toggle.setAttribute("aria-label", label);
    toggle.title = model.total > 0 ? strings.warnings.openHint : strings.warnings.okLabel;
  }

  // Пересчёт — только на смену объекта: на кадр отрисовки и на движение мыши
  // счётчик не реагирует, иначе он мигал бы на каждый ход.
  function refresh(state) {
    model = warningsModel(state.project);
    const shown = Boolean(state.project) && layoutAllows("warnings", state.layout);
    host.hidden = !shown;
    if (!shown && open) setOpen(false);
    renderToggle();
    if (open) renderDrop();
  }

  subscribe((state, changed) => {
    if ("project" in changed || "layout" in changed) refresh(state);
    // Картинка схемы доехала — холст вписал план и сбил наведение: повторяем.
    if ("schemeImage" in changed && pending && center(pending)) pending = null;
  });

  // Закрывается тем же, чем открывается: повторным нажатием, кликом мимо и
  // Escape. Диалогом панель не становится — клавиатура холста остаётся у
  // холста, пока список не открыт.
  document.addEventListener("pointerdown", (event) => {
    if (!open || host.contains(event.target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (!open || event.key !== "Escape") return;
    // Пока открыт диалог, клавиатура принадлежит ему: Escape закрывает окно,
    // а не список под ним.
    if (uiDialogDepth() > 0) return;
    event.preventDefault();
    setOpen(false);
    toggle.focus();
  });

  refresh(getState());
}

registerPanel(PANEL_IDS.headerWarnings, mountWarningsPanel);
