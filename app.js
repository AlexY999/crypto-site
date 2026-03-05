const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

const pricesContainer = document.getElementById("prices");
const newsList = document.getElementById("newsList");
const newsFilterInput = document.getElementById("newsFilter");
const newsCount = document.getElementById("newsCount");
const updatedAt = document.getElementById("updatedAt");
const nextRefresh = document.getElementById("nextRefresh");
const statusBadge = document.getElementById("statusBadge");
const refreshBtn = document.getElementById("refreshBtn");
const autoRefreshBtn = document.getElementById("autoRefreshBtn");
const portfolioTotal = document.getElementById("portfolioTotal");
const symbolInput = document.getElementById("symbolInput");
const addSymbolBtn = document.getElementById("addSymbolBtn");
const alertSymbol = document.getElementById("alertSymbol");
const alertDirection = document.getElementById("alertDirection");
const alertPrice = document.getElementById("alertPrice");
const addAlertBtn = document.getElementById("addAlertBtn");
const alertsList = document.getElementById("alertsList");

const fngValue = document.getElementById("fngValue");
const fngLabel = document.getElementById("fngLabel");
const topGainers = document.getElementById("topGainers");
const topLosers = document.getElementById("topLosers");

const PRICE_REFRESH_MS = 60_000;
const NEWS_REFRESH_MS = 300_000;
const FETCH_TIMEOUT_MS = 12_000;

const fmtPrice = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let symbols = loadJSON("watchlist", DEFAULT_SYMBOLS);
let holdings = loadJSON("holdings", {});
let avgCosts = loadJSON("avgCosts", {});
let alerts = loadJSON("priceAlerts", []);
let tickerMap = {};
let latestNews = [];

let nextRefreshAt = Date.now() + PRICE_REFRESH_MS;
let autoRefreshEnabled = true;
let priceRefreshInFlight = false;
let priceInterval;
let newsInterval;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeSymbol(input) {
  const raw = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  return raw.endsWith("USDT") ? raw : `${raw}USDT`;
}

function displaySymbol(symbol) {
  return symbol.replace("USDT", "");
}

function setStatus(ok, message) {
  statusBadge.textContent = `Статус: ${message}`;
  statusBadge.classList.remove("ok", "error");
  statusBadge.classList.add(ok ? "ok" : "error");
}

function scheduleNextPriceRefresh() {
  nextRefreshAt = Date.now() + PRICE_REFRESH_MS;
}

function markUpdated() {
  updatedAt.textContent = `Обновление: ${new Date().toLocaleString("ru-RU")}`;
  scheduleNextPriceRefresh();
}

function startCountdown() {
  setInterval(() => {
    if (!autoRefreshEnabled) {
      nextRefresh.textContent = "Следующее обновление: пауза";
      return;
    }
    const leftMs = Math.max(0, nextRefreshAt - Date.now());
    nextRefresh.textContent = `Следующее обновление: ${Math.ceil(leftMs / 1000)}с`;
  }, 1000);
}

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function createCard(symbol) {
  const article = document.createElement("article");
  article.className = "price-item";
  article.dataset.symbol = symbol;

  article.innerHTML = `
    <div class="row">
      <h3>${displaySymbol(symbol)}</h3>
      <div class="row" style="gap:6px">
        <span class="symbol">${symbol}</span>
        ${symbols.length > 1 ? `<button class="remove-btn" data-remove="${symbol}" type="button">✕</button>` : ""}
      </div>
    </div>
    <p class="price">—</p>
    <p class="change">—</p>
    <svg class="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points=""></polyline></svg>
    <div class="change-bar" aria-hidden="true"><span></span></div>
    <div class="holding-grid">
      <input id="holding-${symbol}" data-holding="${symbol}" type="number" min="0" step="any" placeholder="Количество" value="${holdings[symbol] ?? ""}" />
      <input id="avg-${symbol}" data-avg="${symbol}" type="number" min="0" step="any" placeholder="Средняя цена входа" value="${avgCosts[symbol] ?? ""}" />
    </div>
    <p class="holding-value" data-holding-value="${symbol}">Стоимость: —</p>
    <p class="holding-pnl" data-holding-pnl="${symbol}">PnL: —</p>
  `;

  return article;
}

function renderPriceCards() {
  pricesContainer.innerHTML = "";
  symbols.forEach((symbol) => pricesContainer.appendChild(createCard(symbol)));
}

