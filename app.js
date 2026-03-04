const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

const pricesContainer = document.getElementById("prices");
const newsList = document.getElementById("newsList");
const updatedAt = document.getElementById("updatedAt");
const refreshBtn = document.getElementById("refreshBtn");

const fmtPrice = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatChange(change) {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

function markUpdated() {
  const now = new Date();
  updatedAt.textContent = `Обновление: ${now.toLocaleString("ru-RU")}`;
}

async function fetchPrices() {
  const requests = symbols.map((symbol) =>
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`).then((r) => r.json())
  );

  const data = await Promise.all(requests);

  data.forEach((ticker) => {
    const el = pricesContainer.querySelector(`[data-symbol="${ticker.symbol}"]`);
    if (!el) return;

    const price = Number(ticker.lastPrice);
    const change = Number(ticker.priceChangePercent);

    const priceEl = el.querySelector(".price");
    const changeEl = el.querySelector(".change");

    priceEl.textContent = `$${fmtPrice.format(price)}`;
    changeEl.textContent = `24ч: ${formatChange(change)}`;
    changeEl.classList.remove("up", "down");
    changeEl.classList.add(change >= 0 ? "up" : "down");
  });
}

async function fetchNews() {
  const url = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN";
  const res = await fetch(url);
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
}

async function refreshAll() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Обновляю...";

  try {
    await Promise.all([fetchPrices(), fetchNews()]);
    markUpdated();
  } catch (e) {
    console.error(e);
    newsList.innerHTML = "<li>Ошибка загрузки данных. Попробуй обновить позже.</li>";
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Обновить";
  }
}

refreshBtn.addEventListener("click", refreshAll);
refreshAll();
setInterval(fetchPrices, 60_000);
setInterval(fetchNews, 300_000);
