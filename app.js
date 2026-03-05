const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

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

const fngValue = document.getElementById("fngValue");
const fngLabel = document.getElementById("fngLabel");
const topGainers = document.getElementById("topGainers");
const topLosers = document.getElementById("topLosers");

const PRICE_REFRESH_MS = 60_000;
const NEWS_REFRESH_MS = 300_000;
const FETCH_TIMEOUT_MS = 12_000;

const fmtPrice = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let holdings = loadJSON("holdings", {});
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
      <span class="symbol">${symbol}</span>
    </div>
    <p class="price">—</p>
    <p class="change">—</p>
    <svg class="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points=""></polyline></svg>
    <div class="change-bar" aria-hidden="true"><span></span></div>
    <div class="holding-grid">
      <input id="holding-${symbol}" data-holding="${symbol}" type="number" min="0" step="any" placeholder="Количество" value="${holdings[symbol] ?? ""}" />
    </div>
    <p class="holding-value" data-holding-value="${symbol}">Стоимость: —</p>
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
  symbols.forEach((symbol) => {
    const qty = Number(holdings[symbol] || 0);
    const price = Number(tickerMap[symbol]?.lastPrice || 0);
    const positionValue = qty * price;
    total += positionValue;

    const valEl = document.querySelector(`[data-holding-value="${symbol}"]`);
    if (valEl) valEl.textContent = qty > 0 ? `Стоимость: $${fmtPrice.format(positionValue)}` : "Стоимость: —";
  });

  portfolioTotal.textContent = `Портфель: $${fmtPrice.format(total)}`;
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
    return { ok: false, label };
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

function bindDynamicEvents() {
  pricesContainer.querySelectorAll("[data-holding]").forEach((input) => {
    input.addEventListener("input", () => {
      const symbol = input.dataset.holding;
      const val = Number(input.value);
      holdings[symbol] = Number.isFinite(val) && val > 0 ? val : 0;
      saveJSON("holdings", holdings);
      updatePortfolioSummary();
    });
  });
}

refreshBtn.addEventListener("click", refreshAll);
autoRefreshBtn.addEventListener("click", () => setAutoRefresh(!autoRefreshEnabled));
newsFilterInput.addEventListener("input", () => renderNews(latestNews));

renderPriceCards();
bindDynamicEvents();
renderCachedPrices();
renderCachedNews();
startCountdown();
setAutoRefresh(true);
refreshAll();