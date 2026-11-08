import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { DucatKioskService } from "./ducat_kiosk.service.js";
import { leeBusquedaInventario } from "./header_read.service.js";
import { vuelcaSesion } from "../../utils/inventory/ducat_kiosk.js";
import { mergeRelicCounts, relicKey } from "../../utils/inventory/relic_counts.js";
import { ESTADO_BUSQUEDA, categoriaDeBusqueda, ausentesDeBusqueda, pasoBusqueda, celdaEnBlanco, normalizaConsulta } from "../../utils/inventory/busqueda_rejilla.js";

const TIPOS = Object.freeze({
    piezas: {
        inventario: (escaner) => vuelcaSesion(state.primeInventory || {}, escaner?.sessionInventory || new Map()),
        nombre: (pagina) => pagina.items || new Map(),
        textoDe: (n) => n,
        excluye: (n) => DucatKioskService.noVota(n),
    },
    reliquias: {
        inventario: (escaner) => Object.fromEntries(mergeRelicCounts(state.inventory, escaner?.sessionRelics || new Map()).map((e) => [relicKey(e.name), e.count])),
        nombre: (pagina) => new Map([...(pagina.reliquias || [])].map(([k, n]) => [k, relicKey(n)])),
        textoDe: (k) => `${k} relic`,
        excluye: () => false,
        repite: true,
    },
});

const vetos = new WeakMap();
const TOLERANCIA_16_9 = 0.01;

function vetados(escaner) {
    if (!escaner) return new Set();
    const previo = vetos.get(escaner);
    if (previo && previo.sesion === escaner._sesion) return previo.nombres;
    const nuevo = { sesion: escaner._sesion, nombres: new Set() };
    vetos.set(escaner, nuevo);
    return nuevo.nombres;
}

export const BusquedaInventarioService = {
    estado: ESTADO_BUSQUEDA,
    id: 0,
    onCero: null,

    async lee(escaner, fuente) {
        const tipo = categoriaDeBusqueda(escaner?._categoriaTexto);
        if (!tipo) return null;
        const texto = await leeBusquedaInventario(escaner, fuente, OCRRepository.workers?.[0]);
        if (normalizaConsulta(texto) === "") return null;
        return { tipo, texto };
    },

    revisa(escaner, { busqueda, contexto, filaTapada, filaParcial, filas, cols, celdas, items, reliquias, vacias, lienzo, cellW, cellH }) {
        const tipo = busqueda && TIPOS[busqueda.tipo];
        if (!tipo || contexto !== "INVENTORY" || filaTapada || /TRADE/.test(escaner?.lastHeaderText || "") || DucatKioskService.conDialogo || DucatKioskService.enMesa?.size > 0 || DucatKioskService.vendiendo) {
            this.estado = ESTADO_BUSQUEDA;
            return 0;
        }
        const ctx = lienzo.getContext("2d", { willReadFrequently: true });
        const mx = Math.round(cellW * 0.1);
        const my = Math.round(cellH * 0.1);
        const enBlanco = (cell) => celdaEnBlanco(ctx.getImageData(cell.sx + mx, cell.sy + my, cellW - 2 * mx, cellH - 2 * my).data);
        const nombres = tipo.nombre({ items, reliquias });
        const tabla = celdas.map((cell) => {
            const key = `r${cell.r}c${cell.c}`;
            if (nombres?.has(key)) {
                return { r: cell.r, c: cell.c, tipo: "item", nombre: nombres.get(key) };
            }
            if (vacias?.has(key) && enBlanco(cell)) {
                return { r: cell.r, c: cell.c, tipo: "vacia" };
            }
            return { r: cell.r, c: cell.c, tipo: "otra" };
        });
        const inventario = tipo.inventario(escaner);
        const veto = vetados(escaner);
        const crudo = Math.abs(busqueda.aspecto / (16 / 9) - 1) <= TOLERANCIA_16_9
            ? ausentesDeBusqueda({ texto: busqueda.texto, celdas: tabla, filas, cols, inventario, textoDe: tipo.textoDe, excluye: tipo.excluye, repite: tipo.repite, filaParcial: !!filaParcial })
            : { consulta: null, motivo: "aspecto", vistos: [], candidatos: [] };
        const resultado = crudo.motivo ? crudo : { ...crudo, candidatos: crudo.candidatos.filter((n) => !veto.has(`${busqueda.tipo}|${n}`)) };
        const clave = resultado.consulta ? `${busqueda.tipo}|${resultado.consulta}` : null;
        const { estado, aCero, pendientes } = pasoBusqueda(this.estado, resultado, clave, ++this.id, inventario, Date.now());
        this.estado = estado;
        console.log(`[BUSQ] ${busqueda.tipo} "${resultado.consulta ?? busqueda.texto.trim()}": ${resultado.motivo || `${resultado.vistos.length} a la vista, ${resultado.candidatos.length} sin salir`}${aCero.length ? ` · a 0: ${aCero.join(", ")}` : ""}`);
        if (aCero.length) {
            for (const n of aCero) veto.add(`${busqueda.tipo}|${n}`);
            this.onCero?.(busqueda.tipo, aCero, resultado.consulta);
        } else if (pendientes.length && escaner) {
            Object.assign(escaner, { autoScrollMuestra: null, fotosSinScroll: Math.min(escaner.fotosSinScroll ?? 0, 2) });
        }
        return resultado.motivo ? 0 : tabla.filter((x) => x.tipo === "vacia").length;
    },

    reset() {
        this.estado = ESTADO_BUSQUEDA;
    },
};
