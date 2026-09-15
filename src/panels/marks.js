// Список меток схемы: обозначение, помещение, расположение и обозначение из
// оригинального проекта — правятся прямо в строке.
//
// Почему список, а не карточка метки: заказчик заполняет «Расположение» и
// «В оригинальной схеме» не в момент постановки, а потом, разом, по списку.
// Поэтому правка здесь на месте, а отдельного окна у метки нет вовсе.
import { layoutAllows, PANEL_IDS, registerPanel } from "../app.js";
import { strings, text } from "../strings.js";
import {
  MARK_NUMBER_MAX,
  findMark,
  findRoom,
  labelOf,
  markControlIds,
  markControls,
  markRoomManual,
  findScheme,
  repeatedNumbers,
  roomsInOrder,
  schemesInOrder,
  setMarkControls,
  setMarkNumber,
  styleOf,
  updateMark,
} from "../model.js";
import { planToScreen, shapeIcon } from "../render.js";
import { canvasCommit } from "../canvas.js";
import { uiButton, uiEl, uiPrompt } from "./ui.js";
import { filtersBox, filtersMarkRows } from "./filters.js";
import { openMarkControlsPicker } from "./markControls.js";
import { roomsEnsure } from "./rooms.js";

const MARKS_NEW_ROOM = "--new-room--";
// «По контуру» — метка отдана автоматике: помещение подставляется по контуру
// на схеме. Любой другой выбор в этом поле — ручная правка, и она главнее:
// такую метку автоматика больше не трогает.
const MARKS_AUTO_ROOM = "--auto-room--";

// Холст подводится к метке переводом координат из render.js: доли плана в
// пиксели экрана здесь руками не пересчитываются.
function marksCenteredView(scheme, mark, view) {
  const host = document.getElementById(PANEL_IDS.canvas);
  if (!host || !host.clientWidth || !host.clientHeight) return view;
  const local = planToScreen(mark.points[0], scheme, { ...view, offsetX: 0, offsetY: 0 });
  return { ...view, offsetX: host.clientWidth / 2 - local.x, offsetY: host.clientHeight / 2 - local.y };
}

// Кто кем управляет — одним проходом по объекту: спрашивать модель на каждую
// строку значило бы пересортировать все метки полтысячи раз.
export function marksControllerIndex(project) {
  const index = new Map();
  if (!project) return index;
  for (const item of project.marks) {
    for (const id of markControlIds(item)) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(labelOf(project, item.id));
    }
  }
  return index;
}

// Что показывает строка списка. Свёрнутая — ровно то, что просил заказчик:
// значок и обозначение (плюс отметка повтора номера: три строки «Т1» подряд
// иначе выглядят ошибкой). Раскрытая — прежний вид со всеми полями.
// Решение о полях принимается здесь, а не в разметке: «в модели полей нет»
// означает «в строке их не будет», и проверить это можно без браузера.
export function marksRowModel(project, row, options = {}) {
  const mark = row.mark;
  const repeat = options.repeat > 1 ? options.repeat : 0;
  const head = {
    id: mark.id,
    open: Boolean(options.open),
    label: row.label,
    code: row.type ? row.type.code : "?",
    style: row.style,
    typeName: row.type ? row.type.name : "",
    repeat,
    fields: null,
  };
  if (!head.open) return head;
  const controllers = options.controllers instanceof Map ? options.controllers : new Map();
  head.fields = {
    number: mark.number,
    roomId: mark.roomId || null,
    roomManual: markRoomManual(mark),
    location: mark.location || "",
    original: mark.original || "",
    controls: markControls(project, mark.id).map((item) => labelOf(project, item.id)),
    controlledBy: controllers.get(mark.id) || [],
  };
  return head;
}

