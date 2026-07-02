const SAMPLE_CSV = `date,song,platform,country,revenue,genre
2024-01-15,Midnight Glow,Spotify,US,420,Indie Pop
2024-01-20,Midnight Glow,Apple Music,UK,180,Indie Pop
2024-02-03,Neon Rain,Spotify,US,310,Alt Rock
2024-02-11,Neon Rain,YouTube,CA,140,Alt Rock
2024-03-05,Ocean Signal,Spotify,DE,260,Ambient
2024-03-19,Ocean Signal,Bandcamp,US,220,Ambient
2024-04-08,Summer Static,Spotify,BR,170,Chillwave
2024-04-16,Summer Static,Apple Music,AU,120,Chillwave
2024-05-11,Midnight Glow,Spotify,US,460,Indie Pop
2024-05-24,Neon Rain,Spotify,FR,210,Alt Rock
2024-06-01,Ocean Signal,Spotify,US,310,Ambient
2024-06-17,Summer Static,YouTube,US,150,Chillwave
2024-07-03,Midnight Glow,Spotify,UK,500,Indie Pop
2024-07-20,Neon Rain,Apple Music,US,230,Alt Rock
2024-08-14,Ocean Signal,Bandcamp,DE,260,Ambient
2024-08-28,Summer Static,Spotify,US,180,Chillwave`;

const state = {
  rows: [],
  sourceFiles: [],
};

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
  return true;
}

function getVisibleEntries(totals) {
  return Object.entries(totals).filter(([, value]) => isVisibleTotal(value));
}

function normalizeRows(rawRows) {
  return rawRows
    .map((row) => {
      const date = row["Reporting Period"] || row["Accounting Period"] || row["date"] || row["Date"] || row["Month"] || "";
      const song = row["Track"] || row["song"] || row["Release"] || row["Title"] || "Unknown";
      const platform = normalizePlatformName(row["Partner"] || row["platform"] || row["Service"] || row["Source"] || "Unknown");
      const country = normalizeCountryName(row["Country"] || row["country"] || "Unknown");
      const revenue = parseNumericValue(row["Revenue (USD)"] || row["revenue"] || row["Revenue"] || row["Amount"] || "0");
      const plays = parseNumericValue(row["Units"] || row["plays"] || row["Play Count"] || "0");
      const genre = row["Type"] || row["genre"] || row["Format"] || "Unknown";

      return {
        date,
        song,
        platform,
        country,
        revenue,
        plays,
        genre,
      };
    })
    .filter((row) => row.date && row.song && row.revenue > 0);
}

function normalizePlatformName(platform) {
  const value = String(platform || "Unknown").trim();
  const map = {
    facebook: "Facebook",
    instagram: "Instagram",
    spotify: "Spotify",
    youtube: "YouTube",
    tiktok: "TikTok",
    apple: "Apple Music",
    applemusic: "Apple Music",
    tencent: "腾讯",
    qq: "腾讯",
    wechat: "微信",
    bandcamp: "Bandcamp",
  };
  const lower = value.toLowerCase();
  return map[lower] || value;
}

function normalizeCountryName(country) {
  return String(country || "Unknown").trim().toUpperCase();
}

function toDate(value) {
  return new Date(value);
}

