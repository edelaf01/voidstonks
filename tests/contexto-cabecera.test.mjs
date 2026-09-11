import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const casos = [
  ["—— BAVOID RELICS/REFINEMENT ©).", "RELICS"],
  ["—— BVOID RELIGS/REFINEMENT ©:", "RELICS"],
  ["BOLD RELICS/REFINENENT®:.", "RELICS"],
  ["VOID RELICS/REFINEMENT >:", "RELICS"],
  ["BESVOND RELICS REFINEMENTS", "RELICS"],
  ["PA VOID RELICS/REFINEMENT", "RELICS"],
  ["B5VOID RELICSREFINEMENT", "RELICS"],
  ["Bim © #V 010 AISSURE/REWARDS", "REWARD"],
  ["PARi@ VOID FISSURE/REWARDS", "REWARD"],
  ["PI@ B11) FSS URE/REWARDS?", "REWARD"],
  ["Mi% VRBVOID FISSURE/REWARDS", "REWARD"],
  ["PAW Pr mV ND FISSURE/REWARDS", "REWARD"],
  ["PAAR VOID FISSURE/REWARDS", "REWARD"],
  ["BE PV 01D FISSURE/REWARDS", "REWARD"],
  ["RE/REWARDS", "REWARD"],
  ["LE/ REWARDS", "REWARD"],
  ["NE/REWARDS :", "REWARD"],
];

for (const [texto, esperado] of casos) {
  test(`"${texto}" -> ${esperado}`, () => {
    assert.equal(VisionService.determineContext(texto.toUpperCase()), esperado);
  });
}

for (const texto of ["iS VOID FISSURES", "3 VOID FISSURES", "VOID FISSURES"]) {
  test(`la lista de fisuras no se escanea: "${texto}"`, () => {
    assert.equal(VisionService.determineContext(texto.toUpperCase()), "UNKNOWN");
  });
}
