/**
 * Easter egg de las Sombras de Jade: la animación de constelaciones del grupo de arcanos de
 * Jade en la pestaña de Vosfor.
 *
 * Vivía dentro de ui_vosfor.js y no comparte nada con él —ni estado, ni textos, ni datos de
 * arcanos—: son 265 líneas de canvas y requestAnimationFrame que solo se cruzaban con el resto
 * en la llamada de renderVosforTab(). Separarlo deja la pestaña en lo suyo y el efecto aparte,
 * que es donde se toca cuando se toca.
 */
import { exposeGlobals } from "../utils/global_registry.js";

let activeJadeAnimFrame = null;
let activeJadeObserver = null;

export function initJadeCosmicEasterEgg() {
    if (activeJadeAnimFrame) {
        cancelAnimationFrame(activeJadeAnimFrame);
        activeJadeAnimFrame = null;
    }
    if (activeJadeObserver) {
        activeJadeObserver.disconnect();
        activeJadeObserver = null;
    }

    const canvas = document.getElementById("jade-cosmic-canvas");
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const width = rect.width || 400;
    const height = rect.height || 60;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    const particles = [];
    const shockwaves = [];
    let t = Math.random() * 100;
    let lastClashTime = 0;
    let isVisible = true;

    function animate() {
        if (!document.contains(canvas) || !isVisible) {
            activeJadeAnimFrame = null;
            return;
        }

        ctx.clearRect(0, 0, width, height);
        t += 0.022;

        const rx = width * 0.42;
        const ry = height * 0.32;
        const cx = width / 2;
        const cy = height / 2;

        const clashCycle = Math.sin(t * 0.75);
        const distMult = 0.15 + 0.85 * Math.pow(Math.abs(clashCycle), 1.6);

        const gx = cx + Math.cos(t) * rx * distMult;
        const gy = cy + Math.sin(t * 1.4) * ry * distMult;

        const rx_pos = cx - Math.cos(t * 1.04) * rx * distMult;
        const ry_pos = cy - Math.sin(t * 1.46) * ry * distMult;

        const dx = gx - rx_pos;
        const dy = gy - ry_pos;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // --- Tormenta Plasma Cósmica Lejana: Arcos de Relámpago entre Nodos ---
        if (dist < 40 && dist > 2) {
            const flicker = Math.random();
            if (flicker > 0.3) {
                ctx.save();
                ctx.strokeStyle = flicker > 0.65 ? "#ffffff" : (Math.random() > 0.5 ? "#42f56c" : "#ff3344");
                ctx.shadowColor = Math.random() > 0.5 ? "#42f56c" : "#ff3344";
                ctx.shadowBlur = 8;
                ctx.lineWidth = 1.2;
                ctx.globalAlpha = (1 - dist / 40) * (0.5 + Math.random() * 0.5);

                const midX = (gx + rx_pos) / 2 + (Math.random() - 0.5) * 14;
                const midY = (gy + ry_pos) / 2 + (Math.random() - 0.5) * 14;

                ctx.beginPath();
                ctx.moveTo(gx, gy);
                ctx.lineTo(midX, midY);
                ctx.lineTo(rx_pos, ry_pos);
                ctx.stroke();
                ctx.restore();
            }
        }

        // Al chocar (< 20px), se engendra la tormenta expansiva de luz en 360°
        if (dist < 20) {
            const impactX = (gx + rx_pos) / 2;
            const impactY = (gy + ry_pos) / 2;
            const now = Date.now();

            if (now - lastClashTime > 600) {
                lastClashTime = now;
                // Registrar onda de tormenta espacial expansiva desde el punto de impacto
                shockwaves.push({
                    x: impactX,
                    y: impactY,
                    radius: 2,
                    maxRadius: Math.max(width, height) * 0.95,
                    life: 1.0,
                    decay: 0.024
                });

                // Chispas de la tormenta emergentes en 360° desde la colisión
                for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
                    const spd = 1.5 + Math.random() * 2.8;
                    particles.push({
                        x: impactX,
                        y: impactY,
                        vx: Math.cos(a) * spd,
                        vy: Math.sin(a) * spd,
                        color: Math.random() > 0.5 ? "#42f56c" : "#ff3344",
                        life: 1.0,
                        decay: 0.03 + Math.random() * 0.03,
                        size: 1.4 + Math.random() * 1.2
                    });
                }
            }
        }

        // --- Renderizado de Tormenta de Luz tenue y Ondas Expansivas Espaciales en 360° ---
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const sw = shockwaves[i];
            sw.radius += 4.5; // Expansión suave por el espacio
            sw.life -= sw.decay;

            if (sw.life <= 0 || sw.radius >= sw.maxRadius) {
                shockwaves.splice(i, 1);
                continue;
            }

            ctx.save();

            // Luz tenue y sutil (opacidad ~0.42)
            const stormPulse = sw.life * (0.85 + 0.15 * Math.sin(sw.radius * 0.4));
            ctx.globalAlpha = stormPulse * 0.42;

            // Nube de plasma expansiva tenue donde destacan los tonos Verde Jade y Rojo Stalker
            const rInner = Math.max(0, sw.radius - 18);
            const rOuter = sw.radius + 20;
            const waveGrad = ctx.createRadialGradient(sw.x, sw.y, rInner, sw.x, sw.y, rOuter);
            waveGrad.addColorStop(0, "rgba(66, 245, 108, 0)");
            waveGrad.addColorStop(0.25, `rgba(66, 245, 108, ${0.52 * sw.life})`);  // Tono verde Jade distintivo
            waveGrad.addColorStop(0.5, `rgba(200, 255, 220, ${0.28 * sw.life})`); // Fusión tenue
            waveGrad.addColorStop(0.75, `rgba(255, 51, 68, ${0.52 * sw.life})`);   // Tono rojo Stalker distintivo
            waveGrad.addColorStop(1, "rgba(255, 51, 68, 0)");

            ctx.fillStyle = waveGrad;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, rOuter, 0, Math.PI * 2);
            ctx.fill();

            // Anillo expansivo muy fino y tenue
            ctx.strokeStyle = `rgba(180, 255, 200, ${0.35 * sw.life})`;
            ctx.lineWidth = 1.2 * sw.life;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.restore();
        }

        // Estelas pequeñas con tiempo de vida (Jade Verde)
        particles.push({
            x: gx,
            y: gy,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            color: "#42f56c",
            life: 1.0,
            decay: 0.038, // Tiempo de vida de la estela (~26 frames)
            size: 1.8
        });

        // Estelas pequeñas con tiempo de vida (Stalker Rojo)
        particles.push({
            x: rx_pos,
            y: ry_pos,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            color: "#ff3344",
            life: 1.0,
            decay: 0.038, // Tiempo de vida de la estela (~26 frames)
            size: 1.8
        });

        // Limitar la cantidad máxima de partículas en memoria (máximo 36 partículas)
        while (particles.length > 36) {
            particles.shift();
        }

        // Dibujar partículas con tiempo de vida que se desvanecen
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;

            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = p.life * 0.85;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 5 * p.life;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Puntos minúsculos principales de luz distante (2.4px con resplandor nítido)
        // Jade (Verde)
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#42f56c";
        ctx.shadowBlur = 11;
        ctx.beginPath();
        ctx.arc(gx, gy, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Stalker (Rojo)
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#ff3344";
        ctx.shadowBlur = 11;
        ctx.beginPath();
        ctx.arc(rx_pos, ry_pos, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        activeJadeAnimFrame = requestAnimationFrame(animate);
    }

    // Pausar automáticamente cuando el elemento se desplaza fuera de pantalla o en otra pestaña (0% CPU / 0 RAM Leak)
    if ("IntersectionObserver" in window) {
        activeJadeObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            const nowVisible = entry ? entry.isIntersecting : true;
            if (nowVisible && !isVisible) {
                isVisible = true;
                if (!activeJadeAnimFrame) {
                    activeJadeAnimFrame = requestAnimationFrame(animate);
                }
            } else if (!nowVisible) {
                isVisible = false;
                if (activeJadeAnimFrame) {
                    cancelAnimationFrame(activeJadeAnimFrame);
                    activeJadeAnimFrame = null;
                }
            }
        }, { threshold: 0.05 });
        activeJadeObserver.observe(parent);
    }

    activeJadeAnimFrame = requestAnimationFrame(animate);
}

function toggleHunhowMemeQuote(el) {
    if (!el) return;
    const quote = el.querySelector(".hunhow-meme-quote");
    if (quote) {
        quote.classList.toggle("hidden");
    }
}

exposeGlobals({ toggleHunhowMemeQuote }, "ui.components/ui_vosfor_jade.js");