function renderSummary(rows) {
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue), 0);
  const songRevenue = aggregateBy(rows, (row) => row.song || "Unknown");
  const visibleSongs = getVisibleEntries(songRevenue).sort((a, b) => b[1] - a[1]);
  const bestSong = visibleSongs[0];
  const platformRevenue = aggregateBy(rows, (row) => row.platform || "Unknown");
  const visiblePlatforms = getVisibleEntries(platformRevenue).sort((a, b) => b[1] - a[1]);
  const bestPlatform = visiblePlatforms[0];
  const countryRevenue = aggregateBy(rows, (row) => row.country || "Unknown");
  const visibleCountries = getVisibleEntries(countryRevenue).sort((a, b) => b[1] - a[1]);
  const bestCountry = visibleCountries[0];

  const monthly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    acc[key] = (acc[key] || 0) + Number(row.revenue);
    return acc;
  }, {});
  const values = Object.values(monthly);
  const growth = values.length > 1 ? ((values[values.length - 1] - values[0]) / values[0]) * 100 : 0;

  const totalPlays = rows.reduce((sum, row) => sum + Number(row.plays || 0), 0);
  const avgRevPerPlay = totalPlays ? totalRevenue / totalPlays : 0;
  const monthKeys = Object.keys(monthly).sort();
  const incomeMonths = monthKeys.length;
  let releaseMonths = 0;
  if (monthKeys.length > 0) {
    const [firstYear, firstMonth] = monthKeys[0].split("-").map(Number);
    const [lastYear, lastMonth] = monthKeys[monthKeys.length - 1].split("-").map(Number);
    releaseMonths = (lastYear - firstYear) * 12 + (lastMonth - firstMonth) + 1;
  }

  const cards = [
    { title: "总收入", value: toCurrency(totalRevenue), detail: "所有记录累计收益" },
    { title: "总播放", value: formatCount(totalPlays), detail: "所有记录累计播放量" },
    { title: "每10万次变现", value: formatRevenuePerHundredThousand(avgRevPerPlay), detail: "平均每10万次播放的收益" },
    { title: "发布", value: `${releaseMonths} 个月`, detail: "自发布以来经过的月份数" },
    { title: "有收入", value: `${incomeMonths} 个月`, detail: "出现有效收入的月份数" },
    { title: "增长趋势", value: `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`, detail: "按月均值观察变化" },
  ];

  document.getElementById("summaryGrid").innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <h3>${card.title}</h3>
          <div class="value">${card.value}</div>
          <p class="status">${card.detail}</p>
        </article>
      `
    )
    .join("");

  document.getElementById("summaryGrid").querySelectorAll(".summary-card").forEach((card, index) => {
    card.style.borderColor = index === 3 ? "rgba(67,217,173,0.35)" : "rgba(124,156,255,0.2)";
  });
}

function renderSongChart(rows) {
  const totals = aggregateBy(rows, (row) => row.song || "Unknown");
  const entries = getVisibleEntries(totals).sort((a, b) => b[1] - a[1]);
  const topEntries = entries.slice(0, 5);
  const remainderEntries = entries.slice(5);
  const max = Math.max(...entries.map(([, value]) => value), 1);

  const topMarkup = topEntries
    .map(([label, value]) => {
      const widthPercent = Math.max(12, Math.round((value / max) * 100));
      return `
        <a class="platform-item" href="./song.html?song=${encodeURIComponent(label)}">
          <span>${label}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${widthPercent}%;"></div>
          </div>
          <strong>${toCurrency(value)}</strong>
        </a>
      `;
    })
    .join("");

  const remainderMarkup = remainderEntries.length
    ? `
        <details class="collapsible-block">
          <summary>其余 ${remainderEntries.length} 项</summary>
          <div class="collapsible-list">
            ${remainderEntries
              .map(([label, value]) => `
                <a class="platform-item" href="./song.html?song=${encodeURIComponent(label)}">
                  <span>${label}</span>
                  <strong>${toCurrency(value)}</strong>
                </a>
              `)
              .join("")}
          </div>
        </details>
      `
    : "";

  document.getElementById("songChart").innerHTML = `${topMarkup}${remainderMarkup}`;
}

function renderPlatformChart(rows) {
  const totals = aggregateBy(rows, (row) => row.platform || "Unknown");
  const entries = getVisibleEntries(totals).sort((a, b) => b[1] - a[1]);
  const topEntries = entries.slice(0, 3);
  const remainderEntries = entries.slice(3);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const monthly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const platform = row.platform || "Unknown";
    acc[platform] = acc[platform] || {};
    acc[platform][key] = (acc[platform][key] || 0) + Number(row.revenue);
    return acc;
  }, {});

  const topMarkup = topEntries
    .map(([label, value]) => {
      const percent = total ? Math.round((value / total) * 100) : 0;
      const monthlyEntries = Object.entries(monthly[label] || {}).sort(([a], [b]) => (a > b ? 1 : -1));
      const trendSvg = monthlyEntries.length ? buildTrendSvg(monthlyEntries.map(([, monthValue]) => monthValue), monthlyEntries.map(([month]) => month)) : "";
      return `
        <div class="platform-item platform-item--detailed">
          <div class="platform-header">
            <span>${label}</span>
            <strong>${toCurrency(value)} · ${percent}%</strong>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${percent}%;"></div>
          </div>
          <details>
            <summary>收入变化趋势</summary>
            <div class="trend-panel">
              ${trendSvg || '<div class="status">暂无趋势</div>'}
            </div>
          </details>
        </div>
      `;
    })
    .join("");

  const remainderMarkup = remainderEntries.length
    ? `
        <details class="collapsible-block">
          <summary>其余 ${remainderEntries.length} 项</summary>
          <div class="collapsible-list">
            ${remainderEntries
              .map(([label, value]) => `
                <div class="platform-item">
                  <span>${label}</span>
                  <strong>${toCurrency(value)}</strong>
                </div>
              `)
              .join("")}
          </div>
        </details>
      `
    : "";

  document.getElementById("platformChart").innerHTML = `${topMarkup}${remainderMarkup}`;
}

function buildTrendSvg(values, labels = []) {
  if (!values.length) {
    return "";
  }
  const padding = 18;
  const width = Math.max(260, values.length * 32 + padding * 2);
  const height = 96;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const max = Math.max(...values, 1);
  const barWidth = Math.max(12, chartWidth / Math.max(values.length, 1) - 8);
  const labelStep = Math.max(1, Math.ceil(values.length / 7));
  const rotate = values.length > 8 ? -35 : 0;

  const bars = values.map((value, index) => {
    const x = padding + index * (barWidth + 8) + 4;
    const barHeight = (value / max) * chartHeight;
    const y = height - padding - barHeight;
    const fullLabel = labels[index] ? formatMonthLabel(labels[index]) : `${index + 1}`;
    const label = index % labelStep === 0 ? fullLabel : "";
    const textX = x + barWidth / 2;
    return `
      <g class="chart-point" tabindex="0">
        <title>${fullLabel}: ${toCurrency(value)}</title>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="url(#trendGradient)"></rect>
        <text class="chart-label" x="${textX}" y="${height - 6}" text-anchor="middle" transform="rotate(${rotate} ${textX} ${height - 6})">${label}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="100%" height="96">
      <defs>
        <linearGradient id="trendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#7c9cff"></stop>
          <stop offset="100%" stop-color="#43d9ad"></stop>
        </linearGradient>
      </defs>
      <line class="chart-axis" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
      <line class="chart-axis" x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}"></line>
      ${bars}
    </svg>
  `;
}

function renderCountryChart(rows) {
  const totals = aggregateBy(rows, (row) => row.country || "Unknown");
  const entries = getVisibleEntries(totals).sort((a, b) => b[1] - a[1]);
  const topEntries = entries.slice(0, 5);
  const remainderEntries = entries.slice(5);

  const topMarkup = topEntries
    .map(([label, value]) => {
      const monthly = rows.filter((row) => row.country === label).reduce((acc, row) => {
        const date = new Date(row.date);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        acc[key] = (acc[key] || 0) + Number(row.revenue);
        return acc;
      }, {});
      const monthlyEntries = Object.entries(monthly).sort(([a], [b]) => (a > b ? 1 : -1));
      const trendSvg = buildTrendSvg(monthlyEntries.map(([, monthValue]) => monthValue), monthlyEntries.map(([month]) => month));
      return `
        <div class="country-item country-item--detailed">
          <div class="platform-header">
            <span>${label}</span>
            <strong>${toCurrency(value)}</strong>
          </div>
          <details>
            <summary>收入变化趋势</summary>
            <div class="trend-panel">${trendSvg || '<div class="status">暂无趋势</div>'}</div>
          </details>
        </div>
      `;
    })
    .join("");

  const remainderMarkup = remainderEntries.length
    ? `
        <details class="collapsible-block">
          <summary>其余 ${remainderEntries.length} 项</summary>
          <div class="collapsible-list">
            ${remainderEntries
              .map(([label, value]) => `
                <div class="country-item">
                  <span>${label}</span>
                  <strong>${toCurrency(value)}</strong>
                </div>
              `)
              .join("")}
          </div>
        </details>
      `
    : "";

  document.getElementById("countryChart").innerHTML = `${topMarkup}${remainderMarkup}`;
}

function renderTrendChart(rows) {
  const monthly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    acc[key] = (acc[key] || 0) + Number(row.revenue);
    return acc;
  }, {});

  const entries = Object.entries(monthly).sort(([a], [b]) => (a > b ? 1 : -1));
  const labels = entries.map(([label]) => label);
  const values = entries.map(([, value]) => value);
  const padding = 36;
  const width = Math.max(560, labels.length * 40 + padding * 2);
  const height = 240;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const max = Math.max(...values, 1);
  const barWidth = Math.max(18, chartWidth / Math.max(values.length, 1) - 10);
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));
  const rotate = labels.length > 8 ? -45 : 0;

  const gridMarkup = Array.from({ length: 4 }, (_, index) => {
    const y = padding + (index / 3) * chartHeight;
    const tickValue = max - (max / 3) * index;
    return `
      <line class="chart-grid" x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}"></line>
      <text class="chart-label" x="${padding - 8}" y="${y + 4}" text-anchor="end">${toCurrency(tickValue)}</text>
    `;
  }).join("");

  const barsMarkup = values.map((value, index) => {
    const x = padding + index * (barWidth + 10) + 4;
    const barHeight = (value / max) * chartHeight;
    const y = height - padding - barHeight;
    const fullLabel = `${formatMonthLabel(labels[index])}：${toCurrency(value)}`;
    const label = index % labelStep === 0 ? formatMonthLabel(labels[index]) : "";
    return `
      <g class="chart-point" tabindex="0">
        <title>${fullLabel}</title>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="url(#trendGradient)"></rect>
        <text class="chart-label" x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" transform="rotate(${rotate} ${x + barWidth / 2} ${height - 10})">${label}</text>
      </g>
    `;
  }).join("");

  document.getElementById("trendChart").innerHTML = `
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

