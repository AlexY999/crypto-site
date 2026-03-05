const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

const pricesContainer = document.getElementById("prices");
const newsList = document.getElementById("newsList");
const updatedAt = document.getElementById("updatedAt");
const nextRefresh = document.getElementById("nextRefresh");
const refreshBtn = document.getElementById("refreshBtn");

const PRICE_REFRESH_MS = 60_000;

const fmtPrice = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

let nextRefreshAt = Date.now() + PRICE_REFRESH_MS;

function formatChange(change) {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

function markUpdated() {
  const now = new Date();
  updatedAt.textContent = `Обновление: ${now.toLocaleString("ru-RU")}`;
  nextRefreshAt = Date.now() + PRICE_REFRESH_MS;
}

function startCountdown() {
  setInterval(() => {
    const leftMs = Math.max(0, nextRefreshAt - Date.now());
    const seconds = Math.ceil(leftMs / 1000);
    nextRefresh.textContent = `Следующее обновление: ${seconds}с`;
  }, 1000);
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

async function fetchPrices() {
  const requests = symbols.map((symbol) =>
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`).then((r) => {
      if (!r.ok) throw new Error("Ошибка загрузки цены");
      return r.json();
    })
  );

  const data = await Promise.all(requests);
  data.forEach(applyTicker);

  localStorage.setItem("cachedPrices", JSON.stringify(data));
}

function renderCachedPrices() {
  const raw = localStorage.getItem("cachedPrices");
  if (!raw) return;
  try {
    const items = JSON.parse(raw);
    items.forEach(applyTicker);
  } catch (e) {
    console.warn("Не удалось прочитать кеш цен", e);
  }
}

async function fetchNews() {
  const url = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Ошибка загрузки новостей");
  const json = await res.json();

  const items = (json.Data || []).slice(0, 8);

  if (!items.length) {
    newsList.innerHTML = "<li>Новости не найдены.</li>";
    return;
  }

  newsList.innerHTML = items
    .map(
      (item) =>
        `<li><a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a> <small>— ${item.source}</small></li>`
    )
    .join("");

  localStorage.setItem("cachedNews", JSON.stringify(items));
}

function renderCachedNews() {
  const raw = localStorage.getItem("cachedNews");
  if (!raw) return;
  try {
    const items = JSON.parse(raw).slice(0, 8);
    if (!items.length) return;
    newsList.innerHTML = items
      .map(
        (item) =>
          `<li><a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a> <small>— ${item.source}</small></li>`
      )
      .join("");
  } catch (e) {
    console.warn("Не удалось прочитать кеш новостей", e);
  }
}

async function refreshAll() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Обновляю...";

  try {
    await Promise.all([fetchPrices(), fetchNews()]);
    markUpdated();
  } catch (e) {
    console.error(e);
    if (!newsList.children.length) {
      newsList.innerHTML = "<li>Ошибка загрузки данных. Попробуй обновить позже.</li>";
    }
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Обновить сейчас";
  }
}

refreshBtn.addEventListener("click", refreshAll);

renderCachedPrices();
renderCachedNews();
startCountdown();

refreshAll();
setInterval(fetchPrices, PRICE_REFRESH_MS);
setInterval(fetchNews, 300_000);