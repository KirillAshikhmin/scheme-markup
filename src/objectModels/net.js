// Модели меток: сеть, домофон, кинотеатр, панели управления.
import { modelBox, modelCyl, modelParts } from "./kit.js";

export const MODELS_NET = {
  // Точка WiFi: плоская шайба с крышкой — так её и видят с пола.
  wifi: modelParts(
    modelCyl("disc", { z: 0, height: 0.6, material: "light" }),
    modelCyl("cap", { x: -0.3, width: 0.6, y: -0.3, depth: 0.6, z: 0.6, height: 0.4 }),
  ),
  // Умная колонка: цилиндр с тёмной шапкой.
  speaker: modelParts(
    modelCyl("case", { z: 0, height: 0.84 }),
    modelCyl("top", { x: -0.35, width: 0.7, y: -0.35, depth: 0.7, z: 0.84, height: 0.16, material: "dark" }),
  ),
  // Панель управления: экран во всю плашку.
  panelControl: modelParts(
    modelBox("screen", { x: -0.3, width: 0.6, y: -0.5, depth: 0.35, z: 0.2, height: 0.6, material: "glass" }),
    modelBox("frame", { y: -0.15, depth: 0.65 }),
  ),
  // Домофон: экран сверху, кнопка вызова снизу.
  intercom: modelParts(
    modelBox("screen", { x: -0.32, width: 0.64, y: -0.5, depth: 0.35, z: 0.3, height: 0.62, material: "glass" }),
    modelCyl("button", { x: -0.1, width: 0.2, y: -0.5, depth: 0.3, z: 0.08, height: 0.16, material: "light" }),
    modelBox("frame", { y: -0.15, depth: 0.65 }),
  ),
  // Проектор: корпус, объектив и кронштейн. Объектив — коробкой, а не
  // цилиндром: цилиндр в этом наборе стоит вертикально, и лежачий ствол им не
  // выйдет. В 120 мм габарита разницы между ними не видит никто.
  projector: modelParts(
    modelBox("lens", { x: 0.08, width: 0.3, y: -0.5, depth: 0.3, z: 0.25, height: 0.5, material: "dark" }),
    modelBox("case", { x: -0.46, width: 0.92, y: -0.2, depth: 0.62, z: 0.1, height: 0.8 }),
    modelBox("mount", { x: -0.3, width: 0.6, y: 0.42, depth: 0.08, z: 0.4, height: 0.4, material: "metal" }),
  ),
  // Ресивер: плоский корпус с окошком.
  receiver: modelParts(
    modelBox("panel", { x: -0.44, width: 0.88, y: -0.5, depth: 0.3, z: 0.15, height: 0.7, material: "glass" }),
    modelBox("case", { y: -0.2, depth: 0.7 }),
  ),
};
