import { PaddleRepository } from "../../repositories/paddle.repository.js";

/**
 * Qué motor de OCR usa el escáner, y que la elección sobreviva a la recarga.
 *
 * Son dos motores con compromisos distintos, no uno mejor y otro peor:
 *
 * - CLÁSICO (Tesseract). Va dentro de la app: no descarga nada y funciona sin conexión desde el
 *   primer segundo. A cambio necesita binarizar y prueba hasta seis combinaciones de recorte y
 *   umbral por pantalla. Medido sobre 7 capturas × 5 resoluciones: 133 de 135 con 1 falso.
 * - PRECISO (PaddleOCR). Una red que localiza el texto ella misma: una sola pasada, sobre el
 *   recorte a color y sin binarizar. Medido igual: 135 de 135 con 0 falsos. A cambio baja 4,8 MB
 *   de modelo la primera vez y necesita conexión ESA vez.
 *
 * Por defecto el clásico: es el que no puede fallar por causas externas. La preferencia se
 * guarda en localStorage y se vuelve a aplicar al arrancar.
 */
const CLAVE = "vs_ocr_engine";
/**
 * El motor activo vive AQUÍ y no en un global: quien lo necesita importa `motorActivo()`. Antes
 * era `globalThis.OCR_ENGINE`, que nadie podía encontrar leyendo el código de quien lo usa.
 */
let activo = null;
export const MOTOR_CLASICO = "tesseract";
export const MOTOR_PRECISO = "paddle";

export function motorElegido() {
    try {
        return localStorage.getItem(CLAVE) === MOTOR_PRECISO ? MOTOR_PRECISO : MOTOR_CLASICO;
    } catch {
        return MOTOR_CLASICO;   // modo privado: sin preferencia, el que siempre funciona
    }
}

/**
 * Fija el motor y lo deja listo. Devuelve el que quedó activo.
 *
 * El precalentado se lanza AQUÍ y no en el primer frame: si el modelo se pidiera al detectar la
 * pantalla de recompensas, ese frame se perdería esperando la descarga. Y no se espera a que
 * termine — hasta que esté, `leeRecompensas` sigue con el clásico.
 */
export function aplicaMotor(motor) {
    const elegido = motor === MOTOR_PRECISO ? MOTOR_PRECISO : MOTOR_CLASICO;
    activo = elegido;
    try { localStorage.setItem(CLAVE, elegido); } catch { /* modo privado: solo esta sesión */ }
    if (elegido === MOTOR_PRECISO) {
        PaddleRepository.warmUp().catch((e) => console.warn("[OCR] motor preciso no disponible:", e));
    }
    return elegido;
}

/** El motor con el que hay que leer ahora mismo. */
export function motorActivo() { return activo || motorElegido(); }

/** Aplica la preferencia guardada. Se llama al arrancar el escáner. */
export function restauraMotor() { return aplicaMotor(motorElegido()); }

/**
 * Estado para la UI: qué está elegido y si el preciso ya puede leer. Mientras no lo esté, el
 * escáner usa el clásico, y el usuario tiene que poder verlo en vez de creer que está roto.
 */
export function estadoMotor() {
    const elegido = motorElegido();
    return { elegido, listo: elegido !== MOTOR_PRECISO || PaddleRepository.listo() };
}
