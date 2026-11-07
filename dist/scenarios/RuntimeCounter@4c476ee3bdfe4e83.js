const REQUIRED_PARAM_CHARS = [HC.C_Integer, HC.C_Long, HC.C_Double, HC.C_Boolean];
const servicesList = getServicesByServiceAndCharacteristicType([HS.C_Option], REQUIRED_PARAM_CHARS);

const scenarioDescription = {
  ru: "Подсчитывает время работы и/или простоя устройства в указанные виртуальные сервисы типа Параметры. Можно указать один или два параметра.\n\n" +
    "Характеристики Параметра:\n" +
    "• Целое число — время работы/простоя в секундах.\n" +
    "• Строка (опционально) — времени текстом («2 часа 30 минут»).\n" +
    "• Логическое значение — сброс: включить → счётчик обнуляется.",
  en: "Counts device runtime and/or downtime in specified Parameter services. You can specify one or two Parameters.\n\n" +
    "Parameter characteristics:\n" +
    "• Integer — runtime/downtime in seconds.\n" +
    "• String (optional) — time in text («2 hours 30 minutes»).\n" +
    "• Boolean — reset: set to true → counter is zeroed."
};

info = {
  name: "⏱ Счётчик времени работы устройства",
  description: scenarioDescription.ru,
  version: "0.1",
  author: "@BOOMikru",
  onStart: true,

  sourceServices: [
    HS.Lightbulb,
    HS.Switch,
    HS.Television,
    HS.ContactSensor,
    HS.Fan,
    HS.FanBasic,
    HS.Valve,
    HS.Faucet,
    HS.AirPurifier,
    HS.Outlet,
    HS.HumidifierDehumidifier
  ],
  sourceCharacteristics: [HC.On, HC.Active],

  options: {
    desc: {
      name: { ru: "ОПИСАНИЕ", en: "DESCRIPTION" },
      desc: scenarioDescription,
      type: "String",
      value: "",
      formType: "status"
    },
    runtimeParameter: {
      name: { ru: "Параметр наработки", en: "Runtime parameter" },
      desc: { ru: "Когда устройство включено", en: "When device is on" },
      type: "String",
      value: "",
      formType: "list",
      values: servicesList
    },
    downtimeParameter: {
      name: { ru: "Параметр простоя", en: "Downtime parameter" },
      desc: { ru: "Когда устройство выключено", en: "When device is off" },
      type: "String",
      value: "",
      formType: "list",
      values: servicesList
    },
    timeTextFormat: {
      name: { ru: "Формат времени текстом", en: "Time format as text" },
      desc: { ru: "Как отображать время в строковой характеристике параметра", en: "How to display time in the parameter string characteristic" },
      type: "Integer",
      value: 0,
      formType: "list",
      values: [
        { name: { ru: "Часы и минуты", en: "Hours and minutes" }, value: 0 },
        { name: { ru: "Часы, минуты и секунды", en: "Hours, minutes and seconds" }, value: 1 },
        { name: { ru: "Дни, часы и минуты", en: "Days, hours and minutes" }, value: 2 },
        { name: { ru: "Дни, часы, минуты и секунды", en: "Days, hours, minutes and seconds" }, value: 3 }
      ]
    }
  },

  variables: {
    intervalTask: undefined,
    parameterSubscribe: undefined,
    optionsJson: undefined
  }
};

const INTERVAL_MS = 30000;
const DEBUG_TITLE = "Счётчик времени работы: ";
const MS_MIN_VALID_TIMESTAMP = 1000000000000;

const getParamLabel = (isRuntime) => isRuntime ? "наработки" : "простоя";

function validateParamCharacteristics(paramService) {
  if (!paramService.getCharacteristic(HC.C_Integer)) return "Целое число";
  if (!paramService.getCharacteristic(HC.C_Long)) return "Длинное целое число";
  if (!paramService.getCharacteristic(HC.C_Double)) return "Дробное число";
  if (!paramService.getCharacteristic(HC.C_Boolean)) return "Логическое значение";
  return null;
}

