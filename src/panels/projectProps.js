// Окно «Свойства объекта» (таск 188, требования G283 и G284).
//
// **Где живёт раздел и почему.** Имя объекта правили карандашом в шапке — одним
// полем в окне вопроса; этаж схемы таск 170 тем же карандашом превратил в
// «Свойства схемы». Здесь то же решение на уровень выше: карандаш в шапке
// открывает свойства объекта, а имя стало первым полем среди прочих. Своей
// колонки у раздела нет нарочно — свойства объекта открывают раз в жизни
// объекта, а место в колонках стоит дорого и принадлежит разметке.
//
// **Данные штампа собрались сюда же.** Жили они и прежде у объекта
// (`project.stamp`), а вот дверь к ним была в окне выгрузки — и дверей было
// три: лист схемы, лист таблицы, лист развёрток. Теперь дверь одна, а те три
// кнопки открывают это же окно с подсветкой раздела штампа: выгрузка данные
// читает (`projectStamp`), но не спрашивает.
//
// Отдельным файлом, а не внутри панели объектов: зовут окно из четырёх мест, и
// жить ему надо там, где его видно всем. Своей панели у него нет — это диалог,
// а не колонка.
//
// Правка идёт через `canvasCommit` **одним шагом**: «Сохранить» нажали один
// раз, и Ctrl+Z обязан вернуть окно целиком, а не половину. Тот же урок, что в
// таске 172 с именем схемы.
import {
  PROJECT_STAMP_FIELDS,
  azimuthRhumb,
  formatCoords,
  projectCoords,
  projectSite,
  projectStamp,
  setProjectSite,
  setProjectStamp,
  updateProject,
} from "../model.js";
import { canvasCommit } from "../canvas.js";
import { strings, text } from "../strings.js";
import { uiButton, uiEl, uiModal } from "./ui.js";

/**
 * Подписи и подсказки граф штампа. Ключ — поле модели, поэтому список строк
 * окна не может разойтись с `PROJECT_STAMP_FIELDS`: порядок строк берётся
 * оттуда, а не повторяется здесь вторым списком. Новое поле без подписи ловит
 * тест.
 */
export const STAMP_LABELS = {
  code: { label: "stampCode", hint: "stampCodeHint" },
  stage: { label: "stampStage", hint: "stampStageHint" },
  author: { label: "stampAuthor" },
  checker: { label: "stampChecker" },
  approver: { label: "stampApprover" },
  org: { label: "stampOrg" },
};

/**
 * Живая подпись направления: словом то, что набрано числом. Пустое поле —
 * пустая строка: «не задано» значит север, но говорить это человеку, который
 * ещё ничего не ввёл, незачем.
 *
 * Чистая и отдельно от окна — её проверяет тест: число и румб обязаны сойтись,
 * иначе подпись станет вторым мнением о том, как считать градусы.
 */
export function projectTopFacing(value) {
  const raw = String(value == null ? "" : value).trim();
  if (raw === "") return "";
  const number = Number(raw.replace(/°/g, "").replace(",", "."));
  if (!Number.isFinite(number)) return "";
  return text("projectProps.topFacing", { rhumb: strings.projectProps.rhumbs[azimuthRhumb(number)] });
}

// Подпись над полем, подсказка под ним — и подсказка **снаружи** `label`:
// внутри она приклеивалась бы к имени поля, и читалка называла бы поле
// «Координаты… как в карте… рассвет и закат…» целым абзацем.
//
// Отказ модели стоит **у своего поля**, а не общей строкой внизу окна. Живой
// прогон показал почему: окно свойств длиннее экрана, нижняя строка оказалась
// за краем, и «Сохранить» с мусором в координатах выглядело как «ничего не
// произошло» — при том, что курсор уже стоял в испорченном поле наверху.
function propsField(label, input, hint, error) {
  const field = uiEl("label", { class: "export__field" }, [
    uiEl("span", { class: "export__field-label", text: label }),
    input,
  ]);
  if (!hint && !error) return field;
  return uiEl("div", { class: "export__field" }, [
    field,
    error || null,
    hint ? uiEl("p", { class: "modal__hint", text: hint }) : null,
  ]);
}

function propsHead(label) {
  return uiEl("div", { class: "modal__section", text: label });
}

function propsInput(value, placeholder, extra = {}) {
  return uiEl("input", { class: "ui-input", type: "text", value, placeholder, ...extra });
}

/**
 * Окно свойств. `options.focus === "stamp"` — открыть с подсветкой граф штампа
 * (так его зовут кнопки выгрузки), `options.onSaved` — сообщить тому, кто
 * открыл: окну выгрузки надо обновить свою подсказку.
 */
