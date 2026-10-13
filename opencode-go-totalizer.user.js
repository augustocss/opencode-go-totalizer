// ==UserScript==
// @name         OpenCode Go Usage Totalizer
// @namespace    https://github.com/augustocss/opencode-go-totalizer
// @version      3.0
// @description  Aggregate cost/token usage from the OpenCode request-logs API with breakdowns by model/day and real-time Go limit tracking. / Totalizador de credito/uso do OpenCode Go via API de logs.
// @author       augustocss
// @match        https://opencode.ai/*
// @updateURL    https://raw.githubusercontent.com/augustocss/opencode-go-totalizer/main/opencode-go-totalizer.user.js
// @downloadURL  https://raw.githubusercontent.com/augustocss/opencode-go-totalizer/main/opencode-go-totalizer.user.js
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "oc_go_totalizer";
  const LIMITS_STORAGE_KEY = "oc_go_limits";
  const THEME_KEY = "oc_go_theme";
  const CACHE_KEY = "oc_go_totalizer_cache_v1";
  const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const LOG_PREFIX = "[oc-go-totalizer]";
  const LOGS_API_PATH = "/console/api/request-logs";
  const API_PAGE_LIMIT = 50;
  const API_WINDOW_CHUNK_MS = 6 * 24 * 60 * 60 * 1000;
  const API_FLOOR_SAFETY_MS = 60 * 60 * 1000;
  const API_PAGE_DELAY = 120;
  const API_MAX_RETRIES = 3;
  const API_RETRY_BASE_MS = 2000;
  const RETENTION_DAYS = 30;
  const ORG_KEY = "oc_go_org_id";

  const locale = (navigator.language || "").startsWith("pt") ? "pt" : "en";
  const _ = (() => {
    const strings = {
      pt: {
        byModel: "Por modelo",
        byDay: "Top dias",
        scanBtn: "Atualizar totais",
        scanningBtn: "Atualizando...",
        resetBtn: "Resetar",
        requests: "requisi\u00e7\u00f5es",
        scanningPage: "P\u00e1gina",
        allPages: "todas as p\u00e1ginas",
        tokens: "Tokens",
        _in: "in",
        _out: "out",
        fallbackLimits: "Limites Go: 5h $12 \u00b7 Semanal $30 \u00b7 Mensal $60",
        billingPeriod: (start, end) => `Per\u00edodo: ${start} \u2014 ${end}`,
        themeToggle: "Alternar tema",
        clearCache: "Limpar cache",
        projection: (pct) =>
          `Proje\u00e7\u00e3o: ${pct}% no fim do m\u00eas \u2014 vai estourar o limite no ritmo atual`,
        waitingLimits: "Aguardando limites Go para calcular o per\u00edodo...",
        noPeriod: "N\u00e3o foi poss\u00edvel calcular o per\u00edodo. Abra a p\u00e1gina /go e tente de novo.",
        prevPeriod: "Per\u00edodo anterior",
        partial: "parcial (reten\u00e7\u00e3o de 30 dias)",
        noPrevData: "sem logs dispon\u00edveis (reten\u00e7\u00e3o do servidor)",
        apiError: "Falha ao consultar a API de logs. Recarregue a p\u00e1gina e tente de novo.",
      },
      en: {
        byModel: "By model",
        byDay: "Top days",
        scanBtn: "Refresh totals",
        scanningBtn: "Refreshing...",
        resetBtn: "Reset",
        requests: "requests",
        scanningPage: "Page",
        allPages: "all pages",
        tokens: "Tokens",
        _in: "in",
        _out: "out",
        fallbackLimits: "Go limits: 5h $12 \u00b7 Weekly $30 \u00b7 Monthly $60",
        billingPeriod: (start, end) => `Period: ${start} \u2014 ${end}`,
        themeToggle: "Toggle theme",
        clearCache: "Clear cache",
        projection: (pct) =>
          `Projection: ${pct}% at month end \u2014 will exceed limit at current pace`,
        waitingLimits: "Waiting for Go limits to compute billing period...",
        noPeriod: "Could not compute billing period. Open the /go page and try again.",
        prevPeriod: "Previous period",
        partial: "partial (30-day retention)",
        noPrevData: "no logs available (server retention)",
        apiError: "Request-logs API failed. Reload the page and try again.",
      },
    };
    const dict = strings[locale] || strings.en;
    return (key, ...args) => {
      const val = dict[key];
      return typeof val === "function" ? val(...args) : val;
    };
  })();
  const LIMIT_LABEL_I18N = {
    pt: { Rolling: "Uso cont\u00ednuo", Weekly: "Semanal", Monthly: "Mensal" },
    en: { Rolling: "Continuous", Weekly: "Weekly", Monthly: "Monthly" },
  };

  function getMonthKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function getPeriodKey(periodo) {
    if (!periodo) return "";
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `${fmt(periodo.inicio)}_${fmt(periodo.fim)}`;
  }

  function loadCache() {
    try {
      const raw = GM_getValue(CACHE_KEY, "");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function saveCache(cache) {
    GM_setValue(CACHE_KEY, JSON.stringify(cache));
  }

  function clearCache() {
    GM_setValue(CACHE_KEY, "");
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function addToBucket(bucket, model, cost, tIn, tOut, date) {
    bucket.total += cost;
    bucket.count++;
    bucket.tokensIn += tIn;
    bucket.tokensOut += tOut;
    bucket.byModel[model] = (bucket.byModel[model] || 0) + cost;
    bucket.tokensInByModel[model] = (bucket.tokensInByModel[model] || 0) + tIn;
    bucket.tokensOutByModel[model] = (bucket.tokensOutByModel[model] || 0) + tOut;
    if (bucket.byDay && date) {
      const day = formatDateShort(date);
      bucket.byDay[day] = (bucket.byDay[day] || 0) + cost;
    }
  }

  function addMonth(months, date, model, cost, tIn, tOut) {
    const mk = getMonthKey(date);
    if (!months[mk]) months[mk] = { total: 0, byModel: {}, byDay: {}, tokensInByModel: {}, tokensOutByModel: {}, tokensIn: 0, tokensOut: 0, count: 0 };
    const m = months[mk];
    m.total += cost;
    m.count++;
    m.tokensIn += tIn;
    m.tokensOut += tOut;
    m.byModel[model] = (m.byModel[model] || 0) + cost;
    m.tokensInByModel[model] = (m.tokensInByModel[model] || 0) + tIn;
    m.tokensOutByModel[model] = (m.tokensOutByModel[model] || 0) + tOut;
    const day = formatDateShort(date);
    m.byDay[day] = (m.byDay[day] || 0) + cost;
  }

  function getOrgId() {
    const m = location.pathname.match(/\/console\/(wrk_[^/]+)/);
    if (m) {
      try { GM_setValue(ORG_KEY, m[1]); } catch {}
      return m[1];
    }
    try { return GM_getValue(ORG_KEY, ""); } catch { return ""; }
  }

  async function fetchLogPage(sinceMs, untilMs, cursor, limit) {
    const params = new URLSearchParams();
    params.set("since", String(sinceMs));
    params.set("until", String(untilMs));
    params.set("category", "inference");
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const headers = { accept: "*/*" };
    const org = getOrgId();
    if (org) headers["x-org-id"] = org;
    let lastErr = null;
    for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${LOGS_API_PATH}?${params.toString()}`, {
          credentials: "include",
          headers,
        });
        if (res.status === 429) {
          await sleep(API_RETRY_BASE_MS * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          const err = new Error(`request-logs HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return await res.json();
      } catch (e) {
        if (e && e.status) throw e;
        lastErr = e;
        if (attempt < API_MAX_RETRIES) await sleep(API_RETRY_BASE_MS * (attempt + 1));
      }
    }
    throw lastErr || new Error("request-logs fetch failed");
  }

  async function fetchLogsWindow(sinceMs, untilMs, onPage) {
    const seen = new Set();
    let pages = 0;
    let itemCount = 0;
    let retentionDays = null;
    let hitRetention = false;
    let emptyWindows = 0;
    let oldestSeenMs = Infinity;

    let wUntil = untilMs;
    while (wUntil > sinceMs) {
      const wSince = Math.max(sinceMs, wUntil - API_WINDOW_CHUNK_MS);
      let cursor = null;
      let windowFresh = 0;
      let windowPages = 0;
      let windowAtFloor = false;

      while (true) {
        let data;
        try {
          data = await fetchLogPage(wSince, wUntil, cursor, API_PAGE_LIMIT);
        } catch (e) {
          if ((e.status === 400 || e.status === 422) && itemCount > 0) {
            console.warn(`${LOG_PREFIX}[api] window ${new Date(wSince).toISOString()}→${new Date(wUntil).toISOString()} rejected (${e.status}); assuming retention floor reached`);
            windowAtFloor = true;
            break;
          }
          throw e;
        }
        pages++;
        windowPages++;
        const batch = Array.isArray(data.items) ? data.items : [];
        const fresh = [];
        for (const it of batch) {
          const id = it.id || it.requestID;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (it.startedAt && it.startedAt < oldestSeenMs) oldestSeenMs = it.startedAt;
          fresh.push(it);
        }
        windowFresh += fresh.length;
        itemCount += fresh.length;
        if (typeof data.retentionDays === "number") retentionDays = data.retentionDays;
        if (onPage) await onPage(fresh, pages);
        if (batch.length) {
          const oldest = batch.reduce((m, b) => (b.startedAt && b.startedAt < m ? b.startedAt : m), Infinity);
          if (oldest < wSince) break;
        }
        if (!data.nextCursor) break;
        cursor = typeof data.nextCursor === "string" ? data.nextCursor : JSON.stringify(data.nextCursor);
        await sleep(API_PAGE_DELAY);
      }

      console.log(`${LOG_PREFIX}[api] window ${new Date(wSince).toISOString()} → ${new Date(wUntil).toISOString()}: fresh=${windowFresh} pages=${windowPages}${windowAtFloor ? " REJECTED(400)" : ""}`);
      if (windowAtFloor) { hitRetention = true; break; }
      if (windowFresh === 0) {
        emptyWindows++;
        if (emptyWindows >= 2) break;
      } else {
        emptyWindows = 0;
      }
      if (wSince <= sinceMs) break;
      wUntil = wSince - 1;
    }

    return { pages, itemCount, retentionDays, hitRetention, oldestSeenMs };
  }

  function saveAndDisplay(result, periodo, prevSummary = null) {
    const data = {
      total: result.total,
      byModel: result.byModel,
      byDay: result.byDay,
      tokensInByModel: result.tokensInByModel,
      tokensOutByModel: result.tokensOutByModel,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      count: result.count,
      billingStart: periodo ? periodo.inicio.toISOString() : undefined,
      billingEnd: periodo ? periodo.fim.toISOString() : undefined,
      billingPeriodKey: periodo ? getPeriodKey(periodo) : undefined,
      prevSummary: (prevSummary && periodo && prevSummary.periodo) ? {
        total: prevSummary.total,
        count: prevSummary.count,
        tokensIn: prevSummary.tokensIn,
        tokensOut: prevSummary.tokensOut,
        periodKey: prevSummary.periodKey || getPeriodKey(prevSummary.periodo),
        savedAt: prevSummary.savedAt || Date.now(),
        partial: !!prevSummary.partial,
        empty: !!prevSummary.empty,
      } : undefined,
      timestamp: Date.now(),
    };
    GM_setValue(STORAGE_KEY, JSON.stringify(data));

    const prevForPanel = prevSummary && prevSummary.periodo ? prevSummary : null;
    updatePanel(result.total, result.byModel, result.byDay,
      result.tokensInByModel, result.tokensOutByModel,
      result.tokensIn, result.tokensOut, result.count, 0, false, periodo, "", prevForPanel);
  }

  function emptyResult() {
    return {
      total: 0,
      byModel: {},
      byDay: {},
      tokensInByModel: {},
      tokensOutByModel: {},
      tokensIn: 0,
      tokensOut: 0,
      count: 0,
    };
  }

  async function scanAll(currentPeriodo, prevPeriodo) {
    const curr = emptyResult();
    const prev = { total: 0, count: 0, tokensIn: 0, tokensOut: 0, byModel: {}, tokensInByModel: {}, tokensOutByModel: {} };
    const monthsCache = {};

    console.log(`${LOG_PREFIX}[scanAll] currentPeriodo: ${currentPeriodo.inicio.toISOString()} → ${currentPeriodo.fim.toISOString()}`);
    if (prevPeriodo) console.log(`${LOG_PREFIX}[scanAll] prevPeriodo: ${prevPeriodo.inicio.toISOString()} → ${prevPeriodo.fim.toISOString()}`);

    const nowMs = Date.now();
    const untilMs = Math.min(currentPeriodo.fim.getTime(), nowMs);
    const currStartMs = currentPeriodo.inicio.getTime();
    const currEndMs = currentPeriodo.fim.getTime();
    const prevStartMs = prevPeriodo ? prevPeriodo.inicio.getTime() : 0;
    const prevEndMs = prevPeriodo ? prevPeriodo.fim.getTime() : 0;

    const classify = (it) => {
      const t = it.startedAt;
      if (!t) return;
      if (it.category && it.category !== "inference") return;
      const isGo = it.product === "go" || (typeof it.path === "string" && it.path.includes("/go/"));
      if (!isGo) return;
      const cost = typeof it.cost === "number" ? it.cost : 0;
      const model = it.model || it.requestedModel || "unknown";
      const tIn = it.inputTokens || 0;
      const tOut = (it.outputTokens || 0) + (it.reasoningTokens || 0);
      const d = new Date(t);
      if (t >= currStartMs && t <= currEndMs) {
        addToBucket(curr, model, cost, tIn, tOut, d);
        addMonth(monthsCache, d, model, cost, tIn, tOut);
      } else if (prevPeriodo && t >= prevStartMs && t <= prevEndMs) {
        addToBucket(prev, model, cost, tIn, tOut, d);
        addMonth(monthsCache, d, model, cost, tIn, tOut);
      }
    };

    const onProgress = (batch, page) => {
      batch.forEach(classify);
      const runningTotal = Object.values(curr.byModel).reduce((s, v) => s + v, 0);
      updatePanel(runningTotal, curr.byModel, curr.byDay, curr.tokensInByModel, curr.tokensOutByModel,
        curr.tokensIn, curr.tokensOut, curr.count, page, true, currentPeriodo);
    };

    const floorMs = nowMs - RETENTION_DAYS * 86400000 + API_FLOOR_SAFETY_MS;
    let sinceMs = prevPeriodo ? prevStartMs : currStartMs;
    let prevPartial = false;
    if (prevPeriodo && prevStartMs < floorMs) {
      sinceMs = floorMs;
      prevPartial = true;
      console.log(`${LOG_PREFIX}[scanAll] prev period predates retention; clamping since to ${new Date(sinceMs).toISOString()}`);
    }
    updatePanel(0, {}, {}, {}, {}, 0, 0, 0, 0, true, currentPeriodo);
    let fetched;
    try {
      fetched = await fetchLogsWindow(sinceMs, untilMs, onProgress);
    } catch (e) {
      console.error(`${LOG_PREFIX}[scanAll] fetch failed:`, e, `orgId=${getOrgId() || "MISSING"}`);
      const meta = document.getElementById("oc-meta");
      if (meta) meta.textContent = _("apiError");
      return;
    }

    if (prevPeriodo && !prevPartial && fetched.hitRetention) prevPartial = true;
    if (prevPeriodo && !prevPartial && typeof fetched.retentionDays === "number") {
      const serverFloor = nowMs - fetched.retentionDays * 86400000;
      if (prevPeriodo.inicio.getTime() < serverFloor) prevPartial = true;
    }

    console.log(`${LOG_PREFIX}[scanAll] fetched ${fetched.itemCount} items in ${fetched.pages} pages, oldest=${Number.isFinite(fetched.oldestSeenMs) ? new Date(fetched.oldestSeenMs).toISOString() : "none"}${fetched.hitRetention ? " hitRetention=true" : ""}`);

    const cache = loadCache() || { version: 1, months: {} };

    let prevSummary = null;
    if (prevPeriodo && (prev.count > 0 || prev.total > 0)) {
      const prevKey = getPeriodKey(prevPeriodo);
      prevSummary = { ...prev, periodo: prevPeriodo, periodKey: prevKey, savedAt: Date.now(), partial: prevPartial };
      console.log(`${LOG_PREFIX}[scanAll] prev TOTAL: $${prev.total.toFixed(4)} (${prev.count} reqs)${prevPartial ? " [partial]" : ""}`);
    } else if (prevPeriodo) {
      const prevKey = getPeriodKey(prevPeriodo);
      const s = cache.prevSummary;
      if (s && s.periodKey === prevKey && (s.count > 0 || s.total > 0) &&
          (Date.now() - (s.savedAt || 0)) < CACHE_MAX_AGE_MS) {
        prevSummary = { total: s.total, count: s.count, tokensIn: s.tokensIn, tokensOut: s.tokensOut,
                        periodo: prevPeriodo, periodKey: prevKey, savedAt: s.savedAt, partial: !!s.partial };
        console.log(`${LOG_PREFIX}[scanAll] prev card from cache: $${s.total.toFixed(4)} (${s.count} reqs)`);
      } else if (prevPartial) {
        prevSummary = { total: 0, count: 0, tokensIn: 0, tokensOut: 0,
                        periodo: prevPeriodo, periodKey: prevKey, savedAt: Date.now(), partial: true, empty: true };
        console.log(`${LOG_PREFIX}[scanAll] prev period has no logs in server retention window`);
      }
    }

    for (const [mk, mc] of Object.entries(monthsCache)) cache.months[mk] = mc;
    cache.billingPeriodKey = getPeriodKey(currentPeriodo);
    cache.savedAt = Date.now();
    if (prev.count > 0 || prev.total > 0) {
      cache.prevSummary = { total: prev.total, count: prev.count, tokensIn: prev.tokensIn, tokensOut: prev.tokensOut, periodKey: getPeriodKey(prevPeriodo), savedAt: Date.now(), partial: prevPartial };
    }
    saveCache(cache);

    saveAndDisplay(curr, currentPeriodo, prevSummary);
    console.log(`${LOG_PREFIX}[scanAll] done: current $${curr.total.toFixed(4)} (${curr.count} reqs) / prev $${prev.total.toFixed(4)} (${prev.count} reqs)`);
  }

  function formatDateShort(date) {
    const d = date.getDate().toString().padStart(2, "0");
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    return locale === "pt" ? `${d}/${m}` : `${m}/${d}`;
  }

  function getTheme() {
    return GM_getValue(THEME_KEY, "dark");
  }

  function setTheme(theme) {
    GM_setValue(THEME_KEY, theme);
    applyTheme(theme);
  }

  function applyTheme(theme) {
    const panel = document.getElementById("oc-go-totalizer");
    if (panel) panel.setAttribute("data-theme", theme);
    const btn = document.getElementById("oc-theme-btn");
    if (btn) btn.textContent = theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
  }

  async function scanAllPages() {
    const currentPeriodo = await ensureBillingPeriod();
    if (!currentPeriodo) {
      updatePanel(0, {}, {}, {}, {}, 0, 0, 0, 0, false, null);
      const meta = document.getElementById("oc-meta");
      if (meta) meta.textContent = _("noPeriod");
      return;
    }
    const prevPeriodo = calcPrevBillingPeriod(currentPeriodo);
    await scanAll(currentPeriodo, prevPeriodo);
  }

  function createPanel() {
    if (document.getElementById("oc-go-totalizer")) return;

    const style = GM_addStyle || ((css) => {
      const el = document.createElement("style");
      el.textContent = css;
      document.head.appendChild(el);
      return el;
    });

    style(`
      #oc-go-totalizer {
        position: sticky;
        top: 0;
        z-index: 9999;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #2a2a4a;
        border-radius: 12px;
        margin: 0 0 16px 0;
        padding: 14px 20px;
        color: #e0e0e0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.4);
        width: 100%;
        box-sizing: border-box;
      }
      #oc-go-totalizer .oc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      #oc-go-totalizer .oc-grand-total {
        font-size: 22px;
        font-weight: 700;
        color: #00d4aa;
      }
      #oc-go-totalizer .oc-meta {
        color: #888;
        font-size: 12px;
      }
      #oc-go-totalizer .oc-prev-period {
        margin-bottom: 10px;
        padding: 8px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        display: none;
      }
      #oc-go-totalizer .oc-prev-period.show { display: block; }
      #oc-go-totalizer .oc-prev-period .oc-prev-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #888;
        margin-bottom: 2px;
      }
      #oc-go-totalizer .oc-prev-period .oc-prev-line {
        font-size: 12px;
      }
      #oc-go-totalizer .oc-prev-period .oc-prev-cost {
        color: #00d4aa;
        font-weight: 600;
      }
      #oc-go-totalizer .oc-prev-period .oc-prev-sep {
        color: #555;
        margin: 0 6px;
      }
      #oc-go-totalizer[data-theme="light"] .oc-prev-period {
        background: rgba(0, 0, 0, 0.04);
      }
      #oc-go-totalizer[data-theme="light"] .oc-prev-period .oc-prev-label {
        color: #6c757d;
      }
      #oc-go-totalizer[data-theme="light"] .oc-prev-period .oc-prev-cost {
        color: #0d6efd;
      }
      #oc-go-totalizer[data-theme="light"] .oc-prev-period .oc-prev-sep {
        color: #ced4da;
      }
      #oc-go-totalizer .oc-breakdowns {
        display: flex;
        gap: 24px;
        flex-wrap: wrap;
      }
      #oc-go-totalizer .oc-breakdown {
        flex: 1;
        min-width: 180px;
      }
      #oc-go-totalizer .oc-breakdown h4 {
        margin: 0 0 4px 0;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #888;
      }
      #oc-go-totalizer .oc-breakdown-row {
        display: flex;
        justify-content: space-between;
        padding: 2px 0;
        font-size: 12px;
      }
      #oc-go-totalizer .oc-breakdown-row .oc-cost {
        color: #00d4aa;
        font-weight: 600;
      }
      #oc-go-totalizer .oc-limits {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #2a2a4a;
        font-size: 11px;
        color: #666;
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
        align-items: flex-start;
      }
      #oc-go-totalizer .oc-buttons {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      #oc-go-totalizer .oc-btn {
        padding: 6px 14px;
        border: 1px solid #00d4aa;
        background: transparent;
        color: #00d4aa;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.2s;
      }
      #oc-go-totalizer .oc-btn:hover {
        background: #00d4aa;
        color: #1a1a2e;
      }
      #oc-go-totalizer .oc-btn.scanning {
        opacity: 0.6;
        pointer-events: none;
      }
      #oc-go-totalizer .oc-btn-icon {
        padding: 4px 8px;
        font-size: 14px;
        line-height: 1;
      }
      /* Tema claro */
      #oc-go-totalizer[data-theme="light"] {
        background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
        border-color: #ced4da;
        color: #212529;
        box-shadow: 0 4px 24px rgba(0,0,0,0.1);
      }
      #oc-go-totalizer[data-theme="light"] .oc-meta {
        color: #6c757d;
      }
      #oc-go-totalizer[data-theme="light"] .oc-breakdown h4 {
        color: #6c757d;
      }
      #oc-go-totalizer[data-theme="light"] .oc-limits {
        border-top-color: #ced4da;
        color: #6c757d;
      }
      #oc-go-totalizer[data-theme="light"] .oc-btn {
        border-color: #0d6efd;
        color: #0d6efd;
      }
      #oc-go-totalizer[data-theme="light"] .oc-btn:hover {
        background: #0d6efd;
        color: #fff;
      }
      #oc-go-totalizer[data-theme="light"] .oc-grand-total {
        color: #0d6efd;
      }
      #oc-go-totalizer[data-theme="light"] .oc-breakdown-row .oc-cost {
        color: #0d6efd;
      }
      /* Barras de limites */
      #oc-go-totalizer .oc-bar-bg {
        background: #333;
        border-radius: 3px;
        height: 6px;
        overflow: hidden;
        display: flex;
      }
      #oc-go-totalizer .oc-bar-green { background: #00d4aa; }
      #oc-go-totalizer .oc-bar-yellow { background: #f0c040; }
      #oc-go-totalizer .oc-bar-red { background: #ff6b6b; }
      #oc-go-totalizer .oc-bar-gray { background: #555; opacity: 0.35; }
      #oc-go-totalizer .oc-pct-green { color: #00d4aa; }
      #oc-go-totalizer .oc-pct-yellow { color: #f0c040; }
      #oc-go-totalizer .oc-pct-red { color: #ff6b6b; }
      #oc-go-totalizer .oc-reset-text { color: #666; }
      #oc-go-totalizer .oc-projection-text { color: #ff6b6b; }
      /* Barras no tema claro */
      #oc-go-totalizer[data-theme="light"] .oc-bar-bg { background: #ced4da; }
      #oc-go-totalizer[data-theme="light"] .oc-bar-green { background: #198754; }
      #oc-go-totalizer[data-theme="light"] .oc-bar-yellow { background: #ffc107; }
      #oc-go-totalizer[data-theme="light"] .oc-bar-red { background: #dc3545; }
      #oc-go-totalizer[data-theme="light"] .oc-bar-gray { background: #adb5bd; opacity: 0.5; }
      #oc-go-totalizer[data-theme="light"] .oc-pct-green { color: #198754; }
      #oc-go-totalizer[data-theme="light"] .oc-pct-yellow { color: #d97706; }
      #oc-go-totalizer[data-theme="light"] .oc-pct-red { color: #dc3545; }
      #oc-go-totalizer[data-theme="light"] .oc-reset-text { color: #6c757d; }
      #oc-go-totalizer[data-theme="light"] .oc-projection-text { color: #dc3545; }
    `);

    const panel = document.createElement("div");
    panel.id = "oc-go-totalizer";
    panel.setAttribute("data-theme", getTheme());
    panel.innerHTML = `
      <div class="oc-header">
        <div>
          <div class="oc-grand-total" id="oc-grand-total">---</div>
          <div class="oc-meta" id="oc-meta"></div>
        </div>
        <button class="oc-btn oc-btn-icon" id="oc-theme-btn" title="${_("themeToggle")}">${getTheme() === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}</button>
      </div>
      <div class="oc-prev-period" id="oc-prev-period"></div>
      <div class="oc-breakdowns">
        <div class="oc-breakdown">
          <h4>${_("byModel")}</h4>
          <div id="oc-by-model"></div>
        </div>
        <div class="oc-breakdown">
          <h4>${_("byDay")}</h4>
          <div id="oc-by-day"></div>
        </div>
      </div>
      <div class="oc-limits" id="oc-limits"></div>
      <div class="oc-buttons">
        <button class="oc-btn" id="oc-scan-btn">${_("scanBtn")}</button>
        <button class="oc-btn" id="oc-reset-btn">${_("resetBtn")}</button>
      </div>
    `;

    const table = document.querySelector("#app table");
    if (table) {
      const holder = table.closest("div") || table;
      if (holder.parentNode) holder.parentNode.insertBefore(panel, holder);
    }
  }

  function waitForTable(timeoutMs) {
    return new Promise((resolve) => {
      if (document.querySelector("#app table")) { resolve(true); return; }
      const start = Date.now();
      const iv = setInterval(() => {
        if (document.querySelector("#app table")) { clearInterval(iv); resolve(true); }
        else if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(false); }
      }, 300);
    });
  }

  function updatePanel(total, byModel, byDay, tokensInByModel, tokensOutByModel, tokensIn, tokensOut, count, pageNum, scanning, periodo, monthLabel = "", prevSummary = null) {
    createPanel();
    if (!document.getElementById("oc-grand-total")) return;

    const prevEl = document.getElementById("oc-prev-period");
    if (prevEl) {
      if (prevSummary && typeof prevSummary.total === "number") {
        const prevPeriodo = prevSummary.periodo || calcPrevBillingPeriod(periodo);
        const periodTxt = prevPeriodo ? `${formatDateShort(prevPeriodo.inicio)} \u2014 ${formatDateShort(prevPeriodo.fim)}` : "";
        const line = prevSummary.empty
          ? `<span style="color:#888">${_("noPrevData")}</span>`
          : `<span class="oc-prev-cost">$${prevSummary.total.toFixed(2)}</span>`
          + `<span class="oc-prev-sep">\u00b7</span>${prevSummary.count.toLocaleString()} ${_("requests")}`
          + `<span class="oc-prev-sep">\u00b7</span>${prevSummary.tokensIn.toLocaleString()} ${_("_in")} / ${prevSummary.tokensOut.toLocaleString()} ${_("_out")}`
          + (prevSummary.partial ? `<span class="oc-prev-sep">\u00b7</span><span style="color:#f0c040">${_("partial")}</span>` : "");
        prevEl.innerHTML = `<div class="oc-prev-label">${_("prevPeriod")}: ${periodTxt}</div><div class="oc-prev-line">${line}</div>`;
        prevEl.classList.add("show");
      } else {
        prevEl.innerHTML = "";
        prevEl.classList.remove("show");
      }
    }

    const modelEntries = Object.entries(byModel).sort((a, b) => b[1] - a[1]);
    const dayEntries = Object.entries(byDay).sort((a, b) => b[1] - a[1]).slice(0, modelEntries.length);

    document.getElementById("oc-grand-total").textContent = `$${total.toFixed(2)}`;
    const metaParts = [];
    if (periodo) {
      metaParts.push(_("billingPeriod", formatDateShort(periodo.inicio), formatDateShort(periodo.fim)));
    }
    const progressParts = [];
    if (monthLabel) progressParts.push(monthLabel);
    if (scanning && pageNum > 0) progressParts.push(`${_("scanningPage")} ${pageNum}`);
    if (progressParts.length > 0) {
      metaParts.push(`${count} ${_("requests")} - ${progressParts.join(" - ")}...`);
    } else {
      metaParts.push(`${count} ${_("requests")} | ${_("allPages")}`);
    }
    metaParts.push(`${_("tokens")}: ${tokensIn.toLocaleString()} ${_("_in")} / ${tokensOut.toLocaleString()} ${_("_out")}`);
    document.getElementById("oc-meta").textContent = metaParts.join(" | ");

    document.getElementById("oc-by-model").innerHTML = modelEntries
      .map(([m, c]) => {
        const tIn = (tokensInByModel[m] || 0).toLocaleString();
        const tOut = (tokensOutByModel[m] || 0).toLocaleString();
        return `<div class="oc-breakdown-row">
          <span><strong>${m}</strong> <span style="color:#888;font-size:10px">${_("_in")}:${tIn} ${_("_out")}:${tOut}</span></span>
          <span class="oc-cost">$${c.toFixed(2)}</span>
        </div>`;
      })
      .join("");

    document.getElementById("oc-by-day").innerHTML = dayEntries
      .map(([d, c]) => `<div class="oc-breakdown-row"><span>${d}</span><span class="oc-cost">$${c.toFixed(2)}</span></div>`)
      .join("");

    refreshPanelLimits();

    document.getElementById("oc-scan-btn").onclick = () => {
      const btn = document.getElementById("oc-scan-btn");
      btn.textContent = _("scanningBtn");
      btn.classList.add("scanning");
      scanAllPages().finally(() => {
        btn.textContent = _("scanBtn");
        btn.classList.remove("scanning");
      });
    };

    document.getElementById("oc-reset-btn").onclick = async () => {
      GM_setValue(STORAGE_KEY, "");
      clearCache();
      await scanAllPages();
    };

    document.getElementById("oc-theme-btn").onclick = () => {
      const current = getTheme();
      const next = current === "dark" ? "light" : "dark";
      setTheme(next);
    };
  }

  function parseResetTitle(title) {
    if (!title) return null;
    const m = title.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    const pt = (navigator.language || "").startsWith("pt");
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else if (pt) { day = a; month = b; }
    else { month = a; day = b; }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let hour = parseInt(m[4], 10);
    if (/pm/i.test(title) && hour < 12) hour += 12;
    if (/am/i.test(title) && hour === 12) hour = 0;
    const d = new Date(y, month - 1, day, hour, parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0, 0);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  function parseLimitsFromDoc(doc) {
    const bars = doc.querySelectorAll('[role="progressbar"][aria-label]');
    if (!bars.length) return null;

    const limits = [];
    bars.forEach((bar) => {
      const aria = (bar.getAttribute("aria-label") || "").trim();
      const m = aria.match(/^(.+?)\s+usage$/i);
      if (!m) return;
      const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      const pct = Math.min(Math.max(parseInt(bar.getAttribute("aria-valuenow") || "0", 10) || 0, 0), 100);
      let reset = "";
      let resetAt = null;
      const block = (bar.parentElement && bar.parentElement.parentElement) || bar.parentElement || doc;
      const spans = block.querySelectorAll("span[title]");
      for (const sp of spans) {
        const txt = (sp.textContent || "").trim();
        if (/reset|redefin|reinici|ends in|expira/i.test(txt)) {
          reset = txt;
          resetAt = parseResetTitle(sp.getAttribute("title") || "");
          break;
        }
      }
      limits.push({ label: name, pct, reset, resetAt });
    });

    return limits.length ? limits : null;
  }

  function loadStoredData(periodo) {
    try {
      const raw = GM_getValue(STORAGE_KEY, "");
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.total !== "number") return null;
      if (data.billingEnd && new Date(data.billingEnd) < new Date()) {
        return null;
      }
      if (periodo) {
        const currentKey = getPeriodKey(periodo);
        if (data.billingPeriodKey) {
          if (data.billingPeriodKey !== currentKey) return null;
        } else if (data.billingStart && data.billingEnd) {
          // legacy: compare local calendar days from stored ISO
          const s = new Date(data.billingStart);
          const e = new Date(data.billingEnd);
          const legacyKey = getPeriodKey({ inicio: s, fim: e });
          if (legacyKey !== currentKey) return null;
        } else {
          return null;
        }
      }
      return data;
    } catch {
      return null;
    }
  }

  function isGoPage() {
    return /\/console\/[^/]+\/go(\?.*)?(#.*)?$/.test(location.pathname + location.search + location.hash);
  }

  function isUsagePage() {
    return /\/console\/[^/]+\/logs(\?.*)?(#.*)?$/.test(location.pathname + location.search + location.hash);
  }

  function captureLimitsFromPage() {
    const limits = parseLimitsFromDoc(document);
    if (!limits || limits.length === 0) return false;
    GM_setValue(LIMITS_STORAGE_KEY, JSON.stringify({ limits, ts: Date.now() }));
    console.log(`${LOG_PREFIX}[go] limits captured: ${limits.map((l) => `${l.label} ${l.pct}% (reset=${l.reset || "?"}${l.resetAt ? " @" + new Date(l.resetAt).toISOString() : ""})`).join(" | ")}`);
    return true;
  }

  function getCachedLimits() {
    const raw = GM_getValue(LIMITS_STORAGE_KEY, "");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.limits && parsed.limits.length > 0) return parsed.limits;
      return null;
    } catch {
      return null;
    }
  }

  function getCachedLimitsFull() {
    const raw = GM_getValue(LIMITS_STORAGE_KEY, "");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.limits && parsed.limits.length > 0) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  function parseRemainingDays(resetText) {
    if (!resetText) return 0;
    const dm = resetText.match(/(\d+)\s*(?:d\b|days?\b|dias?\b|tage?\b|jours?\b)/i);
    const hm = resetText.match(/(\d+)\s*(?:h\b|hrs?\b|hours?\b|horas?\b|heures?\b|stunde?n?\b)/i);
    const mm = resetText.match(/(\d+)\s*(?:m\b|mins?\b|minutes?\b|minutos?\b)/i);
    const days = dm ? parseInt(dm[1], 10) : 0;
    const hours = hm ? parseInt(hm[1], 10) : 0;
    const mins = mm ? parseInt(mm[1], 10) : 0;
    return days + hours / 24 + mins / 1440;
  }

  function calcBillingPeriod() {
    const cache = getCachedLimitsFull();
    if (!cache) return null;
    const monthly = cache.limits.find((l) => /mensal|monthly/i.test(l.label));
    if (!monthly) return null;

    const now = Date.now();

    if (monthly.resetAt && monthly.resetAt > (cache.ts || 0) - 60000) {
      let r = new Date(monthly.resetAt);
      for (let i = 0; i < 12 && r.getTime() <= now; i++) {
        r = new Date(r.getFullYear(), r.getMonth() + 1, r.getDate(), r.getHours(), r.getMinutes(), r.getSeconds(), r.getMilliseconds());
      }
      if (r.getTime() > now) {
        const fim = r;
        const inicio = new Date(fim.getFullYear(), fim.getMonth() - 1, fim.getDate(), fim.getHours(), fim.getMinutes(), fim.getSeconds(), fim.getMilliseconds());
        return { inicio, fim };
      }
    }

    const remainingDays = parseRemainingDays(monthly.reset);
    if (!remainingDays || remainingDays <= 0) return null;

    const ts = cache.ts || now;
    const resetMs = ts + remainingDays * 86400000;
    if (resetMs <= now) return null;

    const resetMoment = new Date(resetMs);
    const resetDay = new Date(resetMoment.getFullYear(), resetMoment.getMonth(), resetMoment.getDate());
    const periodoInicio = new Date(resetDay.getFullYear(), resetDay.getMonth() - 1, resetDay.getDate(), 0, 0, 0, 0);
    const periodoFim = new Date(resetDay.getFullYear(), resetDay.getMonth(), resetDay.getDate(), 23, 59, 59, 999);

    return { inicio: periodoInicio, fim: periodoFim };
  }

  async function ensureBillingPeriod() {
    const periodo = calcBillingPeriod();
    if (periodo) return periodo;
    const cached = getCachedLimitsFull();
    console.warn(`${LOG_PREFIX}[period] no usable Go limits cache.`,
      cached
        ? `cache: ts=${new Date(cached.ts || 0).toISOString()} age=${Math.round((Date.now() - (cached.ts || 0)) / 60000)}min labels=[${(cached.limits || []).map((l) => l.label).join(",")}]`
        : "cache: EMPTY",
      "— open the /console/.../go tab and leave it visible for a few seconds (the script captures automatically).");
    return null;
  }

  function calcPrevBillingPeriod(periodo) {
    if (!periodo) return null;
    const i = periodo.inicio;
    const prevInicio = new Date(i.getFullYear(), i.getMonth() - 1, i.getDate(), i.getHours(), i.getMinutes(), i.getSeconds(), i.getMilliseconds());
    return { inicio: prevInicio, fim: new Date(i.getTime() - 1) };
  }

  function renderLimits(limits) {
    if (!limits || limits.length === 0) {
      return `<span class="oc-limits-info">${_("fallbackLimits")}</span>`;
    }

    return limits
      .map((l) => {
        let colorClass, extra = "";
        const translatedLabel = (LIMIT_LABEL_I18N[locale] || {})[l.label] || l.label;

        if (l.pct < 50) colorClass = "oc-pct-green";
        else if (l.pct < 80) colorClass = "oc-pct-yellow";
        else colorClass = "oc-pct-red";

        const isMonthly = /mensal|monthly/i.test(l.label);
        let barHTML = "";

        if (isMonthly && l.pct > 0) {
          const remaining = parseRemainingDays(l.reset);
          const elapsed = Math.max(30 - remaining, 0.5);
          const idealPct = Math.round((elapsed / 30) * 100);
          const projPct = Math.round((l.pct / elapsed) * 30);

          const safePct = Math.min(l.pct, idealPct);
          const excessPct = Math.max(0, l.pct - idealPct);
          const grayPct = Math.max(0, idealPct - l.pct);

          let safeColorClass;
          if (idealPct < 50) safeColorClass = "oc-bar-green";
          else if (idealPct < 80) safeColorClass = "oc-bar-yellow";
          else safeColorClass = "oc-bar-red";

          const segments = [];
          if (safePct > 0) {
            const isOnlySegment = excessPct === 0 && grayPct === 0;
            segments.push(`<div style="width:${safePct}%;height:100%;border-radius:${isOnlySegment ? "3px" : "3px 0 0 3px"};transition:width .3s" class="${safeColorClass}"></div>`);
          }
          if (excessPct > 0) {
            const borderRadius = safePct === 0 ? "3px" : "0 3px 3px 0";
            segments.push(`<div style="width:${excessPct}%;height:100%;border-radius:${borderRadius};transition:width .3s" class="oc-bar-red"></div>`);
          }
          if (grayPct > 0) {
            const borderRadius = safePct === 0 ? "3px" : "0 3px 3px 0";
            segments.push(`<div style="width:${grayPct}%;height:100%;border-radius:${borderRadius};transition:width .3s" class="oc-bar-gray"></div>`);
          }

          barHTML = `<div class="oc-bar-bg">${segments.join("")}</div>`;

          if (projPct >= 100) {
            extra = `<div style="font-size:10px;margin-top:2px" class="oc-projection-text">${_("projection", projPct)}</div>`;
          }
        } else {
          barHTML = `<div class="oc-bar-bg"><div style="width:${l.pct}%;height:100%;border-radius:3px;transition:width .3s" class="${colorClass.replace("oc-pct", "oc-bar")}"></div></div>`;
        }

        return `<div style="flex:1;min-width:140px">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
            <span>${translatedLabel}</span><span class="${colorClass}" style="font-weight:600">${l.pct}%</span>
          </div>
          ${barHTML}
          <div style="font-size:10px;margin-top:2px" class="oc-reset-text">${l.reset}</div>
          ${extra}
        </div>`;
      })
      .join("");
  }

  function refreshPanelLimits() {
    const limitsEl = document.getElementById("oc-limits");
    if (!limitsEl) return;
    limitsEl.innerHTML = renderLimits(getCachedLimits());
  }

  let logsBooted = false;
  let usageBootBusy = false;
  let goCaptured = false;
  let lastGoCaptureAt = 0;

  async function bootUsagePage() {
    if (usageBootBusy) return;
    usageBootBusy = true;
    try {
      if (!(await waitForTable(15000))) { logsBooted = false; return; }

      createPanel();
      const metaEl = document.getElementById("oc-meta");
      if (metaEl) metaEl.textContent = _("waitingLimits");

      const periodo = await ensureBillingPeriod();
      if (!periodo) {
        updatePanel(0, {}, {}, {}, {}, 0, 0, 0, 0, false, null);
        const meta = document.getElementById("oc-meta");
        if (meta) meta.textContent = _("noPeriod");
        refreshPanelLimits();
        return;
      }

      const stored = loadStoredData(periodo);
      if (stored) {
        const prevSummaryForPanel = hydratePrevSummary(periodo, stored);
        updatePanel(
          stored.total,
          stored.byModel || {},
          stored.byDay || {},
          stored.tokensInByModel || {},
          stored.tokensOutByModel || {},
          stored.tokensIn || 0,
          stored.tokensOut || 0,
          stored.count || 0,
          0,
          false,
          periodo,
          "",
          prevSummaryForPanel
        );
        refreshPanelLimits();
        return;
      }

      await scanAllPages();
      refreshPanelLimits();
    } finally {
      usageBootBusy = false;
    }
  }

  function routeTick() {
    if (isGoPage()) {
      const now = Date.now();
      if (!goCaptured || now - lastGoCaptureAt > 10000) {
        if (captureLimitsFromPage()) {
          goCaptured = true;
          lastGoCaptureAt = now;
        }
      }
      return;
    }
    if (isUsagePage()) {
      const panelAlive = document.getElementById("oc-go-totalizer") !== null;
      if ((!logsBooted || !panelAlive) && !usageBootBusy) {
        logsBooted = true;
        bootUsagePage();
      }
    }
  }

  function start() {
    routeTick();
    setInterval(routeTick, 1000);
  }

  function hydratePrevSummary(periodo, stored) {
    const prevPeriodo = calcPrevBillingPeriod(periodo);
    if (!prevPeriodo) return null;
    const prevKey = getPeriodKey(prevPeriodo);

    const usable = (s) => s && s.periodKey === prevKey && !s.skipped && (s.count > 0 || s.total > 0 || s.empty);

    if (stored && usable(stored.prevSummary)) {
      return {
        total: stored.prevSummary.total,
        count: stored.prevSummary.count,
        tokensIn: stored.prevSummary.tokensIn,
        tokensOut: stored.prevSummary.tokensOut,
        periodo: prevPeriodo,
        partial: !!stored.prevSummary.partial,
        empty: !!stored.prevSummary.empty,
      };
    }

    const cache = loadCache();
    if (cache && usable(cache.prevSummary) &&
        (Date.now() - (cache.prevSummary.savedAt || 0)) < CACHE_MAX_AGE_MS) {
      return {
        total: cache.prevSummary.total,
        count: cache.prevSummary.count,
        tokensIn: cache.prevSummary.tokensIn,
        tokensOut: cache.prevSummary.tokensOut,
        periodo: prevPeriodo,
        partial: !!cache.prevSummary.partial,
      };
    }

    return null;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(start, 500));
  } else {
    setTimeout(start, 500);
  }
})();
