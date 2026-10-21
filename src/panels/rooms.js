// Помещения объекта: раздел левой колонки со списком комнат, цветом, числом
// меток и контурами. Заводятся они и на ходу — из поля «Помещение» в списке
// меток, — поэтому главное здесь не список, а `roomsEnsure`: одно и то же
// название не должно плодить двойников.
//
// Дом у помещений один — этот раздел. Ни окна, ни кнопки в правой колонке
// больше нет: заводить, переименовывать, красить, считать метки и удалять
// можно только здесь.
import {
  PANEL_IDS,
  registerPanel,
  SCREEN_DEFAULT,
  SECTION_IDS,
  setScreen,
  setSectionBadge,
} from "../app.js";
import {
  addRoom,
  colorsInUse,
  deleteRoom,
  findRoom,
  listedMarks,
  outlinesInOrder,
  roomHasFloor,
  roomsInOrder,
  setRoomFloor,
  updateRoom,
} from "../model.js";
import { strings, text } from "../strings.js";
import { uiButton, uiConfirm, uiEl, uiIconButton } from "./ui.js";
import { colorPickerButton } from "./colorPicker.js";
import { CANVAS_MODE_ROOM_TRACE, canvasCommit, canvasRoomTraceSaid, canvasStartRoomTrace } from "../canvas.js";
import { roomTraceReady } from "../roomTrace.js";

// Кнопка цвета помещения: открывает своё окно выбора. Занятыми в него уходят
// и цвета соседних комнат, и цвета категорий: контуров на плане бывает
// десяток, а метка своей же комнаты не должна повторять цвет её заливки.
function roomColorField(project, room, onChange) {
  return colorPickerButton({
    value: room.color,
    used: colorsInUse(project, { exceptRoomId: room.id }),
    title: strings.rooms.color,
    onPick: onChange,
  });
}

function roomsKey(name) {
  return String(name == null ? "" : name).trim().toLowerCase();
}

export function roomsFind(project, name) {
  const key = roomsKey(name);
  if (!key) return null;
  return project.rooms.find((room) => roomsKey(room.name) === key) || null;
}

// «Было или заведём»: пустое название — это «без помещения», а не комната
// с пустым именем.
export function roomsEnsure(project, name) {
  const found = roomsFind(project, name);
  if (found) return { project, room: found };
  if (!roomsKey(name)) return { project, room: null };
  const created = addRoom(project, name);
  return { project: created.project, room: created.room };
}

/**
 * Сколько меток у комнаты. Комментарии не считаются (G167): число читают как
 * «сколько тут позиций», а плашка — надпись на чертеже.
 *
 * Помещение комментарию при этом проставляется, как всем, — по контуру. Это
 * нужно фильтру: сузив список комнатой, человек работает над ней, и
 * замечания, которые он сам же к этой комнате и написал, должны остаться на
 * плане. В карточке комментария помещение не показывается — там и без него
 * видно, где плашка стоит.
 */
export function roomsUsage(project, roomId) {
  return listedMarks(project.marks).filter((mark) => mark.roomId === roomId).length;
}

// Строки списка: комната, сколько у неё меток и есть ли контур на этой схеме.
// Чистая функция — на ней и стоят тесты раздела.
export function roomsRows(project, schemeId) {
  const outlines = schemeId ? outlinesInOrder(project, schemeId) : [];
  return roomsInOrder(project).map((room) => {
    const outline = outlines.find((item) => item.roomId === room.id) || null;
    return {
      room,
      marks: roomsUsage(project, room.id),
      outlineId: outline ? outline.id : null,
      // Пол помещения (таск 209): по умолчанию есть, и строка списка — его дом.
      hasFloor: roomHasFloor(project, room.id),
    };
  });
}

// Что делает поле добавления: завести комнату или — если такая уже есть —
// сразу обвести её заново. Вторая ветка и заменяет прежний выбор помещения
// из раздела «Метки»: там можно было взять комнату с контуром и обвести ещё раз.
export function roomsAddAction(project, name) {
  const trimmed = String(name == null ? "" : name).trim();
  if (!trimmed) return { kind: "none", roomId: null, name: "" };
  const found = roomsFind(project, trimmed);
  return found
    ? { kind: "draw", roomId: found.id, name: trimmed }
    : { kind: "create", roomId: null, name: trimmed };
}

