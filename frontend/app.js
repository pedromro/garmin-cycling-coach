let FTP = 293;
let metrics = [];
let recommendation = null;
let zones = {};
let masters = {};
let training = {};
let selectedDay = null;
let selectedPeriod = 90;

const PERIOD_LABELS = {
  7: "7d",
  15: "15d",
  30: "1m",
  90: "3m",
  183: "6m",
  365: "1y",
  730: "2y",
};

const $ = (selector) => document.querySelector(selector);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("garminCoachTheme", theme);
  const toggle = $("#theme-toggle");
  const icon = $("#theme-icon");
  if (!toggle || !icon) return;
  const isDark = theme === "dark";
  toggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  toggle.title = isDark ? "Day mode" : "Night mode";
  icon.textContent = isDark ? "\u2600" : "\u263E";
}

function initTheme() {
  const saved = localStorage.getItem("garminCoachTheme");
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function fmt(value, suffix = "", digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "No data";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "No data";
  return `${Number(value).toFixed(0)}%`;
}

function setStatus(message, tone = "neutral") {
  const status = $("#sync-status");
  status.textContent = message;
  status.dataset.tone = tone;
}

function periodLabel(days = selectedPeriod) {
  return PERIOD_LABELS[days] || `${days}d`;
}

function recentUntil(day, count) {
  const idx = metrics.findIndex((entry) => entry.day === day);
  if (idx < 0) return [];
  return metrics.slice(Math.max(0, idx - count + 1), idx + 1);
}

function hardDayCount(days) {
  return days.filter((day) => {
    if ((day.cycling_training_effect ?? 0) >= 3.5) return true;
    return day.intensity_bucket === "hard" || ((day.cycling_np || day.cycling_avg_power || 0) > 0 && day.cycling_minutes >= 120);
  }).length;
}

function setGauge(score) {
  const circle = $("#gauge-value");
  const circumference = 301.59;
  circle.style.strokeDashoffset = String(circumference - (circumference * score) / 100);
  circle.style.stroke = score >= 80 ? "var(--accent)" : score >= 60 ? "var(--accent-2)" : score >= 40 ? "var(--warn)" : "var(--danger)";
}

function setDetails(target, rows) {
  target.innerHTML = rows
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function ensureTooltip(container) {
  let tooltip = container.querySelector(".chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    container.appendChild(tooltip);
  }
  return tooltip;
}

function wireTooltips(container) {
  const tooltip = ensureTooltip(container);
  container.querySelectorAll("[data-tooltip]").forEach((dot) => {
    dot.addEventListener("mouseenter", () => {
      tooltip.innerHTML = dot.dataset.tooltip;
      tooltip.classList.add("is-visible");
    });
    dot.addEventListener("mousemove", (event) => {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${event.clientX - rect.left}px`;
      tooltip.style.top = `${event.clientY - rect.top}px`;
    });
    dot.addEventListener("mouseleave", () => {
      tooltip.classList.remove("is-visible");
    });
  });
}

function tooltipHtml(title, rows) {
  return `<strong>${title}</strong>${rows.map(([label, value]) => `<span>${label}: ${value}</span>`).join("<br>")}`;
}

function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const midX = (x0 + x1) / 2;
    path += ` C ${midX} ${y0}, ${midX} ${y1}, ${x1} ${y1}`;
  }
  return path;
}

function renderBars(container, data, key, selected) {
  const width = 860;
  const height = 315;
  const pad = { top: 20, right: 18, bottom: 42, left: 46 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d[key] || 0));
  const barGap = 7;
  const barW = Math.max(12, (chartW - barGap * (data.length - 1)) / Math.max(1, data.length));

  const bars = data.map((d, i) => {
    const value = d[key] || 0;
    const h = (value / max) * chartH;
    const x = pad.left + i * (barW + barGap);
    const y = pad.top + chartH - h;
    const label = d.day.slice(5);
    const tip = tooltipHtml(d.day, [["Minutes", fmt(value, " min")]]);
    return `
      <rect class="bar data-dot ${d.day === selected ? "is-selected" : ""}" data-tooltip='${tip}' x="${x}" y="${y}" width="${barW}" height="${h}" rx="4"></rect>
      <text class="axis-label" x="${x + barW / 2}" y="${height - 16}" text-anchor="middle">${label}</text>
    `;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top}" y2="${pad.top}"></line>
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartH / 2}" y2="${pad.top + chartH / 2}"></line>
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartH}" y2="${pad.top + chartH}"></line>
      <text class="axis-label" x="8" y="${pad.top + 4}">${Math.round(max)}</text>
      <text class="axis-label" x="8" y="${pad.top + chartH + 4}">0</text>
      ${bars}
    </svg>
  `;
  wireTooltips(container);
}

function pointsFor(data, key, min, max, width, height, pad, label) {
  const usable = data.filter((d) => d[key] !== null && d[key] !== undefined);
  if (usable.length === 0) return { path: "", dots: "" };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const denom = Math.max(1, data.length - 1);
  const points = usable.map((d) => {
    const i = data.indexOf(d);
    const x = pad.left + (i / denom) * chartW;
    const y = pad.top + chartH - ((d[key] - min) / Math.max(1, max - min)) * chartH;
    return [x, y, d];
  });
  const path = smoothPath(points);
  const dots = points.map(([x, y, d]) => {
    const tip = tooltipHtml(d.day, [[label || key, fmt(d[key], "", 1)]]);
    return `<circle class="dot data-dot" data-tooltip='${tip}' cx="${x}" cy="${y}" r="4"></circle>`;
  }).join("");
  return { path, dots };
}

function renderLines(container, series) {
  renderLineChart(container, metrics, series);
}

function renderLineChart(container, data, series, options = {}) {
  const width = 860;
  const height = 315;
  const pad = { top: 20, right: 18, bottom: 42, left: 46 };
  const bandValues = (options.bands || []).flatMap((band) => [band.from, band.to]).filter((v) => v !== null && v !== undefined);
  const rangeValues = options.range
    ? data.flatMap((d) => [d[options.range.lowKey], d[options.range.highKey]]).filter((v) => v !== null && v !== undefined)
    : [];
  const allValues = [
    ...series.flatMap(({ key }) => data.map((d) => d[key]).filter((v) => v !== null && v !== undefined)),
    ...bandValues,
    ...rangeValues,
  ];
  if (allValues.length === 0) {
    container.innerHTML = `<div class="empty-chart">No trend data available yet</div>`;
    return;
  }
  const rawMin = Math.min(...allValues);
  const min = Math.floor(rawMin < 0 ? rawMin * 1.2 : rawMin * 0.8);
  const max = Math.ceil(Math.max(...allValues) * 1.12);
  const valueToY = (value) => pad.top + (height - pad.top - pad.bottom) - ((value - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);
  const bands = (options.bands || []).map((band) => {
    const y1 = valueToY(Math.min(max, band.to));
    const y2 = valueToY(Math.max(min, band.from));
    const h = Math.max(0, y2 - y1);
    if (h <= 0) return "";
    return `
      <rect class="chart-band chart-band-${band.tone}" x="${pad.left}" y="${y1}" width="${width - pad.left - pad.right}" height="${h}"></rect>
      <text class="chart-band-label" x="${width - pad.right - 8}" y="${y1 + 14}" text-anchor="end">${band.label}</text>
    `;
  }).join("");
  const rangeBand = options.range ? renderRangeBand(data, options.range, min, max, width, height, pad) : "";
  const labels = data.map((d, i) => {
    const step = Math.max(1, Math.ceil(data.length / 8));
    if (i !== 0 && i !== data.length - 1 && i % step !== 0) return "";
    const x = pad.left + (i / Math.max(1, data.length - 1)) * (width - pad.left - pad.right);
    return `<text class="axis-label" x="${x}" y="${height - 16}" text-anchor="middle">${d.day.slice(5)}</text>`;
  }).join("");
  const lines = series.map(({ key, cls }) => {
    const { path, dots } = pointsFor(data, key, min, max, width, height, pad, series.find((item) => item.key === key)?.label);
    return `<path class="${cls}" d="${path}"></path>${dots}`;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${bands}
      ${rangeBand}
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top}" y2="${pad.top}"></line>
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"></line>
      <text class="axis-label" x="8" y="${pad.top + 4}">${max}</text>
      <text class="axis-label" x="8" y="${height - pad.bottom + 4}">${min}</text>
      ${lines}
      ${labels}
    </svg>
    ${renderLegend(series)}
  `;
  wireTooltips(container);
}

function renderLegend(series) {
  if (!series.some((item) => item.label)) return "";
  return `
    <div class="chart-legend">
      ${series.map((item) => item.label ? `<span class="legend-item"><span class="legend-swatch ${item.cls}"></span>${item.label}</span>` : "").join("")}
    </div>
  `;
}

function renderRangeBand(data, range, min, max, width, height, pad) {
  const usable = data.filter((d) => d[range.lowKey] !== null && d[range.lowKey] !== undefined && d[range.highKey] !== null && d[range.highKey] !== undefined);
  if (usable.length === 0) return "";
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const denom = Math.max(1, data.length - 1);
  const point = (d, key) => {
    const i = data.indexOf(d);
    const x = pad.left + (i / denom) * chartW;
    const y = pad.top + chartH - ((d[key] - min) / Math.max(1, max - min)) * chartH;
    return [x, y];
  };
  const upper = usable.map((d) => point(d, range.highKey));
  const lower = usable.map((d) => point(d, range.lowKey)).reverse();
  const points = [...upper, ...lower].map(([x, y]) => `${x},${y}`).join(" ");
  return `<polygon class="range-band" points="${points}"></polygon>`;
}

function renderZoneBars(target, zoneMinutes) {
  const entries = Object.entries(zoneMinutes || {});
  const max = Math.max(1, ...entries.map(([, value]) => value || 0));
  target.innerHTML = entries
    .map(([name, minutes]) => `
      <div class="zone-row">
        <span class="zone-name">${name}</span>
        <span class="zone-range">${fmt(minutes, " min")}</span>
        <span class="zone-bar"><span class="zone-fill" style="width: ${(minutes / max) * 100}%"></span></span>
      </div>
    `)
    .join("");
}

function renderPowerCurve(container, curve) {
  const data = curve || [];
  const width = 860;
  const height = 430;
  const pad = { top: 22, right: 22, bottom: 48, left: 54 };
  const values = data.flatMap((row) => [row.period_power, row.overall_power]).filter((v) => v !== null && v !== undefined);
  if (values.length === 0) {
    container.innerHTML = `<div class="empty-chart">No power curve data available yet</div>`;
    return;
  }
  const max = Math.ceil(Math.max(...values) * 1.12);
  const min = Math.max(0, Math.floor(Math.min(...values) * 0.78));
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const xFor = (index) => pad.left + (index / Math.max(1, data.length - 1)) * chartW;
  const yFor = (value) => pad.top + chartH - ((value - min) / Math.max(1, max - min)) * chartH;
  const pathFor = (key) => smoothPath(data
    .filter((row) => row[key] !== null && row[key] !== undefined)
    .map((row) => [xFor(data.indexOf(row)), yFor(row[key])]));
  const dotsFor = (key, label) => data
    .filter((row) => row[key] !== null && row[key] !== undefined)
    .map((row) => {
      const tip = tooltipHtml(row.label, [[label, fmt(row[key], " W")], ["Date", key === "period_power" ? row.period_day || "No data" : row.overall_day || "No data"]]);
      return `<circle class="dot data-dot" data-tooltip='${tip}' cx="${xFor(data.indexOf(row))}" cy="${yFor(row[key])}" r="4"></circle>`;
    })
    .join("");
  const labels = data.map((row, index) => `<text class="axis-label" x="${xFor(index)}" y="${height - 18}" text-anchor="middle">${row.label}</text>`).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top}" y2="${pad.top}"></line>
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartH / 2}" y2="${pad.top + chartH / 2}"></line>
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"></line>
      <text class="axis-label" x="8" y="${pad.top + 4}">${max}W</text>
      <text class="axis-label" x="8" y="${height - pad.bottom + 4}">${min}W</text>
      <path class="line-fitness" d="${pathFor("overall_power")}"></path>
      <path class="line-form" d="${pathFor("period_power")}"></path>
      ${dotsFor("overall_power", "Overall")}
      ${dotsFor("period_power", "Selected period")}
      ${labels}
    </svg>
    ${renderLegend([
      { cls: "line-form", label: "Selected period" },
      { cls: "line-fitness", label: "Overall" },
    ])}
  `;
  wireTooltips(container);
}

function renderPowerCurveTable(target, curve) {
  target.innerHTML = (curve || []).map((row) => `
    <tr>
      <td>${row.label}</td>
      <td>${fmt(row.period_power, " W")}</td>
      <td>${row.period_day || "No data"}</td>
      <td>${fmt(row.overall_power, " W")}</td>
      <td>${row.overall_day || "No data"}</td>
    </tr>
  `).join("");
}

function renderVo2MaxChart(container, data) {
  renderLineChart(container, data || [], [
    { key: "vo2max", cls: "line-form", label: "VO2max" },
  ]);
}

function renderTssIfChart(container, data) {
  const normalized = (data || []).map((row) => ({
    ...row,
    if_scaled: row.intensity_factor === null || row.intensity_factor === undefined ? null : row.intensity_factor * 100,
  }));
  renderLineChart(container, normalized, [
    { key: "tss", cls: "line-fatigue", label: "TSS" },
    { key: "if_scaled", cls: "line-fitness", label: "IF x100" },
  ]);
}

function updateDaySelect() {
  const daySelect = $("#day-select");
  const previous = selectedDay;
  daySelect.innerHTML = metrics.map((entry) => `<option value="${entry.day}">${entry.day}</option>`).join("");
  selectedDay = metrics.some((entry) => entry.day === previous) ? previous : (recommendation?.day || metrics.at(-1)?.day);
  daySelect.value = selectedDay || "";
}

function updateDashboard() {
  if (!recommendation || metrics.length === 0) {
    setStatus("No synced data found", "warn");
    return;
  }

  updateDaySelect();
  const selected = metrics.find((entry) => entry.day === selectedDay) || metrics.at(-1);
  const week = recentUntil(selected.day, 7);
  const threeDays = recentUntil(selected.day, 3);
  const weekMinutes = week.reduce((sum, day) => sum + day.cycling_minutes, 0);
  const weekDistance = week.reduce((sum, day) => sum + day.cycling_distance_km, 0);

  $("#page-title").textContent = selected.day === recommendation.day ? "Daily recommendation" : `Day review ${selected.day}`;
  $("#readiness-score").textContent = recommendation.readiness_score;
  $("#readiness-label").textContent = recommendation.readiness_label;
  $("#workout-title").textContent = recommendation.workout;
  $("#duration").textContent = recommendation.duration;
  $("#power-target").textContent = recommendation.power_target;
  $("#weekly-minutes").textContent = Math.round(weekMinutes);
  $("#weekly-distance").textContent = Math.round(weekDistance);
  $("#hard-days").textContent = hardDayCount(threeDays);
  $("#load-spike").textContent = masters.load_spike_ratio ? `${masters.load_spike_ratio.toFixed(2)}x` : "No data";
  $("#form-score").textContent = masters.form ?? "No data";
  $("#fitness-kpi").textContent = fmt(masters.fitness, "", 1);
  $("#fatigue-kpi").textContent = fmt(masters.fatigue, "", 1);
  $("#form-kpi").textContent = fmt(masters.form, "", 1);
  $("#training-minutes-kpi").textContent = `${Math.round(weekMinutes)}`;
  $("#training-distance-kpi").textContent = `${Math.round(weekDistance)}`;
  $("#recovery-risk-kpi").textContent = masters.recovery_risk || "No data";
  $("#sleep-kpi").textContent = fmt(selected.sleep_hours, "h", 1);
  $("#hrv-kpi").textContent = fmt(selected.hrv_value, "ms");
  $("#selected-day-chip").textContent = selected.day;
  $("#stress-chip").textContent = `${periodLabel()} view`;
  $("#tomorrow").textContent = recommendation.tomorrow;
  $("#status-copy").textContent = selected.hrv_status
    ? `${selected.hrv_status.toLowerCase()} HRV with ${fmt(selected.sleep_hours, " h", 1)} sleep and ${fmt(selected.body_battery_max)} body battery peak.`
    : "Recovery data is missing for this day.";
  setGauge(recommendation.readiness_score);

  $("#reason-list").innerHTML = recommendation.reasons.map((reason) => `<li>${reason}</li>`).join("");
  $("#zone-list").innerHTML = Object.entries(zones)
    .map(([name, range]) => `<div class="zone-row"><span class="zone-name">${name}</span><span class="zone-range">${range}</span></div>`)
    .join("");
  $("#intensity-list").innerHTML = [
    ["Easy", masters.intensity_pct?.easy, masters.intensity_minutes?.easy],
    ["Tempo", masters.intensity_pct?.tempo, masters.intensity_minutes?.tempo],
    ["Hard", masters.intensity_pct?.hard, masters.intensity_minutes?.hard],
  ].map(([name, percent, minutes]) => `<div class="zone-row"><span class="zone-name">${name}</span><span class="zone-range">${pct(percent)} / ${fmt(minutes, " min")}</span></div>`).join("");
  renderZoneBars($("#time-in-zones"), masters.zone_minutes);

  setDetails($("#masters-details"), [
    ["Recovery risk", masters.recovery_risk || "No data"],
    ["Fitness", fmt(masters.fitness, "", 1)],
    ["Fatigue", fmt(masters.fatigue, "", 1)],
    ["Form", fmt(masters.form, "", 1)],
    ["Easy intensity", pct(masters.intensity_pct?.easy)],
    ["Hard intensity", pct(masters.intensity_pct?.hard)],
    ["Avg sleep", fmt(masters.sleep_avg_7, " h", 1)],
    ["HRV vs baseline", fmt(masters.hrv_delta, " ms", 1)],
    ["Strength sessions", masters.strength_sessions_7 === null ? "Not tracked by current sync" : masters.strength_sessions_7],
    ["VO2max", masters.vo2max_estimate === null ? "Not available from current Garmin payload" : fmt(masters.vo2max_estimate)],
  ]);

  setDetails($("#fitness-details"), [
    ["Fitness", fmt(masters.fitness, "", 1)],
    ["Fatigue", fmt(masters.fatigue, "", 1)],
    ["Form", fmt(masters.form, "", 1)],
    ["Acute range", `${fmt(masters.acute_load_range?.low, "", 0)}-${fmt(masters.acute_load_range?.high, "", 0)}`],
    ["Load status", masters.acute_load_range?.status || "No data"],
    ["7d stress", fmt(masters.stress_7, "", 0)],
    ["28d stress", fmt(masters.stress_28, "", 0)],
    ["Hard days", `${masters.hard_days_7 ?? "No data"} in 7 days`],
  ]);

  setDetails($("#ride-details"), [
    ["Intensity", selected.intensity_bucket || "No data"],
    ["Minutes", fmt(selected.cycling_minutes, " min")],
    ["Distance", fmt(selected.cycling_distance_km, " km", 1)],
    ["Average HR", fmt(selected.cycling_avg_hr, " bpm")],
    ["Average power", fmt(selected.cycling_avg_power, " W")],
    ["Normalized power", fmt(selected.cycling_np, " W")],
    ["Training effect", fmt(selected.cycling_training_effect, "", 1)],
  ]);

  setDetails($("#recovery-details"), [
    ["Sleep", fmt(selected.sleep_hours, " h", 1)],
    ["HRV", fmt(selected.hrv_value, " ms")],
    ["HRV status", selected.hrv_status || "No data"],
    ["Resting HR", fmt(selected.resting_hr, " bpm")],
    ["Stress", fmt(selected.stress_avg)],
    ["Body battery", fmt(selected.body_battery_max)],
  ]);

  renderBars($("#volume-chart"), metrics, "cycling_minutes", selected.day);
  renderPowerCurve($("#power-curve-chart"), training.power_curve || []);
  renderPowerCurveTable($("#power-curve-table"), training.power_curve || []);
  renderTssIfChart($("#tss-if-chart"), training.training_load || []);
  renderVo2MaxChart($("#vo2max-chart"), training.vo2max || []);
  renderLines($("#recovery-chart"), [
    { key: "sleep_hours", cls: "line-sleep", label: "Sleep" },
    { key: "hrv_value", cls: "line-hrv", label: "HRV" },
  ]);
  renderLineChart($("#fitness-chart"), masters.fitness_trend || [], [
    { key: "fitness", cls: "line-fitness", label: "Fitness" },
    { key: "fatigue", cls: "line-fatigue", label: "Fatigue" },
    { key: "form", cls: "line-form", label: "Form" },
  ], { bands: masters.form_bands || [] });
  renderLineChart($("#acute-load-chart"), masters.fitness_trend || [], [
    { key: "fatigue", cls: "line-fatigue", label: "Acute load" },
    { key: "fitness", cls: "line-fitness", label: "Fitness" },
  ], { range: { lowKey: "acute_min", highKey: "acute_max" } });
}

function applyPayload(payload) {
  FTP = payload.ftp;
  metrics = payload.metrics || [];
  recommendation = payload.recommendation;
  zones = payload.zones || {};
  masters = payload.masters || {};
  training = payload.training || {};
  selectedDay = recommendation?.day || metrics.at(-1)?.day || null;
  updateDashboard();
}

async function loadDashboard() {
  setStatus("Loading data", "neutral");
  const response = await fetch(`/api/dashboard?days=${selectedPeriod}`);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "Unable to load dashboard");
  applyPayload(payload);
  setStatus(`Loaded ${metrics.length} local days (${periodLabel()})`, "ok");
}

async function refreshGarmin() {
  const button = $("#refresh-button");
  button.disabled = true;
  setStatus(`Refreshing ${periodLabel()} from Garmin`, "neutral");
  try {
    const response = await fetch(`/api/refresh?days=${selectedPeriod}`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || "Garmin refresh failed");
    applyPayload(payload);
    setStatus(`Synced ${payload.sync?.synced || 0} days (${periodLabel()})`, "ok");
  } catch (error) {
    setStatus(error.message, "warn");
  } finally {
    button.disabled = false;
  }
}

function setPeriod(days) {
  selectedPeriod = days;
  document.querySelectorAll(".period-button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.days) === selectedPeriod);
  });
  loadDashboard().catch((error) => setStatus(error.message, "warn"));
}

function boot() {
  initTheme();
  $("#theme-toggle").addEventListener("click", toggleTheme);

  $("#day-select").addEventListener("change", (event) => {
    selectedDay = event.target.value;
    updateDashboard();
  });
  $("#refresh-button").addEventListener("click", refreshGarmin);

  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => setPeriod(Number(button.dataset.days)));
  });

  document.querySelectorAll(".segmented-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segmented-button").forEach((item) => item.classList.remove("is-active"));
      document.querySelectorAll("[data-view-panel]").forEach((panel) => panel.classList.remove("is-visible"));
      button.classList.add("is-active");
      document.querySelector(`[data-view-panel="${button.dataset.view}"]`).classList.add("is-visible");
      updateDashboard();
    });
  });

  loadDashboard().catch((error) => setStatus(error.message, "warn"));
}

boot();
