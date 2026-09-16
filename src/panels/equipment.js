// Оборудование: справочник моделей объекта и планирование, что где стоит.
//
// Заказчик разделил две вещи, и окно держит их рядом, но не путает. Модель —
// товар в справочнике: «Shelly 1PM», одна модель стоит на многих метках, и по
// ней считается закупка. Размещённая единица — «одна штука тут»: модель, метка
// места и связи с другими метками (реле стоит в щите, а связано со
// светильниками и выключателем).
//
// Метку выбирает общее окно выбора из `markControls.js` — второго такого в
// сборке нет: и место, и связи спрашиваются им же.
import { layoutAllows } from "../app.js";
import { strings, text } from "../strings.js";
import {
  addEquipment,
  addPlacement,
  deleteEquipment,
  deletePlacement,
  equipmentInOrder,
  equipmentUsage,
  findEquipment,
  findMark,
  labelOf,
  placementLinkIds,
  placementsAt,
  placementsInOrder,
  updateEquipment,
  updatePlacement,
} from "../model.js";
import { canvasCommit } from "../canvas.js";
import { uiButton, uiConfirm, uiEl, uiModal } from "./ui.js";
import { openMarkPicker } from "./markControls.js";

// Подпись единицы для строки списка меток и для кнопки: модель плюс связи.
export function placementSummary(project, placement) {
  const model = findEquipment(project, placement.equipmentId);
  const links = placementLinkIds(placement)
    .map((id) => labelOf(project, id))
    .filter(Boolean);
  return { name: model ? model.name : "", vendor: model ? model.vendor : "", links };
}

