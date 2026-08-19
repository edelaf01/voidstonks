import { state } from "../../state.js";
import { ORDERS_TEXTS as T } from "../../assets/orders_texts.js";
import { applyIcon } from "../../utils/wfm_assets.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import {
    login,
    clearToken,
    isLoggedIn,
    getIngameName,
    getScope,
    getPlatform,
    logout as logoutSession
} from "../../services/market/wfm_auth.service.js";
import {
    fetchMyOrders,
    editOrder,
    fetchItemMarket,
    fetchMarketBatch
} from "../../services/market/wfm_orders.service.js";

/**
 * Orders tab: warframe.market session and order list. The view is a state machine (VIEW): a new screen
 * is one more entry in RENDERERS. API data is painted with textContent, never with interpolated innerHTML.
 */

const VIEW = {
    LOGIN: "login",
    LOADING: "loading",
    ORDERS: "orders",
    ERROR: "error"
};


const txt = () => T[state.currentLang === "es" ? "es" : "en"];

const ERROR_KEYS = {
    missing_fields: "errMissing",
    invalid_credentials: "errInvalid",
    email_not_found: "errEmail",
    wrong_password: "errPassword",
    rate_limited: "errRate",
    network: "errNetwork",
    server: "errServer",
    unauthorized: "errExpired",
    no_token: "errExpired",
    token_rejected: "errRejected"
};

const view = { current: VIEW.LOGIN, data: null };

let listCtx = null;

const filters = { type: "all", query: "" };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function plat(value, className) {
    const wrap = el("span", className);
    wrap.append(el("span", "plat-num", String(value)), el("span", "plat-icon-inline"));
    return wrap;
}

function field(labelText, input) {
    const wrap = el("div", "orders-field");
    const label = el("label", "orders-label", labelText);
    label.htmlFor = input.id;
    wrap.append(label, input);
    return wrap;
}

function message(kind, text, hint) {
    const p = el("p", `orders-msg ${kind}`, text);
    if (hint) p.appendChild(el("span", "orders-msg-hint", hint));
    return p;
}

function stateBlock(icon, text, actionLabel, onAction) {
    const box = el("div", "orders-state");
    if (icon === "spinner") box.appendChild(el("div", "orders-spinner"));
    else box.appendChild(el("div", "orders-state-icon", icon));

    box.appendChild(el("p", "orders-state-text", text));

    if (actionLabel && onAction) {
        const btn = el("button", "orders-btn-ghost", actionLabel);
        btn.type = "button";
        btn.addEventListener("click", onAction);
        box.appendChild(btn);
    }
    return box;
}

function renderLogin(root, errorInfo) {
    const t = txt();
    const card = el("form", "orders-login");

    const head = el("div", "orders-login-head");
    head.append(el("h2", "orders-title", t.title), el("p", "orders-intro", t.intro));
    card.appendChild(head);

    const email = el("input", "orders-input");
    email.type = "email";
    email.id = "wfm-email";
    email.placeholder = t.emailPh;
    email.autocomplete = "username";
    email.required = true;

    const pass = el("input", "orders-input");
    pass.type = "password";
    pass.id = "wfm-pass";
    pass.placeholder = t.passwordPh;
    pass.autocomplete = "current-password";
    pass.required = true;

    const platform = el("select", "orders-input");
    platform.id = "wfm-platform";
    for (const p of ["pc", "ps4", "xbox", "switch", "mobile"]) {
        const opt = el("option", null, p.toUpperCase());
        opt.value = p;
        platform.appendChild(opt);
    }

    card.append(
        field(t.email, email),
        field(t.password, pass),
        field(t.platform, platform)
    );

    if (errorInfo) {
        card.appendChild(message("error", t[ERROR_KEYS[errorInfo.error] || "errInvalid"], errorInfo.hint));
    }

    const submit = el("button", "orders-btn", t.login);
    submit.type = "submit";
    card.appendChild(submit);

    const disclaimer = el("details", "orders-disclaimer");
    const summary = el("summary", "orders-disclaimer-head", t.privacyShort);
    disclaimer.append(summary, el("p", "orders-disclaimer-body", t.privacy));
    card.appendChild(disclaimer);

    card.addEventListener("submit", async (e) => {
        e.preventDefault();

        submit.disabled = true;
        submit.replaceChildren(el("span", "orders-btn-spinner"), el("span", null, t.loggingIn));
        email.disabled = pass.disabled = platform.disabled = true;

        const res = await login(email.value.trim(), pass.value, platform.value);
        pass.value = "";

        if (!res.ok) {
            const hint = res.diag ? `${res.diag.via} / HTTP ${res.diag.v2Status}` : null;
            setView(VIEW.LOGIN, { error: res.error, hint });
            return;
        }
        setView(VIEW.LOADING);
        // the inventory shows "Sell" only with a session
        globalThis.renderPrimeInventory?.();
        loadOrders();
    });

    root.appendChild(card);
}

function renderLoading(root) {
    root.appendChild(stateBlock("spinner", txt().loadingOrders));
}

