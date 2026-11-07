/**
 * Получает информацию о состоянии батарей всех устройств и отправляет сводку
 * @param {Boolean} fullInfo - Показывать полную информацию (включая устройства в норме и без логики)
 * @param {Array} blackList - Список ID устройств для исключения из проверки
 * @param {Array} whiteList - Список ID устройств для включения в проверку (если пустой, проверяются все)
 * @param {String} notificationChannel - Канал уведомлений (например, "Telegram_1", "Web_1")
 * @param {String} notificationClients - Строка с ID клиентов через запятую (например, "1, 3, 4")
 * @param {Boolean} silentNotification - Отправлять уведомление без звука
 */
function getBatteriesInfo(fullInfo, blackList, whiteList, notificationChannel, notificationClients, silentNotification) {
    // Параметры по умолчанию
    var defaultFullInfo = false;                    // Показывать полную информацию (включая устройства в норме и без логики) - по умолчанию оказывать только разряженные батареи
    var defaultBlackList = [];                      // Список ID устройств для исключения из проверки - по умолчанию не исключать устройства
    var defaultWhiteList = [];                      // Список ID устройств для включения в проверку (если пустой, проверяются все) - по умолчанию проверять все устройства
    var defaultNotificationChannel = "Telegram_1";            // Канал уведомлений (например, "Telegram_1", "Web_1") - по умолчанию канал не указан
    var defaultNotificationClients = "1";            // Строка с ID клиентов через запятую (например, "1, 3, 4") - по умолчанию пустая строка
    var defaultSilentNotification = false;          // Отправлять уведомление без звука - по умолчанию уведомления с звуком

    const blackListAccessories = [];
    const whiteListAccessories = [];

    // Слияние переданных параметров с параметрами по умолчанию
    var actualFullInfo = fullInfo !== undefined ? fullInfo : defaultFullInfo;
    var actualBlackList = blackList !== undefined ? blackList : defaultBlackList;
    var actualWhiteList = whiteList !== undefined ? whiteList : defaultWhiteList;
    var actualNotificationChannel = notificationChannel !== undefined ? notificationChannel : defaultNotificationChannel;
    var actualNotificationClients = notificationClients !== undefined ? notificationClients : defaultNotificationClients;
    var actualSilentNotification = silentNotification !== undefined ? silentNotification : defaultSilentNotification;

    let states = GlobalVariables["batteryStateScenario"]
    if (!states) GlobalVariables["batteryStateScenario"] = []

    // Копируем константы, чтобы не мутировать общие массивы верхнего уровня
    // (между вызовами getBatteriesInfo они бы накапливались).
    let black = blackListAccessories.slice()
    let white = whiteListAccessories.slice()
    if (Array.isArray(actualBlackList)) { actualBlackList.forEach(function (i) { black.push(i) }) } else if (actualBlackList != undefined && actualBlackList.length > 0) black.push(actualBlackList)
    if (Array.isArray(actualWhiteList)) { actualWhiteList.forEach(function (i) { white.push(i) }) } else if (actualWhiteList != undefined && actualWhiteList.length > 0) white.push(actualWhiteList)

    let withLowBattery = []
    let normalBattery = []
    let withoutLogic = []
    let batteries = {};
    Hub.getAccessories().forEach(function (accessory) {
        const uuid = accessory.getUUID()
        if (white.length > 0 && white.indexOf(uuid) < 0) return
        if (black.indexOf(uuid) >= 0) return
        let service = accessory.getService(HS.BatteryService)
        if (service == null) return
        let state = GlobalVariables["batteryStateScenario"][uuid]
        if (state == undefined) {
            const level = service.getCharacteristic(HC.BatteryLevel).getValue()
            const charging = service.getCharacteristic(HC.ChargingState).getValue() == 1
            const lowBattery = service.getCharacteristic(HC.StatusLowBattery).getValue()

            state = {
                uuid: uuid,
                name: accessory.getName(),
                room: accessory.getRoom().getName(),
                manufacturer: accessory.getManufacturer(),
                model: accessory.getModel(),
                level: level,
                lowBattery: lowBattery,
                charging: charging,
                logicEnabled: false
            }
        } else {
            state.logicEnabled = true
        }

        if (state.lowBattery) withLowBattery.push(state)
        else normalBattery.push(state)
        if (state.logicEnabled != true) withoutLogic.push(state)
        if (state.lowBattery && state.batteryType != undefined && state.batteryType != "") {
            let count = batteries[state.batteryType]
            if (count == undefined) count = state.quantity
            else count += state.quantity
            batteries[state.batteryType] = count
        }

    })
    GlobalVariables.batteriesForChange = batteries

    withLowBattery = withLowBattery.sort(function (a, b) { return a.room.localeCompare(b.room); })
    normalBattery = normalBattery.sort(function (a, b) { return a.room.localeCompare(b.room); })
    withoutLogic = withoutLogic.sort(function (a, b) { return a.room.localeCompare(b.room); })

    let hasWithLowBattery = withLowBattery.length > 0
    
    // Формируем сообщение в зависимости от канала
    let message = formatBatterySummaryMessage(withLowBattery, normalBattery, withoutLogic, batteries, actualFullInfo, actualNotificationChannel)
    
    // Преобразуем строку клиентов в массив
    let clientsArray = []
    if (actualNotificationClients && actualNotificationClients.trim() !== "") {
        clientsArray = actualNotificationClients.split(',').map(client => client.trim()).filter(client => client !== "")
    }
    
    // Отправляем уведомление через новую функцию
    sendNotification(
        message,
        actualNotificationChannel,
        clientsArray,
        actualSilentNotification
    )
}

