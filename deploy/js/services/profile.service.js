import { WORKER_URL, TEXTS } from "../config.js";
import { state } from "../state.js";

/**
 * Fetches and renders a user's Warframe profile.
 * @param {string} username
 * @param {string} platform
 */
export async function fetchUserProfile(username, platform) {
    try {
        const res = await fetch(
            `${WORKER_URL}?type=profile&platform=${platform}&user=${encodeURIComponent(username)}`,
        );
        if (!res.ok) throw new Error("Worker Error");
        const data = await res.json();
        if (data.error) {
            globalThis.showToast?.(TEXTS[state.currentLang].errProfileNotFound);
            return;
        }
        globalThis.renderProfileStats?.(data.payload);
    } catch (e) {
        console.error("Error fetching user profile:", e);
        globalThis.showToast?.(TEXTS[state.currentLang].errProfileFetch);
    }
}
//TODO en algun momento se podria llegar a usar pero no me lo planteo que es mucho lio y no quiero manejar los logins de los usuarios para que accedan a sus perfiles