function drawSparkline(el, points, isUp) {
  if (!el || !points?.length) return;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 1e-9);

  const toPoint = (v, i) => `${((i / (points.length - 1 || 1)) * 100).toFixed(2)},${(30 - ((v - min) / range) * 30).toFixed(2)}`;
  const polyline = el.querySelector(".sparkline polyline");
  polyline.setAttribute("points", points.map(toPoint).join(" "));
  polyline.classList.remove("up", "down");
  polyline.classList.add(isUp ? "up" : "down");
}

function updatePortfolioSummary() {
  let total = 0;
  let totalPnl = 0;

  symbols.forEach((symbol) => {
    const qty = Number(holdings[symbol] || 0);
    const price = Number(tickerMap[symbol]?.lastPrice || 0);
    const avg = Number(avgCosts[symbol] || 0);
    const positionValue = qty * price;
    const pnl = qty > 0 && avg > 0 ? (price - avg) * qty : 0;

    total += positionValue;
    totalPnl += pnl;

    const valEl = document.querySelector(`[data-holding-value="${symbol}"]`);
    const pnlEl = document.querySelector(`[data-holding-pnl="${symbol}"]`);

    if (valEl) valEl.textContent = qty > 0 ? `Стоимость: $${fmtPrice.format(positionValue)}` : "Стоимость: —";
    if (pnlEl) {
      if (qty > 0 && avg > 0) {
        const sign = pnl >= 0 ? "+" : "";
        pnlEl.textContent = `PnL: ${sign}$${fmtPrice.format(pnl)} (${avg > 0 ? ((price / avg - 1) * 100).toFixed(2) : "0.00"}%)`;
        pnlEl.classList.toggle("up", pnl >= 0);
        pnlEl.classList.toggle("down", pnl < 0);
      } else {
        pnlEl.textContent = "PnL: —";
        pnlEl.classList.remove("up", "down");
      }
    }
  });

  const sign = totalPnl >= 0 ? "+" : "";
  portfolioTotal.textContent = `Портфель: $${fmtPrice.format(total)} | PnL: ${sign}$${fmtPrice.format(totalPnl)}`;
}

function applyTicker(ticker) {
  tickerMap[ticker.symbol] = ticker;
  const el = pricesContainer.querySelector(`[data-symbol="${ticker.symbol}"]`);
  if (!el) return;

  const price = Number(ticker.lastPrice);
  const change = Number(ticker.priceChangePercent);

  el.querySelector(".price").textContent = `$${fmtPrice.format(price)}`;

  const changeEl = el.querySelector(".change");
  changeEl.textContent = `24ч: ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  changeEl.classList.remove("up", "down");
  changeEl.classList.add(change >= 0 ? "up" : "down");

  const bar = el.querySelector(".change-bar span");
  bar.classList.remove("up", "down");
  bar.classList.add(change >= 0 ? "up" : "down");
  bar.style.width = `${Math.min(Math.abs(change), 10) * 10}%`;
}

async function fetchSparkline(symbol) {
  const data = await fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`);
  return data.map((x) => Number(x[4]));
}

