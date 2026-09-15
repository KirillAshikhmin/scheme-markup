// Единственный словарь видимых строк. В остальных файлах русских текстов нет.
export const strings = {
  app: {
    title: "Разметка схем",
    subtitle: "Метки на планах помещений",
  },
  header: {
    project: "Объект",
    noProject: "Объект не выбран",
    projects: "Объекты",
    schemes: "Схемы",
  },
  panels: {
    tools: "Инструменты",
    schemes: "Схемы",
    marks: "Метки",
    properties: "Свойства",
    canvasEmpty: "Загрузите план схемы, чтобы начать разметку",
    marksEmpty: "Меток пока нет — выберите тип и щёлкните по плану",
    schemesEmpty: "Схем пока нет",
  },
  project: {
    untitled: "Новый объект",
    defaultSchemeName: "Схема 1",
  },
  categories: {
    light: "Свет",
    switches: "Выключатели",
    sockets: "Розетки",
    climate: "Климат",
    network: "Сетевое оборудование",
  },
  types: {
    spot: "Точечный светильник",
    lamp: "Светильник",
    bedLight: "Подсветка кровати",
    track: "Трек",
    backlight: "Подсветка",
    strip: "Лента",
    wardrobeLight: "Подсветка шкафа",
    switch: "Выключатель",
    switchDouble: "Выключатель двойной",
    socket: "Розетка",
    breezer: "Бризер",
    conditioner: "Кондиционер",
    wifi: "WiFi точка",
  },
  shapes: {
    circle: "Круг",
    "circle-cross": "Круг с крестом",
    square: "Квадрат",
    triangle: "Треугольник",
    star: "Звезда",
    diamond: "Ромб",
    hexagon: "Шестиугольник",
    inherit: "Как у категории",
  },
  blockMode: {
    each: "Каждая точка — своя метка",
    single: "Одна метка на блок",
  },
  errors: {
    schemeNotFound: "Схема не найдена",
    typeNotFound: "Тип метки не найден",
    markNotFound: "Метка не найдена",
    categoryNotFound: "Категория не найдена",
    roomNotFound: "Помещение не найдено",
    groupNotFound: "Группа не найдена",
    noPoints: "Нужна хотя бы одна точка",
    shortLine: "Линия короче двух вершин не сохраняется",
    codeRequired: "Нужен код типа — одна или две буквы",
    codeTooLong: "Код типа — не больше двух букв",
    codeLetters: "Код типа — только буквы, одна или две",
    blockOnlyForPoints: "Блок собирается только из точек, линию в блок не поставить",
    codeTaken: "Код {code} уже занят",
    nameRequired: "Нужно название",
    typeHasMarks: "Тип {code} используют метки ({count}) — сперва смените им тип",
    categoryHasTypes: "В категории есть типы — сперва перенесите или удалите их",
    unknownShape: "Неизвестная форма",
    unknownBlockMode: "Неизвестный режим блока",
    unknownSide: "Неизвестная сторона блока",
    unknownKind: "Неизвестный вид метки",
  },
  problems: {
    duplicateCode: "Код типа {code} встречается больше одного раза",
    markWithoutType: "У метки нет типа из справочника",
    markWithoutScheme: "Метка ссылается на несуществующую схему",
    markWithoutRoom: "Метка ссылается на несуществующее помещение",
    duplicateNumber: "Обозначение {label} выдано больше одного раза",
    emptyPoints: "У метки нет точек",
    shortLine: "У линии меньше двух вершин",
    smallGroup: "В группе меньше двух меток",
    groupAcrossSchemes: "Метки одной группы лежат на разных схемах",
    counterBehind: "Счётчик типа {code} меньше выданных номеров",
    typeWithoutCategory: "У типа нет категории из справочника",
  },
  notify: {
    close: "Закрыть",
  },
};

// strings.errors.codeTaken и подобные — шаблоны с {переменными}.
export function text(key, vars) {
  let value = key.split(".").reduce((node, part) => (node == null ? node : node[part]), strings);
  if (typeof value !== "string") return key;
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.split("{" + name + "}").join(String(replacement));
    }
  }
  return value;
}