function trigger(source, value, variables, options, context) {
  const optionsChanged = isOptionChanged(variables, options);

  const runtimeParam = getService(options, "runtimeParameter");
  const downtimeParam = getService(options, "downtimeParameter");

  if (!runtimeParam && !downtimeParam) {
    console.error(DEBUG_TITLE + "Не выбраны параметры наработки и/или простоя");
    return;
  }

  if (runtimeParam && downtimeParam && options.runtimeParameter === options.downtimeParameter) {
    console.error(DEBUG_TITLE + "Параметры наработки и простоя должны быть разными");
    return;
  }

  const errors = [];
  if (runtimeParam) {
    const missing = validateParamCharacteristics(runtimeParam);
    if (missing) errors.push("наработки (" + getDeviceName(runtimeParam) + "): " + missing);
  }
  if (downtimeParam) {
    const missing = validateParamCharacteristics(downtimeParam);
    if (missing) errors.push("простоя (" + getDeviceName(downtimeParam) + "): " + missing);
  }
  if (errors.length) {
    console.error(DEBUG_TITLE + "Отсутствуют характеристики — " + errors.join("; "));
    return;
  }

  if (optionsChanged && variables.parameterSubscribe) {
    clear(variables.parameterSubscribe);
    variables.parameterSubscribe = undefined;
  }
  setupParameterSubscription(variables, options);

  const deviceOn = isDeviceOn(source, value);
  if (deviceOn) {
    stopTimer(variables, downtimeParam, options);
    if (runtimeParam) startTimer(variables, runtimeParam, options);
  } else {
    stopTimer(variables, runtimeParam, options);
    if (downtimeParam) startTimer(variables, downtimeParam, options);
  }
}

function startTimer(variables, paramService, options) {
  const startTimeLongChar = paramService.getCharacteristic(HC.C_Long);

  // C_Long — единственный источник правды о моменте старта сессии. Если он
  // уже валиден, значит мы продолжаем активную сессию (перезагрузка хаба,
  // повторный onStart, дребезг trigger) — не перезаписываем, иначе теряем время
  // между последним тиком и текущим вызовом.
  if (!isValidTimestamp(startTimeLongChar.getValue())) {
    const integerChar = paramService.getCharacteristic(HC.C_Integer);
    const doubleChar = paramService.getCharacteristic(HC.C_Double);
    const safeInt = sanitizeSeconds(integerChar.getValue());
    const safeDouble = sanitizeSeconds(doubleChar.getValue());
    // Берём максимум: integer обновляется при каждом тике (точность 1 сек),
    // double — anchor с начала прошлого сеанса (может содержать доли секунды)
    doubleChar.setValue(Math.max(safeInt, safeDouble));
    startTimeLongChar.setValue(Date.now());
  }

  const updateFn = () => {
    const startTimeFromChar = startTimeLongChar.getValue();
    if (!isValidTimestamp(startTimeFromChar)) return;
    const totalSeconds = parseStoredSeconds(paramService) + (Date.now() - startTimeFromChar) / 1000;
    updateParameterService(paramService, totalSeconds, options);
  };

  updateFn();
  variables.intervalTask = setInterval(updateFn, INTERVAL_MS);
}

function stopTimer(variables, paramService, options) {
  if (variables.intervalTask) {
    clearInterval(variables.intervalTask);
    variables.intervalTask = undefined;
  }
  if (!paramService) return;
  const startTimeLongChar = paramService.getCharacteristic(HC.C_Long);
  const startTime = startTimeLongChar.getValue();
  if (isValidTimestamp(startTime)) {
    const totalSeconds = parseStoredSeconds(paramService) + (Date.now() - startTime) / 1000;
    updateParameterService(paramService, totalSeconds, options);
    // Сбрасываем метку — иначе при перезагрузке хаба stopTimer добавит сюда лишнее время от прошлой сессии
    startTimeLongChar.setValue(0);
  }
}

function updateParameterService(service, totalSeconds, options) {
  const integerChar = service.getCharacteristic(HC.C_Integer);
  integerChar.setValue(Math.floor(totalSeconds));
  const stringChar = service.getCharacteristic(HC.C_String);
  if (stringChar) stringChar.setValue(formatRuntime(totalSeconds, options.timeTextFormat));
}

function isDeviceOn(source, value) {
  const type = source.getType();
  return (type === HC.On && value === true) || (type === HC.Active && value === 1);
}

function setupParameterSubscription(variables, options) {
  if (variables.parameterSubscribe || (!options.runtimeParameter && !options.downtimeParameter)) {
    return;
  }

  variables.parameterSubscribe = Hub.subscribeWithCondition("", "", [HS.C_Option], [HC.C_Boolean], (boolSource, boolValue) => {
    if (boolValue !== true) return;
    const runtimeParamUuid = options.runtimeParameter;
    const downtimeParamUuid = options.downtimeParameter;
    const parameterServiceUuid = boolSource.getService().getUUID();
    if (parameterServiceUuid !== runtimeParamUuid && parameterServiceUuid !== downtimeParamUuid) return;
    if (parameterServiceUuid === runtimeParamUuid) handleParamReset(getServiceByUuid(runtimeParamUuid), options);
    if (parameterServiceUuid === downtimeParamUuid) handleParamReset(getServiceByUuid(downtimeParamUuid), options);
    boolSource.setValue(false);
  });
}

