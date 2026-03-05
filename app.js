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

const PRICE_REFRESH_MS = 60_000;
const NEWS_REFRESH_MS = 300_000;
const FETCH_TIMEOUT_MS = 10_000;

const fmtPrice = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

let nextRefreshAt = Date.now() + PRICE_REFRESH_MS;
let autoRefreshEnabled = true;
let priceInterval;
let newsInterval;
let latestNews = [];

function formatChange(change) {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

function setStatus(ok, message) {
  statusBadge.textContent = `Статус: ${message}`;
  statusBadge.classList.remove("ok", "error");
  statusBadge.classList.add(ok ? "ok" : "error");
}

function markUpdated() {
  const now = new Date();
  updatedAt.textContent = `Обновление: ${now.toLocaleString("ru-RU")}`;
  nextRefreshAt = Date.now() + PRICE_REFRESH_MS;
}

function startCountdown() {
  setInterval(() => {
    if (!autoRefreshEnabled) {
      nextRefresh.textContent = "Следующее обновление: пауза";
      return;
    }

    const leftMs = Math.max(0, nextRefreshAt - Date.now());
    const seconds = Math.ceil(leftMs / 1000);
    nextRefresh.textContent = `Следующее обновление: ${seconds}с`;
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

function drawSparkline(el, points, isUp) {
  if (!points?.length) return;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 1e-9);

  const toPoint = (value, idx) => {
    const x = (idx / (points.length - 1 || 1)) * 100;
    const y = 30 - ((value - min) / range) * 30;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };

  const polyline = el.querySelector(".sparkline polyline");
  polyline.setAttribute("points", points.map(toPoint).join(" "));
  polyline.classList.remove("up", "down");
  polyline.classList.add(isUp ? "up" : "down");
}

function applyTicker(ticker) {
  const el = pricesContainer.querySelector(`[data-symbol="${ticker.symbol}"]`);
  if (!el) return;

  const price = Number(ticker.lastPrice);
  const change = Number(ticker.priceChangePercent);

  const priceEl = el.querySelector(".price");
  const changeEl = el.querySelector(".change");
  const bar = el.querySelector(".change-bar span");

  priceEl.textContent = `$${fmtPrice.format(price)}`;
  changeEl.textContent = `24ч: ${formatChange(change)}`;

  changeEl.classList.remove("up", "down");
  changeEl.classList.add(change >= 0 ? "up" : "down");

  const intensity = Math.min(Math.abs(change), 10) * 10;
  bar.classList.remove("up", "down");
  bar.classList.add(change >= 0 ? "up" : "down");
  bar.style.width = `${intensity}%`;
}

async function fetchSparkline(symbol) {
  const data = await fetchWithTimeout(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`
  );

  return data.map((candle) => Number(candle[4]));
}

async function fetchPrices() {
  const tickers = await Promise.all(
    symbols.map((symbol) => fetchWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`))
  );

  tickers.forEach(applyTicker);

  const sparklineData = await Promise.all(symbols.map((symbol) => fetchSparkline(symbol)));
  symbols.forEach((symbol, idx) => {
    const el = pricesContainer.querySelector(`[data-symbol="${symbol}"]`);
    const ticker = tickers.find((t) => t.symbol === symbol);
    const isUp = Number(ticker?.priceChangePercent || 0) >= 0;
    drawSparkline(el, sparklineData[idx], isUp);
  });

  localStorage.setItem("cachedPrices", JSON.stringify(tickers));
  localStorage.setItem("cachedSparklines", JSON.stringify(Object.fromEntries(symbols.map((s, i) => [s, sparklineData[i]]))));
}

function renderCachedPrices() {
  const raw = localStorage.getItem("cachedPrices");
  const sparkRaw = localStorage.getItem("cachedSparklines");

  if (raw) {
    try {
      const items = JSON.parse(raw);
      items.forEach(applyTicker);
    } catch (e) {
      console.warn("Не удалось прочитать кеш цен", e);
    }
  }

  if (sparkRaw) {
    try {
      const sparkMap = JSON.parse(sparkRaw);
      symbols.forEach((symbol) => {
        const el = pricesContainer.querySelector(`[data-symbol="${symbol}"]`);
        const points = sparkMap[symbol];
        const isUp = el.querySelector(".change")?.classList.contains("up");
        drawSparkline(el, points, isUp);
      });
    } catch (e) {
      console.warn("Не удалось прочитать кеш графиков", e);
    }
  }
}

function renderNews(items) {
  if (!items.length) {
    newsList.innerHTML = "<li>Новости не найдены.</li>";
    newsCount.textContent = "0 новостей";
    return;
  }

  const q = newsFilterInput.value.trim().toLowerCase();
  const filtered = q
    ? items.filter((item) => `${item.title} ${item.source}`.toLowerCase().includes(q))
    : items;

  newsCount.textContent = `${filtered.length} новостей`;

  if (!filtered.length) {
    newsList.innerHTML = "<li>По текущему фильтру ничего не найдено.</li>";
    return;
  }

  newsList.innerHTML = filtered
    .map(
      (item) =>
        `<li><a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a> <small>— ${item.source}</small></li>`
    )
    .join("");
}

async function fetchNews() {
  const json = await fetchWithTimeout("https://min-api.cryptocompare.com/data/v2/news/?lang=EN");
  latestNews = (json.Data || []).slice(0, 12);
  renderNews(latestNews);
  localStorage.setItem("cachedNews", JSON.stringify(latestNews));
}

function renderCachedNews() {
  const raw = localStorage.getItem("cachedNews");
  if (!raw) return;

  try {
    latestNews = JSON.parse(raw).slice(0, 12);
    renderNews(latestNews);
  } catch (e) {
    console.warn("Не удалось прочитать кеш новостей", e);
  }
}

function setAutoRefresh(enabled) {
  autoRefreshEnabled = enabled;
  autoRefreshBtn.textContent = `Авто: ${enabled ? "ВКЛ" : "ВЫКЛ"}`;

  if (enabled) {
    nextRefreshAt = Date.now() + PRICE_REFRESH_MS;
    priceInterval = setInterval(() => {
      fetchPrices().catch((e) => {
        console.error(e);
        setStatus(false, "ошибка сети");
      });
    }, PRICE_REFRESH_MS);

    newsInterval = setInterval(() => {
      fetchNews().catch((e) => {
        console.error(e);
        setStatus(false, "ошибка сети");
      });
    }, NEWS_REFRESH_MS);
  } else {
    clearInterval(priceInterval);
    clearInterval(newsInterval);
  }
}

async function refreshAll() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Обновляю...";

  try {
    await Promise.all([fetchPrices(), fetchNews()]);
    markUpdated();
    setStatus(true, "онлайн");
  } catch (e) {
    console.error(e);
    setStatus(false, "ошибка загрузки");
    if (!newsList.children.length) {
      newsList.innerHTML = "<li>Ошибка загрузки данных. Попробуй обновить позже.</li>";
    }
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Обновить сейчас";
  }
}

refreshBtn.addEventListener("click", refreshAll);
autoRefreshBtn.addEventListener("click", () => setAutoRefresh(!autoRefreshEnabled));
newsFilterInput.addEventListener("input", () => renderNews(latestNews));

renderCachedPrices();
renderCachedNews();
startCountdown();
setAutoRefresh(true);
refreshAll();