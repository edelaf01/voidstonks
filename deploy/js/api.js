/**
 * VoidStonks — API & Services Barrel
 *
 * This file maintains backward compatibility by re-exporting modules
 * from their new locations in repositories/ and services/.
 */

// Repositories (Data Access)
export { 
    MEMORY_CACHE, 
    getPriceValue, 
    addToQueue, 
    preloadPricesToMemory 
} from "./repositories/storage.repository.js";

export {
    loadRelicsData,
    fetchPrimeManifest,
    initializeOCRDatabase,
} from "./repositories/api.repository.js";

// Services (Business Logic)
export { getSlug, getRivenSlug } from "./utils/slugs.utils.js";
export { downloadRelics, updateDucatsDB } from "./services/relics.service.js";
export { fetchActiveBounties } from "./services/bounties.service.js";
export { fetchBestFissures } from "./services/fissures.service.js";
export { fetchUserProfile } from "./services/profile.service.js";
export { fetchRivenWeapons, fetchRivenAverage } from "./services/rivens.service.js";
export { warmupPrices } from "./services/inventory.service.js";
