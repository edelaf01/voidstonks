import {
    DUAL_PATH_FACTIONS,
    NODE_MAP,
    NODE_TO_TYPE,
    CHALLENGE_MAP,
    ZARIMAN_DATA,
    OPTIMAL_FILTERS,
    ALLY_MAP,
    WORKER_URL,
} from "../config.js";
import { dbHelper } from "../repositories/storage.repository.js";

//Helpers for classification

function getTier(index, isNarmer, isLich) {
    if (isNarmer) return "NARMER";
    if (isLich) return "CODA";
    return index + 1;
}

function getTechType(uName, nodeKey) {
    const chall = uName.toLowerCase();
    if (chall.includes("mobdef")) return "Mobile Defense";
    if (chall.includes("exterminate")) return "Exterminate";
    if (chall.includes("cascade")) return "Void Cascade";
    if (chall.includes("armageddon")) return "Void Armageddon";
    if (chall.includes("flood")) return "Void Flood";
    if (chall.includes("capture")) return "Capture";
    if (chall.includes("defense")) return "Defense";
    return NODE_TO_TYPE[nodeKey] || "Bounty";
}

function getMissionName(job, techType, faction, isLich, nodeKey, allyKey) {
    if (faction === "The Hex") {
        if (isLich) return "Coda bounty/ antivirus";
        if (techType === "Capture") return "Capture Antivirus";
        const allyName = ALLY_MAP[allyKey];
        if (allyName) return `${allyName}'s Bounty (${techType})`;
    }
    if (NODE_MAP[nodeKey]) return `${techType} (${NODE_MAP[nodeKey]})`;
    return job.type || job.title || techType;
}

function checkIsOptimal(key, info) {
    return OPTIMAL_FILTERS.some((f) => {
        const fac = !f.factions || f.factions.includes(key);
        const typ = !f.types || f.types.includes(info.techType);
        const tie = !f.tiers || f.tiers.includes(info.tier);
        const cha = !f.challenges || f.challenges.some((c) => info.uName.includes(c));
        return fac && typ && tie && cha;
    });
}

// Job extraction

function extractJobInfo(job, source, faction, oracleJob = null, index = 0) {
    const uName = oracleJob?.challenge || job.uniqueName || job.jobType || "";
    const nodeKey = oracleJob?.node || job.node || "";
    const allyKey = oracleJob?.ally?.split("/").pop() || null;

    const isLich = uName.toLowerCase().includes("lich") || uName.toLowerCase().includes("coda");
    const isNarmer =
        uName.toLowerCase().includes("narmer") ||
        job.type?.toLowerCase().includes("narmer");

    const tier = getTier(index, isNarmer, isLich);
    const techType = getTechType(uName, nodeKey);
    const missionName = getMissionName(job, techType, faction, isLich, nodeKey, allyKey);

    const challengeKey = Object.keys(CHALLENGE_MAP).find((k) => uName.includes(k));
    const condition = challengeKey ? CHALLENGE_MAP[challengeKey] : job.description || "";

    let resolvedName;
    if (missionName !== "Bounty") {
        resolvedName = missionName;
    } else if (isNarmer) {
        resolvedName = missionName;
    } else {
        resolvedName = `Bounty Tier ${tier}`;
    }

    return {
        min: job.enemyLevels?.[0] || job.minEnemyLevel || job.minLevel || 0,
        max: job.enemyLevels?.[1] || job.maxEnemyLevel || job.maxLevel || 0,
        name: resolvedName,
        techType,
        condition,
        uName,
        tier,
        hideTier: techType === "Excavation" || job.isVault,
        isLich,
    };
}

//Reward processing
const calculateStandingXp = (arr) =>
    Array.isArray(arr) ? arr.reduce((a, b) => a + (Number(b) || 0), 0) : 0;

function formatDropItem(d) {
    return { name: d.name, chance: (d.chance || 0) * 100 };
}

function processStageRewards(stage, simple) {
    const drops = (Array.isArray(stage) ? stage : [])
        .map(formatDropItem)
        .sort((a, b) => b.chance - a.chance);
    drops.forEach((d) => simple.push(d.name));
    return drops;
}

function processJobRewards(job, ttSyn) {
    const initial = Array.isArray(job.rewardPool) ? job.rewardPool : [];
    let simple = [...initial];
    let detailed = null;

    if (ttSyn?.jobs) {
        const minLvl = job.minLevel || job.minEnemyLevel || job.enemyLevels?.[0];
        const match = ttSyn.jobs.find((tj) => (tj.minLevel || tj.minEnemyLevel) === minLvl);
        if (Array.isArray(match?.rewards)) {
            simple = [];
            detailed = match.rewards.map((stage, i) => ({
                stage: i + 1,
                drops: processStageRewards(stage, simple),
            }));
        }
    }
    return { simple: [...new Set(simple)], detailed };
}