function renderError(root, info) {
    const t = txt();
    root.appendChild(sessionBar());
    root.appendChild(stateBlock("!", t[ERROR_KEYS[info?.error] || "errServer"], t.retry, () => {
        setView(VIEW.LOADING);
        loadOrders();
    }));
}

function tabHeader() {
    const t = txt();
    const box = el("div", "orders-about");

    box.appendChild(el("p", "orders-about-what", t.tabWhat));

    const caps = getScope() === "full"
        ? [t.tabCanSell, t.tabCanEdit, t.tabCanClose, t.tabCanWatch]
        : [t.tabCanWatch];

    const list = el("ul", "orders-about-caps");
    for (const c of caps) list.appendChild(el("li", null, c));
    box.appendChild(list);

    return box;
}

function renderOrders(root, orders) {
    const t = txt();
    root.appendChild(sessionBar());
    root.appendChild(tabHeader());

    if (getScope() === "public") {
        const note = message("note", t.publicNote);
        const relog = el("button", "order-act", t.relogin);
        relog.type = "button";
        relog.addEventListener("click", () => {
            clearToken();
            setView(VIEW.LOGIN);
        });
        note.appendChild(relog);
        root.appendChild(note);
    }

    if (!orders.length) {
        const hint = getScope() === "full" ? t.noOrdersHintFull : t.noOrdersHint;
        root.appendChild(stateBlock("○", `${t.noOrders} ${hint}`));
        root.appendChild(inventorySection(orders));
        return;
    }

    let summary = summaryBar(orders);
    root.appendChild(summary);

    const head = el("div", "orders-section-head");
    const count = el("span", "orders-count");
    head.append(el("span", "orders-section-title", t.sectionOrders), count);
    root.appendChild(head);

    let bar = filterBar(orders, () => paint());
    root.appendChild(bar);

    const list = el("div", "orders-list");
    root.appendChild(list);

    function paint() {
        const shown = applyFilters(orders);
        count.textContent = shown.length === orders.length
            ? String(orders.length)
            : `${shown.length} / ${orders.length}`;

        if (!shown.length) {
            list.replaceChildren(stateBlock("○", t.noMatches, t.clearFilters, () => {
                filters.type = "all";
                filters.query = "";
                // refreshAggregates rebuilds the filter bar, where the search input lives
                listCtx?.refreshAggregates();
                paint();
            }));
            return;
        }
        const frag = document.createDocumentFragment();
        for (const o of shown) frag.appendChild(orderCard(o));
        list.replaceChildren(frag);
    }
    paint();

    // lets an action update only its card (see patchOrder) instead of repainting the tab, which lost the
    // scroll, the active filter and the loaded prices
    listCtx = {
        orders,
        list,
        repaint: paint,
        refreshAggregates() {
            const nextSummary = summaryBar(orders);
            summary.replaceWith(nextSummary);
            summary = nextSummary;

            const nextBar = filterBar(orders, () => paint());
            bar.replaceWith(nextBar);
            bar = nextBar;
        }
    };

    loadMarketForList(orders, list);

    root.appendChild(inventorySection(orders));
}

function inventorySection(orders) {
    const t = txt();
    const box = el("div", "orders-inv");

    if (getScope() !== "full") {
        box.appendChild(el("span", "orders-section-title", t.sectionInv));
        box.appendChild(el("p", "orders-inv-hint", t.invNeedFull));
        return box;
    }

    const head = el("div", "orders-section-head");
    head.append(el("span", "orders-section-title", t.sectionInv));
    box.appendChild(head);
    box.appendChild(el("p", "orders-inv-hint", t.invHint));

    const body = el("div", "orders-inv-body");
    body.appendChild(el("p", "orders-state-text", t.invLoading));
    box.appendChild(body);

    fillInventorySection(body, orders);
    return box;
}

async function fillInventorySection(body, orders) {
    const t = txt();

    let link;
    try {
        link = await import("../../services/market/wfm_link.service.js");
        linkApi = link;
    } catch {
        body.replaceChildren(el("p", "orders-state-text", t.errGeneric));
        return;
    }

    // reuses the loaded orders instead of fetching them again
    const res = await link.syncInventory(orders);
    if (!res.ok) {
        body.replaceChildren(el("p", "orders-state-text", t.errGeneric));
        return;
    }

    const frag = document.createDocumentFragment();

    if (res.stale?.length) {
        frag.appendChild(el("p", "orders-inv-stale-head", t.invStale));
        frag.appendChild(el("p", "orders-inv-hint", t.invStaleHint));
        for (const s of res.stale) frag.appendChild(staleRow(s));
    }

    if (!res.unlisted?.length) {
        if (!res.stale?.length) frag.appendChild(el("p", "orders-state-text", t.invEmpty));
        body.replaceChildren(frag);
        return;
    }

    const slugs = res.unlisted.map(i => i.slug);
    const [ids, market] = await Promise.all([
        link.resolveIds(slugs),
        fetchMarketBatch(slugs)
    ]);

    for (const item of res.unlisted) {
        frag.appendChild(sellableRow(item, ids[item.slug], market[item.slug]));
    }
    body.replaceChildren(frag);
}