function handleParamReset(paramService, options) {
  const startTimeLongChar = paramService.getCharacteristic(HC.C_Long);
  const doubleChar = paramService.getCharacteristic(HC.C_Double);
  doubleChar.setValue(0);
  // Если сессия активна — обнуляем точку отсчёта на сейчас, чтобы счёт пошёл с 0.
  // Если сессия не активна (C_Long=0), оставляем 0: иначе следующий startTimer
  // примет это за "активную сессию" и приплюсует промежуток ожидания.
  if (isValidTimestamp(startTimeLongChar.getValue())) {
    startTimeLongChar.setValue(Date.now());
  }
  updateParameterService(paramService, 0, options);
}

// ============================================================================
// УТИЛИТЫ
// ============================================================================

function sanitizeSeconds(value) {
  const num = Number(value);
  return isNaN(num) || num < 0 ? 0 : num;
}

function parseStoredSeconds(paramService) {
  if (!paramService) return 0;
  const doubleChar = paramService.getCharacteristic(HC.C_Double);
  return doubleChar ? sanitizeSeconds(doubleChar.getValue()) : 0;
}

function isValidTimestamp(ms) {
  return ms > MS_MIN_VALID_TIMESTAMP;
}

// Универсальная проверка изменения опций между вызовами trigger.
// Сравнивает JSON-снимок текущих options с предыдущим, сохранённым в variables.
// Первый вызов всегда возвращает false (нечего сравнивать). Снимок обновляется.
function isOptionChanged(variables, options) {
  const currentJson = JSON.stringify(options);
  const previousJson = variables.optionsJson;
  variables.optionsJson = currentJson;
  if (previousJson === undefined || previousJson === null) return false;
  return previousJson !== currentJson;
}

function getPluralForm(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 1;
  return 2;
}

const DAYS = ["день", "дня", "дней"];
const HOURS = ["час", "часа", "часов"];
const MINUTES = ["минута", "минуты", "минут"];
const SECONDS = ["секунда", "секунды", "секунд"];

function formatPart(value, forms) {
  if (value <= 0) return "";
  return value + " " + forms[getPluralForm(value)];
}

function joinNonEmpty(parts) {
  return parts.filter(function (p) { return p !== ""; }).join(" ");
}

function formatRuntime(seconds, formatType) {
  const totalSec = Math.floor(seconds);
  const secs = totalSec % 60;

  const format = formatType === 1 || formatType === 2 || formatType === 3 ? formatType : 0;

  let result;
  if (format === 0 || format === 1) {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    if (hours < 1) result = formatPart(minutes, MINUTES);
    else if (minutes === 0) result = formatPart(hours, HOURS);
    else result = joinNonEmpty([formatPart(hours, HOURS), formatPart(minutes, MINUTES)]);
  } else {
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    result = joinNonEmpty([formatPart(days, DAYS), formatPart(hours, HOURS), formatPart(minutes, MINUTES)]);
  }
  if ((format === 1 || format === 3) && secs > 0) {
    result = joinNonEmpty([result, formatPart(secs, SECONDS)]);
  }

  if (result === "") result = "0 " + MINUTES[2];
  return result;
}

function getService(options, name) {
  const uuid = options[name];
  if (uuid === "" || !uuid) return undefined;
  return getServiceByUuid(uuid);
}

function getServiceByUuid(uuid) {
  if (!uuid) return undefined;
  try {
    const parts = String(uuid).split(".");
    if (parts.length >= 2) {
      const aid = parseInt(parts[0], 10);
      const sid = parseInt(parts[1], 10);
      const accessory = Hub.getAccessory(aid);
      if (accessory) {
        return accessory.getService(sid);
      }
    }
  } catch (e) {
    console.error(DEBUG_TITLE + "Ошибка получения устройства по uuid " + uuid + ": " + e.toString());
  }
  return undefined;
}

function getDeviceName(service) {
  if (!service) return "Unknown";
  try {
    const acc = service.getAccessory();
    const accName = acc.getName();
    const sName = service.getName();
    return acc.getRoom().getName() + " -> " + (accName === sName ? accName : accName + " " + sName) + " (" + service.getUUID() + ")" + (!service.isVisible() ? ". Скрыт" : "");
  } catch (e) {
    return "Unknown";
  }
}

function getServicesByServiceAndCharacteristicType(serviceTypes, characteristicTypes) {
  const unsorted = [];
  Hub.getAccessories().forEach((a) => {
    a.getServices()
      .filter((s) => serviceTypes.indexOf(s.getType()) >= 0)
      .filter((s) => characteristicTypes.every((c) => s.getCharacteristic(c)))
      .forEach((s) => {
        unsorted.push({ name: { ru: getDeviceName(s), en: getDeviceName(s) }, value: s.getUUID() });
      });
  });
  const sorted = [{ name: { ru: "Не выбрано", en: "Not selected" }, value: "" }];
  unsorted.sort((a, b) => a.name.ru.localeCompare(b.name.ru)).forEach((s) => sorted.push(s));
  return sorted;
}