function renderInsights(rows) {
  const genreRevenue = aggregateBy(rows, (row) => row.genre || "Unknown");
  const dominantGenre = getVisibleEntries(genreRevenue).sort((a, b) => b[1] - a[1])[0];

  const platformRevenue = aggregateBy(rows, (row) => row.platform || "Unknown");
  const dominantPlatform = getVisibleEntries(platformRevenue).sort((a, b) => b[1] - a[1])[0];

  const songRevenue = aggregateBy(rows, (row) => row.song || "Unknown");
  const bestSong = getVisibleEntries(songRevenue).sort((a, b) => b[1] - a[1])[0];

  const suggestions = [
    {
      title: "下一首建议",
      text: `优先创作和 ${dominantGenre ? dominantGenre[0] : "当前风格"} 相近的作品，尤其是能在 ${dominantPlatform ? dominantPlatform[0] : "主流平台"} 上形成复播的旋律线。`,
    },
    {
      title: "听众留存",
      text: `${bestSong ? bestSong[0] : "你的主打歌"} 目前是收益核心，说明它的核心卖点足够清晰。可以继续延展出同风格的后续单曲。`,
    },
    {
      title: "平台策略",
      text: `如果 ${dominantPlatform ? dominantPlatform[0] : "你的主要平台"} 的收益占比已经明显领先，下一步可把发行节奏和素材投放重点放在这里。`,
    },
  ];

  document.getElementById("insights").innerHTML = suggestions
    .map(
      (item) => `
        <div class="insight-item">
          <div>
            <strong>${item.title}</strong>
            <div>${item.text}</div>
          </div>
        </div>
      `
    )
    .join("");
}