function sellableRow(item, meta, market) {
    const t = txt();
    const row = el("div", "inv-row");

    const img = el("img", "inv-thumb");
    img.alt = "";
    img.loading = "lazy";
    applyIcon(img, item.name, meta?.thumb);
    row.appendChild(img);

    const info = el("div", "inv-info");
    info.appendChild(el("span", "inv-name", item.name));
    info.appendChild(el("span", "inv-meta", `${t.invOwned} ×${item.qty}`));
    row.appendChild(info);

    const suggested = market?.median != null ? Math.round(market.median) : null;

    const price = el("input", "inv-price");
    price.type = "number";
    price.min = "1";
    price.setAttribute("aria-label", t.invPrice);
    if (suggested) price.value = String(suggested);
    row.appendChild(price);

    const hint = el("span", "inv-suggested");
    if (suggested) hint.append(el("span", "inv-suggested-label", t.invSuggested), plat(suggested));
    else hint.textContent = t.invNoPrice;
    row.appendChild(hint);

    const btn = el("button", "order-act ok", t.invSell);
    btn.type = "button";

    // WFM needs the itemId, not the slug
    if (!meta?.id) btn.disabled = true;

    btn.addEventListener("click", async () => {
        const asking = parseInt(price.value, 10);
        if (!(asking > 0)) {
            price.focus();
            return;
        }
        btn.disabled = true;
        btn.textContent = t.invPublishing;

        const { createSellOrder } = await import("../../services/market/wfm_link.service.js");
        const res = await createSellOrder({
            itemId: meta.id,
            slug: item.slug,
            platinum: asking,
            quantity: item.qty
        });

        if (!res.ok) {
            btn.disabled = false;
            btn.textContent = t.invSell;
            globalThis.showToast?.(res.error === "unauthorized" ? t.invNeedFull : t.errPublish);
            return;
        }

        row.classList.add("is-done");
        row.replaceChildren(el("span", "inv-done", `${item.name} · ${t.invPublished}`));
        globalThis.showToast?.(`${item.name} · ${t.invPublished}`);
    });
    row.appendChild(btn);

    return row;
}

function staleRow(entry) {
    const t = txt();
    const row = el("div", "inv-row is-stale");

    const info = el("div", "inv-info");
    info.appendChild(el("span", "inv-name", entry.name || entry.slug));
    row.appendChild(info);

    const btn = el("button", "order-act danger", t.remove);
    btn.type = "button";
    btn.addEventListener("click", async () => {
        if (!confirm(t.confirmDelete)) return;
        btn.disabled = true;
        const res = await editOrder(entry.order.id, "delete");
        if (!res.ok) {
            btn.disabled = false;
            globalThis.showToast?.(t.errEdit);
            return;
        }
        row.remove();
    });
    row.appendChild(btn);

    return row;
}

/**
 * Cached so isSetListed can answer synchronously: the set tracker calls it from an onclick.
 */
let linkApi = null;

const marketCache = new Map();

async function loadMarketForList(orders, listEl) {
    const slugs = [...new Set(
        orders.map(o => o.itemSlug || o.item?.slug).filter(s => s && !marketCache.has(s))
    )];

    if (slugs.length) {
        const data = await fetchMarketBatch(slugs);
        for (const [slug, info] of Object.entries(data)) marketCache.set(slug, info);
    }
    if (!listEl.isConnected) return; // the view changed while loading

    for (const card of listEl.querySelectorAll(".order-card")) applyMarketToCard(card);

    startLiveWatch(orders);
}

function applyMarketToCard(card) {
    const slug = card.dataset.slug;
    const info = slug && marketCache.get(slug);
    if (!info) return;
    card.querySelector(".order-market")
        ?.replaceWith(marketSummary(info, card.dataset.type, card.dataset.plat,
            card.dataset.ranked === "1"));
}

async function startLiveWatch(orders) {
    const { setWatchlist, startWatching, onUndercut, onDeal, onPrice } =
        await import("../../services/market/wfm_watch.service.js");

    setWatchlist(toWatchlist(orders));

    if (!liveHooked) {
        liveHooked = true;
        const t = txt();

        onUndercut(({ name, theirs, mine, user }) => {
            globalThis.showToast?.(`${t.undercutAlert}: ${name} — ${theirs}p (${t.yours} ${mine}p) · ${user}`);
            markCardStale(name);
        });

        onDeal(({ name, platinum, discount, user }) => {
            globalThis.showToast?.(`${t.dealAlert}: ${name} — ${platinum}p (-${discount}%) · ${user}`);
        });

        onPrice(({ itemId, sell }) => {
            if (sell != null) updateLivePriceBadge(itemId, sell);
        });
    }

    // crossplay off: only players you can actually trade with
    await startWatching({ platform: getPlatform(), crossplay: false });
}

let liveHooked = false;

function toWatchlist(orders) {
    return orders.map(o => {
        const slug = o.itemSlug || o.item?.slug;
        const mkt = slug && marketCache.get(slug);
        return {
            itemId: o.itemId,
            median: mkt?.median ?? null,
            myPrice: o.platinum,
            type: (o.type || "sell").toLowerCase(),
            name: o.itemName || slug || "",
            rank: Number(o.itemMaxRank) > 0 ? (Number(o.rank) || 0) : null
        };
    });
}