/**
 * Что делает кнопка «по чертежу»: `trace` — считать контур по стенам, `tell` —
 * сказать, чего не хватает, `name` — попросить название, `scheme` — попросить
 * план. Чистая функция, потому что проверок четыре и порядок у них важен:
 * сперва то, что мешает **вообще**, потом то, что мешает **этому** помещению.
 *
 * Кнопка при этом не гасится и не прячется: «чертежа нет» — это не поломка, а
 * состояние, у которого есть ответ, откуда чертёж берётся. Погашенная кнопка
 * этот ответ сказать не может — нажатия у неё не бывает.
 */
export function roomsTraceAction(project, schemeId, name, ready) {
  if (!project) return { kind: "none", roomId: null, name: "" };
  if (!schemeId) return { kind: "scheme", roomId: null, name: "" };
  if (ready && !ready.ok) return { kind: "tell", roomId: null, name: "", reason: ready.reason };
  const action = roomsAddAction(project, name);
  if (action.kind === "none") return { kind: "name", roomId: null, name: "" };
  return { kind: action.kind === "draw" ? "trace" : "create", roomId: action.roomId, name: action.name };
}

// Что делает кнопка контура: нарисовать новый или править вершины прежнего.
// Правка — это режим выбора с выделенным контуром: дальше вершины таскаются
// на холсте, «+» на стенке добавляет, двойной клик убирает.
export function roomsOutlineAction(row) {
  return row && row.outlineId ? "edit" : "draw";
}

