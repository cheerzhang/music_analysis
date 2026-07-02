const state = {
  rows: [],
  songName: "",
};

function parseNumericValue(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const normalized = String(value).trim().replace(/,/g, "").replace(/[$€£]/g, "");
  if (!normalized) {
    return 0;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregateBy(rows, getter) {
  return rows.reduce((acc, row) => {
    const key = getter(row);
    acc[key] = (acc[key] || 0) + Number(row.revenue || 0);
    return acc;
  }, {});
}

function isVisibleTotal(value) {
  return Number(value || 0) > 0;
}

function getVisibleEntries(totals) {
  return Object.entries(totals).filter(([, value]) => isVisibleTotal(value));
}

function toCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMonthLabel(value) {
  if (!value) {
    return "";
  }
  const match = String(value).match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return String(value);
  }
  const [, year, month] = match;
  const date = new Date(Number(year), Number(month) - 1);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
  }).format(date);
}

function formatCount(value) {
  const count = Number(value || 0);
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  }
  return String(Math.round(count));
}

function formatRevenuePerHundredThousand(value) {
  const num = Number(value || 0);
  if (num <= 0) {
    return "0";
  }
  const per100k = num * 100000;
  if (per100k >= 10000) {
    return `${(per100k / 10000).toFixed(1).replace(/\.0$/, "")} 万`;
  }
  return `${per100k.toFixed(1).replace(/\.0$/, "")} /10万次`;
}

function normalizeRows(rawRows) {
  return rawRows
    .map((row) => {
      const date = row["Reporting Period"] || row["Accounting Period"] || row["date"] || row["Date"] || row["Month"] || "";
      const song = row["Track"] || row["song"] || row["Release"] || row["Title"] || "Unknown";
      const platform = row["Partner"] || row["platform"] || row["Service"] || row["Source"] || "Unknown";
      const country = row["Country"] || row["country"] || "Unknown";
      const revenue = parseNumericValue(row["Revenue (USD)"] || row["revenue"] || row["Revenue"] || row["Amount"] || "0");
      const plays = parseNumericValue(row["Units"] || row["plays"] || row["Play Count"] || "0");
      const genre = row["Type"] || row["genre"] || row["Format"] || "Unknown";
      return { date, song, platform, country, revenue, plays, genre };
    })
    .filter((row) => row.date && row.song && row.revenue > 0);
}

async function discoverDataSources() {
  const sources = [];

  try {
    const manifestResponse = await fetch("./data/manifest.json");
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json();
      const files = Array.isArray(manifest.files) ? manifest.files : [];
      files.forEach((entry) => {
        const name = entry.name || entry;
        if (typeof name === "string" && name.toLowerCase().endsWith(".csv")) {
          sources.push({ name, url: `./data/${name}` });
        }
      });
    }
  } catch (error) {
    console.warn("manifest unavailable", error);
  }

  try {
    const dirResponse = await fetch("./data/", { cache: "no-store" });
    if (dirResponse.ok) {
      const html = await dirResponse.text();
      const matches = html.matchAll(/href="([^"]+)"/g);
      Array.from(matches).forEach((match) => {
        const href = match[1];
        const name = href.split("/").pop();
        if (typeof name === "string" && name.toLowerCase().endsWith(".csv")) {
          const normalizedName = decodeURIComponent(name);
          if (!sources.some((source) => source.name === normalizedName)) {
            sources.push({ name: normalizedName, url: `./data/${normalizedName}` });
          }
        }
      });
    }
  } catch (error) {
    console.warn("directory listing unavailable", error);
  }

  return sources.filter((source, index, list) => list.findIndex((item) => item.name === source.name) === index);
}

async function loadRows() {
  const sources = await discoverDataSources();
  const allRows = [];

  for (const source of sources) {
    const csvResponse = await fetch(source.url);
    if (!csvResponse.ok) {
      continue;
    }
    const text = await csvResponse.text();
    const rows = parseCSV(text);
    allRows.push(...normalizeRows(rows));
  }

  return allRows;
}