function renderDetails(rows) {
  const rowsToDisplay = rows.slice().sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 8);
  document.getElementById("detailsTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>日期</th>
          <th>歌曲</th>
          <th>平台</th>
          <th>地区</th>
          <th>收益</th>
          <th>风格</th>
        </tr>
      </thead>
      <tbody>
        ${rowsToDisplay
          .map(
            (row) => `
              <tr>
                <td>${row.date}</td>
                <td>${row.song}</td>
                <td>${row.platform}</td>
                <td>${row.country}</td>
                <td>${toCurrency(Number(row.revenue))}</td>
                <td>${row.genre}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function getMonthlySeries(rows) {
  const monthly = rows.reduce((acc, row) => {
    const date = new Date(row.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    acc[key] = (acc[key] || 0) + Number(row.revenue);
    return acc;
  }, {});
  return Object.entries(monthly)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([month, value]) => ({ month, value }));
}

function getSongMonthlySeries(rows) {
  const bySong = {};
  rows.forEach((row) => {
    const song = row.song || "Unknown";
    const date = new Date(row.date);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    bySong[song] = bySong[song] || {};
    bySong[song][month] = (bySong[song][month] || 0) + row.revenue;
  });
  return Object.entries(bySong).map(([song, months]) => {
    const series = Object.entries(months)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([month, value]) => ({ month, value }));
    return { song, series, total: series.reduce((sum, item) => sum + item.value, 0) };
  });
}

function getSongPlaysSeries(rows) {
  const bySong = {};
  rows.forEach((row) => {
    const song = row.song || "Unknown";
    const date = new Date(row.date);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    bySong[song] = bySong[song] || {};
    bySong[song][month] = (bySong[song][month] || 0) + Number(row.plays || 0);
  });

  return Object.entries(bySong).map(([song, months]) => {
    const series = Object.entries(months)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([month, value]) => ({ month, value }));
    return { song, series, total: series.reduce((sum, item) => sum + item.value, 0) };
  });
}

function calculatePlayScores(rows) {
  const playSeries = getSongPlaysSeries(rows);
  return playSeries.map((songData) => {
    const series = songData.series;
    const firstThree = series.slice(0, 3).reduce((sum, item) => sum + item.value, 0);
    const lastThree = series.slice(-3).reduce((sum, item) => sum + item.value, 0);
    const momentum = firstThree ? Math.min(200, Math.round((lastThree / firstThree) * 100)) : 100;
    const trendDirection = series.length > 1
      ? series[series.length - 1].value >= series[series.length - 2].value
        ? "上升"
        : "下降"
      : "平稳";
    const totalRevenue = rows.filter((row) => row.song === songData.song).reduce((sum, row) => sum + Number(row.revenue), 0);
    const avgRevPerPlay = songData.total > 0 ? totalRevenue / songData.total : 0;
    const platforms = new Set(rows.filter((row) => row.song === songData.song).map((row) => row.platform || "Unknown")).size;
    const countries = new Set(rows.filter((row) => row.song === songData.song).map((row) => row.country || "Unknown")).size;

    return {
      song: songData.song,
      totalPlays: songData.total,
      totalRevenue,
      avgRevPerPlay,
      playMomentum: `${momentum}%`,
      platformCount: platforms,
      countryCount: countries,
      trendDirection,
      totalScore: `${Math.round(Math.min(100, momentum * 0.4 + Math.min(platforms, 6) * 6 + Math.min(countries, 6) * 5 + Math.min(avgRevPerPlay * 100, 30)))} 分`,
    };
  });
}

function calculateSongScores(rows) {
  const songSeries = getSongMonthlySeries(rows);
  return songSeries.map((songData) => {
    const series = songData.series;
    const firstThree = series.slice(0, 3).reduce((sum, item) => sum + item.value, 0);
    const lastThree = series.slice(-3).reduce((sum, item) => sum + item.value, 0);
    const evergreen = firstThree ? Math.min(200, Math.round((lastThree / firstThree) * 100)) : 100;
    const slowBurn = songData.series.length > 3 ? Math.min(100, Math.round((lastThree / Math.max(firstThree, 1)) * 100)) : 0;
    const platforms = new Set(rows.filter((row) => row.song === songData.song).map((row) => row.platform || "Unknown")).size;
    const countries = new Set(rows.filter((row) => row.song === songData.song).map((row) => row.country || "Unknown")).size;
    const lastValue = series[songData.series.length - 1]?.value || 0;
    const prevAvg = songData.series.length > 1 ? series.slice(0, -1).reduce((sum, item) => sum + item.value, 0) / Math.max(songData.series.length - 1, 1) : 0;
    const surpriseHit = prevAvg > 0 && lastValue >= prevAvg * 3 ? 1 : 0;
    let momentumMonths = songData.series.length;
    const threshold = songData.total * 0.1;
    let cumulative = 0;
    for (let i = 0; i < songData.series.length; i += 1) {
      cumulative += songData.series[i].value;
      if (cumulative >= threshold) {
        momentumMonths = i + 1;
        break;
      }
    }
    const trendDirection = songData.series.length > 1
      ? songData.series[songData.series.length - 1].value >= songData.series[songData.series.length - 2].value
        ? "上升"
        : "下降"
      : "平稳";

    // calculate release months (span between first and last month)
    const monthKeys = Object.keys(songData.series.reduce((acc, item) => { acc[item.month] = true; return acc; }, {})).sort();
    let releaseMonths = 0;
    if (monthKeys.length > 0) {
      const [firstYear, firstMonth] = monthKeys[0].split("-").map(Number);
      const [lastYear, lastMonth] = monthKeys[monthKeys.length - 1].split("-").map(Number);
      releaseMonths = (lastYear - firstYear) * 12 + (lastMonth - firstMonth) + 1;
    }

    const totalScore = Math.round(
      evergreen * 0.2 +
      slowBurn * 0.15 +
      Math.min(platforms, 5) * 8 +
      Math.min(countries, 6) * 5 +
      surpriseHit * 20 +
      Math.max(0, 20 - Math.min(momentumMonths, 10) * 2)
    );

    return {
      song: songData.song,
      totalRevenue: songData.total,
      evergreen: `${evergreen}%`,
      slowBurn: `${slowBurn}%`,
      platformCount: platforms,
      countryCount: countries,
      trendDirection,
      surpriseHit: surpriseHit ? "是" : "否",
      releaseMonths: `${releaseMonths} 月`,
      totalScore: `${totalScore} 分`,
    };
  });
}

function renderMetrics(rows) {
  const songScores = calculateSongScores(rows)
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 4);
  document.getElementById("metricGrid").innerHTML = songScores
    .map((song) => `
      <a class="metric-link" href="./song.html?song=${encodeURIComponent(song.song)}">
        <article class="metric-card metric-card--highlight">
          <h3>${song.song}</h3>
          <div class="value">${song.totalScore}</div>
          <div class="detail">
            总收入 ${toCurrency(song.totalRevenue)}<br />
            Evergreen ${song.evergreen} · 慢热 ${song.slowBurn}<br />
            平台 ${song.platformCount} · 国家 ${song.countryCount}<br />
            趋势 ${song.trendDirection} · 爆发 ${song.surpriseHit} · 上线 ${song.releaseMonths}
          </div>
        </article>
      </a>
    `)
    .join("");
}

function renderPlayMetrics(rows) {
  const playScores = calculatePlayScores(rows)
    .sort((a, b) => b.totalPlays - a.totalPlays)
    .slice(0, 4);

  document.getElementById("playMetricGrid").innerHTML = playScores
    .map((song) => `
      <article class="metric-card metric-card--highlight">
        <h3>${song.song}</h3>
        <div class="value">${song.totalScore}</div>
        <div class="detail">
          播放 ${formatCount(song.totalPlays)} · 收入 ${toCurrency(song.totalRevenue)}<br />
          变现 ${formatRevenuePerHundredThousand(song.avgRevPerPlay)} · 动能 ${song.playMomentum}<br />
          平台 ${song.platformCount} · 国家 ${song.countryCount} · 趋势 ${song.trendDirection}
        </div>
      </article>
    `)
    .join("");
}

function renderDashboard(rows) {
  state.rows = rows;
  renderSummary(rows);
  renderMetrics(rows);
  renderPlayMetrics(rows);
  renderSongChart(rows);
  renderPlatformChart(rows);
  renderCountryChart(rows);
  renderTrendChart(rows);
}

function loadDataFromText(text) {
  const parsed = parseCSV(text);
  if (!parsed.length) {
    document.getElementById("status").textContent = "未读取到有效数据，请检查 CSV 格式。";
    return [];
  }

  const normalized = normalizeRows(parsed);
  if (!normalized.length) {
    document.getElementById("status").textContent = "已读取到表头，但没有有效的收入数据。";
    return [];
  }

  return normalized;
}

function getDataManifestUrl() {
  return new URL("./data/manifest.json", window.location.href).toString();
}

function getDataDirectoryUrl() {
  return new URL("./data/", window.location.href).toString();
}

function getGitHubRepoInfo() {
  const host = window.location.hostname;
  const pathname = window.location.pathname.replace(/^\/+|\/+$/g, "");

  if (!host.endsWith("github.io") || !pathname) {
    return null;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }

  return {
    owner: host.split(".")[0],
    repo: segments[0],
  };
}

async function readTextFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`无法读取 ${url}`);
  }
  return response.text();
}

async function discoverDataSources() {
  const sources = [];

  try {
    const manifestResponse = await fetch(getDataManifestUrl());
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json();
      const files = Array.isArray(manifest.files) ? manifest.files : [];
      files.forEach((entry) => {
        const name = entry.name || entry;
        if (typeof name === "string" && name.toLowerCase().endsWith(".csv")) {
          sources.push({
            name,
            url: entry.url ? new URL(entry.url, window.location.href).toString() : new URL(`./data/${name}`, window.location.href).toString(),
          });
        }
      });
    }
  } catch (error) {
    console.warn("manifest not available", error);
  }

  try {
    const dirResponse = await fetch(getDataDirectoryUrl(), { cache: "no-store" });
    if (dirResponse.ok) {
      const html = await dirResponse.text();
      const matches = html.matchAll(/href="([^"]+)"/g);
      Array.from(matches).forEach((match) => {
        const href = match[1];
        const name = href.split("/").pop();
        if (typeof name === "string" && name.toLowerCase().endsWith(".csv")) {
          const normalizedName = decodeURIComponent(name);
          if (!sources.some((source) => source.name === normalizedName)) {
            sources.push({
              name: normalizedName,
              url: new URL(normalizedName, getDataDirectoryUrl()).toString(),
            });
          }
        }
      });
    }
  } catch (error) {
    console.warn("directory listing unavailable", error);
  }

  const repoInfo = getGitHubRepoInfo();
  if (repoInfo) {
    try {
      const repoResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/data`);
      if (repoResponse.ok) {
        const items = await repoResponse.json();
        items
          .filter((item) => item.type === "file" && item.name.toLowerCase().endsWith(".csv"))
          .forEach((item) => {
            if (!sources.some((source) => source.name === item.name)) {
              sources.push({ name: item.name, url: item.download_url });
            }
          });
      }
    } catch (error) {
      console.warn("GitHub API listing failed", error);
    }
  }

  return sources.filter((source, index, list) => list.findIndex((item) => item.name === source.name) === index);
}