async function fetchPrices() {
  const tickers = await Promise.all(symbols.map((s) => fetchWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${s}`)));
  tickers.forEach(applyTicker);

  const lines = await Promise.all(symbols.map((s) => fetchSparkline(s).catch(() => [])));
  symbols.forEach((symbol, i) => {
    const el = pricesContainer.querySelector(`[data-symbol="${symbol}"]`);
    const isUp = Number(tickerMap[symbol]?.priceChangePercent || 0) >= 0;
    drawSparkline(el, lines[i], isUp);
  });

  saveJSON("cachedPrices", tickers);
  saveJSON("cachedSparklines", Object.fromEntries(symbols.map((s, i) => [s, lines[i]])));
  updatePortfolioSummary();
  checkAlerts();
}

function renderCachedPrices() {
  const cached = loadJSON("cachedPrices", []);
  const lines = loadJSON("cachedSparklines", {});

  cached.forEach(applyTicker);
  symbols.forEach((symbol) => {
    const el = pricesContainer.querySelector(`[data-symbol="${symbol}"]`);
    const isUp = el?.querySelector(".change")?.classList.contains("up");
    drawSparkline(el, lines[symbol], isUp);
  });

  updatePortfolioSummary();
}

function renderNews(items) {
  if (!items.length) {
    newsList.innerHTML = "<li>Новости не найдены.</li>";
    newsCount.textContent = "0 новостей";
    return;
  }
  const q = newsFilterInput.value.trim().toLowerCase();
  const filtered = q ? items.filter((n) => `${n.title} ${n.source}`.toLowerCase().includes(q)) : items;
  newsCount.textContent = `${filtered.length} новостей`;
  newsList.innerHTML = filtered.length
    ? filtered.map((n) => `<li><a href="${n.url}" target="_blank" rel="noopener noreferrer">${n.title}</a> <small>— ${n.source}</small></li>`).join("")
    : "<li>По текущему фильтру ничего не найдено.</li>";
}

async function fetchNews() {
  const json = await fetchWithTimeout("https://min-api.cryptocompare.com/data/v2/news/?lang=EN");
  latestNews = (json.Data || []).slice(0, 12);
  renderNews(latestNews);
  saveJSON("cachedNews", latestNews);
}

async function safeRun(fn, label) {
  try {
    await fn();
    return { ok: true, label };
  } catch (e) {
    console.warn(`Ошибка в ${label}`, e);
    return { ok: false, label, error: e };
  }
}

function renderCachedNews() {
  latestNews = loadJSON("cachedNews", []);
  if (latestNews.length) renderNews(latestNews);
}

async function fetchMarketPulse() {
  try {
    const fng = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1");
    const p = fng?.data?.[0];
    if (p) {
      fngValue.textContent = `${p.value}/100`;
      fngLabel.textContent = p.value_classification || "—";
    }
  } catch {}

  try {
    const tickers = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/24hr");
    const usdt = tickers.filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("UPUSDT") && !t.symbol.includes("DOWNUSDT"));
    const sorted = usdt.map((t) => ({ symbol: displaySymbol(t.symbol), change: Number(t.priceChangePercent) })).filter((x) => Number.isFinite(x.change));

    const gainers = [...sorted].sort((a, b) => b.change - a.change).slice(0, 3);
    const losers = [...sorted].sort((a, b) => a.change - b.change).slice(0, 3);

    topGainers.innerHTML = gainers.map((x) => `<li><strong>${x.symbol}</strong> <span class="up">+${x.change.toFixed(2)}%</span></li>`).join("");
    topLosers.innerHTML = losers.map((x) => `<li><strong>${x.symbol}</strong> <span class="down">${x.change.toFixed(2)}%</span></li>`).join("");
  } catch {
    topGainers.innerHTML = "<li>Нет данных</li>";
    topLosers.innerHTML = "<li>Нет данных</li>";
  }
}

function renderAlerts() {
  if (!alerts.length) {
    alertsList.innerHTML = "<li>Нет активных алертов</li>";
    return;
  }

  alertsList.innerHTML = alerts
    .map((a) => `<li>${displaySymbol(a.symbol)} ${a.direction === "above" ? ">" : "<"} $${fmtPrice.format(a.price)} <button data-alert-remove="${a.id}" type="button">Удалить</button></li>`)
    .join("");

  alertsList.querySelectorAll("[data-alert-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      alerts = alerts.filter((a) => a.id !== btn.dataset.alertRemove);
      saveJSON("priceAlerts", alerts);
      renderAlerts();
    });
  });
}

function notifyAlert(message) {
  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification(message);
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") new Notification(message);
      });
    }
  }
}

function checkAlerts() {
  if (!alerts.length) return;

  const triggeredIds = [];
  alerts.forEach((a) => {
    const price = Number(tickerMap[a.symbol]?.lastPrice || 0);
    if (!price) return;

    const hit = a.direction === "above" ? price >= a.price : price <= a.price;
    if (hit) {
      const msg = `Алерт: ${displaySymbol(a.symbol)} ${a.direction === "above" ? "выше" : "ниже"} $${fmtPrice.format(a.price)} (сейчас $${fmtPrice.format(price)})`;
      setStatus(true, msg);
      notifyAlert(msg);
      triggeredIds.push(a.id);
    }
  });

  if (triggeredIds.length) {
    alerts = alerts.filter((a) => !triggeredIds.includes(a.id));
    saveJSON("priceAlerts", alerts);
    renderAlerts();
  }
}

function setAutoRefresh(enabled) {
  autoRefreshEnabled = enabled;
  autoRefreshBtn.textContent = `Авто: ${enabled ? "ВКЛ" : "ВЫКЛ"}`;
  clearInterval(priceInterval);
  clearInterval(newsInterval);

  if (enabled) {
    scheduleNextPriceRefresh();
    priceInterval = setInterval(async () => {
      if (priceRefreshInFlight) return;
      priceRefreshInFlight = true;
      try {
        const priceRes = await safeRun(fetchPrices, "курсы");
        if (priceRes.ok) {
          markUpdated();
          setStatus(true, "онлайн");
        } else {
          setStatus(false, "ошибка сети (курсы)");
          scheduleNextPriceRefresh();
        }
      } finally {
        priceRefreshInFlight = false;
      }
    }, PRICE_REFRESH_MS);

    newsInterval = setInterval(async () => {
      const [newsRes, pulseRes] = await Promise.all([
        safeRun(fetchNews, "новости"),
        safeRun(fetchMarketPulse, "пульс рынка"),
      ]);

      if (!newsRes.ok && !pulseRes.ok) {
        setStatus(false, "ошибка сети (новости/пульс)");
      }
    }, NEWS_REFRESH_MS);
  }
}

async function refreshAll() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Обновляю...";

  try {
    priceRefreshInFlight = true;
    const results = await Promise.all([
      safeRun(fetchPrices, "курсы"),
      safeRun(fetchNews, "новости"),
      safeRun(fetchMarketPulse, "пульс рынка"),
    ]);

    const failed = results.filter((r) => !r.ok);
    const okCount = results.length - failed.length;

    if (okCount > 0) {
      markUpdated();
      if (failed.length === 0) {
        setStatus(true, "онлайн");
      } else {
        setStatus(true, `частично онлайн (${failed.map((f) => f.label).join(", ")} недоступно)`);
      }
    } else {
      setStatus(false, "ошибка загрузки");
      scheduleNextPriceRefresh();
    }
  } finally {
    priceRefreshInFlight = false;
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Обновить сейчас";
  }
}

function addSymbol() {
  const symbol = normalizeSymbol(symbolInput.value);
  if (!symbol) return;
  if (symbols.includes(symbol)) {
    symbolInput.value = "";
    return;
  }

  symbols.push(symbol);
  saveJSON("watchlist", symbols);
  symbolInput.value = "";
  renderPriceCards();
  bindDynamicEvents();
  fetchPrices().catch(() => setStatus(false, "ошибка сети"));
}

function removeSymbol(symbol) {
  if (symbols.length <= 1) return;
  symbols = symbols.filter((s) => s !== symbol);
  delete holdings[symbol];
  delete avgCosts[symbol];
  delete tickerMap[symbol];
  alerts = alerts.filter((a) => a.symbol !== symbol);
  saveJSON("watchlist", symbols);
  saveJSON("holdings", holdings);
  saveJSON("avgCosts", avgCosts);
  saveJSON("priceAlerts", alerts);
  renderPriceCards();
  bindDynamicEvents();
  renderAlerts();
  updatePortfolioSummary();
}

function bindDynamicEvents() {
  pricesContainer.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeSymbol(btn.dataset.remove));
  });

  pricesContainer.querySelectorAll("[data-holding]").forEach((input) => {
    input.addEventListener("input", () => {
      const symbol = input.dataset.holding;
      const val = Number(input.value);
      holdings[symbol] = Number.isFinite(val) && val > 0 ? val : 0;
      saveJSON("holdings", holdings);
      updatePortfolioSummary();
    });
  });

  pricesContainer.querySelectorAll("[data-avg]").forEach((input) => {
    input.addEventListener("input", () => {
      const symbol = input.dataset.avg;
      const val = Number(input.value);
      avgCosts[symbol] = Number.isFinite(val) && val > 0 ? val : 0;
      saveJSON("avgCosts", avgCosts);
      updatePortfolioSummary();
    });
  });
}

function addPriceAlert() {
  const symbol = normalizeSymbol(alertSymbol.value);
  const target = Number(alertPrice.value);
  const direction = alertDirection.value;

  if (!symbol || !Number.isFinite(target) || target <= 0) return;

  const id = `${symbol}-${direction}-${target}-${Date.now()}`;
  alerts.push({ id, symbol, direction, price: target });
  saveJSON("priceAlerts", alerts);
  renderAlerts();

  alertSymbol.value = "";
  alertPrice.value = "";
}

refreshBtn.addEventListener("click", refreshAll);
autoRefreshBtn.addEventListener("click", () => setAutoRefresh(!autoRefreshEnabled));
newsFilterInput.addEventListener("input", () => renderNews(latestNews));
addSymbolBtn.addEventListener("click", addSymbol);
addAlertBtn.addEventListener("click", addPriceAlert);
symbolInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSymbol();
});
[alertSymbol, alertPrice].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPriceAlert();
  });
});

renderPriceCards();
bindDynamicEvents();
renderAlerts();
renderCachedPrices();
renderCachedNews();
startCountdown();
setAutoRefresh(true);
refreshAll();