/**
 * Функция для форматирования сводки по батареям в зависимости от канала
 * @param {Array} withLowBattery - Массив устройств с разряженными батареями
 * @param {Array} normalBattery - Массив устройств с нормальными батареями
 * @param {Array} withoutLogic - Массив устройств без активированной логики
 * @param {Object} batteries - Объект с типами батарей для замены
 * @param {Boolean} fullInfo - Показывать полную информацию
 * @param {String} channel - Канал уведомлений
 * @returns {String} Отформатированное сообщение
 */
function formatBatterySummaryMessage(withLowBattery, normalBattery, withoutLogic, batteries, fullInfo, channel) {
    if (channel && channel.startsWith("Telegram")) {
        // Форматирование для Telegram - сразу строка
        let text = "*🔋 Состояние батарей:*\n"
        
        if (withLowBattery.length > 0) {
            text += "❗️ *Разряжены:*\n"
            withLowBattery.forEach(function (state) {
                text += formatStateToTgString(state) + "\n"
            })

            let batKeys = Object.keys(batteries)
            if (batKeys.length > 0) {
                text += "\n🔋  *Необходимо для замены:*\n"
                batKeys.forEach(function (type) {
                    text += type + " " + batteries[type] + " шт.\n"
                })
            }
        } else {
            if (!fullInfo) text += "Все батареи заряжены\n"
        }
        
        if (fullInfo) {
            if (normalBattery.length > 0 && withoutLogic.length > 0 && withLowBattery.length > 0) {
                text += "\n####################################\n\n"
            }
            if (normalBattery.length > 0) {
                text += "👌 *В норме:*\n"
                normalBattery.forEach(function (state) {
                    text += formatStateToTgString(state, true) + "\n"
                })
            }

            if (withoutLogic.length > 0) {
                text += "\n🫵 *Устройства без активированной логики:*\n"
                withoutLogic.forEach(function (state) {
                    text += formatStateToTgString(state, true, true) + "\n"
                })
            }
        }
        
        return text
    } else {
        // Форматирование для других каналов
        let text = ""
        if (withLowBattery.length > 0) {
            text += "🔋❗️ Разряжённые батареи: "
            withLowBattery.forEach(function (state) {
                text += formatStateToInfo(state)
            })

            let batKeys = Object.keys(batteries)
            if (batKeys.length > 0) {
                text += "🔋 Необходимо для замены: "
                batKeys.forEach(function (type) {
                    text += type + " " + batteries[type] + " шт. "
                })
            }
        }
        if (text == "") text = "Все батареи заряжены"
        
        return text
    }
}

function formatStateToInfo(state) {
    return state.room + " -> " + state.name +
        (state.placement != "" && state.placement != undefined ? ". " + state.placement.trim() : "") + " (ID: " + state.uuid + ")" +
        " " + state.level + "% | "
}