function mountMarksPanel(host, api) {
  const { getState, setState, notify } = api;
  const filters = filtersBox(api);
  const list = uiEl("div", { class: "marks" });
  const count = uiEl("p", { class: "marks__count" });
  host.replaceChildren(filters.node, count, list);
  // Пока курсор стоит в текстовом поле строки, список не пересобирается: иначе
  // буква, набранная в «Расположении», выбрасывала бы фокус после каждой правки.
  // Поле поиска сюда не входит: оно живёт над списком, и набор в нём обязан
  // перестраивать список по ходу — ради этого он и набирается.
  let pending = false;
  let shownSelection = "";

  // Номер правится числовым полем — оно тоже держит список от пересборки,
  // иначе набранная цифра выбрасывала бы курсор из поля.
  function typing() {
    const active = document.activeElement;
    if (!active || !list.contains(active) || active.tagName !== "INPUT") return false;
    return active.type === "text" || active.type === "number";
  }

  function fail(error) {
    notify(error && error.message ? error.message : String(error), "error");
  }

  function selectMark(markId) {
    const state = getState();
    const scheme = state.project ? findScheme(state.project, state.schemeId) : null;
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!scheme || !mark) return;
    setState({ selectedMarkIds: [markId], view: marksCenteredView(scheme, mark, state.view) });
  }

  function setField(markId, field, value) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark) return;
    const next = value.trim();
    if ((mark[field] || "") === next) return;
    try {
      canvasCommit(state.project, updateMark(state.project, markId, { [field]: next }).project, strings.history.markField);
    } catch (error) {
      fail(error);
    }
  }

  // Номер метки ставится руками: несколько одинаковых светильников одной группы
  // носят один номер. Повтор модель разрешает и помечает предупреждением —
  // здесь он только доезжает до истории одним шагом отмены.
  function setNumber(markId, value) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark) return;
    try {
      const next = setMarkNumber(state.project, markId, value);
      if (next.project === state.project) return;
      canvasCommit(state.project, next.project, strings.history.markNumber);
    } catch (error) {
      fail(error);
      render();
    }
  }

  // Комната заводится по ходу: новое название добавляется в справочник объекта
  // и тем же шагом истории проставляется метке.
  function setRoom(markId, name) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark) return;
    try {
      const ensured = roomsEnsure(state.project, name);
      const roomId = ensured.room ? ensured.room.id : null;
      if (roomId === (mark.roomId || null) && markRoomManual(mark) && ensured.project === state.project) return;
      canvasCommit(
        state.project,
        updateMark(ensured.project, markId, { roomId, roomManual: true }).project,
        strings.history.markRoom,
      );
    } catch (error) {
      fail(error);
      render();
    }
  }

  // Возврат метки автоматике: снимаем признак ручной правки, а помещение
  // подставит по контуру canvasCommit — тем же шагом истории.
  function setAutoRoom(markId) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark || !markRoomManual(mark)) return;
    try {
      canvasCommit(
        state.project,
        updateMark(state.project, markId, { roomManual: false }).project,
        strings.history.markRoomAuto,
      );
    } catch (error) {
      fail(error);
      render();
    }
  }

  // Пока окно открыто, объект мог уехать (отмена, чужая правка): список
  // отмеченного сверяется со свежим снимком, прежде чем стать шагом истории.
  async function editControls(markId) {
    const state = getState();
    if (!state.project || !layoutAllows("editMarks", state.layout)) return;
    const picked = await openMarkControlsPicker(state.project, markId);
    if (!picked) return;
    const fresh = getState();
    if (!fresh.project || !findMark(fresh.project, markId)) return;
    try {
      const alive = picked.filter((id) => findMark(fresh.project, id));
      const next = setMarkControls(fresh.project, markId, alive);
      canvasCommit(fresh.project, next.project, strings.history.markControls);
    } catch (error) {
      fail(error);
    }
  }

  async function askNewRoom(markId) {
    const name = await uiPrompt({ title: strings.rooms.newTitle, placeholder: strings.rooms.namePlaceholder });
    if (!name) {
      render();
      return;
    }
    setRoom(markId, name);
  }

  function roomField(state, mark) {
    const manual = markRoomManual(mark);
    const select = uiEl("select", {
      class: "ui-select marks__room" + (manual ? " is-manual" : ""),
      title: manual ? strings.marks.roomManual : strings.marks.roomAuto,
    });
    const auto = mark.roomId ? findRoom(state.project, mark.roomId) : null;
    select.append(
      uiEl("option", {
        value: MARKS_AUTO_ROOM,
        text: auto ? text("rooms.autoOf", { name: auto.name }) : strings.rooms.auto,
      }),
    );
    select.append(uiEl("option", { value: "", text: strings.rooms.none }));
    for (const room of roomsInOrder(state.project)) {
      select.append(uiEl("option", { value: room.id, text: room.name }));
    }
    select.append(uiEl("option", { value: MARKS_NEW_ROOM, text: strings.rooms.newRoom }));
    select.value = manual ? mark.roomId || "" : MARKS_AUTO_ROOM;
    select.addEventListener("change", () => {
      if (select.value === MARKS_NEW_ROOM) {
        askNewRoom(mark.id);
        return;
      }
      if (select.value === MARKS_AUTO_ROOM) {
        setAutoRoom(mark.id);
        return;
      }
      const room = select.value ? roomsInOrder(state.project).find((item) => item.id === select.value) : null;
      setRoom(mark.id, room ? room.name : "");
    });
    return select;
  }

  // Раскрыта та метка, что выделена: клик по строке и клик по метке на плане
  // — один и тот же выбор, и показывать они должны одно и то же. Поэтому
  // отдельного «раскрытого» состояния нет: одно выделение на список и холст.
  function markRow(state, row, selected, repeats, controllers) {
    const mark = row.mark;
    const view = marksRowModel(state.project, row, {
      open: selected,
      repeat: repeats.get(mark.id) || 0,
      controllers,
    });
    const badge =
      view.repeat > 0
        ? uiEl("span", {
            class: "mark-row__repeat",
            text: text("marks.repeatBadge", { count: view.repeat }),
            title: text("problems.repeatedNumber", { label: view.label, count: view.repeat }),
          })
        : null;
    // Свёрнутая строка — значок и обозначение: ровно то, по чему метку ищут
    // глазами. Полей в ней нет и в разметке: при полусотне меток это ещё и
    // полсотни неподнятых полей ввода.
    const head = view.fields
      ? uiEl("div", { class: "mark-row__head" }, [
          // Галочка раскрытия — одна и та же в обоих видах: по ней видно,
          // свёрнута строка или раскрыта, и куда нажать.
          uiEl("span", { class: "mark-row__toggle" }),
          shapeIcon(view.style.shape, view.style.color, 20),
          uiEl("span", { class: "mark-row__label", text: view.code }),
          uiEl("input", {
            class: "ui-input mark-row__number",
            type: "number",
            value: String(view.fields.number),
            title: strings.marks.number,
            attrs: { min: "1", max: String(MARK_NUMBER_MAX), step: "1" },
            on: { change: (event) => setNumber(mark.id, event.target.value) },
          }),
          badge,
          uiEl("span", { class: "mark-row__type", text: view.typeName }),
        ])
      : uiEl("div", { class: "mark-row__head" }, [
          uiEl("span", { class: "mark-row__toggle" }),
          shapeIcon(view.style.shape, view.style.color, 20),
          uiEl("span", { class: "mark-row__label", text: view.label }),
          badge,
        ]);
    const controlsButton = view.fields
      ? uiButton(
          view.fields.controls.length > 0
            ? text("marks.controlsOf", { labels: view.fields.controls.join(", ") })
            : strings.marks.controls,
          {
            class: "ui-btn ui-btn--wide mark-row__controls" + (view.fields.controls.length > 0 ? " is-set" : ""),
            title: strings.marks.controlsTitle,
            on: { click: () => editControls(mark.id) },
          },
        )
      : null;
    const node = uiEl(
      "div",
      {
        class: "mark-row" + (view.open ? " is-current is-open" : ""),
        title: strings.marks.focus,
      },
      [
        head,
        view.fields ? roomField(state, mark) : null,
        view.fields
          ? uiEl("input", {
              class: "ui-input",
              type: "text",
              value: view.fields.location,
              placeholder: strings.marks.locationPlaceholder,
              title: strings.marks.location,
              on: { change: (event) => setField(mark.id, "location", event.target.value) },
            })
          : null,
        view.fields
          ? uiEl("input", {
              class: "ui-input",
              type: "text",
              value: view.fields.original,
              placeholder: strings.marks.originalPlaceholder,
              title: strings.marks.original,
              on: { change: (event) => setField(mark.id, "original", event.target.value) },
            })
          : null,
        controlsButton,
        // Обратная сторона связи — строкой и только для чтения: стоя у
        // светильника, надо видеть, какой выключатель его включает, а правится
        // связь там, где её завели, — у выключателя.
        view.fields && view.fields.controlledBy.length > 0
          ? uiEl("p", {
              class: "mark-row__by",
              text: text("marks.controlledBy", { labels: view.fields.controlledBy.join(", ") }),
            })
          : null,
      ],
    );
    node.addEventListener("pointerdown", (event) => {
      if (event.target.closest("input, select, button, option")) return;
      selectMark(mark.id);
    });
    // Режим просмотра: строка читается и подводит к метке на плане, но поля
    // в ней не правятся — правка живёт на широком экране.
    if (!layoutAllows("editMarks", state.layout)) {
      for (const field of node.querySelectorAll("input")) field.readOnly = true;
      for (const field of node.querySelectorAll("select")) field.disabled = true;
      // Кнопка связи — тоже правка: в режиме просмотра она не нажимается.
      for (const button of node.querySelectorAll("button")) button.disabled = true;
    }
    return node;
  }

  function render() {
    pending = false;
    const state = getState();
    if (!state.project || !state.schemeId) {
      count.textContent = "";
      list.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.panels.canvasEmpty }));
      return;
    }
    const rows = filtersMarkRows(state.project, state.schemeId, state.filter);
    const total = state.project.marks.filter((mark) => mark.schemeId === state.schemeId).length;
    count.textContent = total > 0 ? text("marks.count", { shown: rows.length, total }) : "";
    if (rows.length === 0) {
      list.replaceChildren(
        uiEl("p", { class: "panel__empty", text: total > 0 ? strings.marks.nothingFound : strings.panels.marksEmpty }),
      );
      return;
    }
    const selected = new Set(state.selectedMarkIds);
    // Повтор номера ищется по всему объекту, а не по видимым строкам: два Т1 на
    // разных схемах — такой же повтор, и предупредить о нём надо в обеих.
    const repeats = new Map();
    for (const item of repeatedNumbers(state.project)) {
      for (const markId of item.markIds) repeats.set(markId, item.count);
    }
    const controllers = marksControllerIndex(state.project);
    list.replaceChildren(
      ...rows.map((row) => markRow(state, row, selected.has(row.mark.id), repeats, controllers)),
    );
    // Подводим список к выделенной строке только когда выделение сменилось:
    // иначе правка поля в одной строке уводила бы список к другой.
    const selection = state.selectedMarkIds.join(",");
    const current = list.querySelector(".mark-row.is-current");
    if (current && selection !== shownSelection) current.scrollIntoView({ block: "nearest" });
    shownSelection = selection;
  }

  // Отложенная перерисовка: то, что накопилось, пока пользователь печатал.
  host.addEventListener("focusout", () => {
    if (!pending) return;
    setTimeout(() => {
      if (!typing()) render();
    }, 0);
  });
  api.subscribe((state, changed) => {
    if (
      !(
        "project" in changed ||
        "schemeId" in changed ||
        "filter" in changed ||
        "selectedMarkIds" in changed ||
        "layout" in changed
      )
    ) {
      return;
    }
    if (typing()) {
      pending = true;
      return;
    }
    render();
  });
  render();
}

registerPanel(PANEL_IDS.marks, mountMarksPanel);
