// Окно «Устройство» (таск 03 сценариев, истории 1.1, 1.8–1.13): сводка профиля,
// состав окна, правки черновика и перевод черновика в записи модели.
//
// Ожидаемые подписи и значения здесь записаны руками по спецификации и словарю
// заказчика, а не прочитаны из кода под тестом. Сам диалог проверяется живой
// приёмкой; здесь — чистая часть и швы с моделью.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  createProject,
  findMark,
  findType,
  markDeviceOf,
  markDeviceOwn,
  markDeviceProfile,
  setMarkDevice,
  setTypeDevice,
  typeDeviceOf,
} from "../src/model.js";
import { LAYOUT_ABILITIES } from "../src/app.js";
import { strings } from "../src/strings.js";
import {
  deviceDraftAddService,
  deviceDraftChar,
  deviceDraftDecoupled,
  deviceDraftKind,
  deviceDraftOf,
  deviceDraftParam,
  deviceDraftRemoveService,
  deviceMarkField,
  deviceMarkPatch,
  deviceSummary,
  deviceTypeField,
  deviceTypeRecord,
  deviceWindowModel,
} from "../src/panels/deviceSettings.js";
import { filtersMarkRows } from "../src/panels/filters.js";
import { marksRowModel } from "../src/panels/marks.js";

function typeOf(project, code) {
  return project.markTypes.find((type) => type.code === code);
}