function mountRoomsPanel(host, api) {
  const { getState, setState, subscribe, notify } = api;
  const list = uiEl("div", { class: "rooms" });
  const input = uiEl("input", {
    class: "ui-input",
    type: "text",
    placeholder: strings.rooms.namePlaceholder,
    on: {
      keydown: (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addAndDraw();
      },
    },
  });
  const addButton = uiButton(strings.rooms.addAndDraw, {
    class: "ui-btn ui-btn--accent",
    title: strings.rooms.addAndDrawHint,
    on: { click: () => addAndDraw() },
  });
  // Второй способ — рядом, а не вместо: без чертежа обводят руками, и этот
  // порядок кнопок («обвести» первой) так и говорит.
  const traceButton = uiButton(strings.rooms.addAndTrace, {
    class: "ui-btn",
    title: strings.rooms.addAndTraceHint,
    on: { click: () => addAndTrace() },
  });
  host.replaceChildren(list, uiEl("div", { class: "rooms__add" }, [input, addButton, traceButton]));

  function project() {
    return getState().project;
  }

  function fail(error) {
    notify(error && error.message ? error.message : String(error), "error");
  }

  function commit(after, label, options) {
    canvasCommit(project(), after, label, options);
  }

  // Комната заводится и сразу берётся в обводку: режим рисования включается тем
  // же шагом истории, искать его отдельно не нужно.
  function addAndDraw() {
    const state = getState();
    if (!state.project) return;
    const action = roomsAddAction(state.project, input.value);
    // Пустое поле: прежде кнопка молчала, и нажатие выглядело поломкой.
    if (action.kind === "none") {
      notify(strings.rooms.needName);
      return;
    }
    if (action.kind === "draw") {
      input.value = "";
      startDrawing(action.roomId);
      return;
    }
    try {
      const created = addRoom(state.project, action.name);
      input.value = "";
      canvasCommit(state.project, created.project, strings.history.addRoom, {
        patch: drawPatch(created.room.id),
      });
      if (!state.schemeId) notify(strings.canvas.needScheme);
    } catch (error) {
      fail(error);
    }
  }

  // Та же дорога, что у обводки, но заканчивается она одним кликом по комнате:
  // режим холста ставит `canvasStartRoomTrace`, контур считает он же.
  function addAndTrace() {
    const state = getState();
    const ready = state.project && state.schemeId ? roomTraceReady(state.project, state.schemeId) : null;
    const action = roomsTraceAction(state.project, state.schemeId, input.value, ready);
    if (action.kind === "none") return;
    if (action.kind === "scheme") {
      notify(strings.canvas.needScheme);
      return;
    }
    // Чертежа нет — не молчим: сказано и чего не хватает, и откуда это берётся.
    if (action.kind === "tell") {
      notify(canvasRoomTraceSaid(state.project, action), "error");
      return;
    }
    if (action.kind === "name") {
      notify(strings.rooms.needName);
      return;
    }
    if (action.kind === "trace") {
      input.value = "";
      canvasStartRoomTrace(action.roomId);
      return;
    }
    try {
      const created = addRoom(state.project, action.name);
      input.value = "";
      // Показывают пальцем внутрь комнаты на плане — его и показываем (таск 153).
      setScreen(SCREEN_DEFAULT);
      canvasCommit(state.project, created.project, strings.history.addRoom, {
        patch: { activeRoomId: created.room.id, mode: CANVAS_MODE_ROOM_TRACE, selectedOutlineId: null },
      });
    } catch (error) {
      fail(error);
    }
  }

  // Без схемы рисовать негде: комната заводится, режим остаётся прежним.
  function drawPatch(roomId) {
    return getState().schemeId
      ? { activeRoomId: roomId, mode: "room", selectedOutlineId: null }
      : { activeRoomId: roomId };
  }

  // Кнопка у комнаты: нет контура — обводим, есть — выделяем его и правим
  // вершины на плане.
  //
  // И то и другое делается **на плане**, а раздел «Помещения» стоит в колонке
  // во всех трёх режимах (таск 153): если на экране чертёж или объём, план
  // надо вернуть — иначе обводка началась бы за кадром.
  function startOutline(roomId) {
    const state = getState();
    if (!state.schemeId) {
      notify(strings.canvas.needScheme);
      return;
    }
    const row = roomsRows(state.project, state.schemeId).find((item) => item.room.id === roomId);
    if (roomsOutlineAction(row) !== "edit") {
      startDrawing(roomId);
      return;
    }
    setScreen(SCREEN_DEFAULT);
    setState({ mode: "select", selectedOutlineId: row.outlineId, selectedMarkIds: [], activeRoomId: roomId });
    notify(strings.rooms.outlineEditing);
  }

  // Обводка с нуля — та самая дорога, что была в разделе «Метки»: она осталась
  // и для комнаты, у которой контур уже есть (вписать её название в поле).
  function startDrawing(roomId) {
    if (!getState().schemeId) {
      notify(strings.canvas.needScheme);
      return;
    }
    setScreen(SCREEN_DEFAULT);
    setState({ activeRoomId: roomId, mode: "room", selectedOutlineId: null });
  }

  function rename(roomId, name) {
    const current = findRoom(project(), roomId);
    if (!current || name.trim() === current.name) return;
    try {
      commit(updateRoom(project(), roomId, { name }).project, strings.history.renameRoom);
    } catch (error) {
      fail(error);
      render();
    }
  }

  /**
   * Снять или вернуть пол (таск 209, G317).
   *
   * Это **свойство помещения**, а не отметка показа: оно уезжает с объектом к
   * напарнику и меняет объём у обоих. Поэтому идёт оно через историю, как
   * имя и цвет, а не через настройки браузера.
   */
  function toggleFloor(roomId) {
    const before = project();
    const row = roomsRows(before, getState().schemeId).find((item) => item.room.id === roomId);
    if (!row) return;
    let after;
    try {
      after = setRoomFloor(before, roomId, !row.hasFloor);
    } catch (error) {
      fail(error);
      return;
    }
    if (!after.changed) return;
    commit(after.project, strings.history.roomFloor);
  }

  function recolor(roomId, color) {
    const current = findRoom(project(), roomId);
    // Поле цвета отдаёт значение в нижнем регистре, модель хранит в верхнем:
    // сравнение без учёта регистра бережёт историю от пустого шага.
    if (!current || String(current.color || "").toUpperCase() === String(color).toUpperCase()) return;
    try {
      commit(updateRoom(project(), roomId, { color }).project, strings.history.roomColor);
    } catch (error) {
      fail(error);
      render();
    }
  }

  async function remove(roomId) {
    const current = findRoom(project(), roomId);
    if (!current) return;
    const agreed = await uiConfirm({
      title: strings.rooms.removeTitle,
      message: text("rooms.removeMessage", { name: current.name, count: roomsUsage(project(), roomId) }),
      confirmLabel: strings.dialog.confirm,
    });
    if (!agreed) return;
    const fresh = project();
    if (!findRoom(fresh, roomId)) return;
    canvasCommit(fresh, deleteRoom(fresh, roomId).project, strings.history.removeRoom);
  }

  function render() {
    const state = getState();
    if (!state.project) {
      list.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.projects.empty }));
      setSectionBadge(SECTION_IDS.rooms, "");
      input.disabled = true;
      addButton.disabled = true;
      traceButton.disabled = true;
      return;
    }
    input.disabled = false;
    addButton.disabled = false;
    traceButton.disabled = false;
    // Чего не хватает чертежу — в подсказке кнопки, а не в её погашенном виде:
    // так ответ виден до нажатия, а не только после.
    const ready = state.schemeId ? roomTraceReady(state.project, state.schemeId) : null;
    traceButton.title = ready && !ready.ok
      ? canvasRoomTraceSaid(state.project, ready)
      : strings.rooms.addAndTraceHint;
    traceButton.classList.toggle("is-active", state.mode === CANVAS_MODE_ROOM_TRACE);
    const rows = roomsRows(state.project, state.schemeId);
    setSectionBadge(SECTION_IDS.rooms, rows.length || "");
    if (rows.length === 0) {
      list.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.rooms.empty }));
      return;
    }
    list.replaceChildren(
      ...rows.map((row) => {
        const drawing =
          (state.mode === "room" || state.mode === CANVAS_MODE_ROOM_TRACE) && state.activeRoomId === row.room.id;
        const editing = Boolean(row.outlineId) && state.selectedOutlineId === row.outlineId;
        const action = roomsOutlineAction(row);
        return uiEl("div", { class: "rooms__row" + (drawing || editing ? " is-active" : "") }, [
          roomColorField(state.project, row.room, (color) => recolor(row.room.id, color)),
          uiEl("input", {
            class: "ui-input rooms__name",
            type: "text",
            value: row.room.name,
            on: { change: (event) => rename(row.room.id, event.target.value) },
          }),
          // Счётчик числом: в узкой колонке «меток: 3» съедало имя комнаты,
          // а пояснение живёт в подсказке.
          uiEl("span", {
            class: "rooms__count",
            text: String(row.marks),
            title: text("rooms.marks", { count: row.marks }),
          }),
          uiIconButton("outline", {
            class: "ui-btn" + (action === "edit" ? " rooms__outline--set" : ""),
            title: action === "edit" ? strings.rooms.outlineEdit : strings.rooms.outlineDraw,
            on: { click: () => startOutline(row.room.id) },
          }),
          // Пол — рядом с контуром: обе кнопки про одно и то же замкнутое
          // помещение. Нажатая значит «пол есть», отжатая — «двусветное
          // пространство», и то же самое видно на плане штриховкой.
          uiIconButton("floorSlab", {
            // Состояние видно и цветом, и перечёркнутым значком (D64): класс
            // `is-on` у значковых кнопок раздела ничего не красил, и человек
            // жал в пустоту.
            class: "ui-btn " + (row.hasFloor ? "rooms__floor--on" : "rooms__floor--off"),
            title: (row.hasFloor ? strings.rooms.floorOn : strings.rooms.floorOff) + ". " + strings.rooms.floorHint,
            attrs: { "aria-pressed": row.hasFloor ? "true" : "false" },
            on: { click: () => toggleFloor(row.room.id) },
          }),
          uiIconButton("trash", {
            class: "ui-btn ui-btn--danger",
            title: strings.rooms.remove,
            on: { click: () => remove(row.room.id) },
          }),
        ]);
      }),
    );
  }

  subscribe((state, changed) => {
    if (
      "project" in changed ||
      "schemeId" in changed ||
      "mode" in changed ||
      "activeRoomId" in changed ||
      "selectedOutlineId" in changed
    ) {
      render();
    }
  });
  render();
}

registerPanel(PANEL_IDS.rooms, mountRoomsPanel);
