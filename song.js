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
  return Math.round(Number(value || 0)) >= 1;
}

function getVisibleEntries(totals) {
  return Object.entries(totals).filter(([, value]) => isVisibleTotal(value));
}

function toCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
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
  const peakMonth = sortedMonths.length ? sortedMonths[sortedMonths.length - 1] : ["暂无", 0];
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
    { title: "歌曲评分", value: `${totalScore} 分`, detail: "综合收入、播放与变现效率得分" },
    { title: "总收入", value: toCurrency(totalRevenue), detail: "该歌曲累计收益" },
    { title: "总播放", value: formatCount(totalPlays), detail: "该歌曲累计播放量" },
    { title: "每10万次变现", value: formatRevenuePerHundredThousand(avgRevPerPlay), detail: "按播放效率计算的变现水平" },
    { title: "发布", value: `${releaseMonths} 个月`, detail: "自发布以来经过的月份数" },
    { title: "有收入", value: `${incomeMonths} 个月`, detail: "该歌曲出现有效收入的月份数" },
    { title: "动能", value: `${momentum}%`, detail: "近三个月播放动能" },
    { title: "平台", value: `${platforms}`, detail: "该歌曲出现的平台数量" },
    { title: "国家", value: `${countries}`, detail: "该歌曲覆盖的国家数量" },
    { title: "趋势", value: trendDirection, detail: "最新收入走势" },
    { title: "爆发", value: surpriseHit, detail: "最近是否出现爆发式增长" },
  ];

  document.getElementById("songSummaryGrid").innerHTML = cards
    .map((card) => `
      <article class="summary-card">
        <h3>${card.title}</h3>
        <div class="value">${card.value}</div>
        <p class="status">${card.detail}</p>
      </article>
    `)
    .join("");
  document.getElementById("songTitle").textContent = songName;
  document.getElementById("songSubtitle").textContent = `这是 ${songName} 的详细收入分析。`;
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
  const width = 560;
  const height = 240;
  const padding = 36;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const max = Math.max(...values, 1);
  const barWidth = chartWidth / Math.max(values.length, 1) - 10;
  const rotate = labels.length > 6 ? -35 : 0;

  const gridMarkup = Array.from({ length: 4 }, (_, index) => {
    const y = padding + (index / 3) * chartHeight;
    const tickValue = max - (max / 3) * index;
    return `
      <line class="chart-grid" x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}"></line>
      <text class="chart-label" x="${padding - 8}" y="${y + 4}" text-anchor="end">${toCurrency(tickValue)}</text>
    `;
  }).join("");

  const labelStep = Math.max(1, Math.ceil(labels.length / 8));
  const barsMarkup = values.map((value, index) => {
    const x = padding + index * (barWidth + 10) + 4;
    const barHeight = (value / max) * chartHeight;
    const y = height - padding - barHeight;
    const label = index % labelStep === 0 ? formatMonthLabel(labels[index]) : "";
    const tooltip = `${formatMonthLabel(labels[index])}：${toCurrency(value)}`;
    return `
      <g class="chart-point" tabindex="0">
        <title>${tooltip}</title>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="url(#trendGradient)"></rect>
        <text class="chart-label" x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" transform="rotate(${rotate} ${x + barWidth / 2} ${height - 10})">${label}</text>
      </g>
    `;
  }).join("");

  document.getElementById("songTrendChart").innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="240">
      <defs>
        <linearGradient id="trendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#7c9cff"></stop>
          <stop offset="100%" stop-color="#43d9ad"></stop>
        </linearGradient>
      </defs>
      <line class="chart-axis" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
      <line class="chart-axis" x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}"></line>
      ${gridMarkup}
      ${barsMarkup}
    </svg>
  `;
}

function renderPlatformChart(rows) {
  const totals = aggregateBy(rows, (row) => row.platform || "Unknown");
  const entries = getVisibleEntries(totals).sort((a, b) => b[1] - a[1]);
  document.getElementById("songPlatformChart").innerHTML = entries
    .map(([label, value]) => `
      <div class="platform-item" title="${label}: ${toCurrency(value)}">
        <span>${label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.round((value / Math.max(...entries.map(([,v]) => v), 1)) * 100))}%;"></div></div>
        <strong>${toCurrency(value)}</strong>
      </div>
    `)
    .join("");
}

function renderCountryChart(rows) {
  const totals = aggregateBy(rows, (row) => row.country || "Unknown");
  const entries = getVisibleEntries(totals).sort((a, b) => b[1] - a[1]);
  document.getElementById("songCountryChart").innerHTML = entries
    .map(([label, value]) => `
      <div class="country-item" title="${label}: ${toCurrency(value)}">
        <span>${label}</span>
        <strong>${toCurrency(value)}</strong>
      </div>
    `)
    .join("");
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
  renderTrendChart(songRows);
  renderPlatformChart(songRows);
  renderCountryChart(songRows);
}

window.addEventListener("DOMContentLoaded", renderSongPage);