async function loadAutoData() {
  const sources = await discoverDataSources();
  if (!sources.length) {
    document.getElementById("status").textContent = "未在 data 目录中找到 CSV 文件。";
    return;
  }

  const loadedFiles = [];
  for (const source of sources) {
    try {
      const text = await readTextFromUrl(source.url);
      loadedFiles.push({ name: source.name, text });
    } catch (error) {
      console.warn("Failed to load", source.name, error);
    }
  }

  if (!loadedFiles.length) {
    document.getElementById("status").textContent = "找到 CSV 文件，但读取失败。";
    return;
  }

  const rows = loadedFiles.flatMap(({ text }) => loadDataFromText(text));
  if (!rows.length) {
    document.getElementById("status").textContent = "CSV 文件已找到，但没有有效收入数据。";
    return;
  }

  state.sourceFiles = loadedFiles.map((file) => file.name);
  renderDashboard(rows);
  document.getElementById("status").textContent = `已加载 ${state.sourceFiles.length} 个 CSV 文件。`;
}

async function loadSampleData() {
  document.getElementById("status").textContent = "正在重新加载 data 目录…";
  await loadAutoData();
}

async function handleFileUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }

  const loadedFiles = [];
  for (const file of files) {
    loadedFiles.push({ name: file.name, text: await file.text() });
  }

  const rows = loadedFiles.flatMap(({ text }) => loadDataFromText(text));
  if (!rows.length) {
    document.getElementById("status").textContent = "上传的文件没有有效收入数据。";
    return;
  }

  state.sourceFiles = loadedFiles.map((file) => file.name);
  renderDashboard(rows);
  document.getElementById("status").textContent = `已加载 ${state.sourceFiles.length} 个上传文件。`;
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sampleBtn").addEventListener("click", loadSampleData);
  loadSampleData();
});
