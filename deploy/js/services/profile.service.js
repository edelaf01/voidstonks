import { TEXTS } from "../config.js";
import { state } from "../state.js";
import { getProfileData } from "../repositories/api.repository.js";

/**
 * Fetches and renders a user's Warframe profile.
 * @param {string} username
 * @param {string} platform
 */
export async function fetchUserProfile(username, platform) {
    try {
        const res = await getProfileData(username, platform);
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