function parseCSV(text) {
  const normalizedText = String(text || "").replace(/^\uFEFF/, "");
  const lines = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < normalizedText.length; i += 1) {
    const char = normalizedText[i];
    const next = normalizedText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(current);
      if (row.some((value) => value !== "")) {
        lines.push(row);
      }
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((value) => value !== "")) {
      lines.push(row);
    }
  }

  if (lines.length === 0) {
    return [];
  }

  const [headers, ...dataRows] = lines;
  return dataRows.map((values) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header.trim()] = values[index] ? values[index].trim() : "";
    });
    return entry;
  });
}

function getSongNameFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return decodeURIComponent(params.get("song") || "");
}

function renderSummary(rows, songName) {
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const monthly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    acc[key] = (acc[key] || 0) + row.revenue;
    return acc;
  }, {});
  const sortedMonths = Object.entries(monthly).sort(([a], [b]) => (a > b ? 1 : -1));
  const peakMonth = sortedMonths.slice().sort((a, b) => b[1] - a[1])[0] || ["暂无", 0];
  const totalPlays = rows.reduce((sum, row) => sum + Number(row.plays || 0), 0);
  const avgRevPerPlay = totalPlays ? totalRevenue / totalPlays : 0;
  const revenueScore = Math.min(100, Math.round(Math.log10(Math.max(totalRevenue, 1)) * 20));
  const playScore = Math.min(100, Math.round(Math.log10(Math.max(totalPlays, 1)) * 18));
  const efficiencyScore = Math.min(100, Math.round(Math.min(100, avgRevPerPlay * 10000)));
  const totalScore = Math.round(revenueScore * 0.4 + playScore * 0.35 + efficiencyScore * 0.25);

  const series = sortedMonths.map(([month, value]) => ({ month, value }));
  const firstThree = series.slice(0, 3).reduce((sum, item) => sum + item.value, 0);
  const lastThree = series.slice(-3).reduce((sum, item) => sum + item.value, 0);
  const momentum = firstThree ? Math.min(200, Math.round((lastThree / firstThree) * 100)) : 100;
  const trendDirection = series.length > 1
    ? series[series.length - 1].value >= series[series.length - 2].value
      ? "上升"
      : "下降"
    : "平稳";
  const platforms = new Set(rows.map((row) => row.platform || "Unknown")).size;
  const countries = new Set(rows.map((row) => row.country || "Unknown")).size;
  const prevAvg = series.length > 1 ? series.slice(0, -1).reduce((sum, item) => sum + item.value, 0) / Math.max(series.length - 1, 1) : 0;
  const lastValue = series[series.length - 1]?.value || 0;
  const surpriseHit = prevAvg > 0 && lastValue >= prevAvg * 3 ? "是" : "否";
  const incomeMonths = series.length;
  const monthKeys = series.map((item) => item.month).sort();
  let releaseMonths = 0;
  if (monthKeys.length > 0) {
    const [firstYear, firstMonth] = monthKeys[0].split("-").map(Number);
    const [lastYear, lastMonth] = monthKeys[monthKeys.length - 1].split("-").map(Number);
    releaseMonths = (lastYear - firstYear) * 12 + (lastMonth - firstMonth) + 1;
  }

  const cards = [
    { type: "score", icon: "✦", title: "作品指数", value: `${totalScore}`, suffix: "/ 100", detail: `${releaseMonths} 个月周期 · ${trendDirection}趋势 · ${momentum}% 动能` },
    { type: "revenue", icon: "＄", title: "累计收入", value: toCurrency(totalRevenue), detail: `峰值 ${formatMonthLabel(peakMonth[0])} · ${toCurrency(peakMonth[1])}` },
    { type: "plays", icon: "▶", title: "累计播放", value: formatCount(totalPlays), detail: `${incomeMonths} 个月产生收入` },
    { type: "efficiency", icon: "↗", title: "每 10 万次变现", value: formatRevenuePerHundredThousand(avgRevPerPlay), detail: "播放到收入的转化效率" },
    { type: "reach", icon: "◎", title: "市场覆盖", value: `${countries} 地区`, detail: `覆盖 ${platforms} 个平台${surpriseHit === "是" ? " · 近期出现爆发增长" : ""}` },
  ];

  document.getElementById("songSummaryGrid").innerHTML = cards
    .map((card) => `
      <article class="song-kpi song-kpi--${card.type}">
        <div class="song-kpi__label"><span>${card.icon}</span>${card.title}</div>
        <div class="song-kpi__value">${card.value}${card.suffix ? `<small>${card.suffix}</small>` : ""}</div>
        <p>${card.detail}</p>
      </article>
    `)
    .join("");
  document.getElementById("songTitle").textContent = songName;
  document.getElementById("songSubtitle").textContent = `从收入、播放与市场分布，看懂这首作品的长期价值。`;
}

