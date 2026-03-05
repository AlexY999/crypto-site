const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

const pricesContainer = document.getElementById("prices");
const newsList = document.getElementById("newsList");
const newsFilterInput = document.getElementById("newsFilter");
const newsCount = document.getElementById("newsCount");
const fngValue = document.getElementById("fngValue");
const fngLabel = document.getElementById("fngLabel");
const topGainers = document.getElementById("topGainers");
const topLosers = document.getElementById("topLosers");
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
let priceRefreshInFlight = false;

function formatChange(change) {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
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
  const now = new Date();
  updatedAt.textContent = `Обновление: ${now.toLocaleString("ru-RU")}`;
  scheduleNextPriceRefresh();
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

async function fetchMarketPulse() {
  try {
    const fng = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1");
    const point = fng?.data?.[0];
    if (point) {
      fngValue.textContent = `${point.value}/100`;
      fngLabel.textContent = point.value_classification || "—";
    }
  } catch (e) {
    console.warn("Fear & Greed недоступен", e);
  }

  try {
    const tickers = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/24hr");
    const usdt = tickers.filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("UPUSDT") && !t.symbol.includes("DOWNUSDT"));

    const sorted = usdt
      .map((t) => ({ symbol: t.symbol.replace("USDT", ""), change: Number(t.priceChangePercent) }))
      .filter((t) => Number.isFinite(t.change));

    const gainers = [...sorted].sort((a, b) => b.change - a.change).slice(0, 3);
    const losers = [...sorted].sort((a, b) => a.change - b.change).slice(0, 3);

    topGainers.innerHTML = gainers.map((x) => `<li><strong>${x.symbol}</strong> <span class="up">+${x.change.toFixed(2)}%</span></li>`).join("");
    topLosers.innerHTML = losers.map((x) => `<li><strong>${x.symbol}</strong> <span class="down">${x.change.toFixed(2)}%</span></li>`).join("");
  } catch (e) {
    console.warn("Top movers недоступны", e);
    topGainers.innerHTML = "<li>Нет данных</li>";
    topLosers.innerHTML = "<li>Нет данных</li>";
  }
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

  clearInterval(priceInterval);
  clearInterval(newsInterval);

  if (enabled) {
    scheduleNextPriceRefresh();

    priceInterval = setInterval(async () => {
      if (priceRefreshInFlight) return;
      priceRefreshInFlight = true;

      try {
        await fetchPrices();
        markUpdated();
        setStatus(true, "онлайн");
      } catch (e) {
        console.error(e);
        setStatus(false, "ошибка сети");
        scheduleNextPriceRefresh();
      } finally {
        priceRefreshInFlight = false;
      }
    }, PRICE_REFRESH_MS);

    newsInterval = setInterval(() => {
      Promise.all([fetchNews(), fetchMarketPulse()]).catch((e) => {
        console.error(e);
        setStatus(false, "ошибка сети");
      });
    }, NEWS_REFRESH_MS);
  }
}

async function refreshAll() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Обновляю...";

  try {
    priceRefreshInFlight = true;
    await Promise.all([fetchPrices(), fetchNews(), fetchMarketPulse()]);
    markUpdated();
    setStatus(true, "онлайн");
  } catch (e) {
    console.error(e);
    setStatus(false, "ошибка загрузки");
    scheduleNextPriceRefresh();
    if (!newsList.children.length) {
      newsList.innerHTML = "<li>Ошибка загрузки данных. Попробуй обновить позже.</li>";
    }
  } finally {
    priceRefreshInFlight = false;
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