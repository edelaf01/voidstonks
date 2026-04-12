import { WORKER_URL, TEXTS } from "../config.js";
import { state } from "../state.js";

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
// TODO: could be used eventually, but managing user logins for profile access is too much hassle