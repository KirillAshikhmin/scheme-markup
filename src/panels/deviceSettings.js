// Окно «Аксессуар»: профиль аксессуара у типа и своя настройка у метки
// (таск 03 сценариев, истории 1.1, 1.8–1.13; слово «аксессуар» вместо
// «устройство», идентификаторы `aid`/`sid` в окне и кнопка клавиши рядом с её
// «Выключателем» — таск 13, G11–G13). Имена в коде (`device*`) прежние.
//
// Устройство метки в имитации — аксессуар: упорядоченный список сервисов с
// характеристиками. Описание живёт у типа (профиль) и может быть поправлено у
// одной метки (своя настройка). Читает и пишет его модель (`typeDeviceOf`,
// `markDeviceProfile`, `setTypeDevice`, `setMarkDevice`); словарь видов,
// сервисов и характеристик — `sim/catalog.js`. Здесь — три вещи:
//
//   1. **Чистая часть**: сводка профиля для кнопки (`deviceSummary`), состав
//      окна (`deviceWindowModel`), правки черновика (`deviceDraft*`) и перевод
//      черновика в то, что принимает модель (`deviceTypeRecord`,
//      `deviceMarkPatch`). Они и проверяются тестами, без браузера.
//   2. **Окно** (`openDeviceWindow`): рисует черновик, правит его и отвечает
//      черновиком — сохраняет ответ не оно, а вызывающий, через `canvasCommit`.
//   3. **Поле строки метки** (`deviceMarkField`): то, что `marksRowModel`
//      кладёт в `head.fields.device`. Второй правды о метке тут нет — всё
//      считается из модели на каждый спрос.
//
// **Черновик** — `{kind, services, decoupled, params}`; «без устройства» —
// `kind: "none"` и пустые остальные. Сервис — как в профиле: `{type, chars,
// perChannel?}`. Что записывать в объект, решает перевод: только то, что
// отличается от умолчания вида (или от типа, если правка у метки), — чтобы
// своя настройка не копировала профиль целиком и тип мог ею не мешать.
import { strings, text } from "../strings.js";
import {
  DEVICE_KINDS,
  DEVICE_PARAMS,
  SIM_SERVICES,
  deviceKind,
  simServiceChars,
  simServiceMeta,
} from "../sim/catalog.js";
import {
  DEVICE_KIND_NONE,
  deviceExpand,
  findMark,
  findType,
  labelOf,
  markDeviceLeader,
  markDeviceOwn,
  markDeviceProfile,
  markIsComment,
  typeChannels,
  typeDeviceOf,
} from "../model.js";
import { deviceAids, deviceIdsOf } from "../sim/home.js";
import { uiBadLine, uiButton, uiCheckRow, uiEl, uiMarkBad, uiModal } from "./ui.js";

// Тип сервиса-клавиши: отметка «отвязана» есть только у него.
const DEVICE_KEY_TYPE = "StatelessProgrammableSwitch";
// «Выключатель» клавиши (G11): реле канала, за которым следуют нагрузки.
const DEVICE_RELAY_TYPE = "Switch";
// Характеристики, которые человеку не показываются галкой: номер клавиши
// проставляет сборка дома.
const DEVICE_HIDDEN_CHARS = ["ServiceLabelIndex"];

function deviceCopyService(service) {
  return {
    type: service.type,
    chars: [...service.chars],
    ...(service.name ? { name: service.name } : {}),
    ...(service.perChannel ? { perChannel: true } : {}),
  };
}