export function projectPropsDialog(api, options = {}) {
  const { getState, notify } = api;
  const project = getState().project;
  if (!project) return null;
  const site = projectSite(project);
  const stamp = projectStamp(project);

  const nameInput = propsInput(project.name || "", strings.projects.namePlaceholder);
  const addressInput = propsInput(site.address, strings.projectProps.addressPlaceholder);
  const coordsInput = propsInput(formatCoords(projectCoords(project)), strings.projectProps.coordsPlaceholder);
  const topInput = propsInput(
    site.topAzimuthDeg === 0 ? "" : String(site.topAzimuthDeg),
    strings.projectProps.topPlaceholder,
    { attrs: { inputmode: "decimal" } },
  );
  // Живая подпись стоит только тогда, когда ей есть что сказать: пустая строка
  // с отступами оставляла бы в окне дыру — поймано живым прогоном.
  const facing = uiEl("p", { class: "modal__hint" });
  const sayFacing = () => {
    facing.textContent = projectTopFacing(topInput.value);
    facing.hidden = facing.textContent === "";
  };
  sayFacing();
  topInput.addEventListener("input", sayFacing);

  const stampRows = PROJECT_STAMP_FIELDS.map((field) => {
    const row = STAMP_LABELS[field] || { label: field };
    const input = propsInput(stamp[field], row.hint ? strings.gost[row.hint] : "");
    return { field, input, node: propsField(strings.gost[row.label] || field, input) };
  });

  const coordsError = uiEl("p", { class: "modal__error" });
  const topError = uiEl("p", { class: "modal__error" });
  const stampHead = propsHead(strings.projectProps.stamp);
  const body = uiEl("div", { class: "modal__sections" }, [
    uiEl("div", { class: "modal__fields" }, [
      propsField(strings.projectProps.name, nameInput),
      propsField(strings.projectProps.address, addressInput, strings.projectProps.addressHint),
    ]),
    propsHead(strings.projectProps.place),
    uiEl("div", { class: "modal__fields" }, [
      propsField(strings.projectProps.coords, coordsInput, strings.projectProps.coordsHint, coordsError),
      propsField(strings.projectProps.top, topInput, strings.projectProps.topHint, topError),
    ]),
    facing,
    uiEl("p", { class: "modal__hint", text: strings.projectProps.topOnlyVolume }),
    stampHead,
    uiEl("p", { class: "modal__hint", text: strings.gost.stampHint }),
    uiEl("div", { class: "modal__fields" }, stampRows.map((row) => row.node)),
  ]);

  let modal = null;

  function apply() {
    const base = getState().project;
    if (!base) {
      modal.close();
      return;
    }
    // **Числа проверяются первыми.** Опечатка в координатах не должна оставить
    // объект переименованным наполовину, а отказ модели остаётся в окне
    // строкой: закрыть окно и потерять набранное человек не должен.
    coordsError.textContent = "";
    topError.textContent = "";
    let located;
    try {
      located = setProjectSite(base, {
        address: addressInput.value,
        coords: coordsInput.value,
        topAzimuthDeg: topInput.value,
      });
    } catch (failure) {
      const azimuth = failure.code === "azimuthInvalid" || failure.code === "azimuthRange";
      const input = azimuth ? topInput : coordsInput;
      (azimuth ? topError : coordsError).textContent = failure.message;
      input.focus();
      if (typeof input.scrollIntoView === "function") input.scrollIntoView({ block: "center" });
      return;
    }
    const patch = {};
    for (const row of stampRows) patch[row.field] = row.input.value;
    const stamped = setProjectStamp(located.project, patch);
    // Пустое имя — не ответ: окно про имя спрашивают реже всего, а объект без
    // имени не найти в списке.
    const name = nameInput.value.trim();
    const renamed = name !== "" && name !== base.name;
    const next = renamed ? updateProject(stamped.project, { name }).project : stamped.project;
    if (located.changed || stamped.changed || renamed) {
      canvasCommit(base, next, strings.history.projectProps);
    }
    modal.close();
    notify(strings.projectProps.saved, "success");
    if (typeof options.onSaved === "function") options.onSaved();
  }

  for (const input of [nameInput, addressInput, coordsInput, topInput, ...stampRows.map((row) => row.input)]) {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      apply();
    });
  }

  const confirm = uiButton(strings.dialog.save, { class: "ui-btn ui-btn--accent", on: { click: () => apply() } });
  modal = uiModal({
    title: strings.projectProps.title,
    body,
    actions: [uiButton(strings.dialog.cancel, { on: { click: () => modal.close() } }), confirm],
    primary: confirm,
  });
  // Пришли за штампом — окно открывается на штампе: иначе кнопка «Свойства
  // объекта» в выгрузке выглядела бы подменой той, что открывала графы.
  if (options.focus === "stamp") {
    if (typeof stampHead.scrollIntoView === "function") stampHead.scrollIntoView({ block: "nearest" });
    stampRows[0].input.focus();
    stampRows[0].input.select();
  } else {
    nameInput.select();
  }
  return modal;
}