function renderYearlyStats(rows) {
  const yearly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const year = String(date.getFullYear());
    const month = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    acc[year] ||= { revenue: 0, plays: 0, months: new Set() };
    acc[year].revenue += Number(row.revenue || 0);
    acc[year].plays += Number(row.plays || 0);
    acc[year].months.add(month);
    return acc;
  }, {});

  document.getElementById("songYearGrid").innerHTML = Object.entries(yearly)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, stats]) => {
      const monthCount = stats.months.size || 1;
      return `
        <article class="song-year-card">
          <div class="song-year-card__head"><strong>${year}</strong><span>${monthCount} 个月数据</span></div>
          <div class="song-year-metrics">
            <div><span>年度收入</span><strong>${toCurrency(stats.revenue)}</strong></div>
            <div><span>月均收入</span><strong>${toCurrency(stats.revenue / monthCount)}</strong></div>
            <div><span>年度播放</span><strong>${formatCount(stats.plays)}</strong></div>
            <div><span>月均播放</span><strong>${formatCount(stats.plays / monthCount)}</strong></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTrendChart(rows) {
  const monthly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    acc[key] = (acc[key] || 0) + row.revenue;
    return acc;
  }, {});
  const entries = Object.entries(monthly).sort(([a], [b]) => (a > b ? 1 : -1));
  const labels = entries.map(([label]) => label);
  const values = entries.map(([, value]) => value);
  const countryByMonth = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const country = row.country || "Unknown";
    acc[month] ||= {};
    acc[month][country] = (acc[month][country] || 0) + Number(row.revenue || 0);
    return acc;
  }, {});
  const width = 900;
  const height = 260;
  const paddingX = 28;
  const paddingTop = 25;
  const paddingBottom = 38;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingTop - paddingBottom;
  const max = Math.max(...values, 1);
  const baseline = paddingTop + chartHeight;
  const points = values.map((value, index) => ({
    x: paddingX + (values.length === 1 ? chartWidth / 2 : (index / (values.length - 1)) * chartWidth),
    y: paddingTop + chartHeight - (value / max) * chartHeight,
    value,
    label: formatMonthLabel(labels[index]),
    countries: Object.entries(countryByMonth[labels[index]] || {}).sort(([, a], [, b]) => b - a).slice(0, 3),
  }));
  const linePath = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
  const labelStep = Math.max(1, Math.ceil(labels.length / 7));

  document.getElementById("songTrendChart").innerHTML = `
    <svg class="song-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="歌曲月度收入趋势">
      <defs>
        <linearGradient id="songTrendArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#9b87f5" stop-opacity=".38"></stop>
          <stop offset="100%" stop-color="#9b87f5" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      ${[0, 1, 2].map((index) => `<line class="song-trend-grid" x1="${paddingX}" y1="${paddingTop + (index / 2) * chartHeight}" x2="${width - paddingX}" y2="${paddingTop + (index / 2) * chartHeight}"></line>`).join("")}
      <path class="song-trend-area" d="${areaPath}"></path>
      <path class="song-trend-line" d="${linePath}"></path>
      ${points.map((point, index) => {
        const tooltipX = Math.max(4, Math.min(width - 224, point.x - 110));
        const tooltipY = point.y < 100 ? point.y + 12 : point.y - 92;
        return `<g class="song-trend-point" tabindex="0">
          <circle cx="${point.x}" cy="${point.y}" r="4"></circle>
          <foreignObject class="trend-tooltip" x="${tooltipX}" y="${tooltipY}" width="220" height="82">
            <div xmlns="http://www.w3.org/1999/xhtml" class="trend-tooltip-card">
              <div class="tooltip-head"><span>${point.label}</span><strong>${toCurrency(point.value)}</strong></div>
              ${point.countries.map(([country, revenue], rank) => `<div class="tooltip-song"><span>${rank + 1}. ${country}</span><strong>${toCurrency(revenue)}</strong></div>`).join("")}
            </div>
          </foreignObject>
          ${index % labelStep === 0 || index === points.length - 1 ? `<text x="${point.x}" y="${height - 10}" text-anchor="${index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}">${point.label}</text>` : ""}
        </g>`;
      }).join("")}
    </svg>
  `;
}

function renderPlatformChart(rows) {
  const totals = aggregateBy(rows, (row) => row.platform || "Unknown");
  const entries = getVisibleEntries(totals).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  document.getElementById("songPlatformChart").innerHTML = entries
    .map(([label, value], index) => `
      <div class="song-distribution-item">
        <span class="distribution-rank">${String(index + 1).padStart(2, "0")}</span>
        <div class="distribution-main"><div><span>${label}</span><strong>${toCurrency(value)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${total ? (value / total) * 100 : 0}%;"></div></div></div>
        <span class="distribution-share">${total ? Math.round((value / total) * 100) : 0}%</span>
      </div>
    `)
    .join("");
}

function renderPlayPlatformChart(rows) {
  const totals = rows.reduce((acc, row) => {
    const platform = row.platform || "Unknown";
    acc[platform] = (acc[platform] || 0) + Number(row.plays || 0);
    return acc;
  }, {});
  const entries = Object.entries(totals).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  document.getElementById("songPlayPlatformChart").innerHTML = entries.length
    ? entries.map(([label, value], index) => `
        <div class="song-distribution-item">
          <span class="distribution-rank">${String(index + 1).padStart(2, "0")}</span>
          <div class="distribution-main"><div><span>${label}</span><strong>${formatCount(value)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${total ? (value / total) * 100 : 0}%;"></div></div></div>
          <span class="distribution-share">${total ? Math.round((value / total) * 100) : 0}%</span>
        </div>
      `).join("")
    : '<p class="empty-channel-state">暂无平台播放数据</p>';
}

function renderRegionTrendChart(rows) {
  const countryTotals = rows.reduce((acc, row) => {
    const country = row.country || "Unknown";
    acc[country] = (acc[country] || 0) + Number(row.revenue || 0);
    return acc;
  }, {});
  const topCountries = Object.entries(countryTotals).sort(([, a], [, b]) => b - a).slice(0, 3).map(([country]) => country);
  const months = [...new Set(rows.map((row) => {
    const date = new Date(row.date);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }))].sort();
  const monthly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const country = row.country || "Unknown";
    acc[country] ||= {};
    acc[country][month] = (acc[country][month] || 0) + Number(row.revenue || 0);
    return acc;
  }, {});

  if (!topCountries.length || !months.length) {
    document.getElementById("songRegionTrendChart").innerHTML = '<p class="empty-channel-state">暂无地区趋势数据</p>';
    return;
  }

  const colors = ["#9b87f5", "#63c9f2", "#68ddb5"];
  const width = 900;
  const height = 270;
  const paddingX = 30;
  const paddingTop = 25;
  const paddingBottom = 42;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingTop - paddingBottom;
  const series = topCountries.map((country) => ({
    country,
    values: months.map((month) => Number(monthly[country]?.[month] || 0)),
  }));
  const max = Math.max(...series.flatMap((item) => item.values), 1);
  const labelStep = Math.max(1, Math.ceil(months.length / 7));
  const getPoint = (value, index) => ({
    x: paddingX + (months.length === 1 ? chartWidth / 2 : (index / (months.length - 1)) * chartWidth),
    y: paddingTop + chartHeight - (value / max) * chartHeight,
  });

  const lines = series.map((item, seriesIndex) => {
    const points = item.values.map(getPoint);
    const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
    return `<g class="region-series" style="--series-color:${colors[seriesIndex]}">
      <path class="region-line" d="${path}"></path>
      ${points.map((point, index) => `<circle class="region-point" cx="${point.x}" cy="${point.y}" r="3.5"><title>${item.country} · ${formatMonthLabel(months[index])}：${toCurrency(item.values[index])}</title></circle>`).join("")}
    </g>`;
  }).join("");

  document.getElementById("songRegionTrendChart").innerHTML = `
    <div class="region-legend">${topCountries.map((country, index) => `<span><i style="background:${colors[index]}"></i>${country}</span>`).join("")}</div>
    <div class="region-chart-scroll">
      <svg class="region-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="前三地区月度收入趋势">
        ${[0, 1, 2].map((index) => `<line class="song-trend-grid" x1="${paddingX}" y1="${paddingTop + (index / 2) * chartHeight}" x2="${width - paddingX}" y2="${paddingTop + (index / 2) * chartHeight}"></line>`).join("")}
        ${lines}
        ${months.map((month, index) => index % labelStep === 0 || index === months.length - 1 ? `<text class="region-month-label" x="${getPoint(0, index).x}" y="${height - 10}" text-anchor="${index === 0 ? "start" : index === months.length - 1 ? "end" : "middle"}">${formatMonthLabel(month)}</text>` : "").join("")}
      </svg>
    </div>
  `;
}

function renderPeakMonth(rows) {
  const monthly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    acc[key] = (acc[key] || 0) + row.revenue;
    return acc;
  }, {});
  const entries = Object.entries(monthly).sort((a, b) => b[1] - a[1]);
  const [month, value] = entries[0] || ["暂无", 0];
  document.getElementById("songPeakMonth").innerHTML = `
    <div class="insight-item">
      <div>
        <strong>${month}</strong>
        <div>${toCurrency(value)} 的单月收入</div>
      </div>
    </div>
  `;
}

function renderDetails(rows) {
  document.getElementById("songDetailsTable").innerHTML = `
    <table>
      <thead>
        <tr><th>日期</th><th>平台</th><th>地区</th><th>收益</th><th>类型</th></tr>
      </thead>
      <tbody>
        ${rows.slice().sort((a,b) => b.revenue - a.revenue).slice(0, 10).map((row) => `
          <tr>
            <td>${row.date}</td>
            <td>${row.platform}</td>
            <td>${row.country}</td>
            <td>${toCurrency(row.revenue)}</td>
            <td>${row.genre}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function renderSongPage() {
  const songName = getSongNameFromUrl();
  if (!songName) {
    document.getElementById("songStatus").textContent = "没有选择歌曲。";
    return;
  }

  const rows = await loadRows();
  const songRows = rows.filter((row) => row.song === songName);
  if (!songRows.length) {
    document.getElementById("songStatus").textContent = "没有找到这首歌的数据。";
    return;
  }

  state.rows = songRows;
  state.songName = songName;
  document.getElementById("songStatus").textContent = `已加载 ${songRows.length} 条记录。`;
  renderSummary(songRows, songName);
  renderYearlyStats(songRows);
  renderTrendChart(songRows);
  renderPlatformChart(songRows);
  renderPlayPlatformChart(songRows);
  renderRegionTrendChart(songRows);
}

window.addEventListener("DOMContentLoaded", renderSongPage);