async function refreshWatchlist(orders) {
    try {
        const { setWatchlist } = await import("../../services/market/wfm_watch.service.js");
        setWatchlist(toWatchlist(orders));
    } catch { /* watching is optional: its failure must not break the edit */ }
}

function markCardStale(name) {
    for (const card of document.querySelectorAll(".order-card")) {
        if (card.querySelector(".order-name")?.textContent === name) {
            card.classList.add("is-undercut");
        }
    }
}

function updateLivePriceBadge(itemId, sell) {
    const card = document.querySelector(`.order-card[data-item="${CSS.escape(itemId)}"]`);
    if (!card) return;

    let badge = card.querySelector(".om-live");
    if (!badge) {
        badge = el("span", "om-live");
        card.querySelector(".order-market")?.appendChild(badge);
    }
    badge.textContent = `${txt().live} ${sell}p`;
    badge.title = txt().liveTitle;
}

/**
 * Ranked items mix r0 and max rank (the list batch is not split by rank, that would multiply the
 * requests), so they get no "on market" verdict.
 */
function marketSummary(info, type, myPlat, ranked = false) {
    const t = txt();
    const box = el("div", "order-market");

    const isBuy = type === "buy";
    const rows = (isBuy ? info.buy : info.sell) || [];
    const mine = parseInt(myPlat, 10);

    if (info.median != null) {
        const m = el("span", "om-stat");
        m.title = t.medianTitle;
        m.append(el("span", "om-label", t.median), plat(Math.round(info.median), "om-val"));
        box.appendChild(m);
    }
    if (info.volume != null) {
        const v = el("span", "om-stat");
        v.title = t.volumeTitle;
        v.append(el("span", "om-label", t.volume), el("span", "om-val", String(info.volume)));
        box.appendChild(v);
    }

    if (rows.length) {
        const best = rows[0].platinum;
        const b = el("span", "om-stat");
        b.title = t.bestTitle;
        b.append(
            el("span", "om-label", isBuy ? t.bestBuy : t.bestSell),
            plat(best, "om-val")
        );
        box.appendChild(b);

        const depth = el("span", "om-depth");
        depth.title = t.depthTitle;
        for (const o of rows.slice(0, 3)) {
            const chip = plat(o.platinum, "om-depth-item");
            chip.appendChild(el("span", "om-depth-qty", `×${o.quantity}`));
            depth.appendChild(chip);
        }
        box.appendChild(depth);

        if (Number.isFinite(mine) && !ranked) {
            const good = isBuy ? mine >= best : mine <= best;
            const tag = el("span", `om-tag ${good ? "ok" : "warn"}`,
                good ? t.competitive : t.offMarket);
            tag.title = good ? t.competitiveTitle : t.offMarketTitle;
            box.appendChild(tag);

            const diff = mine - best;
            if (diff !== 0) {
                const delta = plat(`${diff > 0 ? "+" : ""}${diff}`,
                    `om-delta ${good ? "ok" : "warn"}`);
                delta.title = (diff > 0 ? t.deltaAbove : t.deltaBelow)
                    .replace("{n}", Math.abs(diff));
                box.appendChild(delta);
            }
        }
    }

    if (!box.childElementCount) box.appendChild(el("span", "om-sample", t.noListings));
    return box;
}

function summaryBar(orders) {
    const t = txt();
    const acc = { sell: 0, buy: 0 };

    for (const o of orders) {
        const type = (o.type || "").toLowerCase();
        if (type !== "sell" && type !== "buy") continue;
        // hidden orders are not on the market
        if (o.visible === false) continue;
        const platinum = Number(o.platinum) || 0;
        const qty = Number(o.quantity) || 0;
        acc[type] += platinum * qty;
    }

    const bar = el("div", "orders-summary");
    const stat = (kind, label, value) => {
        const box = el("div", `os-stat os-${kind}`);
        box.append(plat(value.toLocaleString(), "os-val"), el("span", "os-label", label));
        return box;
    };

    bar.append(
        stat("sell", t.totalSell, acc.sell),
        stat("buy", t.totalBuy, acc.buy)
    );
    return bar;
}

const FILTER_TESTS = {
    all: () => true,
    sell: (o) => (o.type || "").toLowerCase() === "sell",
    buy: (o) => (o.type || "").toLowerCase() === "buy",
    hidden: (o) => o.visible === false,
    visible: (o) => o.visible !== false
};

function applyFilters(orders) {
    const q = filters.query.trim().toLowerCase();
    const test = FILTER_TESTS[filters.type] || FILTER_TESTS.all;

    return orders.filter((o) => {
        if (!test(o)) return false;
        if (!q) return true;
        const name = (o.itemName || o.itemSlug || o.item?.slug || "").toLowerCase();
        return name.includes(q);
    });
}