function deviceSameJson(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

// ——— черновик ————————————————————————————————————————————————————————————

/**
 * Черновик по профилю модели (`typeDeviceOf`, `markDeviceProfile`); `null` —
 * «без устройства».
 */
export function deviceDraftOf(profile) {
  if (!profile) return { kind: DEVICE_KIND_NONE, services: [], decoupled: [], params: {} };
  return {
    kind: profile.kind,
    services: profile.services.map(deviceCopyService),
    decoupled: [...(profile.decoupled || [])],
    params: { ...(profile.params || {}) },
  };
}

/** Черновик вида с его умолчаниями; `"none"` — «без устройства». */
export function deviceDraftKind(draft, key) {
  const kind = key === DEVICE_KIND_NONE ? null : deviceKind(key);
  if (!kind) return deviceDraftOf(null);
  return {
    kind: kind.key,
    services: kind.services.map(deviceCopyService),
    decoupled: [],
    params: { ...kind.params },
  };
}

/** Включить или выключить необязательную характеристику сервиса. */
export function deviceDraftChar(draft, index, char, on) {
  const service = draft.services[index];
  const meta = service ? simServiceMeta(service.type) : null;
  if (!meta || !meta.optional.includes(char)) return draft;
  const chosen = new Set(service.chars);
  if (on) chosen.add(char);
  else chosen.delete(char);
  const chars = simServiceChars(service.type, [...chosen]);
  if (deviceSameJson(chars, service.chars)) return draft;
  const services = draft.services.map((item, at) => (at === index ? { ...item, chars } : item));
  return { ...draft, services };
}

/** Добавить сервис из словаря (с его обязательными характеристиками). */
export function deviceDraftAddService(draft, type) {
  const chars = simServiceChars(type, []);
  if (!chars || draft.kind === DEVICE_KIND_NONE) return draft;
  return { ...draft, services: [...draft.services.map(deviceCopyService), { type, chars }] };
}

/** Убрать сервис по месту в списке. */
export function deviceDraftRemoveService(draft, index) {
  if (!draft.services[index]) return draft;
  return { ...draft, services: draft.services.filter((item, at) => at !== index).map(deviceCopyService) };
}

/** Отметить клавишу отвязанной или привязанной. */
export function deviceDraftDecoupled(draft, channel, on) {
  const keys = new Set(draft.decoupled);
  if (on) keys.add(channel);
  else keys.delete(channel);
  return { ...draft, decoupled: [...keys].sort((first, second) => first - second) };
}

/**
 * Параметр вида (время сброса, ход шторы). Ответ — `{draft}` или `{error}`:
 * мусор и выход за границы не применяются, а показываются у поля.
 */
export function deviceDraftParam(draft, name, raw) {
  const range = Object.prototype.hasOwnProperty.call(DEVICE_PARAMS, name) ? DEVICE_PARAMS[name] : null;
  const message = range ? text("deviceWindow.paramBad", { min: range.min, max: range.max }) : "";
  if (!range) return { error: strings.errors.deviceParamInvalid };
  const source = String(raw == null ? "" : raw).trim().replace(",", ".");
  const value = Number(source);
  if (source === "" || !Number.isInteger(value) || value < range.min || value > range.max) return { error: message };
  return { draft: { ...draft, params: { ...draft.params, [name]: value } } };
}

// ——— перевод черновика в запись модели ———————————————————————————————————

// Что даёт вид сам, без правок: сервисы и параметры вида.
function deviceKindBase(key) {
  const kind = deviceKind(key);
  if (!kind) return { services: [], decoupled: [], params: {} };
  return { services: kind.services, decoupled: [], params: kind.params };
}

/**
 * Запись профиля для `setTypeDevice`: `null` — «без устройства», иначе
 * `{kind, services?, decoupled?, params?}`; ключ есть, только если отличается
 * от умолчания вида.
 */
export function deviceTypeRecord(draft) {
  if (draft.kind === DEVICE_KIND_NONE) return null;
  const base = deviceKindBase(draft.kind);
  const record = { kind: draft.kind };
  if (!deviceSameJson(draft.services.map(deviceCopyService), base.services.map(deviceCopyService))) {
    record.services = draft.services.map(deviceCopyService);
  }
  if (draft.decoupled.length > 0) record.decoupled = [...draft.decoupled];
  const params = {};
  for (const [name, value] of Object.entries(draft.params)) if (base.params[name] !== value) params[name] = value;
  if (Object.keys(params).length > 0) record.params = params;
  return record;
}

/**
 * Настройка метки для `setMarkDevice`. Если черновик совпал с профилем типа —
 * все поля `undefined` («как у типа», своей настройки нет). Иначе метка
 * получает **полный снимок** вида, сервисов, отвязанных клавиш и параметров:
 * правка типа после этого метку не трогает (история 1.9). «Без устройства» —
 * один вид `"none"`. `typeProfile` — профиль типа метки (`typeDeviceOf`)
 * или `null`.
 */
export function deviceMarkPatch(typeProfile, draft) {
  if (deviceSameJson(draft, deviceDraftOf(typeProfile))) {
    return { kind: undefined, services: undefined, decoupled: undefined, params: undefined };
  }
  if (draft.kind === DEVICE_KIND_NONE) {
    return { kind: DEVICE_KIND_NONE, services: undefined, decoupled: undefined, params: undefined };
  }
  return {
    kind: draft.kind,
    services: draft.services.map(deviceCopyService),
    // Пустой список у метки законен: он перебивает отвязку, заданную у типа.
    decoupled: [...draft.decoupled],
    params: Object.keys(draft.params).length > 0 ? { ...draft.params } : undefined,
  };
}

// ——— сводка и состав окна ————————————————————————————————————————————————

function deviceKeysText(count) {
  const tail = count % 10;
  const key =
    count % 100 >= 11 && count % 100 <= 14
      ? "keysMany"
      : tail === 1
        ? "keysOne"
        : tail >= 2 && tail <= 4
          ? "keysFew"
          : "keysMany";
  return text("deviceWindow." + key, { n: count });
}

function deviceIsAux(type) {
  const meta = simServiceMeta(type);
  return Boolean(meta && meta.aux);
}

/**
 * Сводка профиля для кнопки: «Светильник: включено, яркость», «3 клавиши»,
 * «без устройства». `profile` — как у `typeDeviceOf` (сервисы можно не
 * разворачивать), `channels` — число каналов типа.
 */
export function deviceSummary(profile, channels = 1) {
  if (!profile || profile.kind === DEVICE_KIND_NONE || profile.services.length === 0) {
    return strings.deviceWindow.none;
  }
  const main = profile.services.filter((service) => !deviceIsAux(service.type));
  // Выключатель — числом клавиш: одни кнопки (профиль до G11) или кнопки со
  // своими «Выключателями» (G11).
  const keyed = main.some((service) => service.type === DEVICE_KEY_TYPE);
  if (keyed && main.every((service) => service.type === DEVICE_KEY_TYPE || service.type === DEVICE_RELAY_TYPE) && profile.kind !== "button") {
    const keys = main
      .filter((service) => service.type === DEVICE_KEY_TYPE)
      .reduce((sum, service) => sum + (service.perChannel ? channels : 1), 0);
    return deviceKeysText(keys);
  }
  const first = main[0] || profile.services[0];
  const chars = first.chars
    .filter((char) => !DEVICE_HIDDEN_CHARS.includes(char))
    .map((char) => (strings.sim.chars[char] || char).toLowerCase());
  const head = (strings.sim.kinds[profile.kind] || profile.kind) + (chars.length > 0 ? ": " + chars.join(", ") : "");
  const more = profile.services.length - 1;
  return more > 0 ? text("deviceWindow.summaryMore", { head, count: more }) : head;
}

/**
 * Поле `device` строки метки (`marksRowModel`) и кнопки типа: всё считается
 * из модели. `own` — у метки своя настройка.
 */
export function deviceMarkField(project, markId) {
  const mark = findMark(project, markId);
  if (!mark) return { summary: strings.deviceWindow.none, own: false };
  const profile = markDeviceProfile(project, markId);
  const summary = deviceSummary(profile, typeChannels(project, mark.typeId));
  // Ведомая метка группы (правка после сборки сценариев): аксессуар — ведущей,
  // и сводка говорит чей.
  const leader = markDeviceLeader(project, markId);
  if (!leader) return { summary, own: markDeviceOwn(project, markId) };
  return { summary: text("deviceWindow.followerSummary", { summary, label: labelOf(project, leader) }), own: false, leader };
}

/** Сводка профиля типа для кнопки справочника. */
export function deviceTypeField(project, typeId) {
  return deviceSummary(typeDeviceOf(project, typeId), typeChannels(project, typeId));
}

/**
 * Идентификатор аксессуара метки (`aid`, G12) — тот же, что у дома
 * (`deviceAids`: совпадения разведены по всему объекту); `null` — нет метки.
 */
export function deviceMarkAid(project, markId) {
  const mark = findMark(project, markId);
  if (!mark || markIsComment(mark)) return null;
  return deviceAids(project).get(markId) ?? null;
}

// Идентификаторы сервисов черновика (G12): по строке окна — список `sid`
// (у сервиса на каждый канал — по номеру на канал), счёт — правилом дома.
function deviceDraftSids(draft, channels) {
  const expanded = deviceExpand({ ...draft, decoupled: [] }, channels);
  const ids = deviceIdsOf(expanded ? expanded.services : []);
  let at = 0;
  return draft.services.map((service) => {
    const copies = deviceExpand({ services: [service], decoupled: [] }, channels).services.length;
    const sids = ids.slice(at, at + copies).map((item) => item.sid);
    at += copies;
    return sids;
  });
}

// Сервисы черновика, которых вид сам не даёт, — «добавленные»: их можно
// убрать. Сопоставление по типу и числу: вид с двумя сервисами одного типа
// теряет «свои» по очереди.
function deviceAddedFlags(draft) {
  const kind = deviceKind(draft.kind);
  const pool = kind ? kind.services.map((service) => service.type) : [];
  return draft.services.map((service) => {
    const at = pool.indexOf(service.type);
    if (at < 0) return true;
    pool.splice(at, 1);
    return false;
  });
}

/**
 * Подпись сервиса по виду устройства (правка после сборки сценариев): у
 * бризера «Выключатель» — это подогрев, у ели две лампы — гирлянда и звезда, у
 * тёплого пола термостат — сам пол. Имени в профиле у них нет: оно выводится,
 * а не пишется (ADR 013). `null` — у вида своих подписей нет. Одна подпись на
 * окно устройства (состав профиля) и на карточку дома (`deviceCard.js`).
 */
export function deviceServiceRole(kind, service) {
  const roles = strings.sim.roles || {};
  if (kind === "breezer" && service.type === "Switch") return roles.breezerHeat || null;
  if (kind === "xmasTree" && service.type === "Lightbulb") return (service.index === 0 ? roles.treeGarland : roles.treeStar) || null;
  if (kind === "warmFloor" && service.type === "Thermostat") return roles.warmFloor || null;
  return null;
}

/**
 * Состав окна по черновику: что показать и что можно. Чистая функция —
 * по ней окно строится и по ней же тест проверяет состав. `aid` — у окна
 * метки её идентификатор аксессуара, у окна типа `null` (у каждой метки свой).
 * У сервиса `sids` — его идентификаторы (по одному на канал), `keyNote` —
 * кнопка стоит рядом со своим «Выключателем» и работает, только когда клавиша
 * отвязана (G11).
 */
export function deviceWindowModel(draft, channels = 1, { aid = null } = {}) {
  const kinds = [
    { key: DEVICE_KIND_NONE, label: strings.deviceWindow.kindNone },
    ...DEVICE_KINDS.map((kind) => ({ key: kind.key, label: strings.sim.kinds[kind.key] || kind.key })),
  ];
  const added = deviceAddedFlags(draft);
  const sids = deviceDraftSids(draft, channels);
  const relayed = draft.services.some((service) => service.type === DEVICE_RELAY_TYPE);
  const services = draft.services.map((service, index) => {
    const meta = simServiceMeta(service.type);
    // У бризера «Выключатель» — «Подогрев», у ели лампы — гирлянда и звезда.
    const name = deviceServiceRole(draft.kind, { type: service.type, index }) || strings.sim.services[service.type] || service.type;
    return {
      index,
      type: service.type,
      label: service.perChannel ? text("deviceWindow.perChannel", { name, count: channels }) : name,
      sids: sids[index],
      keyNote: service.type === DEVICE_KEY_TYPE && relayed,
      aux: Boolean(meta && meta.aux),
      removable: added[index],
      optional: (meta ? meta.optional : [])
        .filter((char) => !DEVICE_HIDDEN_CHARS.includes(char))
        .map((char) => ({ char, label: strings.sim.chars[char] || char, on: service.chars.includes(char) })),
    };
  });
  const present = new Set(draft.services.map((service) => service.type));
  // «Добавить сервис» — **по имени** (правка после сборки сценариев: «при
  // добавлении сервиса в окне упорядочивай их по имени»). Сервисов в словаре
  // теперь весь хаб, семь десятков, и искать нужный глазами можно только по
  // алфавиту; спутники вида первыми больше не ставятся.
  const addable =
    draft.kind === DEVICE_KIND_NONE
      ? []
      : Object.keys(SIM_SERVICES)
          .filter((type) => !present.has(type))
          .map((type) => ({
            type,
            label: strings.sim.services[type] || type,
            aux: Boolean(SIM_SERVICES[type].aux),
          }))
          .sort((first, second) => first.label.localeCompare(second.label, "ru"));
  const keyed = draft.services.some((service) => service.type === DEVICE_KEY_TYPE && service.perChannel);
  const keys = keyed
    ? Array.from({ length: channels }, (unused, at) => ({
        channel: at + 1,
        label: text("deviceWindow.keyLabel", { n: at + 1 }),
        decoupled: draft.decoupled.includes(at + 1),
      }))
    : [];
  const params = Object.keys(draft.params)
    .filter((name) => Object.prototype.hasOwnProperty.call(DEVICE_PARAMS, name))
    .map((name) => ({
      name,
      label: strings.sim.params[name] || name,
      value: draft.params[name],
      min: DEVICE_PARAMS[name].min,
      max: DEVICE_PARAMS[name].max,
    }));
  return {
    kind: draft.kind,
    aid: draft.kind === DEVICE_KIND_NONE || !Number.isInteger(aid) ? null : aid,
    kinds,
    services,
    addable,
    keys,
    params,
  };
}

// ——— окно ————————————————————————————————————————————————————————————————

/**
 * Окно «Аксессуар». Параметры: `title`, `hint`, `profile` (профиль модели
 * или `null`), `channels`, `aid` (у окна метки — её идентификатор
 * аксессуара, `deviceMarkAid`; у окна типа — нет), `readOnly` (телефон),
 * `own` и `resetable` (у метки со своей настройкой — «Вернуть как у типа»).
 *
 * Отвечает `{draft}` — применить; `{reset: true}` — вернуть как у типа; `null`
 * — закрыли или ничего не изменили. Сохраняет ответ вызывающий.
 */
export function openDeviceWindow({
  title,
  hint,
  profile,
  channels = 1,
  aid = null,
  readOnly = false,
  readOnlyNote = null,
  own = false,
  resetable = false,
}) {
  return new Promise((resolve) => {
    const initial = deviceDraftOf(profile);
    let draft = initial;
    const body = uiEl("div", { class: "device" });
    const error = uiBadLine();
    let bad = new Map();
    let modal;

    const done = (value) => {
      modal.close();
      resolve(value);
    };

    const set = (next) => {
      draft = next;
      render();
    };

    function kindSection(model) {
      const select = uiEl("select", {
        class: "ui-select device__kind",
        title: strings.deviceWindow.kind,
        on: { change: (event) => set(deviceDraftKind(draft, event.target.value)) },
      });
      for (const kind of model.kinds) select.append(uiEl("option", { value: kind.key, text: kind.label }));
      select.value = model.kind;
      select.disabled = readOnly;
      return uiEl("label", { class: "ui-field device__field" }, [
        uiEl("span", { class: "ui-field__label", text: strings.deviceWindow.kind }),
        select,
      ]);
    }

    function serviceSection(model) {
      if (model.services.length === 0) {
        return uiEl("p", { class: "panel__empty device__empty", text: strings.deviceWindow.noServices });
      }
      const items = model.services.map((service) => {
        const head = [uiEl("span", { class: "device__serviceName", text: service.label })];
        if (service.sids.length > 0) {
          head.push(
            uiEl("span", {
              class: "device__sid",
              text: text("deviceWindow.sid", { sids: service.sids.join(", ") }),
              title: strings.deviceWindow.sidTitle,
            }),
          );
        }
        if (service.aux) head.push(uiEl("span", { class: "device__aux", text: strings.deviceWindow.aux }));
        if (service.removable && !readOnly) {
          head.push(
            uiButton("×", {
              class: "ui-btn ui-btn--icon device__remove",
              title: strings.deviceWindow.removeService,
              attrs: { "aria-label": strings.deviceWindow.removeService },
              on: { click: () => set(deviceDraftRemoveService(draft, service.index)) },
            }),
          );
        }
        const chars = service.optional.map((item) => {
          const box = uiEl("input", { type: "checkbox" });
          box.checked = item.on;
          box.disabled = readOnly;
          box.addEventListener("change", () => set(deviceDraftChar(draft, service.index, item.char, box.checked)));
          return uiCheckRow(box, item.label);
        });
        return uiEl("div", { class: "device__service" }, [
          uiEl("div", { class: "device__serviceHead" }, head),
          service.keyNote
            ? uiEl("p", { class: "device__note", text: strings.deviceWindow.keyNote, title: strings.deviceWindow.keyNoteTitle })
            : null,
          chars.length > 0 ? uiEl("div", { class: "device__chars" }, chars) : null,
        ]);
      });
      return uiEl("div", { class: "device__services" }, items);
    }

    function addSection(model) {
      if (readOnly || model.addable.length === 0) return null;
      const select = uiEl("select", {
        class: "ui-select device__add",
        title: strings.deviceWindow.addService,
        on: {
          change: (event) => {
            if (event.target.value) set(deviceDraftAddService(draft, event.target.value));
          },
        },
      });
      select.append(uiEl("option", { value: "", text: strings.deviceWindow.addService }));
      for (const item of model.addable) {
        select.append(
          uiEl("option", {
            value: item.type,
            text: item.aux ? item.label + " (" + strings.deviceWindow.aux + ")" : item.label,
          }),
        );
      }
      select.value = "";
      return select;
    }

    function keysSection(model) {
      if (model.keys.length === 0) return null;
      const rows = model.keys.map((key) => {
        const box = uiEl("input", { type: "checkbox" });
        box.checked = key.decoupled;
        box.disabled = readOnly;
        box.addEventListener("change", () => set(deviceDraftDecoupled(draft, key.channel, box.checked)));
        return uiCheckRow(box, key.label + ": " + strings.deviceWindow.decoupled, strings.deviceWindow.decoupledTitle);
      });
      return uiEl("div", { class: "device__group" }, [
        uiEl("h4", { class: "device__title", text: strings.deviceWindow.keys }),
        ...rows,
      ]);
    }

    function paramsSection(model) {
      if (model.params.length === 0) return null;
      const fields = model.params.map((param) => {
        const input = uiEl("input", {
          class: "ui-input device__param",
          type: "text",
          value: String(param.value),
          title: param.label + " (" + param.min + "…" + param.max + ")",
          attrs: { inputmode: "numeric" },
        });
        input.disabled = readOnly;
        input.addEventListener("change", () => {
          const result = deviceDraftParam(draft, param.name, input.value);
          if (result.error) {
            bad.set(input, result.error);
            uiMarkBad(error, [...bad.keys()], [...bad].map(([field, message]) => ({ input: field, message })));
            return;
          }
          bad.delete(input);
          draft = result.draft;
          uiMarkBad(error, [input], [...bad].map(([field, message]) => ({ input: field, message })));
        });
        return uiEl("label", { class: "ui-field device__field" }, [
          uiEl("span", { class: "ui-field__label", text: param.label }),
          input,
        ]);
      });
      return uiEl("div", { class: "device__group" }, [
        uiEl("h4", { class: "device__title", text: strings.deviceWindow.params }),
        ...fields,
      ]);
    }

    // Идентификатор аксессуара (G12): у метки — свой `aid`, у типа — пояснение,
    // что он у каждой метки свой.
    function aidLine(model) {
      if (model.kind === DEVICE_KIND_NONE) return null;
      if (model.aid !== null) return uiEl("p", { class: "device__aid", text: text("deviceWindow.aid", { aid: model.aid }) });
      return uiEl("p", { class: "device__aid", text: strings.deviceWindow.aidPerMark });
    }

    function render() {
      bad = new Map();
      uiMarkBad(error, [], []);
      const model = deviceWindowModel(draft, channels, { aid });
      body.replaceChildren(
        ...[
          hint ? uiEl("p", { class: "modal__hint", text: hint }) : null,
          readOnly ? uiEl("p", { class: "device__viewOnly", text: readOnlyNote || strings.deviceWindow.viewOnly }) : null,
          aidLine(model),
          kindSection(model),
          uiEl("div", { class: "device__group" }, [
            uiEl("h4", { class: "device__title", text: strings.deviceWindow.services }),
            serviceSection(model),
            addSection(model),
          ]),
          keysSection(model),
          paramsSection(model),
          error,
        ].filter(Boolean),
      );
    }

    const apply = () => {
      if (bad.size > 0) {
        [...bad.keys()][0].focus();
        return;
      }
      done(deviceSameJson(draft, initial) ? null : { draft });
    };

    const actions = [];
    if (resetable && own && !readOnly) {
      actions.push(
        uiButton(strings.deviceWindow.reset, {
          class: "ui-btn device__reset",
          title: strings.deviceWindow.resetTitle,
          on: { click: () => done({ reset: true }) },
        }),
      );
    }
    actions.push(uiButton(readOnly ? strings.deviceWindow.close : strings.dialog.cancel, { on: { click: () => done(null) } }));
    if (!readOnly) {
      actions.push(uiButton(strings.deviceWindow.apply, { class: "ui-btn ui-btn--accent", on: { click: apply } }));
    }
    render();
    modal = uiModal({ title, body, actions, onCancel: () => resolve(null) });
    if (modal.card) modal.card.classList.add("modal--fit");
  });
}

/** Заголовок окна типа и метки — одна подстановка в одном месте. */
export function deviceWindowTitle(project, { typeId, markId }) {
  if (markId) return text("deviceWindow.markTitle", { label: labelOf(project, markId) });
  const type = findType(project, typeId);
  return text("deviceWindow.typeTitle", { label: type ? type.code + " — " + type.name : "" });
}