function formatStateToTg(textArray, state, compact, noShowLevel) {
    if (compact == true) {
        textArray.push(
            state.room + " -> " + state.name +
            (state.placement != "" && state.placement != undefined ? ". " + state.placement.trim() : "") + " (ID: " + state.uuid + ")" +
            (!noShowLevel ? (" *" + state.level + "%*") : "")
        )
    } else {
        textArray.push(state.room + " -> " + state.name + " (ID: " + state.uuid + ")")
        if (state.placement != undefined && state.placement != "") textArray.push(state.placement.trim())
        textArray.push("Заряд: " + state.level + "%")
        if (state.batteryType != undefined && state.batteryType != "" && state.batteryType != "-") textArray.push("Тип: " + state.batteryType + " (" + state.quantity + " шт.)")
        if (state.chargingType != undefined && state.chargingType != "" && state.chargingType != "-") textArray.push("Заряжается через: " + state.chargingType + " ")
        if (state.comment != undefined && state.comment != "") textArray.push(state.comment.trim())
        if (state.date != undefined) textArray.push("Дата " + (state.chargingType != "" ? "зарядки" : "замены батареи") + ": " + state.date.replaceAll("-", "."))
        if (state.logicEnabled != true) textArray.push("Логика не активирована")
        textArray.push("")
    }
}

/**
 * Форматирует состояние устройства в строку для Telegram
 * @param {Object} state - Объект состояния устройства
 * @param {Boolean} compact - Компактный режим
 * @param {Boolean} noShowLevel - Не показывать уровень заряда
 * @returns {String} Отформатированная строка
 */
function formatStateToTgString(state, compact, noShowLevel) {
    if (compact == true) {
        return state.room + " -> " + state.name +
            (state.placement != "" && state.placement != undefined ? ". " + state.placement.trim() : "") + " (ID: " + state.uuid + ")" +
            (!noShowLevel ? (" *" + state.level + "%*") : "")
    } else {
        let result = state.room + " -> " + state.name + " (ID: " + state.uuid + ")\n"
        if (state.placement != undefined && state.placement != "") result += state.placement.trim() + "\n"
        result += "Заряд: " + state.level + "%\n"
        if (state.batteryType != undefined && state.batteryType != "" && state.batteryType != "-") result += "Тип: " + state.batteryType + " (" + state.quantity + " шт.)\n"
        if (state.chargingType != undefined && state.chargingType != "" && state.chargingType != "-") result += "Заряжается через: " + state.chargingType + " \n"
        if (state.comment != undefined && state.comment != "") result += state.comment.trim() + "\n"
        if (state.date != undefined) result += "Дата " + (state.chargingType != "" ? "зарядки" : "замены батареи") + ": " + state.date.replaceAll("-", ".") + "\n"
        if (state.logicEnabled != true) result += "Логика не активирована\n"
        
        return result
    }
}

/**
 * Функция для отправки уведомлений через Notify
 * @param {String} message - Текст сообщения для отправки
 * @param {String} channel - Канал уведомлений (например, "Telegram_1", "Web_1")
 * @param {Array} clients - Массив идентификаторов клиентов
 * @param {Boolean} silent - Флаг тихого режима
 */
function sendNotification(message, channel, clients, silent) {
    try {
        // Проверяем, что если заданы клиенты, то должен быть задан канал
        if (clients && clients.length > 0 && (!channel || channel.trim() === "")) {
            log.error("BatteryMonitoring: Заданы клиенты, но не указан канал уведомлений")
            return
        }

        // Создаем объект уведомления
        let notify = Notify.text(message)
            .debugText("BatteryMonitoring")

        // Устанавливаем тихий режим если нужно
        if (silent) {
            notify = notify.silent(true)
        }

        // Если заданы и канал, и клиенты, то настраиваем адресатов
        if (channel && channel.trim() !== "" && clients && clients.length > 0) {
            // Применяем клиентов по одному, так как spread operator не поддерживается
            clients.forEach(function(client) {
                notify = notify.to(channel, client)
            })
        }

        // Отправляем уведомление
        notify.send()
    } catch (e) {
        log.error("BatteryMonitoring: Ошибка отправки уведомления: " + e.message)
    }
}