function filterBar(orders, onChange) {
    const t = txt();
    const bar = el("div", "orders-filters");

    const counts = {};
    for (const [key, test] of Object.entries(FILTER_TESTS)) {
        counts[key] = orders.filter(test).length;
    }

    const chips = el("div", "orders-chips");
    const defs = [
        ["all", t.filterAll],
        ["sell", t.filterSell],
        ["buy", t.filterBuy],
        ["hidden", t.filterHidden]
    ];

    // the saved filter can point to a chip that no longer renders: reset it or the list stays empty
    if (filters.type !== "all" && !counts[filters.type]) filters.type = "all";

    for (const [key, label] of defs) {
        if (key !== "all" && !counts[key]) continue;

        const chip = el("button", "orders-chip", `${label} (${counts[key]})`);
        chip.type = "button";
        if (filters.type === key) chip.classList.add("active");
        chip.addEventListener("click", () => {
            filters.type = key;
            for (const c of chips.children) c.classList.remove("active");
            chip.classList.add("active");
            onChange();
        });
        chips.appendChild(chip);
    }
    bar.appendChild(chips);

    const search = el("input", "orders-input orders-search");
    search.type = "search";
    search.placeholder = t.searchPh;
    search.value = filters.query;
    // input, not keyup: on mobile keyup only fires on Enter
    search.addEventListener("input", () => {
        filters.query = search.value;
        onChange();
    });
    bar.appendChild(search);

    return bar;
}

function sessionBar() {
    const t = txt();
    const name = getIngameName() || "—";

    const bar = el("div", "orders-bar");
    bar.appendChild(el("div", "orders-avatar", name.charAt(0).toUpperCase()));

    const identity = el("div", "orders-identity");
    identity.append(
        el("span", "orders-user", name),
        el("span", "orders-status", getScope() === "public" ? t.connectedPublic : t.connected)
    );
    bar.appendChild(identity);

    const actions = el("div", "orders-actions");

    const refresh = el("button", "orders-btn-ghost", t.refresh);
    refresh.type = "button";
    refresh.addEventListener("click", () => {
        setView(VIEW.LOADING);
        loadOrders();
    });

    const logout = el("button", "orders-btn-ghost danger", t.logout);
    logout.type = "button";
    logout.addEventListener("click", async () => {
        logout.disabled = true;
        // revokes the token on WFM, not only locally
        await logoutSession();
        setView(VIEW.LOGIN);
        globalThis.renderPrimeInventory?.();
    });

    actions.append(refresh, logout);
    bar.appendChild(actions);
    return bar;
}

