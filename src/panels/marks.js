// Список меток схемы: обозначение, помещение, расположение и обозначение из
// оригинального проекта — правятся прямо в строке.
//
// Почему список, а не карточка метки: заказчик заполняет «Расположение» и
// «В оригинальной схеме» не в момент постановки, а потом, разом, по списку.
// Поэтому правка здесь на месте, а отдельного окна у метки нет вовсе.
import { PANEL_IDS, registerPanel } from "../app.js";
import { strings, text } from "../strings.js";
import {
  MARK_NUMBER_MAX,
  findMark,
  findRoom,
  markRoomManual,
  findScheme,
  repeatedNumbers,
  roomsInOrder,
  setMarkNumber,
  styleOf,
  updateMark,
} from "../model.js";
import { planToScreen, shapeIcon } from "../render.js";
import { canvasCommit } from "../canvas.js";
import { uiEl, uiPrompt } from "./ui.js";
import { filtersBox, filtersMarkRows } from "./filters.js";
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

  function markRow(state, row, selected, repeats) {
    const mark = row.mark;
    const repeat = repeats.get(mark.id) || 0;
    const node = uiEl("div", { class: "mark-row" + (selected ? " is-current" : ""), title: strings.marks.focus }, [
      uiEl("div", { class: "mark-row__head" }, [
        shapeIcon(row.style.shape, row.style.color, 20),
        uiEl("span", { class: "mark-row__label", text: row.type ? row.type.code : "?" }),
        uiEl("input", {
          class: "ui-input mark-row__number",
          type: "number",
          value: String(mark.number),
          title: strings.marks.number,
          attrs: { min: "1", max: String(MARK_NUMBER_MAX), step: "1" },
          on: { change: (event) => setNumber(mark.id, event.target.value) },
        }),
        repeat > 1
          ? uiEl("span", {
              class: "mark-row__repeat",
              text: text("marks.repeatBadge", { count: repeat }),
              title: text("problems.repeatedNumber", { label: row.label, count: repeat }),
            })
          : null,
        uiEl("span", { class: "mark-row__type", text: row.type ? row.type.name : "" }),
      ]),
      roomField(state, mark),
      uiEl("input", {
        class: "ui-input",
        type: "text",
        value: mark.location || "",
        placeholder: strings.marks.locationPlaceholder,
        title: strings.marks.location,
        on: { change: (event) => setField(mark.id, "location", event.target.value) },
      }),
      uiEl("input", {
        class: "ui-input",
        type: "text",
        value: mark.original || "",
        placeholder: strings.marks.originalPlaceholder,
        title: strings.marks.original,
        on: { change: (event) => setField(mark.id, "original", event.target.value) },
      }),
    ]);
    node.addEventListener("pointerdown", (event) => {
      if (event.target.closest("input, select, button, option")) return;
      selectMark(mark.id);
    });
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
    list.replaceChildren(...rows.map((row) => markRow(state, row, selected.has(row.mark.id), repeats)));
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
    if (!("project" in changed || "schemeId" in changed || "filter" in changed || "selectedMarkIds" in changed)) return;
    if (typing()) {
      pending = true;
      return;
    }
    render();
  });
  render();
}

registerPanel(PANEL_IDS.marks, mountMarksPanel);
