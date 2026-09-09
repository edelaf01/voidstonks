import { PaddleRepository } from "../../repositories/paddle.repository.js";

const CLAVE = "vs_ocr_engine";
let activo = null;
export const MOTOR_CLASICO = "tesseract";
export const MOTOR_PRECISO = "paddle";

const guardado = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };

export function motorDecidido() { return guardado() !== null; }

export function motorElegido() { return guardado() === MOTOR_PRECISO ? MOTOR_PRECISO : MOTOR_CLASICO; }

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

export function restauraMotor() {
    if (!motorDecidido()) return (activo = MOTOR_CLASICO);
    return aplicaMotor(motorElegido());
}

export function estadoMotor() {
    const elegido = motorElegido();
    return {
        decidido: motorDecidido(),
        elegido,
        listo: elegido !== MOTOR_PRECISO || PaddleRepository.listo(),
    };
}
