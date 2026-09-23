import { PaddleRepository } from "../../repositories/paddle.repository.js";

/**
 * Which OCR engine the scanner uses, kept across reloads.
 * Classic (Tesseract) ships with the app and works offline, but needs binarizing and several crop
 * and threshold tries. Precise (PaddleOCR) reads the color crop in one pass and loads a 6.4 MB
 * model the first time. Until the user answers, the classic engine reads and the model is not
 * loaded; while it loads, `leeRecompensas` stays on the classic engine.
 */
const CLAVE = "vs_ocr_engine";
let activo = null;
export const MOTOR_CLASICO = "tesseract";
export const MOTOR_PRECISO = "paddle";

const guardado = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };

export function motorDecidido() { return guardado() !== null; }

export function motorElegido() { return guardado() === MOTOR_PRECISO ? MOTOR_PRECISO : MOTOR_CLASICO; }

/**
 * Sets the engine and returns the active one. The warm-up starts here, not on the first reward
 * frame, which would be lost waiting for the model.
 */
export function aplicaMotor(motor) {
    const elegido = motor === MOTOR_PRECISO ? MOTOR_PRECISO : MOTOR_CLASICO;
    activo = elegido;
    try { localStorage.setItem(CLAVE, elegido); } catch {}
    if (elegido === MOTOR_PRECISO) {
        PaddleRepository.warmUp().catch((e) => console.warn("[OCR] motor preciso no disponible:", e));
    }
    return elegido;
}

export function motorActivo() { return activo || motorElegido(); }

/**
 * Whether Tesseract reads the inventory grid: classic chosen, or precise failed. Not while precise
 * loads: the page waits for it.
 */
export function rejillaConClasico() { return motorActivo() !== MOTOR_PRECISO || !!PaddleRepository.ultimoFallo; }

/**
 * Applies the saved choice at scanner start. Without an answer it skips aplicaMotor, which would
 * mark the question as answered.
 */
export function restauraMotor() {
    if (!motorDecidido()) return (activo = MOTOR_CLASICO);
    return aplicaMotor(motorElegido());
}

/**
 * UI state: answered, chosen engine and whether precise can read yet.
 */
export function estadoMotor() {
    const elegido = motorElegido();
    return {
        decidido: motorDecidido(),
        elegido,
        listo: elegido !== MOTOR_PRECISO || PaddleRepository.listo(),
    };
}
