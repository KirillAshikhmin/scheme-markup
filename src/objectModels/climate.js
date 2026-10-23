// Модели меток: климат.
//
// Здесь тот самый внутренний блок кондиционера, ради которого затевался
// таск 135: под метр по стене, и в объёме он теперь не кубик, а корпус с
// жалюзи — то есть видно, куда он дует.
import { modelBox, modelCyl, modelParts } from "./kit.js";

export const MODELS_CLIMATE = {
  // Термостат (правка после сборки сценариев): светлая рамка и тёмный экран,
  // который загорается, пока термостат греет.
  thermostat: modelParts(
    modelBox("screen", { x: -0.3, width: 0.6, y: -0.5, depth: 0.06, z: 0.48, height: 0.34, material: "dark", lit: true }),
    modelBox("plate", { y: -0.44, depth: 0.94, material: "light" }),
  ),
  // Тёплый пол: светлый мат и греющий слой в нём — он рдеет, пока пол греет.
  warmFloor: modelParts(
    modelBox("coil", { x: -0.42, width: 0.84, y: -0.42, depth: 0.84, z: 0.4, height: 0.6, lit: true }),
    modelBox("mat", { z: 0, height: 0.4, material: "light" }),
  ),
  // Внутренний блок: светлая лицевая панель, тёмная щель жалюзи под ней,
  // корпус за обеими.
  conditioner: modelParts(
    modelBox("louvers", { x: -0.44, width: 0.88, y: -0.5, depth: 0.3, z: 0.08, height: 0.22, material: "dark" }),
    modelBox("panel", { x: -0.46, width: 0.92, y: -0.5, depth: 0.3, z: 0.3, height: 0.65, material: "light" }),
    modelBox("case", { y: -0.2, depth: 0.7 }),
  ),
  // Бризер: приточный короб с круглой решёткой.
  breezer: modelParts(
    modelCyl("grille", { x: -0.26, width: 0.52, y: -0.5, depth: 0.3, z: 0.24, height: 0.52, material: "dark" }),
    modelBox("case", { y: -0.2, depth: 0.7 }),
  ),
  // Вытяжка: зонт и труба к потолку. Скоса у зонта нет — ни коробка, ни
  // цилиндр его не умеют, а трапеция была бы третьим телом в наборе.
  hood: modelParts(
    modelBox("canopy", { z: 0, height: 0.55 }),
    modelBox("duct", { x: -0.14, width: 0.28, y: 0.08, depth: 0.3, z: 0.55, height: 0.45, material: "metal" }),
  ),
  // Вентиляция: панель с рабочим колесом за решёткой. От бризера отличается
  // тем же, чем на листе: решётка почти во всю панель, а не кружок на коробе.
  vent: modelParts(
    modelCyl("wheel", { x: -0.3, width: 0.6, y: -0.5, depth: 0.4, z: 0.2, height: 0.6, material: "dark" }),
    modelBox("frame", { y: -0.1, depth: 0.6 }),
  ),
  // Осушитель: напольная коробка с решёткой в лицо.
  dehumidifier: modelParts(
    modelBox("grille", { x: -0.3, width: 0.6, y: -0.5, depth: 0.2, z: 0.12, height: 0.48, material: "dark" }),
    modelBox("case", { y: -0.3, depth: 0.8, z: 0, height: 0.9 }),
  ),
};
