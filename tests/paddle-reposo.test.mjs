import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");
const { pistasDelLog } = await import("../deploy/js/utils/ganchos.js");

let clientes = [];
let _arrancaWorkerOrig = null;
let enMisionOrig = null;

beforeEach(() => {
  _arrancaWorkerOrig = PaddleRepository._arrancaWorker;
  enMisionOrig = pistasDelLog.enMision;
  PaddleRepository._service = null;
  PaddleRepository._initPromise = null;
  PaddleRepository.ultimoFallo = null;
  PaddleRepository._enUso = 0;
  PaddleRepository._enReposo = false;
  PaddleRepository._arranquesWorker = 0;
  clientes = [];
  PaddleRepository._arrancaWorker = async () => {
    const cliente = {
      recognize: async () => ({ text: "AXI A1", lines: [] }),
      terminate() { this.muerto = true; },
    };
    clientes.push(cliente);
    PaddleRepository._modo = "worker";
    return cliente;
  };
});

afterEach(() => {
  PaddleRepository.apaga();
  PaddleRepository._arrancaWorker = _arrancaWorkerOrig;
  pistasDelLog.enMision = enMisionOrig;
});

test("suelta el worker tras diez minutos sin leer", async () => {
  await PaddleRepository.recognizeWords({});
  const ahora = PaddleRepository._ultimoUso + PaddleRepository.SUELTA_REPOSO_MS;
  const solto = PaddleRepository.sueltaEnReposo(ahora);
  assert.equal(solto, true);
  assert.equal(PaddleRepository.listo(), false);
  assert.equal(clientes[0].muerto, true);
  assert.equal(PaddleRepository._enReposo, true);
});

test("no suelta antes de tiempo", async () => {
  await PaddleRepository.recognizeWords({});
  const ahora = PaddleRepository._ultimoUso + PaddleRepository.SUELTA_REPOSO_MS - 1;
  const solto = PaddleRepository.sueltaEnReposo(ahora);
  assert.equal(solto, false);
  assert.equal(PaddleRepository.listo(), true);
});

test("no suelta con una lectura en curso", async () => {
  await PaddleRepository.warmUp();
  PaddleRepository._enUso = 1;
  const ahora = PaddleRepository._ultimoUso + PaddleRepository.SUELTA_REPOSO_MS + 1000;
  const solto = PaddleRepository.sueltaEnReposo(ahora);
  assert.equal(solto, false);
  PaddleRepository._enUso = 0;
});

test("no suelta en misión", async () => {
  pistasDelLog.enMision = () => true;
  await PaddleRepository.recognizeWords({});
  const ahora = PaddleRepository._ultimoUso + PaddleRepository.SUELTA_REPOSO_MS + 1000;
  let solto = PaddleRepository.sueltaEnReposo(ahora);
  assert.equal(solto, false);
  assert.equal(PaddleRepository.listo(), true);

  pistasDelLog.enMision = () => null;
  solto = PaddleRepository.sueltaEnReposo(ahora);
  assert.equal(solto, true);
});

test("no suelta el motor del hilo principal", async () => {
  PaddleRepository._arrancaWorker = async () => ({ recognize: async () => ({ text: "", lines: [] }) });
  await PaddleRepository.recognizeWords({});
  const ahora = PaddleRepository._ultimoUso + PaddleRepository.SUELTA_REPOSO_MS + 1000;
  const solto = PaddleRepository.sueltaEnReposo(ahora);
  assert.equal(solto, false);
});

test("disponible() recarga en segundo plano tras soltarlo", async () => {
  await PaddleRepository.recognizeWords({});
  const ahora = PaddleRepository._ultimoUso + PaddleRepository.SUELTA_REPOSO_MS;
  PaddleRepository.sueltaEnReposo(ahora);

  const primera = PaddleRepository.disponible();
  assert.equal(primera, false);

  await PaddleRepository._initPromise;

  const segunda = PaddleRepository.disponible();
  assert.equal(segunda, true);
  assert.equal(clientes.length, 2);
  assert.equal(PaddleRepository._enReposo, false);
});

test("disponible() no carga nada si nunca se cargó", () => {
  const disp = PaddleRepository.disponible();
  assert.equal(disp, false);
  assert.equal(clientes.length, 0);
  assert.equal(PaddleRepository._initPromise, null);
});

test("cada lectura cuenta como uso", async () => {
  const antes = Date.now();
  await PaddleRepository.recognizeLines({});
  assert.equal(PaddleRepository._ultimoUso >= antes, true);
  assert.equal(PaddleRepository._enUso, 0);
});

test("apaga limpia el reposo", async () => {
  await PaddleRepository.recognizeWords({});
  const ahora = PaddleRepository._ultimoUso + PaddleRepository.SUELTA_REPOSO_MS;
  PaddleRepository.sueltaEnReposo(ahora);

  PaddleRepository.apaga();
  assert.equal(PaddleRepository._enReposo, false);
  const disp = PaddleRepository.disponible();
  assert.equal(disp, false);
  assert.equal(clientes.length, 1);
});

test("si la recarga falla, disponible() no reintenta en cada lectura", async () => {
  await PaddleRepository.recognizeWords({});
  PaddleRepository.sueltaEnReposo(PaddleRepository._ultimoUso + PaddleRepository.SUELTA_REPOSO_MS);
  PaddleRepository._arrancaWorker = async () => { throw new Error("sin red"); };
  assert.equal(PaddleRepository.disponible(), false);
  await assert.rejects(PaddleRepository._initPromise, /sin red/);
  assert.equal(PaddleRepository.disponible(), false);
  assert.equal(PaddleRepository._initPromise, null);
});
