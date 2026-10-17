// Модели меток: сантехника, электроприборы, карнизы.
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
  // Карниз штор: труба сверху и полотно под ней.
  curtainRail: modelParts(
    modelBox("rod", { x: -0.5, width: 1, y: -0.3, depth: 0.4, z: 0.82, height: 0.16, material: "metal" }),
    modelBox("fabric", { x: -0.46, width: 0.92, y: -0.1, depth: 0.3, z: 0, height: 0.8, material: "light" }),
  ),
};
