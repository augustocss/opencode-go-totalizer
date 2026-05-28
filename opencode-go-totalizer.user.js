// ==UserScript==
// @name         OpenCode Go Usage Totalizer
// @namespace    https://github.com/augustocss/opencode-go-totalizer
// @version      1.3
// @description  Aggregate cost/token usage from the OpenCode Go table with breakdowns by model/day and real-time Go limit tracking. / Totalizador de credito/uso do OpenCode Go.
// @author       augustocss
// @match        https://opencode.ai/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "oc_go_totalizer";
  const LIMITS_STORAGE_KEY = "oc_go_limits";
  const THEME_KEY = "oc_go_theme";
  const TABLE_SELECTOR = '[data-slot="usage-table-element"]';
  const PAGINATION_SELECTOR = '[data-slot="pagination"]';
  const MONTH_PICKER_SELECTOR = '[data-slot="month-picker"]';
  const MONTH_BUTTON_SELECTOR = '[data-slot="month-button"]';
  const MONTH_LABEL_SELECTOR = '[data-slot="month-label"]';
  const PAGE_SCAN_DELAY = 1200;
  let monthOffset = 0;

  const locale = (navigator.language || "").startsWith("pt") ? "pt" : "en";
  const _ = (() => {
    const strings = {
      pt: {
        byModel: "Por modelo",
        byDay: "Top dias",
        scanBtn: "Escanear todas as p\u00e1ginas",
        scanningBtn: "Escaneando...",
        resetBtn: "Resetar",
        requests: "requisi\u00e7\u00f5es",
        scanningPage: "Escaneando p\u00e1gina",
        allPages: "Todas as p\u00e1ginas",
        tokens: "Tokens",
        _in: "in",
        _out: "out",
        fallbackLimits: "Limites Go: 5h $12 \u00b7 Semanal $30 \u00b7 Mensal $60",
        scanningMonth: "Escaneando m\u00eas",
        billingPeriod: (start, end) => `Per\u00edodo: ${start} \u2014 ${end}`,
        themeToggle: "Alternar tema",
        projection: (pct) =>
          `Proje\u00e7\u00e3o: ${pct}% no fim do m\u00eas \u2014 vai estourar o limite no ritmo atual`,
      },
      en: {
        byModel: "By model",
        byDay: "Top days",
        scanBtn: "Scan all pages",
        scanningBtn: "Scanning...",
        resetBtn: "Reset",
        requests: "requests",
        scanningPage: "Scanning page",
        allPages: "All pages",
        tokens: "Tokens",
        _in: "in",
        _out: "out",
        fallbackLimits: "Go limits: 5h $12 \u00b7 Weekly $30 \u00b7 Monthly $60",
        scanningMonth: "Scanning month",
        billingPeriod: (start, end) => `Period: ${start} \u2014 ${end}`,
        themeToggle: "Toggle theme",
        projection: (pct) =>
          `Projection: ${pct}% at month end \u2014 will exceed limit at current pace`,
      },
    };
    const dict = strings[locale] || strings.en;
    return (key, ...args) => {
      const val = dict[key];
      return typeof val === "function" ? val(...args) : val;
    };
  })();
  const limitLabels = {
    "Uso Cont\u00ednuo": locale === "en" ? "Continuous Usage" : undefined,
    Semanal: locale === "en" ? "Weekly" : undefined,
    Mensal: locale === "en" ? "Monthly" : undefined,
  };

  function parseCost(text) {
    const m = text.match(/Go\s*\(\$([\d.]+)\)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function parseDate(cell) {
    const title = cell.getAttribute("title") || "";
    const m = title.match(/(\d{1,2}\s+de\s+\w+\.)/);
    return m ? m[1] : cell.textContent.trim();
  }

  function parseModel(cell) {
    return cell.textContent.trim();
  }

  function parseTokens(cell) {
    const span = cell.querySelector("span");
    return span ? parseInt(span.textContent.trim(), 10) || 0 : 0;
  }

  function scanCurrentPage(periodo) {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return null;

    const rows = table.querySelectorAll("tbody tr");
    const result = {
      total: 0,
      byModel: {},
      byDay: {},
      tokensInByModel: {},
      tokensOutByModel: {},
      tokensIn: 0,
      tokensOut: 0,
      count: 0,
    };

    rows.forEach((tr) => {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 5) return;

      const dateCell = tds[0];
      const modelCell = tds[1];
      const tokensInCell = tds[2];
      const tokensOutCell = tds[3];
      const costCell = tds[4];

      if (periodo) {
        const rowDate = parseRowDate(dateCell);
        if (!rowDate || rowDate < periodo.inicio || rowDate > periodo.fim) return;
      }

      const cost = parseCost(costCell.textContent);
      const model = parseModel(modelCell);
      const day = parseDate(dateCell);
      const tIn = parseTokens(tokensInCell);
      const tOut = parseTokens(tokensOutCell);

      result.total += cost;
      result.byModel[model] = (result.byModel[model] || 0) + cost;
      result.tokensInByModel[model] = (result.tokensInByModel[model] || 0) + tIn;
      result.tokensOutByModel[model] = (result.tokensOutByModel[model] || 0) + tOut;
      result.byDay[day] = (result.byDay[day] || 0) + cost;
      result.tokensIn += tIn;
      result.tokensOut += tOut;
      result.count++;
    });

    return result;
  }

  function hasNextPage() {
    const pag = document.querySelector(PAGINATION_SELECTOR);
    if (!pag) return false;
    const buttons = pag.querySelectorAll("button");
    if (buttons.length < 2) return false;
    return !buttons[1].disabled;
  }

  function clickNextPage() {
    const pag = document.querySelector(PAGINATION_SELECTOR);
    if (!pag) return false;
    const buttons = pag.querySelectorAll("button");
    if (buttons.length < 2 || buttons[1].disabled) return false;
    buttons[1].click();
    return true;
  }

  function waitForTableChange() {
    return new Promise((resolve) => {
      const initialRows = document.querySelectorAll(
        TABLE_SELECTOR + " tbody tr"
      ).length;
      let attempts = 0;
      const maxAttempts = 30;
      const interval = setInterval(() => {
        attempts++;
        const currentRows = document.querySelectorAll(
          TABLE_SELECTOR + " tbody tr"
        ).length;
        const pag = document.querySelector(PAGINATION_SELECTOR);
        const nextBtn = pag ? pag.querySelectorAll("button")[1] : null;
        const nextEnabled = nextBtn && !nextBtn.disabled;
        const tableChanged = currentRows !== initialRows;

        if ((tableChanged && nextEnabled) || !nextBtn || attempts >= maxAttempts) {
          clearInterval(interval);
          setTimeout(resolve, 400);
        }
      }, 200);
    });
  }

  async function scanAllPagesRaw(periodo) {
    let grandTotal = 0;
    const grandByModel = {};
    const grandByDay = {};
    const grandTokensInByModel = {};
    const grandTokensOutByModel = {};
    let grandTokensIn = 0;
    let grandTokensOut = 0;
    let grandCount = 0;
    let pageNum = 0;
    const seen = new Set();

    while (true) {
      pageNum++;
      const result = scanCurrentPage(periodo);
      if (!result) break;

      const key = `${result.count}-${result.total.toFixed(4)}`;
      if (seen.has(key)) {
        if (!clickNextPage()) break;
        await new Promise((r) => setTimeout(r, PAGE_SCAN_DELAY));
        continue;
      }
      seen.add(key);

      grandTotal += result.total;
      for (const [m, c] of Object.entries(result.byModel)) {
        grandByModel[m] = (grandByModel[m] || 0) + c;
      }
      for (const [m, t] of Object.entries(result.tokensInByModel)) {
        grandTokensInByModel[m] = (grandTokensInByModel[m] || 0) + t;
      }
      for (const [m, t] of Object.entries(result.tokensOutByModel)) {
        grandTokensOutByModel[m] = (grandTokensOutByModel[m] || 0) + t;
      }
      for (const [d, c] of Object.entries(result.byDay)) {
        grandByDay[d] = (grandByDay[d] || 0) + c;
      }
      grandTokensIn += result.tokensIn;
      grandTokensOut += result.tokensOut;
      grandCount += result.count;

      updatePanel(grandTotal, grandByModel, grandByDay, grandTokensInByModel, grandTokensOutByModel, grandTokensIn, grandTokensOut, grandCount, pageNum, true, periodo);

      if (!hasNextPage()) break;
      clickNextPage();
      await waitForTableChange();
      await new Promise((r) => setTimeout(r, PAGE_SCAN_DELAY));
    }

    return { total: grandTotal, byModel: grandByModel, byDay: grandByDay, tokensInByModel: grandTokensInByModel, tokensOutByModel: grandTokensOutByModel, tokensIn: grandTokensIn, tokensOut: grandTokensOut, count: grandCount };
  }

  function saveAndDisplay(result, periodo) {
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
      timestamp: Date.now(),
    };
    GM_setValue(STORAGE_KEY, JSON.stringify(data));
    updatePanel(result.total, result.byModel, result.byDay,
      result.tokensInByModel, result.tokensOutByModel,
      result.tokensIn, result.tokensOut, result.count, 0, false, periodo);
  }

  async function scanBillingPeriod() {
    const periodo = calcBillingPeriod();

    if (!periodo) {
      // Fallback: scan sem filtro de período
      const result = await scanAllPagesRaw(null);
      saveAndDisplay(result, null);
      returnToFirstPage();
      return;
    }

    const crossesMonth = periodo.inicio.getMonth() !== periodo.fim.getMonth() || periodo.inicio.getFullYear() !== periodo.fim.getFullYear();
    const originalMonthOffset = monthOffset;

    let grandTotal = 0;
    const grandByModel = {};
    const grandByDay = {};
    const grandTokensInByModel = {};
    const grandTokensOutByModel = {};
    let grandTokensIn = 0;
    let grandTokensOut = 0;
    let grandCount = 0;

    if (!crossesMonth) {
      const result = await scanAllPagesRaw(periodo);
      grandTotal = result.total;
      Object.assign(grandByModel, result.byModel);
      Object.assign(grandByDay, result.byDay);
      Object.assign(grandTokensInByModel, result.tokensInByModel);
      Object.assign(grandTokensOutByModel, result.tokensOutByModel);
      grandTokensIn = result.tokensIn;
      grandTokensOut = result.tokensOut;
      grandCount = result.count;
    } else {
      const startMonth = periodo.inicio.getMonth();
      const startYear = periodo.inicio.getFullYear();

      // Navegar para o mês mais antigo
      for (let i = 0; i < 3; i++) {
        const currentView = getCurrentViewMonth();
        if (currentView.getMonth() === startMonth && currentView.getFullYear() === startYear) break;
        if (!clickPrevMonth()) break;
        await waitForMonthChange(document.querySelector(MONTH_LABEL_SELECTOR)?.textContent?.trim());
      }

      // Scan do mês antigo
      const olderResult = await scanAllPagesRaw(periodo);
      grandTotal += olderResult.total;
      for (const [m, c] of Object.entries(olderResult.byModel)) grandByModel[m] = (grandByModel[m] || 0) + c;
      for (const [m, t] of Object.entries(olderResult.tokensInByModel)) grandTokensInByModel[m] = (grandTokensInByModel[m] || 0) + t;
      for (const [m, t] of Object.entries(olderResult.tokensOutByModel)) grandTokensOutByModel[m] = (grandTokensOutByModel[m] || 0) + t;
      for (const [d, c] of Object.entries(olderResult.byDay)) grandByDay[d] = (grandByDay[d] || 0) + c;
      grandTokensIn += olderResult.tokensIn;
      grandTokensOut += olderResult.tokensOut;
      grandCount += olderResult.count;

      // Navegar para o mês mais recente
      clickNextMonth();
      await waitForMonthChange(document.querySelector(MONTH_LABEL_SELECTOR)?.textContent?.trim());

      // Scan do mês novo
      const newerResult = await scanAllPagesRaw(periodo);
      grandTotal += newerResult.total;
      for (const [m, c] of Object.entries(newerResult.byModel)) grandByModel[m] = (grandByModel[m] || 0) + c;
      for (const [m, t] of Object.entries(newerResult.tokensInByModel)) grandTokensInByModel[m] = (grandTokensInByModel[m] || 0) + t;
      for (const [m, t] of Object.entries(newerResult.tokensOutByModel)) grandTokensOutByModel[m] = (grandTokensOutByModel[m] || 0) + t;
      for (const [d, c] of Object.entries(newerResult.byDay)) grandByDay[d] = (grandByDay[d] || 0) + c;
      grandTokensIn += newerResult.tokensIn;
      grandTokensOut += newerResult.tokensOut;
      grandCount += newerResult.count;
    }

    // Voltar ao mês original
    while (monthOffset !== originalMonthOffset) {
      if (monthOffset < originalMonthOffset) {
        if (!clickNextMonth()) break;
      } else {
        if (!clickPrevMonth()) break;
      }
      await waitForMonthChange(document.querySelector(MONTH_LABEL_SELECTOR)?.textContent?.trim());
    }

    saveAndDisplay({
      total: grandTotal,
      byModel: grandByModel,
      byDay: grandByDay,
      tokensInByModel: grandTokensInByModel,
      tokensOutByModel: grandTokensOutByModel,
      tokensIn: grandTokensIn,
      tokensOut: grandTokensOut,
      count: grandCount
    }, periodo);
    returnToFirstPage();
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
    return scanBillingPeriod();
  }

  function returnToFirstPage() {
    const pag = document.querySelector(PAGINATION_SELECTOR);
    if (!pag) return;
    const buttons = pag.querySelectorAll("button");
    if (buttons.length > 0) {
      let maxClicks = 50;
      const clickPrev = () => {
        if (maxClicks-- <= 0) return;
        const prevBtn = pag.querySelectorAll("button")[0];
        if (prevBtn && !prevBtn.disabled) {
          prevBtn.click();
          setTimeout(clickPrev, 600);
        }
      };
      clickPrev();
    }
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

    const container = document.querySelector('[data-slot="usage-table"]');
    if (container) {
      container.parentNode.insertBefore(panel, container);
    } else {
      const table = document.querySelector(TABLE_SELECTOR);
      if (table) {
        table.parentNode.insertBefore(panel, table);
      }
    }
  }

  function updatePanel(total, byModel, byDay, tokensInByModel, tokensOutByModel, tokensIn, tokensOut, count, pageNum, scanning, periodo) {
    createPanel();

    const modelEntries = Object.entries(byModel).sort((a, b) => b[1] - a[1]);
    const dayEntries = Object.entries(byDay).sort((a, b) => b[1] - a[1]).slice(0, modelEntries.length);

    document.getElementById("oc-grand-total").textContent = `$${total.toFixed(2)}`;
    const metaParts = [];
    if (periodo) {
      metaParts.push(_("billingPeriod", formatDateShort(periodo.inicio), formatDateShort(periodo.fim)));
    }
    metaParts.push(`${count} ${_("requests")}` + (scanning ? ` | ${_("scanningPage")} ${pageNum}...` : ` | ${_("allPages")}`));
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

    document.getElementById("oc-reset-btn").onclick = () => {
      GM_setValue(STORAGE_KEY, "");
      const periodo = calcBillingPeriod();
      const r = scanCurrentPage(periodo);
      if (r) {
        updatePanel(r.total, r.byModel, r.byDay, r.tokensInByModel, r.tokensOutByModel, r.tokensIn, r.tokensOut, r.count, 0, false, periodo);
      }
    };

    document.getElementById("oc-theme-btn").onclick = () => {
      const current = getTheme();
      const next = current === "dark" ? "light" : "dark";
      setTheme(next);
    };
  }

  function parseLimitsFromDoc(doc) {
    const items = doc.querySelectorAll('[data-slot="usage-item"]');
    if (items.length === 0) return null;

    const limits = [];
    items.forEach((item) => {
      const label = item.querySelector('[data-slot="usage-label"]')?.textContent?.trim() || "";
      const value = item.querySelector('[data-slot="usage-value"]')?.textContent?.trim() || "";
      const pct = Math.min(parseFloat(value) || 0, 100);
      const bar = item.querySelector('[data-slot="progress-bar"]');
      const barPct = bar ? parseFloat(bar.style.width) || pct : pct;
      const reset = item.querySelector('[data-slot="reset-time"]')?.textContent?.replace(/<!--[^>]*-->/g, "").trim() || "";

      limits.push({ label, pct: Math.round(barPct), reset });
    });

    return limits;
  }

  function extractResetInSec(doc) {
    const scripts = doc.querySelectorAll("script:not([src])");
    for (const s of scripts) {
      const text = s.textContent;
      const m = text.match(/monthlyUsage[^}]*resetInSec:\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  function loadStoredData() {
    try {
      const raw = GM_getValue(STORAGE_KEY, "");
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && typeof data.total === "number") {
        if (data.billingEnd && new Date(data.billingEnd) < new Date()) {
          return null; // período expirou
        }
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  function isGoPage() {
    return /\/workspace\/wrk_[^/]+\/go(\?.*)?(#.*)?$/.test(location.pathname + location.search + location.hash) || location.pathname.endsWith("/go");
  }

  function isUsagePage() {
    return document.querySelector(TABLE_SELECTOR) !== null;
  }

  function captureLimitsFromPage() {
    const limits = parseLimitsFromDoc(document);
    if (limits && limits.length > 0) {
      const monthlyResetInSec = extractResetInSec(document);
      GM_setValue(LIMITS_STORAGE_KEY, JSON.stringify({ limits, monthlyResetInSec, ts: Date.now() }));
    }
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

  async function fetchGoLimits() {
    const wsId = (() => {
      const m = location.pathname.match(/\/workspace\/(wrk_[^/]+)/);
      return m ? m[1] : null;
    })();
    if (!wsId) return null;

    return new Promise((resolve) => {
      let timer, interval;

      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(interval);
        iframe.onload = null;
        try { iframe.remove(); } catch {}
      };

      const done = (result) => {
        cleanup();
        resolve(result);
      };

      const iframe = document.createElement("iframe");
      Object.assign(iframe.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        border: "0",
        zIndex: "-1",
        opacity: "0",
        pointerEvents: "none",
      });

      timer = setTimeout(() => done(null), 20000);

      iframe.onload = () => {
        let attempts = 0;
        interval = setInterval(() => {
          attempts++;
          try {
            const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (!doc) return;
            const limits = parseLimitsFromDoc(doc);
            if (limits && limits.length > 0) {
              const monthlyResetInSec = extractResetInSec(doc);
              GM_setValue(LIMITS_STORAGE_KEY, JSON.stringify({ limits, monthlyResetInSec, ts: Date.now() }));
              done(limits);
            } else if (attempts >= 15) {
              done(null);
            }
          } catch {
            done(null);
          }
        }, 1000);
      };

      iframe.src = `/workspace/${wsId}/go`;
      document.body.appendChild(iframe);
    });
  }

  function parseRemainingDays(resetText) {
    const daysMatch = resetText.match(/(\d+)\s*(?:days?|dias?|tage?|jours?)/i);
    const hoursMatch = resetText.match(/(\d+)\s*(?:hours?|horas?|stunden?|heures?|hrs?)/i);
    const days = daysMatch ? parseInt(daysMatch[1], 10) : 0;
    const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
    return days + hours / 24;
  }

  function calcBillingPeriod() {
    const cache = getCachedLimitsFull();
    if (!cache) return null;
    const monthly = cache.limits.find((l) => /mensal|monthly/i.test(l.label));
    if (!monthly) return null;

    let remainingDays;
    if (cache.monthlyResetInSec && cache.monthlyResetInSec > 0) {
      remainingDays = cache.monthlyResetInSec / 86400;
    } else {
      remainingDays = parseRemainingDays(monthly.reset);
    }

    // Sanity check: se remainingDays for 0, nao e um periodo valido
    if (!remainingDays || remainingDays <= 0) return null;

    // resetMoment = momento exato do reset (= inicio do novo periodo)
    const resetMoment = new Date(Date.now() + remainingDays * 86400000);
    // resetDay = primeiro dia do novo periodo
    const resetDay = new Date(resetMoment.getFullYear(), resetMoment.getMonth(), resetMoment.getDate());
    // periodoInicio = mesmo dia-do-mes do reset, no mes anterior
    const periodoInicio = new Date(resetDay.getFullYear(), resetDay.getMonth() - 1, resetDay.getDate(), 0, 0, 0, 0);
    // periodoFim = ate o inicio do dia do reset (inclui o proprio dia)
    const periodoFim = resetDay;

    return { inicio: periodoInicio, fim: periodoFim };
  }

  function getCurrentViewMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }

  function parseRowDate(cell) {
    const title = cell.getAttribute("title") || "";
    const yearMatch = title.match(/\b(\d{4})\b/);
    const dayMatch = cell.textContent.trim().match(/^(\d{1,2})\b/);
    if (!yearMatch || !dayMatch) return null;

    const view = getCurrentViewMonth();
    return new Date(parseInt(yearMatch[1], 10), view.getMonth(), parseInt(dayMatch[1], 10));
  }

  function clickPrevMonth() {
    const buttons = document.querySelectorAll(MONTH_BUTTON_SELECTOR);
    if (buttons[0] && !buttons[0].disabled) {
      buttons[0].click();
      monthOffset--;
      return true;
    }
    return false;
  }

  function clickNextMonth() {
    const buttons = document.querySelectorAll(MONTH_BUTTON_SELECTOR);
    if (buttons[1] && !buttons[1].disabled) {
      buttons[1].click();
      monthOffset++;
      return true;
    }
    return false;
  }

  function waitForMonthChange(previousLabel) {
    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        const label = document.querySelector(MONTH_LABEL_SELECTOR)?.textContent?.trim();
        if (label !== previousLabel || attempts >= 30) {
          clearInterval(interval);
          setTimeout(resolve, 500);
        }
      }, 300);
    });
  }

  function renderLimits(limits) {
    if (!limits || limits.length === 0) {
      return `<span class="oc-limits-info">${_("fallbackLimits")}</span>`;
    }

    return limits
      .map((l) => {
        let colorClass, extra = "";
        const translatedLabel = limitLabels[l.label] || l.label;

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

  async function refreshPanelLimits() {
    const limitsEl = document.getElementById("oc-limits");
    if (!limitsEl) return;

    const cached = getCachedLimits();
    limitsEl.innerHTML = renderLimits(cached);

    const fresh = await fetchGoLimits();
    if (fresh) {
      limitsEl.innerHTML = renderLimits(fresh);
    }
  }

  function init() {
    if (isGoPage()) {
      captureLimitsFromPage();
      setInterval(captureLimitsFromPage, 10000);
      return;
    }

    if (!isUsagePage()) return;

    let periodo = calcBillingPeriod();
    let pageResult = scanCurrentPage(periodo);

    // Se filtro removiu tudo mas há linhas na tabela, tentar sem filtro
    if (pageResult && pageResult.count === 0 && periodo) {
      const unfiltered = scanCurrentPage(null);
      if (unfiltered && unfiltered.count > 0) pageResult = unfiltered;
    }

    if (!pageResult) return;

    const stored = loadStoredData();

    if (stored) {
      updatePanel(
        stored.total, stored.byModel, stored.byDay,
        stored.tokensInByModel || {}, stored.tokensOutByModel || {},
        stored.tokensIn, stored.tokensOut, stored.count,
        0, false, periodo
      );
    } else {
      updatePanel(
        pageResult.total, pageResult.byModel, pageResult.byDay,
        pageResult.tokensInByModel, pageResult.tokensOutByModel,
        pageResult.tokensIn, pageResult.tokensOut, pageResult.count,
        1, false, periodo
      );
    }

    refreshPanelLimits();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 800));
  } else {
    setTimeout(init, 800);
  }
})();