function orderCard(order) {
    const t = txt();
    const type = (order.type || "").toLowerCase() === "buy" ? "buy" : "sell";

    const card = el("div", `order-card ${type}`);
    if (order.visible === false) card.classList.add("is-hidden");

    // the market summary arrives later and finds the card by these data-*
    const slug = order.itemSlug || order.item?.slug;
    if (slug) card.dataset.slug = slug;
    card.dataset.type = type;
    card.dataset.plat = String(order.platinum ?? "");
    if (order.itemId) card.dataset.item = order.itemId;

    const name = order.itemName
        || order.item?.i18n?.[state.currentLang]?.name
        || order.item?.i18n?.en?.name
        || order.itemSlug
        || order.item?.slug
        || "—";

    if (order.itemThumb || slug) {
        const img = el("img", "order-thumb");
        img.alt = "";
        img.loading = "lazy";
        applyIcon(img, name, order.itemThumbPath);
        card.appendChild(img);
    }

    const body = el("div", "order-body");

    if (slug) {
        const link = el("a", "order-name", name);
        link.href = `https://warframe.market/items/${encodeURIComponent(slug)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        body.appendChild(link);
    } else {
        body.appendChild(el("span", "order-name", name));
    }

    const meta = el("div", "order-meta");
    meta.appendChild(el("span", "order-type", type === "buy" ? t.buy : t.sell));
    meta.appendChild(el("span", null, `×${order.quantity ?? "?"}`));

    const maxRank = Number(order.itemMaxRank) || 0;
    if (maxRank > 0) {
        card.dataset.ranked = "1";
        const r = Number(order.rank) || 0;
        const badge = el("span", "order-rank", `${t.rank} ${r}/${maxRank}`);
        badge.title = t.rankTitle;
        if (r >= maxRank) badge.classList.add("is-max");
        meta.appendChild(badge);
    }

    if (order.visible === false) meta.appendChild(el("span", "order-hidden-tag", t.hidden));
    body.appendChild(meta);

    body.appendChild(el("div", "order-market om-loading"));

    card.append(body, plat(order.platinum ?? "?", "order-price"));

    if (getScope() === "full" && order.id) {
        card.appendChild(orderActions(card, order));
    }
    return card;
}

function orderActions(card, order) {
    const t = txt();
    const actions = el("div", "order-actions");

    const mk = (label, className, handler) => {
        const b = el("button", `order-act ${className}`, label);
        b.type = "button";
        b.addEventListener("click", handler);
        return b;
    };

    const total = order.quantity ?? 1;

    actions.append(mk(t.edit, "", () => openEditor(card, order)));

    const isVisible = order.visible !== false;
    actions.appendChild(mk(isVisible ? t.hide : t.show, "toggle", async () => {
        await applyChange(card, order.id, "update", { visible: !isVisible },
            isVisible ? t.hiddenToast : t.shownToast);
    }));

    actions.appendChild(mk(t.sell1, "ok", async () => {
        if (!confirm(t.confirmSell1)) return;
        await applyChange(card, order.id, "close", { quantity: 1 });
    }));

    if (total > 1) {
        actions.appendChild(mk(t.sellAll, "ok", async () => {
            if (!confirm(t.confirmSellAll.replace("{n}", total))) return;
            await applyChange(card, order.id, "close", { quantity: total });
        }));
    }

    actions.appendChild(mk(t.remove, "danger", async () => {
        if (!confirm(t.confirmDelete)) return;
        await applyChange(card, order.id, "delete");
    }));

    return actions;
}

function openEditor(card, order) {
    const t = txt();

    const backdrop = el("div", "orders-modal-backdrop");
    const modal = el("div", "orders-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const close = () => {
        backdrop.remove();
        document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

    const head = el("div", "orders-modal-head");
    head.appendChild(el("h3", "orders-modal-title", order.itemName || order.itemSlug || "—"));
    const closeBtn = el("button", "orders-modal-x", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", t.close);
    closeBtn.addEventListener("click", close);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    const form = el("div", "orders-modal-form");

    const platInput = el("input", "orders-input");
    platInput.type = "number";
    platInput.min = "1";
    platInput.value = order.platinum ?? 1;

    const qty = el("input", "orders-input");
    qty.type = "number";
    qty.min = "1";
    qty.value = order.quantity ?? 1;

    form.append(field(t.yourPrice, platInput), field(t.amount, qty));

    const maxRank = Number(order.itemMaxRank) || 0;
    let rankSelect = null;
    if (maxRank > 0) {
        rankSelect = el("select", "orders-input");
        for (let r = 0; r <= maxRank; r++) {
            let label = String(r);
            if (r === 0) label = t.rankUnranked;
            else if (r === maxRank) label = `${r} (${t.rankMax})`;
            const opt = el("option", null, label);
            opt.value = String(r);
            rankSelect.appendChild(opt);
        }
        rankSelect.value = String(Number(order.rank) || 0);
        form.appendChild(field(t.rank, rankSelect));
    }

    modal.appendChild(form);

    const marketBox = el("div", "orders-market");
    marketBox.appendChild(el("p", "orders-state-text", t.loadingMarket));
    modal.appendChild(marketBox);

    const foot = el("div", "orders-modal-foot");
    const save = el("button", "orders-btn", t.save);
    save.type = "button";
    const cancel = el("button", "orders-btn-ghost", t.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", close);
    foot.append(cancel, save);
    modal.appendChild(foot);

    save.addEventListener("click", async () => {
        const patch = {};
        const p = parseInt(platInput.value, 10);
        const q = parseInt(qty.value, 10);
        if (p > 0 && p !== order.platinum) patch.platinum = p;
        if (q > 0 && q !== order.quantity) patch.quantity = q;

        if (rankSelect) {
            const r = parseInt(rankSelect.value, 10);
            // rank 0 is a real value: compare against the normalized current rank so it is neither sent twice nor lost
            if (r >= 0 && r <= maxRank && r !== (Number(order.rank) || 0)) patch.rank = r;
        }

        close();
        if (!Object.keys(patch).length) return;
        await applyChange(card, order.id, "update", patch);
    });

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    platInput.focus();
    platInput.select();

    const marketRank = () => (rankSelect ? parseInt(rankSelect.value, 10) : null);
    loadMarket(marketBox, order, platInput, marketRank());

    if (rankSelect) {
        rankSelect.addEventListener("change", () => {
            marketBox.replaceChildren(el("p", "orders-state-text", t.loadingMarket));
            loadMarket(marketBox, order, platInput, marketRank());
        });
    }
}

async function loadMarket(box, order, priceInput, rank = null) {
    const t = txt();
    const slug = order.itemSlug || order.item?.slug;
    if (!slug) {
        box.replaceChildren(el("p", "orders-state-text", t.noListings));
        return;
    }

    // a rank change starts another load without cancelling the previous one: a late answer would paint the
    // old rank
    const token = {};
    box._loadToken = token;

    const res = await fetchItemMarket(slug, rank);
    if (box._loadToken !== token) return;

    if (!res.ok || !res.market) {
        box.replaceChildren(el("p", "orders-state-text", t.noListings));
        return;
    }
    const m = res.market;
    box.replaceChildren();

    box.appendChild(el("div", "orders-section-title", t.marketTitle));

    const stats = el("div", "market-stats");
    // value: text or an already built node
    const stat = (label, value) => {
        const b = el("div", "market-stat");
        const val = typeof value === "string"
            ? el("span", "market-stat-value", value)
            : value;
        b.append(el("span", "market-stat-label", label), val);
        return b;
    };
    if (m.median != null) stats.appendChild(stat(t.median, plat(m.median, "market-stat-value")));
    if (m.avg != null) stats.appendChild(stat(t.avgPrice, plat(Math.round(m.avg), "market-stat-value")));
    if (m.volume != null) stats.appendChild(stat(t.volume, String(m.volume)));
    if (m.min != null && m.max != null) {
        stats.appendChild(stat(t.range, plat(`${m.min}–${m.max}`, "market-stat-value")));
    }
    if (stats.childElementCount) box.appendChild(stats);

    const isBuy = (order.type || "").toLowerCase() === "buy";
    const best = isBuy ? m.buy?.[0]?.platinum : m.sell?.[0]?.platinum;
    const quick = el("div", "market-quick");

    if (best != null) {
        const target = isBuy ? best + 1 : best - 1;
        if (target > 0) {
            const b = el("button", "order-act", `${t.undercut} `);
            b.type = "button";
            b.appendChild(plat(target, "order-act-plat"));
            b.addEventListener("click", () => { priceInput.value = target; priceInput.focus(); });
            quick.appendChild(b);
        }
    }
    if (m.median != null) {
        const median = Math.round(m.median);
        const b = el("button", "order-act", `${t.matchMedian} `);
        b.type = "button";
        b.appendChild(plat(median, "order-act-plat"));
        b.addEventListener("click", () => { priceInput.value = median; priceInput.focus(); });
        quick.appendChild(b);
    }
    if (quick.childElementCount) box.appendChild(quick);

    const rows = isBuy ? m.buy : m.sell;
    box.appendChild(el("div", "orders-section-title", isBuy ? t.onlineBuy : t.onlineSell));

    if (!rows?.length) {
        box.appendChild(el("p", "orders-state-text", t.noListings));
        return;
    }
    const list = el("div", "market-listings");
    for (const o of rows) {
        const row = el("div", "market-row");
        row.append(
            el("span", `market-dot ${o.status === "ingame" ? "ingame" : "online"}`),
            el("span", "market-user", o.user),
            el("span", "market-qty", `x${o.quantity}`),
            plat(o.platinum, "market-plat")
        );
        list.appendChild(row);
    }
    box.appendChild(list);
}

/**
 * `patch === null` means the order is gone. An emptied list reloads, because the empty state is a
 * different screen.
 */
function patchOrder(card, orderId, patch) {
    if (!listCtx || !card.isConnected) return false;

    const i = listCtx.orders.findIndex(o => o.id === orderId);
    if (i === -1) return false;

    if (patch === null) {
        listCtx.orders.splice(i, 1);
        if (!listCtx.orders.length) return false;
        card.remove();
    } else {
        const next = { ...listCtx.orders[i], ...patch };
        listCtx.orders[i] = next;

        const fresh = orderCard(next);
        card.replaceWith(fresh);
        applyMarketToCard(fresh);

        if (!FILTER_TESTS[filters.type]?.(next)) listCtx.repaint();
    }

    listCtx.refreshAggregates();
    refreshWatchlist(listCtx.orders);
    return true;
}

/**
 * `okToast` confirms changes the card barely shows, like hide and show.
 */
async function applyChange(card, orderId, action, payload, okToast) {
    const t = txt();
    card.classList.add("is-busy");

    const res = await editOrder(orderId, action, payload);
    card.classList.remove("is-busy");

    if (!res.ok) {
        if (res.error === "unauthorized") {
            clearToken();
            setView(VIEW.LOGIN, { error: "unauthorized" });
            return;
        }
        const err = el("p", "orders-msg error", t.errEdit);
        card.appendChild(err);
        setTimeout(() => err.remove(), 3000);
        return;
    }
    if (okToast) globalThis.showToast?.(okToast);

    if (patchOrder(card, orderId, localPatchFor(action, payload, orderId))) return;

    setView(VIEW.LOADING);
    loadOrders();
}

/**
 * `undefined` means it cannot be modelled and the caller reloads.
 */
function localPatchFor(action, payload, orderId) {
    if (action === "update") return { ...payload };
    if (action === "delete") return null;

    if (action === "close") {
        const order = listCtx?.orders.find(o => o.id === orderId);
        if (!order) return undefined;
        const left = (Number(order.quantity) || 0) - (Number(payload?.quantity) || 0);
        // WFM closes the order when the last unit sells
        return left > 0 ? { quantity: left } : null;
    }
    return undefined;
}

const RENDERERS = {
    [VIEW.LOGIN]: renderLogin,
    [VIEW.LOADING]: renderLoading,
    [VIEW.ORDERS]: renderOrders,
    [VIEW.ERROR]: renderError
};

function setView(next, data = null) {
    view.current = next;
    view.data = data;

    const root = document.getElementById("orders-content");
    if (!root) return;

    listCtx = null;

    root.replaceChildren();
    (RENDERERS[next] || renderLogin)(root, data);
}

async function loadOrders() {
    const res = await fetchMyOrders();

    if (!res.ok) {
        if (res.error === "unauthorized" || res.error === "no_token") {
            clearToken();
            setView(VIEW.LOGIN, { error: "unauthorized" });
            return;
        }
        setView(VIEW.ERROR, { error: res.error });
        return;
    }
    setView(VIEW.ORDERS, res.orders);
}

function renderUnderConstruction() {
    const t = txt();
    const root = document.getElementById("orders-content");
    if (!root) return;
    root.replaceChildren();

    const box = el("div", "orders-wip");
    box.appendChild(el("div", "orders-wip-icon", "🚧"));
    box.appendChild(el("h2", "orders-wip-title", t.wipTitle));

    const text = el("p", "orders-wip-text", t.wipText);
    text.title = t.wipTooltip;
    box.appendChild(text);

    root.appendChild(box);
}

export function initOrdersTab() {
    if (!document.getElementById("orders-content")) return;
    renderUnderConstruction();
}

export function isSetListed(slug) {
    return linkApi?.isListed(slug) ?? false;
}

export function canPublishToWfm() {
    return isLoggedIn() && getScope() === "full";
}

/** @param {string} setName */
export async function sellSetFromInventory(setName) {
    const t = txt();
    if (!setName) return;

    if (!isLoggedIn()) {
        openSessionWarning(t.sellNoSession, t.sellNoSessionHint);
        return;
    }
    if (getScope() !== "full") {
        openSessionWarning(t.sellPublicSession, t.sellNoSessionHint);
        return;
    }

    const { getSlug } = await import("../../utils/slugs.utils.js");
    const slug = getSlug(setName + " Set");

    const link = await import("../../services/market/wfm_link.service.js");
    linkApi = link;

    if (link.isListed(slug)) {
        globalThis.showToast?.(`${setName} · ${t.invPublished}`);
        return;
    }

    const [ids, market] = await Promise.all([
        link.resolveIds([slug]),
        fetchMarketBatch([slug])
    ]);

    const meta = ids[slug];
    if (!meta?.id) {
        globalThis.showToast?.(t.errPublish);
        return;
    }

    openSellModal({
        name: `${setName} Set`,
        slug,
        itemId: meta.id,
        thumb: meta.thumb,
        suggested: market[slug]?.median != null ? Math.round(market[slug].median) : null
    });
}

function openSessionWarning(text, hint) {
    const t = txt();

    const backdrop = el("div", "orders-modal-backdrop");
    const modal = el("div", "orders-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const close = () => {
        backdrop.remove();
        document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

    const head = el("div", "orders-modal-head");
    head.appendChild(el("h3", "orders-modal-title", t.sellConfirmTitle));
    const closeBtn = el("button", "orders-modal-x", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", t.close);
    closeBtn.addEventListener("click", close);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    modal.appendChild(message("note", text, hint));

    const foot = el("div", "orders-modal-foot");
    const cancel = el("button", "orders-btn-ghost", t.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", close);

    const go = el("button", "orders-btn", t.goToOrders);
    go.type = "button";
    go.addEventListener("click", () => {
        close();
        globalThis.switchTab?.("orders");
    });

    foot.append(cancel, go);
    modal.appendChild(foot);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    go.focus();
}

function openSellModal(item) {
    const t = txt();

    const backdrop = el("div", "orders-modal-backdrop");
    const modal = el("div", "orders-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const close = () => {
        backdrop.remove();
        document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

    const head = el("div", "orders-modal-head");
    head.appendChild(el("h3", "orders-modal-title", `${t.sellConfirmTitle}: ${item.name}`));
    const closeBtn = el("button", "orders-modal-x", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", t.close);
    closeBtn.addEventListener("click", close);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    modal.appendChild(message("note", t.sellConfirmWarn));

    const form = el("div", "orders-modal-form");

    const price = el("input", "orders-input");
    price.type = "number";
    price.min = "1";
    if (item.suggested) price.value = String(item.suggested);

    const qty = el("input", "orders-input");
    qty.type = "number";
    qty.min = "1";
    qty.value = "1";

    form.append(field(t.invPrice, price), field(t.amount, qty));
    modal.appendChild(form);

    const hint = el("p", "orders-inv-hint");
    if (item.suggested) {
        hint.append(document.createTextNode(`${t.invSuggested}: `), plat(item.suggested));
    } else {
        hint.textContent = t.invNoPrice;
    }
    modal.appendChild(hint);

    const foot = el("div", "orders-modal-foot");
    const cancel = el("button", "orders-btn-ghost", t.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", close);
    const publish = el("button", "orders-btn", t.sellConfirmBtn);
    publish.type = "button";

    publish.addEventListener("click", async () => {
        const asking = parseInt(price.value, 10);
        if (!(asking > 0)) {
            price.focus();
            return;
        }
        publish.disabled = true;
        publish.textContent = t.invPublishing;

        const res = await linkApi.createSellOrder({
            itemId: item.itemId,
            slug: item.slug,
            platinum: asking,
            quantity: parseInt(qty.value, 10) || 1
        });

        if (!res.ok) {
            publish.disabled = false;
            publish.textContent = t.sellConfirmBtn;
            globalThis.showToast?.(res.error === "unauthorized" ? t.invNeedFull : t.errPublish);
            return;
        }

        close();
        globalThis.showToast?.(`${item.name} · ${t.invPublished}`);
        globalThis.renderPrimeInventory?.();
    });

    foot.append(cancel, publish);
    modal.appendChild(foot);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    price.focus();
    price.select();
}

exposeGlobals(
    { initOrdersTab, isSetListed, canPublishToWfm, sellSetFromInventory },
    "ui.components/market/ui_orders.js"
);