function home() {
  let project = createProject({ name: "Дом" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const marks = {};
  let x = 0.1;
  for (const code of ["Т", "ВВ", "ВВВ", "В", "ДД", "Щ"]) {
    const result = addMark(project, {
      schemeId: scheme.scheme.id,
      typeId: typeOf(project, code).id,
      kind: "point",
      points: [{ x, y: 0.5 }],
    });
    project = result.project;
    marks[code] = result.mark.id;
    x += 0.1;
  }
  return { project, schemeId: scheme.scheme.id, marks };
}

test("сводка: свет — вид и характеристики, выключатель — число клавиш, щит — без устройства", () => {
  const { project } = home();
  const sum = (code) => deviceTypeField(project, typeOf(project, code).id);
  assert.equal(sum("Т"), "Светильник: включено, яркость");
  assert.equal(sum("В"), "1 клавиша");
  assert.equal(sum("ВВ"), "2 клавиши");
  assert.equal(sum("ВВВ"), "3 клавиши");
  assert.equal(sum("Щ"), "без устройства");
  // Датчик с добавленной освещённостью: главный сервис назван, остальное числом.
  const motion = typeOf(project, "ДД");
  const draft = deviceDraftAddService(deviceDraftOf(typeDeviceOf(project, motion.id)), "LightSensor");
  assert.equal(
    deviceSummary({ ...draft, services: draft.services }, 1),
    "Датчик движения: движение + ещё 1",
  );
});

test("сводка: склонение числа клавиш — 1, 2–4, 5 и 11–14", () => {
  const key = { kind: "switch", services: [{ type: "StatelessProgrammableSwitch", chars: ["ProgrammableSwitchEvent"], perChannel: true }] };
  assert.equal(deviceSummary(key, 1), "1 клавиша");
  assert.equal(deviceSummary(key, 4), "4 клавиши");
  assert.equal(deviceSummary(key, 5), "5 клавиш");
  assert.equal(deviceSummary(key, 11), "11 клавиш");
  assert.equal(deviceSummary(key, 21), "21 клавиша");
  assert.equal(deviceSummary(null), "без устройства");
});

test("необязательная характеристика включается галкой и выключается ею же; обязательная не гаснет", () => {
  const { project } = home();
  const base = deviceDraftOf(typeDeviceOf(project, typeOf(project, "Т").id));
  const withCct = deviceDraftChar(base, 0, "ColorTemperature", true);
  assert.deepEqual(withCct.services[0].chars, ["On", "Brightness", "ColorTemperature"]);
  assert.deepEqual(deviceDraftChar(withCct, 0, "ColorTemperature", false), base);
  // «Включено» обязательна — галки у неё нет, и команда её не снимает.
  assert.equal(deviceDraftChar(base, 0, "On", false), base);
  // Порядок характеристик — порядок словаря, как бы ни нажимали.
  const rgb = deviceDraftChar(deviceDraftChar(base, 0, "Hue", true), 0, "ColorTemperature", true);
  assert.deepEqual(rgb.services[0].chars, ["On", "Brightness", "ColorTemperature", "Hue"]);
});

test("состав окна: галки только у необязательного, добавленный сервис убирается, вида нет — сервисов нет", () => {
  const { project } = home();
  const base = deviceDraftOf(typeDeviceOf(project, typeOf(project, "ДД").id));
  let model = deviceWindowModel(base, 1);
  assert.equal(model.services.length, 1);
  assert.equal(model.services[0].removable, false, "сервис вида не убирается");
  assert.deepEqual(model.services[0].optional, []);
  // Батарея и освещённость — спутники датчика движения: стоят в списке первыми.
  assert.deepEqual(model.addable.slice(0, 2).map((item) => item.type), ["LightSensor", "BatteryService"]);
  assert.ok(!model.addable.some((item) => item.type === "MotionSensor"), "уже стоящий сервис не предлагается");
  assert.equal(model.addable.find((item) => item.type === "BatteryService").aux, true, "батарея помечена служебной");

  const added = deviceDraftAddService(base, "BatteryService");
  model = deviceWindowModel(added, 1);
  assert.deepEqual(model.services.map((item) => [item.type, item.removable, item.aux]), [
    ["MotionSensor", false, false],
    ["BatteryService", true, true],
  ]);
  assert.deepEqual(deviceDraftRemoveService(added, 1), base);

  // Без устройства: ни сервисов, ни «добавить».
  const none = deviceWindowModel(deviceDraftOf(null), 1);
  assert.equal(none.kind, "none");
  assert.deepEqual([none.services, none.addable, none.keys, none.params], [[], [], [], []]);
  assert.equal(none.kinds[0].key, "none");
});

test("клавиши: по числу каналов типа, отметка «Отвязана» ложится в профиль и в развёрнутые сервисы", () => {
  const { project, schemeId } = home();
  const type = typeOf(project, "ВВВ");
  const draft = deviceDraftOf(typeDeviceOf(project, type.id));
  const model = deviceWindowModel(draft, 3);
  assert.deepEqual(model.keys.map((key) => [key.channel, key.decoupled]), [[1, false], [2, false], [3, false]]);
  assert.equal(model.services[0].label, "Кнопка × 3");

  const decoupled = deviceDraftDecoupled(deviceDraftDecoupled(draft, 3, true), 2, true);
  assert.deepEqual(decoupled.decoupled, [2, 3]);
  assert.deepEqual(deviceWindowModel(decoupled, 3).keys.map((key) => key.decoupled), [false, true, true]);
  assert.deepEqual(deviceDraftDecoupled(decoupled, 2, false).decoupled, [3]);

  const written = setTypeDevice(project, type.id, deviceTypeRecord(decoupled)).project;
  const markId = addMark(written, {
    schemeId,
    typeId: type.id,
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  assert.deepEqual(
    markDeviceOf(markId.project, markId.mark.id).services.map((service) => service.decoupled),
    [false, true, true],
  );
  // Светильнику клавиш нет.
  assert.deepEqual(deviceWindowModel(deviceDraftOf(typeDeviceOf(project, typeOf(project, "Т").id)), 1).keys, []);
});

test("параметры с границами: мусор и выход за диапазон не применяются и называют границы", () => {
  const { project } = home();
  const draft = deviceDraftOf(typeDeviceOf(project, typeOf(project, "ДД").id));
  assert.deepEqual(deviceWindowModel(draft, 1).params, [
    { name: "resetSec", label: "Сброс через, с", value: 60, min: 1, max: 86400 },
  ]);
  for (const raw of ["abc", "", "0", "86401", "1.5", "-3"]) {
    const result = deviceDraftParam(draft, "resetSec", raw);
    assert.equal(result.error, "Введите целое число от 1 до 86400", "«" + raw + "» должно отвергаться");
    assert.equal(result.draft, undefined);
  }
  assert.equal(deviceDraftParam(draft, "resetSec", " 30 ").draft.params.resetSec, 30);
  assert.equal(deviceDraftParam(draft, "resetSec", "86400").draft.params.resetSec, 86400);
  assert.equal(draft.params.resetSec, 60, "черновик не мутирует");
  // Ход шторы — своя граница.
  const curtain = deviceDraftOf(typeDeviceOf(project, typeOf(project, "КШ").id));
  assert.equal(deviceDraftParam(curtain, "travelSec", "601").error, "Введите целое число от 1 до 600");
});

test("тип: черновик без правок пишется минимально, правка видна в профиле, возврат вида снимает правку", () => {
  const { project } = home();
  const lamp = typeOf(project, "Т");
  const base = deviceDraftOf(typeDeviceOf(project, lamp.id));
  assert.deepEqual(deviceTypeRecord(base), { kind: "light" });
  assert.equal(deviceTypeRecord(deviceDraftOf(null)), null);

  const tuned = deviceDraftChar(base, 0, "ColorTemperature", true);
  const record = deviceTypeRecord(tuned);
  assert.deepEqual(record, {
    kind: "light",
    services: [{ type: "Lightbulb", chars: ["On", "Brightness", "ColorTemperature"] }],
  });
  const next = setTypeDevice(project, lamp.id, record).project;
  assert.deepEqual(typeDeviceOf(next, lamp.id).services[0].chars, ["On", "Brightness", "ColorTemperature"]);
  assert.equal(deviceTypeField(next, lamp.id), "Светильник: включено, яркость, цветовая температура");

  // «Без устройства» у типа и обратно выбором вида.
  const none = setTypeDevice(project, lamp.id, deviceTypeRecord(deviceDraftKind(base, "none"))).project;
  assert.equal(typeDeviceOf(none, lamp.id), null);
  assert.equal(deviceTypeField(none, lamp.id), "без устройства");
  const relay = deviceDraftKind(deviceDraftOf(null), "relay");
  assert.equal(
    typeDeviceOf(setTypeDevice(none, lamp.id, deviceTypeRecord(relay)).project, lamp.id).kind,
    "relay",
  );
  // Параметры, отличные от вида, едут в запись; равные виду — нет.
  const slow = deviceDraftParam(deviceDraftOf(typeDeviceOf(project, typeOf(project, "КШ").id)), "travelSec", "45").draft;
  assert.deepEqual(deviceTypeRecord(slow), { kind: "curtain", params: { travelSec: 45 } });
  assert.deepEqual(deviceTypeRecord(deviceDraftOf(typeDeviceOf(project, typeOf(project, "КШ").id))), { kind: "curtain" });
});

test("метка: своя настройка — снимок; правка типа её не трогает; «Вернуть как у типа» снимает", () => {
  const { project, marks } = home();
  const lamp = marks["Т"];
  const typeId = findMark(project, lamp).typeId;
  const draft = deviceDraftChar(deviceDraftOf(markDeviceProfile(project, lamp)), 0, "Hue", true);
  const patch = deviceMarkPatch(typeDeviceOf(project, typeId), draft);
  const own = setMarkDevice(project, lamp, patch).project;
  assert.equal(markDeviceOwn(own, lamp), true);
  assert.deepEqual(deviceMarkField(own, lamp), {
    summary: "Светильник: включено, яркость, оттенок",
    own: true,
  });

  // Тип стал вентиляцией — метка со своей настройкой осталась светильником.
  const retyped = setTypeDevice(own, typeId, { kind: "fan" }).project;
  assert.equal(markDeviceProfile(retyped, lamp).kind, "light");
  assert.deepEqual(markDeviceProfile(retyped, lamp).services[0].chars, ["On", "Brightness", "Hue"]);
  // Метка без своей настройки поехала за типом.
  assert.equal(markDeviceProfile(setTypeDevice(project, typeId, { kind: "fan" }).project, lamp).kind, "fan");

  // Вернуть как у типа: метка снова ничья, в файле поля нет.
  const reset = setMarkDevice(own, lamp, undefined).project;
  assert.equal(markDeviceOwn(reset, lamp), false);
  assert.equal("device" in findMark(reset, lamp), false);
  assert.deepEqual(deviceMarkField(reset, lamp), { summary: "Светильник: включено, яркость", own: false });
});

test("метка: черновик, совпавший с типом, ничего не задаёт; «без устройства» у метки — своя настройка", () => {
  const { project, marks } = home();
  const lamp = marks["Т"];
  const typeId = findMark(project, lamp).typeId;
  const same = deviceMarkPatch(typeDeviceOf(project, typeId), deviceDraftOf(typeDeviceOf(project, typeId)));
  assert.deepEqual(same, { kind: undefined, services: undefined, decoupled: undefined, params: undefined });
  assert.equal(setMarkDevice(project, lamp, same).project, project, "нечего менять — тот же объект, шага истории нет");

  const none = setMarkDevice(
    project,
    lamp,
    deviceMarkPatch(typeDeviceOf(project, typeId), deviceDraftOf(null)),
  ).project;
  assert.equal(markDeviceProfile(none, lamp), null);
  assert.deepEqual(deviceMarkField(none, lamp), { summary: "без устройства", own: true });
  // У не-устройства профиль задаётся руками: щиту — датчик.
  const board = marks["Щ"];
  const boardType = findMark(project, board).typeId;
  assert.equal(typeDeviceOf(project, boardType), null);
  const given = setMarkDevice(
    project,
    board,
    deviceMarkPatch(null, deviceDraftKind(deviceDraftOf(null), "motion")),
  ).project;
  assert.equal(markDeviceProfile(given, board).kind, "motion");
  assert.equal(deviceMarkField(given, board).summary, "Датчик движения: движение");
  // Тот же щит у типа: профиль типа — и метка щита его наследует.
  const typed = setTypeDevice(project, boardType, deviceTypeRecord(deviceDraftKind(deviceDraftOf(null), "motion"))).project;
  assert.equal(markDeviceProfile(typed, board).kind, "motion");
});

test("метка: отвязанная клавиша своей настройкой перебивает тип, пустой список — «ничего не отвязано»", () => {
  const { project, marks } = home();
  const sw = marks["ВВ"];
  const typeId = findMark(project, sw).typeId;
  const typed = setTypeDevice(project, typeId, { kind: "switch", decoupled: [1] }).project;
  assert.deepEqual(markDeviceOf(typed, sw).services.map((service) => service.decoupled), [true, false]);
  const draft = deviceDraftDecoupled(deviceDraftOf(markDeviceProfile(typed, sw)), 1, false);
  const own = setMarkDevice(typed, sw, deviceMarkPatch(typeDeviceOf(typed, typeId), draft)).project;
  assert.deepEqual(markDeviceOf(own, sw).services.map((service) => service.decoupled), [false, false]);
  assert.deepEqual(markDeviceOf(typed, sw).services.map((service) => service.decoupled), [true, false], "тип не тронут");
});

test("строка метки несёт поле device и не хранит его в объекте", () => {
  const { project, marks, schemeId } = home();
  const before = JSON.stringify(project);
  const row = filtersMarkRows(project, schemeId, null).find((item) => item.mark.id === marks["ВВ"]);
  const view = marksRowModel(project, row, { open: true });
  assert.deepEqual(view.fields.device, { summary: "2 клавиши", own: false });
  assert.equal(marksRowModel(project, row, { open: false }).fields, null);
  assert.equal(JSON.stringify(project), before, "чтение ничего не дописало в объект");
  assert.equal("device" in findMark(project, marks["ВВ"]), false);
  assert.equal("device" in findType(project, findMark(project, marks["ВВ"]).typeId), false);
});

test("телефон: правка меток недоступна — окно откроется только на просмотр", () => {
  assert.deepEqual(LAYOUT_ABILITIES.editMarks, ["desktop"]);
  assert.ok(strings.deviceWindow.viewOnly.length > 0);
});
