import { test } from "node:test";
import assert from "node:assert/strict";
import { state } from "../deploy/js/state.js";
import {
  prettyTraderItem,
  nextVaultRotation,
  isPrimedMod,
  isTraderWeapon,
} from "../deploy/js/ui.components/farms/ui_traders.js";
import { progresoSets } from "../deploy/js/utils/ui_utils.js";

test("prettyTraderItem devuelve cadena vacía ante entradas nulas, indefinidas o sin nombre", () => {
  assert.equal(prettyTraderItem(null), "");
  assert.equal(prettyTraderItem(undefined), "");
  assert.equal(prettyTraderItem({}), "");
  assert.equal(prettyTraderItem({ uniqueName: "" }), "");
  assert.equal(prettyTraderItem({ item: "" }), "");
});

test("prettyTraderItem limpia sufijos genéricos y prefijos inversos en los nombres de objetos", () => {
  assert.equal(prettyTraderItem({ item: "Braton Prime Weapon" }), "Braton Prime");
  assert.equal(prettyTraderItem({ item: "Fang Prime Item" }), "Fang Prime");
  assert.equal(prettyTraderItem({ item: "Prime Orthos" }), "Orthos Prime");
});

test("prettyTraderItem formatea nombres derivados de rutas internas, packs de resurgence y reliquias", () => {
  assert.equal(
    prettyTraderItem({ uniqueName: "/Lotus/Types/Recipes/Weapons/BratonPrimeBlueprint" }),
    "Braton Prime Blueprint"
  );
  assert.equal(
    prettyTraderItem({ uniqueName: "MPVMagPrimeSinglePack" }),
    "Mag Prime"
  );
  assert.equal(
    prettyTraderItem({ uniqueName: "MPVMagNovaPrimeDualPack" }),
    "Mag & Nova Prime"
  );
  assert.equal(
    prettyTraderItem({ uniqueName: "T1VoidProjectionLithA1VaultA" }),
    "Lith · Lith & A1 · A"
  );
});

test("nextVaultRotation devuelve null ante datos de vault vacíos, nulos o malformados", () => {
  assert.equal(nextVaultRotation(null, 1000), null);
  assert.equal(nextVaultRotation(undefined, 1000), null);
  assert.equal(nextVaultRotation({}, 1000), null);
  assert.equal(nextVaultRotation({ schedule: null }, 1000), null);
  assert.equal(nextVaultRotation({ schedule: "no-array" }, 1000), null);
  assert.equal(nextVaultRotation({ schedule: [] }, 1000), null);
});

test("nextVaultRotation calcula la rotación antes del vencimiento y en el límite exacto de cambio", () => {
  const schedule = [
    { expiry: "2026-06-01T00:00:00Z" },
    { expiry: "2026-07-01T00:00:00Z" },
    { expiry: "2026-08-01T00:00:00Z" },
  ];
  const vault = { schedule };
  const t0 = Date.parse("2026-06-01T00:00:00Z");

  const antes = nextVaultRotation(vault, t0 - 1);
  assert.deepEqual(antes, {
    item: schedule[1],
    start: schedule[0].expiry,
  });

  const enLimite = nextVaultRotation(vault, t0);
  assert.deepEqual(enLimite, {
    item: schedule[2],
    start: schedule[1].expiry,
  });

  const ultimoPeriodo = nextVaultRotation(vault, Date.parse("2026-07-01T00:00:00Z"));
  assert.equal(ultimoPeriodo, null);
});

test("isPrimedMod distingue correctamente mods prime de mods regulares y otros ítems", () => {
  assert.equal(
    isPrimedMod({ uniqueName: "/Lotus/Upgrades/Mods/Warframe/AvatarContinuityExpert" }),
    true
  );
  assert.equal(
    isPrimedMod({
      uniqueName: "/Lotus/Upgrades/Mods/Warframe/ContinuityMod",
      item: "Primed Continuity",
    }),
    true
  );
  assert.equal(
    isPrimedMod({
      uniqueName: "/Lotus/Upgrades/Mods/Warframe/ContinuityMod",
      item: "Continuity",
    }),
    false
  );
  assert.equal(
    isPrimedMod({
      uniqueName: "/Lotus/Weapons/Tenno/Rifle/Braton",
      item: "Primed Chamber",
    }),
    false
  );
  assert.equal(isPrimedMod(null), false);
  assert.equal(isPrimedMod(undefined), false);
  assert.equal(isPrimedMod({}), false);
});

