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
 *   recorte a color y sin binarizar. Medido igual: 135 de 135 con 0 falsos. A cambio carga 6,4 MB
 *   de modelo la primera vez (van con la app, en deploy/assets/ocr).
 *
 * NO hay defecto: hasta que el usuario contesta se lee con el CLÁSICO y no se carga el modelo. El
 * preciso era el defecto y la carga arrancaba en `startLiveSession()`, o sea antes de que el HUD
 * fuera visible: el botón de "no" no podía evitarla la primera vez, que es la única que importa.
 *
 * Lo que se gana contestando que sí, medido sobre las 7 capturas reales de la pantalla de
 * recompensas (26 recompensas): el clásico lee 9 y el preciso 26, y en tres de las siete el
 * clásico no lee NADA. Ese es el caso con reloj: el jugador tiene 15 segundos para elegir.
 *
 * Contestado que sí, la carga no deja al escáner sin leer: `leeRecompensas` sigue con el
 * clásico mientras el modelo no esté listo, y si falla se queda ahí para siempre.
 */
const CLAVE = "vs_ocr_engine";
/**
 * El motor activo vive AQUÍ y no en un global: quien lo necesita importa `motorActivo()`. Antes
 * era `globalThis.OCR_ENGINE`, que nadie podía encontrar leyendo el código de quien lo usa.
 */
let activo = null;
export const MOTOR_CLASICO = "tesseract";
export const MOTOR_PRECISO = "paddle";

const guardado = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };

/**
 * ¿Ha contestado el usuario qué motor quiere? Mientras no conteste NO se carga el modelo: la
 * pregunta salía en el HUD cuando el modelo ya estaba cargando, así que decir que no no servía
 * de nada la primera vez.
 */
export function motorDecidido() { return guardado() !== null; }

/** Sin respuesta, el clásico: es el que arranca al instante. */
export function motorElegido() { return guardado() === MOTOR_PRECISO ? MOTOR_PRECISO : MOTOR_CLASICO; }

/**
 * Fija el motor y lo deja listo. Devuelve el que quedó activo.
 *
 * El precalentado se lanza AQUÍ y no en el primer frame: si el modelo se pidiera al detectar la
 * pantalla de recompensas, ese frame se perdería esperando la carga. Y no se espera a que
 * termine — hasta que esté, `leeRecompensas` sigue con el clásico.
 */
export function aplicaMotor(motor) {
    // Una sola regla en todo el módulo: lo que no sea exactamente el preciso, es el clásico.
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

/**
 * Aplica la preferencia guardada. Se llama al arrancar el escáner.
 *
 * Sin respuesta no llama a aplicaMotor: escribiría la clave y daría la pregunta por contestada.
 */
export function restauraMotor() {
    if (!motorDecidido()) return (activo = MOTOR_CLASICO);
    return aplicaMotor(motorElegido());
}

/**
 * Estado para la UI: si ya se contestó, qué está elegido y si el preciso ya puede leer. Mientras
 * no lo esté, el escáner usa el clásico, y el usuario tiene que poder verlo en vez de creer que
 * está roto.
 */
export function estadoMotor() {
    const elegido = motorElegido();
    return {
        decidido: motorDecidido(),
        elegido,
        listo: elegido !== MOTOR_PRECISO || PaddleRepository.listo(),
    };
}
