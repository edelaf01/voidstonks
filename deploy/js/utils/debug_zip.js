/**
 * Escritor de ZIP sin compresión (método "store"), para el paquete de depuración del escáner.
 *
 * Sin dependencias a propósito: es lo único que hace falta para que un puñado de PNG y JSON
 * salgan del navegador en UN archivo que cualquiera abre. Los PNG ya vienen comprimidos, así
 * que deflate no ahorraría nada y costaría CPU en el hilo principal.
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
}

export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** Fecha/hora en el formato de MS-DOS que usa el ZIP (2 s de resolución). */
function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

/**
 * @param {Array<{ name: string, data: Uint8Array }>} files rutas con "/" como separador
 * @returns {Uint8Array} el archivo ZIP entero
 */
export function buildZip(files, fecha = new Date()) {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(fecha);
    const locals = [], centrals = [];
    let offset = 0;
    for (const { name, data } of files) {
        const nombre = enc.encode(name);
        const crc = crc32(data);
        const local = new Uint8Array(30 + nombre.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);          // versión mínima 2.0
        lv.setUint16(6, 0x0800, true);      // nombres en UTF-8
        lv.setUint16(8, 0, true);           // store
        lv.setUint16(10, time, true);
        lv.setUint16(12, date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nombre.length, true);
        local.set(nombre, 30);

        const central = new Uint8Array(46 + nombre.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, time, true);
        cv.setUint16(14, date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nombre.length, true);
        cv.setUint32(42, offset, true);
        central.set(nombre, 46);

        locals.push(local, data);
        centrals.push(central);
        offset += local.length + data.length;
    }
    const centralSize = centrals.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const out = new Uint8Array(offset + centralSize + 22);
    let p = 0;
    for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
    return out;
}