test("isTraderWeapon identifica armas del comerciante y rechaza otros tipos de inventario", () => {
  assert.equal(
    isTraderWeapon({ uniqueName: "/Lotus/Weapons/Tenno/Rifle/Braton" }),
    true
  );
  assert.equal(
    isTraderWeapon({ uniqueName: "/Lotus/StoreItems/Weapons/Tenno/Pistol/Lato" }),
    true
  );
  assert.equal(
    isTraderWeapon({ uniqueName: "/Lotus/Powersuits/Excalibur/Excalibur" }),
    false
  );
  assert.equal(
    isTraderWeapon({ uniqueName: "/Lotus/Upgrades/Mods/Warframe/ContinuityMod" }),
    false
  );
  assert.equal(isTraderWeapon(null), false);
  assert.equal(isTraderWeapon(undefined), false);
  assert.equal(isTraderWeapon({}), false);
});

test("progresoSets calcula piezas parciales y acumulado total de requisitos", () => {
  state.setsDatabase = {
    "Venato Prime": ["Venato Prime Blueprint", "Venato Prime Blade", "Venato Prime Handle"],
  };
  state.primeInventory = {
    "Venato Prime Blueprint": 1,
    "Venato Prime Blade": 1,
  };
  state.primeManifest = [
    {
      name: "Venato Prime",
      components: [
        { name: "Blueprint", itemCount: 1 },
        { name: "Blade", itemCount: 2 },
        { name: "Handle", itemCount: 1 },
      ],
    },
  ];

  const res = progresoSets(["Venato Prime"]);
  assert.equal(res.tengo, 2);
  assert.equal(res.total, 4);
  assert.equal(res.sets, 0);
  assert.equal(res.piezas.length, 3);
});

test("progresoSets contabiliza sets completos cuando se poseen todas las piezas requeridas", () => {
  state.setsDatabase = {
    "Akarius Prime": ["Akarius Prime Blueprint", "Akarius Prime Barrel", "Akarius Prime Receiver"],
  };
  state.primeInventory = {
    "Akarius Prime Blueprint": 2,
    "Akarius Prime Barrel": 4,
    "Akarius Prime Receiver": 2,
  };
  state.primeManifest = [];

  const res = progresoSets(["Akarius Prime"]);
  assert.equal(res.tengo, 3);
  assert.equal(res.total, 3);
  assert.equal(res.sets, 2);
});

test("progresoSets no falla ante nombres de sets desconocidos o inexistentes en la base de datos", () => {
  state.setsDatabase = {};
  state.primeInventory = {};
  state.primeManifest = [];

  const res = progresoSets(["Set Inexistente Desconocido"]);
  assert.deepEqual(res, {
    piezas: [],
    tengo: 0,
    total: 0,
    sets: 0,
  });
});

test("la regla de ranking de traders prioriza sets completos, luego parciales, luego sin empezar y finalmente sin set", () => {
  const rankDe = (prog) => (!prog?.total ? 3 : prog.sets > 0 ? 0 : prog.tengo > 0 ? 1 : 2);

  const completo = { total: 4, tengo: 4, sets: 1 };
  const parcial = { total: 4, tengo: 2, sets: 0 };
  const sinEmpezar = { total: 4, tengo: 0, sets: 0 };
  const sinSet = { total: 0, tengo: 0, sets: 0 };

  const lista = [
    { id: "sinSet", prog: sinSet },
    { id: "parcial", prog: parcial },
    { id: "sinEmpezar", prog: sinEmpezar },
    { id: "completo", prog: completo },
  ];

  lista.sort((a, b) => rankDe(a.prog) - rankDe(b.prog));

  assert.deepEqual(
    lista.map((x) => x.id),
    ["completo", "parcial", "sinEmpezar", "sinSet"]
  );
});
