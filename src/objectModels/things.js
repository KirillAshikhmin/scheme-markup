// Модели меток: сантехника, электроприборы, карнизы.
//
// Телевизор и полотенцесушитель приехали сюда из семейства `objects` (таск
// 186, G279): они были вещами встроенного каталога, а стали метками. Тела
// перенесены **как были**, ни одной доли не поправлено: доли считаются от
// габарита, а габарит у метки тот же, каким был у вещи (1240 × 80 × 720 и
// 500 × 100 × 800). Поэтому у прежнего чертежа, где такая вещь уже стоит, кадр
// объёма не меняется — модель находится по тому же ключу (G68).
import { modelBox, modelCyl, modelParts } from "./kit.js";

export const MODELS_THINGS = {
  // Выход канализации: раструб в фланце.
  drain: modelParts(
    modelCyl("socket", { x: -0.31, width: 0.62, y: -0.5, depth: 0.45, z: 0.19, height: 0.62, material: "dark" }),
    modelCyl("flange", { y: -0.05, depth: 0.55 }),
  ),
  // Водорозетка: вывод трубы из плашки.
  waterOutlet: modelParts(
    modelCyl("outlet", { x: -0.21, width: 0.42, y: -0.5, depth: 0.25, z: 0.29, height: 0.42, material: "metal" }),
    modelBox("plate", { y: -0.25, depth: 0.75 }),
  ),
  // Кран с электроприводом: корпус и рукоятка привода над ним.
  valve: modelParts(
    modelCyl("case", { x: -0.35, width: 0.7, y: -0.35, depth: 0.7, z: 0.05, height: 0.55 }),
    modelBox("handle", { x: -0.4, width: 0.8, y: -0.2, depth: 0.4, z: 0.6, height: 0.35, material: "metal" }),
  ),
  // Полотенцесушитель: две стойки и перекладины между ними. Лестница на стене
  // — ровно то, чем он и выглядит.
  towelDryer: modelParts(
    modelBox("postLeft", { x: -0.44, width: 0.16, y: -0.3, depth: 0.6 }),
    modelBox("postRight", { x: 0.28, width: 0.16, y: -0.3, depth: 0.6 }),
    modelBox("rungLow", { x: -0.3, width: 0.6, y: -0.25, depth: 0.5, z: 0.2, height: 0.1, material: "metal" }),
    modelBox("rungHigh", { x: -0.3, width: 0.6, y: -0.25, depth: 0.5, z: 0.58, height: 0.1, material: "metal" }),
  ),
  // Телевизор: тёмный экран почти во всю площадь лица, корпус за ним и
  // кронштейн в стену. Экран **тёмный** — этим он и отличается от картины, у
  // которой полотно светлое в широкой раме.
  tv: modelParts(
    modelBox("screen", { x: -0.47, width: 0.94, y: -0.5, depth: 0.1, z: 0.04, height: 0.92, material: "dark" }),
    modelBox("case", { x: -0.46, width: 0.92, y: -0.4, depth: 0.3, z: 0.06, height: 0.88 }),
    modelBox("bracket", { x: -0.1, width: 0.2, y: -0.1, depth: 0.6, z: 0.3, height: 0.4, material: "metal" }),
  ),
  // Робот-пылесос: шайба на полу с башенкой дальномера.
  vacuum: modelParts(
    modelCyl("puck", { z: 0, height: 0.8 }),
    modelCyl("turret", { x: -0.15, width: 0.3, y: -0.15, depth: 0.3, z: 0.8, height: 0.2, material: "dark" }),
  ),
  // Сушилка, дверца с приводом и прочая техника: корпус со светлой дверцей.
  appliance: modelParts(
    modelBox("door", { x: -0.46, width: 0.92, y: -0.5, depth: 0.3, z: 0.06, height: 0.88, material: "light" }),
    modelBox("case", { y: -0.2, depth: 0.7 }),
  ),
  // Карниз штор: труба сверху и **шторы до пола** под ней (таск 177, G261).
  // Слова заказчика: «Карниз штор, метку — отрисовывай как шторы на объеме».
  //
  // Полотно висит до пола (`toFloor`), и это единственное место в сборке, где
  // тело выходит из габарита: габарит у этой метки — сам карниз, 400 × 120 ×
  // 120 в стартовом справочнике, и полотно в сто двадцать миллиметров было бы
  // не шторой, а полоской под трубой. Ширину полотна по-прежнему задаёт
  // габарит: сделал человек карниз в полтора метра — такие и шторы.
  //
  // Складки — три полосы, средняя вперёд, крайние назад. Волна поперёк и даёт
  // складку: грани у полос отвёрнуты друг от друга, и между ними встаёт тёмный
  // стык — то, по чему ткань и узнают. Четвёртая полоса стоила бы шести граней
  // и ровно ничего не добавила бы: складка читается уже с трёх.
  curtainRail: modelParts(
    modelBox("rod", { x: -0.5, width: 1, y: -0.3, depth: 0.4, z: 0.82, height: 0.16, material: "metal" }),
    modelBox("foldLeft", { x: -0.47, width: 0.3, y: 0.02, depth: 0.3, z: 0, height: 0.82, material: "light", toFloor: true }),
    modelBox("foldMiddle", { x: -0.15, width: 0.3, y: -0.28, depth: 0.3, z: 0, height: 0.82, material: "light", toFloor: true }),
    modelBox("foldRight", { x: 0.17, width: 0.3, y: 0.02, depth: 0.3, z: 0, height: 0.82, material: "light", toFloor: true }),
  ),
};
