// Модели меток: датчики и камера.
//
// Три датчика из пяти на плане похожи — и заказчик это принял сознательно
// (повтор знаков, `model.js`). Телом они всё же разные: присутствие — купол,
// движение — коробка с линзой, открытие — две отдельные части. Это не прихоть:
// именно так они и выглядят на стене, и человек в объёме узнаёт их быстрее,
// чем сверяет подпись.
import { modelBox, modelCyl, modelParts } from "./kit.js";

export const MODELS_SENSE = {
  // Датчик освещённости (правка после сборки сценариев): светлая шайба и
  // тёмное окошко фотоэлемента в лицо.
  lightSensor: modelParts(
    modelCyl("window", { x: -0.2, width: 0.4, y: -0.5, depth: 0.12, z: 0.3, height: 0.4, material: "dark" }),
    modelCyl("puck", { x: -0.5, width: 1, y: -0.38, depth: 0.88, z: 0, height: 1, material: "light" }),
  ),
  // Датчик климата (правка после сборки сценариев): светлый корпус и три
  // тёмные трубки «как на ртутном градуснике». Столбики в трубках — значения
  // его помещения — кладёт кадр (`volumeLiveSigns`), пока дом идёт.
  climateSensor: modelParts(
    modelBox("tubeT", { x: -0.34, width: 0.12, y: -0.5, depth: 0.04, z: 0.12, height: 0.76, material: "dark" }),
    modelBox("tubeH", { x: -0.06, width: 0.12, y: -0.5, depth: 0.04, z: 0.12, height: 0.76, material: "dark" }),
    modelBox("tubeC", { x: 0.22, width: 0.12, y: -0.5, depth: 0.04, z: 0.12, height: 0.76, material: "dark" }),
    modelBox("case", { y: -0.46, depth: 0.96, material: "light" }),
  ),
  // Присутствие: купол на плоском основании — на потолке он и правда купол.
  presence: modelParts(
    modelCyl("dome", { x: -0.38, width: 0.76, y: -0.38, depth: 0.76, z: 0, height: 0.62, material: "light" }),
    modelCyl("base", { z: 0.62, height: 0.38 }),
  ),
  // Движение: коробочка с тёмной линзой в лицо.
  motion: modelParts(
    modelCyl("lens", { x: -0.22, width: 0.44, y: -0.5, depth: 0.35, z: 0.28, height: 0.44, material: "dark" }),
    modelBox("case", { x: -0.4, width: 0.8, y: -0.15, depth: 0.65, z: 0.05, height: 0.9 }),
  ),
  // Открытие: две части — на створке и на раме, с зазором между ними. Разрыв и
  // есть обозначение: датчик, который видно, что из двух половин.
  opening: modelParts(
    modelBox("reed", { x: -0.5, width: 0.55, y: -0.5, depth: 0.7, z: 0, height: 1 }),
    modelBox("magnet", { x: 0.12, width: 0.38, y: -0.5, depth: 0.6, z: 0.1, height: 0.8, material: "light" }),
  ),
  // Протечка: шайба на полу и усы-электроды под ней.
  leak: modelParts(
    modelCyl("puck", { x: -0.43, width: 0.86, y: -0.43, depth: 0.86, z: 0.1, height: 0.9 }),
    modelBox("probes", { x: -0.34, width: 0.68, y: -0.08, depth: 0.16, z: 0, height: 0.1, material: "metal" }),
  ),
  // Камера: объектив, корпус и кронштейн к стене.
  camera: modelParts(
    modelCyl("lens", { x: -0.25, width: 0.5, y: -0.5, depth: 0.4, z: 0.25, height: 0.5, material: "dark" }),
    modelBox("case", { x: -0.42, width: 0.84, y: -0.1, depth: 0.45, z: 0.12, height: 0.76 }),
    modelBox("mount", { x: -0.12, width: 0.24, y: 0.35, depth: 0.15, z: 0.3, height: 0.4, material: "metal" }),
  ),
};
