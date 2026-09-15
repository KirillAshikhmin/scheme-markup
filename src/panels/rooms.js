// Помещения объекта: раздел левой колонки со списком комнат, цветом, числом
// меток и контурами. Заводятся они и на ходу — из поля «Помещение» в списке
// меток, — поэтому главное здесь не список, а `roomsEnsure`: одно и то же
// название не должно плодить двойников.
//
// Отдельного окна «Помещения» больше нет: список и все его действия живут в
// панели, а прежняя кнопка в справочнике разворачивает раздел и подводит к нему.
import { PANEL_IDS, registerPanel, revealSection, SECTION_IDS, setSectionBadge } from "../app.js";
import {
  addRoom,
  colorsInUse,
  deleteRoom,
  findRoom,
  outlinesInOrder,
  roomsInOrder,
  updateRoom,
} from "../model.js";
import { strings, text } from "../strings.js";
import { uiButton, uiConfirm, uiEl, uiModal } from "./ui.js";
import { colorPickerButton } from "./colorPicker.js";
import { canvasCommit } from "../canvas.js";

// Кружок цвета помещения: тем же цветом обводится его контур на схеме.
export function roomSwatch(color, size = 14) {
  return uiEl("span", {
    class: "rooms__swatch",
    attrs: { style: `width:${size}px;height:${size}px;background:${color || "#8B949E"}` },
  });
}

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

export function roomsUsage(project, roomId) {
  return project.marks.filter((mark) => mark.roomId === roomId).length;
}

// Строки списка: комната, сколько у неё меток и есть ли контур на этой схеме.
// Чистая функция — на ней и стоят тесты раздела.
export function roomsRows(project, schemeId) {
  const outlines = schemeId ? outlinesInOrder(project, schemeId) : [];
  return roomsInOrder(project).map((room) => {
    const outline = outlines.find((item) => item.roomId === room.id) || null;
    return { room, marks: roomsUsage(project, room.id), outlineId: outline ? outline.id : null };
  });
}

// Что делает кнопка контура: нарисовать новый или править вершины прежнего.
// Правка — это режим выбора с выделенным контуром: дальше вершины таскаются
// на холсте, «+» на стенке добавляет, двойной клик убирает.
export function roomsOutlineAction(row) {
  return row && row.outlineId ? "edit" : "draw";
}

// Прежнее окно помещений уехало в панель; кнопка «Помещения» в справочнике
// теперь разворачивает раздел, а не открывает второй способ делать то же самое.
export function openRoomsEditor() {
  revealSection(SECTION_IDS.rooms);
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
  host.replaceChildren(list, uiEl("div", { class: "rooms__add" }, [input, addButton]));

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
    const name = input.value.trim();
    if (!state.project || !name) return;
    const found = roomsFind(state.project, name);
    if (found) {
      input.value = "";
      startOutline(found.id);
      return;
    }
    try {
      const created = addRoom(state.project, name);
      input.value = "";
      canvasCommit(state.project, created.project, strings.history.addRoom, {
        patch: drawPatch(created.room.id),
      });
      if (!state.schemeId) notify(strings.canvas.needScheme);
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

  function startOutline(roomId) {
    const state = getState();
    if (!state.schemeId) {
      notify(strings.canvas.needScheme);
      return;
    }
    const row = roomsRows(state.project, state.schemeId).find((item) => item.room.id === roomId);
    if (roomsOutlineAction(row) === "edit") {
      setState({ mode: "select", selectedOutlineId: row.outlineId, selectedMarkIds: [], activeRoomId: roomId });
      notify(strings.rooms.outlineEditing);
      return;
    }
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
      return;
    }
    input.disabled = false;
    addButton.disabled = false;
    const rows = roomsRows(state.project, state.schemeId);
    setSectionBadge(SECTION_IDS.rooms, rows.length || "");
    if (rows.length === 0) {
      list.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.rooms.empty }));
      return;
    }
    list.replaceChildren(
      ...rows.map((row) => {
        const drawing = state.mode === "room" && state.activeRoomId === row.room.id;
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
          uiButton("⬡", {
            class: "ui-btn" + (action === "edit" ? " rooms__outline--set" : ""),
            title: action === "edit" ? strings.rooms.outlineEdit : strings.rooms.outlineDraw,
            on: { click: () => startOutline(row.room.id) },
          }),
          uiButton("🗑", {
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

// Окно выбора помещения для обводки: список комнат объекта плюс поле «новое».
// Устроено как выбор типа метки — по той же причине: выбранное помещение
// «залипает», и следующий контур рисуется без диалога.
export function openRoomPicker(project, options = {}) {
  return new Promise((resolve) => {
    let modal;
    let current = project;
    const done = (result) => {
      modal.close();
      resolve(result || null);
    };

    const list = uiEl("div", { class: "picker__list" });
    const input = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.rooms.namePlaceholder,
      on: {
        keydown: (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          create();
        },
      },
    });

    function create() {
      const name = input.value.trim();
      if (!name) return;
      const found = roomsFind(current, name);
      if (found) {
        done({ roomId: found.id, project: current, created: false });
        return;
      }
      const result = addRoom(current, name);
      done({ roomId: result.room.id, project: result.project, created: true });
    }

    function renderList() {
      const rooms = roomsInOrder(current);
      if (rooms.length === 0) {
        list.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.rooms.empty }));
        return;
      }
      list.replaceChildren(
        ...rooms.map((room) =>
          uiEl(
            "button",
            {
              class: "picker__row" + (room.id === options.activeRoomId ? " is-active" : ""),
              type: "button",
              on: { click: () => done({ roomId: room.id, project: current, created: false }) },
            },
            [roomSwatch(room.color, 16), uiEl("span", { class: "picker__name", text: room.name })],
          ),
        ),
      );
    }

    renderList();
    modal = uiModal({
      title: options.title || strings.rooms.pickTitle,
      body: uiEl("div", { class: "picker" }, [
        list,
        uiEl("div", { class: "rooms__add" }, [
          input,
          uiButton(strings.rooms.add, { class: "ui-btn ui-btn--accent", on: { click: () => create() } }),
        ]),
      ]),
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })],
      dismissable: true,
      onCancel: () => resolve(null),
    });
  });
}
