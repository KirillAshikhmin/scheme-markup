// Помещения объекта: заводятся на ходу из поля «Помещение» в списке меток,
// правятся и удаляются в своём окне.
//
// Своего справочника комнат пользователь не заполняет заранее — он пишет
// «Спальная Оли» в строке метки, и комната появляется. Поэтому главное здесь —
// не окно, а `roomsEnsure`: одно и то же название не должно плодить двойников.
import { addRoom, deleteRoom, findRoom, roomsInOrder, updateRoom } from "../model.js";
import { strings, text } from "../strings.js";
import { uiButton, uiConfirm, uiEl, uiModal } from "./ui.js";
import { canvasCommit } from "../canvas.js";

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

export function openRoomsEditor(api) {
  const list = uiEl("div", { class: "rooms" });
  const input = uiEl("input", {
    class: "ui-input",
    type: "text",
    placeholder: strings.rooms.namePlaceholder,
    on: {
      keydown: (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addFromInput();
      },
    },
  });

  function project() {
    return api.getState().project;
  }

  // Перерисовка приходит подпиской на объект: так окно обновляется и от своей
  // команды, и от чужой — например, от Ctrl+Z, пока оно открыто.
  function commit(after, label) {
    canvasCommit(project(), after, label);
  }

  function fail(error) {
    api.notify(error && error.message ? error.message : String(error), "error");
  }

  function addFromInput() {
    const name = input.value.trim();
    if (!name) return;
    if (roomsFind(project(), name)) {
      input.value = "";
      return;
    }
    try {
      commit(addRoom(project(), name).project, strings.history.addRoom);
      input.value = "";
    } catch (error) {
      fail(error);
    }
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

  async function remove(roomId) {
    const current = findRoom(project(), roomId);
    if (!current) return;
    const agreed = await uiConfirm({
      title: strings.rooms.removeTitle,
      message: text("rooms.removeMessage", { name: current.name, count: roomsUsage(project(), roomId) }),
      confirmLabel: strings.dialog.confirm,
    });
    if (!agreed) return;
    commit(deleteRoom(project(), roomId).project, strings.history.removeRoom);
  }

  function render() {
    const rooms = roomsInOrder(project());
    if (rooms.length === 0) {
      list.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.rooms.empty }));
      return;
    }
    list.replaceChildren(
      ...rooms.map((room) =>
        uiEl("div", { class: "rooms__row" }, [
          uiEl("input", {
            class: "ui-input",
            type: "text",
            value: room.name,
            on: { change: (event) => rename(room.id, event.target.value) },
          }),
          uiEl("span", {
            class: "rooms__count",
            text: text("rooms.marks", { count: roomsUsage(project(), room.id) }),
          }),
          uiButton("🗑", {
            class: "ui-btn ui-btn--danger",
            title: strings.rooms.remove,
            on: { click: () => remove(room.id) },
          }),
        ]),
      ),
    );
  }

  render();
  const unsubscribe = api.subscribe((state, changed) => {
    if ("project" in changed) render();
  });
  const modal = uiModal({
    title: strings.rooms.title,
    body: uiEl("div", { class: "rooms__box" }, [
      list,
      uiEl("div", { class: "rooms__add" }, [
        input,
        uiButton(strings.rooms.add, { class: "ui-btn ui-btn--accent", on: { click: () => addFromInput() } }),
      ]),
    ]),
    actions: [uiButton(strings.dialog.close, { on: { click: () => close() } })],
    onCancel: () => unsubscribe(),
  });
  function close() {
    unsubscribe();
    modal.close();
  }
  return { close };
}