const WORKER_URL_KEY = "active_bounties_cache";

/**
 * Fetches, processes and caches all active bounty missions across all factions.
 * @returns {Promise<Array>}
 */
export async function fetchActiveBounties() {
    try {
        const cached = await dbHelper.get(WORKER_URL_KEY);
        if (cached?.expiryTime > Date.now()) return cached.data;

        const res = await fetch(`${WORKER_URL}?type=active_bounties`);
        if (!res.ok) return [];

        const { ws = [], tt = [], oracle = {} } = await res.json();
        const now = Date.now();
        const tzOptions = { hour12: false };
        const realExpiry = oracle.expiry
            ? new Date(Number(oracle.expiry)).toLocaleString("es-ES", tzOptions)
            : new Date(now + 600000).toLocaleString("es-ES", tzOptions);

        const factionMap = [
            { key: "Ostrons", ttId: "696e78a80000000000000010", wsMatch: "Ostron", wsId: "CetusSyndicate" },
            { key: "The Holdfasts", ttId: "ZarimanSyndicate", wsMatch: "Holdfasts", wsId: "ZarimanSyndicate" },
            { key: "Cavia", ttId: "CaviaSyndicate", wsMatch: "Cavia", wsId: "EntratiLabSyndicate" },
            { key: "The Hex", ttId: "HexSyndicate", wsMatch: "Hex", wsId: "HexSyndicate" },
            { key: "Entrati", ttId: "696e78a80000000000000002", wsMatch: "Entrati", wsId: "EntratiSyndicate" },
            { key: "Solaris United", ttId: "696e78a80000000000000031", wsMatch: "Solaris", wsId: "SolarisSyndicate" },
        ];

        const allMissions = [];
        factionMap.forEach(({ key, ttId, wsMatch, wsId }) => {
            const wsSyn = ws.find((s) =>
                (s.syndicate || s.syndicateKey || "").toLowerCase().includes(wsMatch.toLowerCase()),
            );
            const ttSyn = tt.find(
                (t) => t.id === ttId || (t.syndicate || "").startsWith(key.substring(0, 4)),
            );
            let source;
            if (wsSyn?.jobs?.length) source = "ws";
            else if (ttSyn) source = "tt";
            else source = "none";
            if (source === "none") return;

            const jobs = source === "ws" ? wsSyn.jobs : ttSyn.jobs;
            const oracleData = oracle.bounties?.[wsId] || [];
            const useOracle = source === "tt" && oracleData.length > 0;
            const jobsToProcess = useOracle ? oracleData : jobs;

            jobsToProcess.forEach((item, idx) => {
                const oJob = useOracle ? item : oracleData[idx];
                const j = useOracle ? (jobs[idx] || jobs[jobs.length - 1]) : item;
                const info = extractJobInfo(j, source, key, oJob, idx);
                const rewards = processJobRewards(j, ttSyn);
                const isSpecialTier = info.tier === "NARMER" || info.isLich;
                const numTier = isSpecialTier ? 6 : (Number.parseInt(info.tier) || 1);

                let standing = 0;
                let standingSP = 0;
                if (key === "The Hex") {
                    standing = numTier * 1000;
                    standingSP = standing + 500;
                } else if (key === "The Holdfasts") {
                    const tIdx = Math.min(numTier, 5);
                    standing = (ZARIMAN_DATA.counts.normal[tIdx] || 0) * ZARIMAN_DATA.value;
                    standingSP = (ZARIMAN_DATA.counts.sp[tIdx] || 0) * ZARIMAN_DATA.value;
                    if (info.uName.includes("VoidAngel")) { standing += 2500; standingSP += 2500; }
                } else {
                    standing = calculateStandingXp(j.standingStages || j.xpAmounts);
                    standingSP = Math.round(standing * 1.5);
                }

                allMissions.push({
                    factionKey: key,
                    type: info.name,
                    technicalType: info.techType,
                    tier: info.tier,
                    hideTier: info.hideTier,
                    standing,
                    standingSP,
                    level: `${info.min}-${info.max}`,
                    levelSP: `${info.min + 100}-${info.max + 100}`,
                    rewards: rewards.simple,
                    detailedRewards: rewards.detailed,
                    expiry: realExpiry,
                    isDual: DUAL_PATH_FACTIONS.has(key),
                    isSP: !DUAL_PATH_FACTIONS.has(key) && (j.isHard || info.min >= 100),
                    condition: info.condition,
                    uName: info.uName,
                    isOptimal: checkIsOptimal(key, info),
                });
            });
        });

        allMissions.sort((a, b) => b.standing - a.standing);
        const expiryTime = oracle.expiry ? Number(oracle.expiry) : now + 600000;
        await dbHelper.set(WORKER_URL_KEY, { expiryTime, data: allMissions });
        return allMissions;
    } catch (e) {
        console.error("Bounties error:", e);
        return [];
    }
}