export function openEquipmentWindow(api, options = {}) {
  const markId = options.markId || null;
  const body = uiEl("div", { class: "equip" });

  function project() {
    return api.getState().project;
  }

  function editable() {
    return layoutAllows("editMarks", api.getState().layout);
  }

  function fail(error) {
    api.notify(error && error.message ? error.message : String(error), "error");
    render();
  }

  // Перерисовка приходит подпиской на объект: так окно обновляется и от своей
  // команды, и от чужой — например, от Ctrl+Z, пока оно открыто.
  function commit(build, label) {
    try {
      canvasCommit(project(), build(project()), label);
    } catch (error) {
      fail(error);
    }
  }

  // ——— справочник моделей ———

  function modelRow(item) {
    const used = equipmentUsage(project(), item.id);
    const remove = uiButton("🗑", {
      class: "ui-btn ui-btn--danger",
      title: used > 0 ? text("errors.equipmentInUse", { name: item.name, count: used }) : strings.equipment.removeModel,
      on: { click: () => removeModel(item) },
    });
    remove.disabled = used > 0;
    return uiEl("div", { class: "equip__row" }, [
      uiEl("input", {
        class: "ui-input equip__name",
        type: "text",
        value: item.name,
        title: strings.equipment.name,
        on: {
          change: (event) =>
            commit((current) => updateEquipment(current, item.id, { name: event.target.value }).project, strings.history.editEquipment),
        },
      }),
      uiEl("input", {
        class: "ui-input",
        type: "text",
        value: item.vendor,
        placeholder: strings.equipment.vendorPlaceholder,
        title: strings.equipment.vendor,
        on: {
          change: (event) =>
            commit((current) => updateEquipment(current, item.id, { vendor: event.target.value }).project, strings.history.editEquipment),
        },
      }),
      uiEl("input", {
        class: "ui-input equip__code",
        type: "text",
        value: item.code,
        placeholder: strings.equipment.codePlaceholder,
        title: strings.equipment.code,
        on: {
          change: (event) =>
            commit((current) => updateEquipment(current, item.id, { code: event.target.value }).project, strings.history.editEquipment),
        },
      }),
      uiEl("span", { class: "equip__used", text: text("equipment.used", { count: used }) }),
      remove,
    ]);
  }

  async function removeModel(item) {
    const agreed = await uiConfirm({
      title: strings.equipment.removeModelTitle,
      message: text("equipment.removeModelMessage", { name: item.name }),
      confirmLabel: strings.dialog.confirm,
    });
    if (!agreed) return;
    commit((current) => deleteEquipment(current, item.id).project, strings.history.removeEquipment);
  }

  function addModelRow() {
    const name = uiEl("input", {
      class: "ui-input equip__name",
      type: "text",
      placeholder: strings.equipment.namePlaceholder,
      title: strings.equipment.name,
    });
    const vendor = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.equipment.vendorPlaceholder,
      title: strings.equipment.vendor,
    });
    const code = uiEl("input", {
      class: "ui-input equip__code",
      type: "text",
      placeholder: strings.equipment.codePlaceholder,
      title: strings.equipment.code,
    });
    return uiEl("div", { class: "equip__row equip__row--add" }, [
      name,
      vendor,
      code,
      uiButton(strings.equipment.addModel, {
        class: "ui-btn ui-btn--accent",
        on: {
          click: () =>
            commit(
              (current) => addEquipment(current, { name: name.value, vendor: vendor.value, code: code.value }).project,
              strings.history.addEquipment,
            ),
        },
      }),
    ]);
  }

  // ——— размещение ———

  function modelSelect(value, onPick) {
    const select = uiEl("select", {
      class: "ui-select",
      title: strings.equipment.name,
      on: { change: (event) => onPick(event.target.value) },
    });
    for (const item of equipmentInOrder(project())) {
      select.append(uiEl("option", { value: item.id, text: item.name }));
    }
    select.value = value || "";
    return select;
  }

  async function pickPlace(placement) {
    const chosen = await openMarkPicker(project(), {
      title: text("equipment.placeTitle", { name: placementSummary(project(), placement).name }),
      chosen: [placement.markId],
      multiple: false,
    });
    if (!chosen || chosen.length === 0) return;
    commit((current) => updatePlacement(current, placement.id, { markId: chosen[0] }).project, strings.history.editPlacement);
  }

  async function pickLinks(placement) {
    const chosen = await openMarkPicker(project(), {
      title: text("equipment.linksTitle", { name: placementSummary(project(), placement).name }),
      hint: strings.equipment.linksHint,
      chosen: placementLinkIds(placement),
      exclude: placement.markId,
      multiple: true,
    });
    if (!chosen) return;
    commit((current) => updatePlacement(current, placement.id, { links: chosen }).project, strings.history.editPlacement);
  }

  function placementRow(placement) {
    const summary = placementSummary(project(), placement);
    const place = findMark(project(), placement.markId);
    return uiEl("div", { class: "equip__row" }, [
      modelSelect(placement.equipmentId, (equipmentId) =>
        commit((current) => updatePlacement(current, placement.id, { equipmentId }).project, strings.history.editPlacement),
      ),
      uiButton(place ? labelOf(project(), placement.markId) : strings.equipment.placeChoose, {
        class: "ui-btn equip__place",
        title: strings.equipment.place,
        on: { click: () => pickPlace(placement) },
      }),
      uiButton(summary.links.length > 0 ? summary.links.join(", ") : strings.equipment.linksEmpty, {
        class: "ui-btn ui-btn--wide equip__links" + (summary.links.length > 0 ? " is-set" : ""),
        title: strings.equipment.links,
        on: { click: () => pickLinks(placement) },
      }),
      uiButton("🗑", {
        class: "ui-btn ui-btn--danger",
        title: strings.equipment.removePlacement,
        on: {
          click: () =>
            commit((current) => deletePlacement(current, placement.id).project, strings.history.removePlacement),
        },
      }),
    ]);
  }

  function addPlacementRow() {
    const models = equipmentInOrder(project());
    let equipmentId = models.length > 0 ? models[0].id : "";
    let placeId = markId;
    const placeButton = uiButton(placeId ? labelOf(project(), placeId) : strings.equipment.placeChoose, {
      class: "ui-btn equip__place",
      title: strings.equipment.place,
      on: {
        click: async () => {
          const chosen = await openMarkPicker(project(), {
            title: strings.equipment.placeChoose,
            chosen: placeId ? [placeId] : [],
            multiple: false,
          });
          if (!chosen || chosen.length === 0) return;
          placeId = chosen[0];
          placeButton.textContent = labelOf(project(), placeId);
        },
      },
    });
    const add = uiButton(strings.equipment.addPlacement, {
      class: "ui-btn ui-btn--accent",
      title: strings.equipment.addPlacementHint,
      on: {
        click: () => {
          if (!equipmentId) {
            api.notify(strings.equipment.needModel);
            return;
          }
          if (!placeId) {
            api.notify(strings.equipment.addPlacementHint);
            return;
          }
          commit((current) => addPlacement(current, { equipmentId, markId: placeId }).project, strings.history.addPlacement);
        },
      },
    });
    return uiEl("div", { class: "equip__row equip__row--add" }, [
      modelSelect(equipmentId, (value) => {
        equipmentId = value;
      }),
      placeButton,
      add,
    ]);
  }

  function render() {
    const current = project();
    if (!current) {
      body.replaceChildren();
      return;
    }
    const models = equipmentInOrder(current);
    // На метке — только её единицы: окно открыто из строки этой метки.
    const placed = markId ? placementsAt(current, markId) : placementsInOrder(current);
    body.replaceChildren(
      uiEl("h4", { class: "equip__title", text: strings.equipment.models }),
      ...(models.length > 0
        ? models.map((item) => modelRow(item))
        : [uiEl("p", { class: "panel__empty", text: strings.equipment.modelsEmpty })]),
      addModelRow(),
      uiEl("h4", { class: "equip__title", text: strings.equipment.placed }),
      ...(placed.length > 0
        ? placed.map((placement) => placementRow(placement))
        : [
            uiEl("p", {
              class: "panel__empty",
              text: markId ? strings.equipment.placedEmptyAtMark : strings.equipment.placedEmpty,
            }),
          ]),
      addPlacementRow(),
    );
    // Режим просмотра: окно читается, но ничего не правит — как и список меток.
    if (!editable()) {
      for (const field of body.querySelectorAll("input")) field.readOnly = true;
      for (const field of body.querySelectorAll("select")) field.disabled = true;
      for (const button of body.querySelectorAll("button")) button.disabled = true;
    }
  }

  render();
  const unsubscribe = api.subscribe((state, changed) => {
    if ("project" in changed || "layout" in changed) render();
  });
  const modal = uiModal({
    title: markId ? text("equipment.atMarkTitle", { label: labelOf(project(), markId) }) : strings.equipment.title,
    body,
    actions: [uiButton(strings.dialog.close, { on: { click: () => close() } })],
    onCancel: () => unsubscribe(),
  });
  function close() {
    unsubscribe();
    modal.close();
  }
  return { close };
}
