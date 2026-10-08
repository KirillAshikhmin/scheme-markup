// Окно «Данные для штампа»: графы основной надписи, которых в разметке нет.
//
// Отдельным файлом, а не внутри панели выгрузки: окно зовут из двух диалогов
// (схема и таблица), и жить оно должно там, где его видно обоим. Своей панели
// у него нет — это диалог, а не колонка.
//
// Правка объекта идёт через `canvasCommit`: Ctrl+Z возвращает прежние графы,
// как и любую другую правку. Пустые графы не хранятся вовсе — объект, у
// которого штамп не заполняли, остаётся побайтово прежним (G68).
import { PROJECT_STAMP_FIELDS, projectStamp, setProjectStamp } from "../model.js";
import { canvasCommit } from "../canvas.js";
import { strings } from "../strings.js";
import { uiButton, uiEl, uiModal } from "./ui.js";

/**
 * Подписи и подсказки граф. Ключ — поле модели, поэтому список строк окна
 * не может разойтись с `PROJECT_STAMP_FIELDS`: порядок строк берётся оттуда,
 * а не повторяется здесь вторым списком. Новое поле без подписи ловит тест.
 */
export const STAMP_LABELS = {
  code: { label: "stampCode", hint: "stampCodeHint" },
  stage: { label: "stampStage", hint: "stampStageHint" },
  author: { label: "stampAuthor" },
  checker: { label: "stampChecker" },
  approver: { label: "stampApprover" },
  org: { label: "stampOrg" },
};

function stampField(field, value) {
  const row = STAMP_LABELS[field] || { label: field };
  const input = uiEl("input", {
    class: "ui-input",
    type: "text",
    value,
    placeholder: row.hint ? strings.gost[row.hint] : "",
  });
  return {
    field,
    input,
    node: uiEl("label", { class: "export__field" }, [
      uiEl("span", { class: "export__field-label", text: strings.gost[row.label] || field }),
      input,
    ]),
  };
}

/**
 * Окно с графами. Закрывается двумя способами: «Сохранить» кладёт правку в
 * объект, «Отмена» не трогает ничего. `onSaved` зовут после сохранения —
 * диалогу выгрузки надо обновить подсказку.
 */
export function stampDialog(api, onSaved) {
  const { getState, notify } = api;
  const current = projectStamp(getState().project);
  const rows = PROJECT_STAMP_FIELDS.map((field) => stampField(field, current[field]));

  const save = () => {
    const patch = {};
    for (const row of rows) patch[row.field] = row.input.value;
    const before = getState().project;
    const result = setProjectStamp(before, patch);
    if (result.changed) canvasCommit(before, result.project, strings.history.stamp);
    modal.close();
    notify(strings.gost.stampSaved, "success");
    if (typeof onSaved === "function") onSaved();
  };

  const confirm = uiButton(strings.dialog.save, { class: "ui-btn ui-btn--accent", on: { click: save } });
  const modal = uiModal({
    title: strings.gost.stampTitle,
    body: uiEl("div", { class: "export__body" }, [
      uiEl("p", { class: "export__hint", text: strings.gost.stampHint }),
      uiEl("div", { class: "export__controls" }, rows.map((row) => row.node)),
    ]),
    actions: [uiButton(strings.dialog.cancel, { on: { click: () => modal.close() } }), confirm],
    primary: confirm,
  });
  return modal;
}
