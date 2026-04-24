let FTP = 293;
let metrics = [];
let recommendation = null;
let zones = {};
let masters = {};
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
    return `
      <rect class="bar ${d.day === selected ? "is-selected" : ""}" x="${x}" y="${y}" width="${barW}" height="${h}" rx="4"></rect>
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
}

function pointsFor(data, key, min, max, width, height, pad) {
  const usable = data.filter((d) => d[key] !== null && d[key] !== undefined);
  if (usable.length === 0) return { path: "", dots: "" };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const denom = Math.max(1, data.length - 1);
  const points = usable.map((d) => {
    const i = data.indexOf(d);
    const x = pad.left + (i / denom) * chartW;
    const y = pad.top + chartH - ((d[key] - min) / Math.max(1, max - min)) * chartH;
    return [x, y];
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const dots = points.map(([x, y]) => `<circle class="dot" cx="${x}" cy="${y}" r="4"></circle>`).join("");
  return { path, dots };
}

function renderLines(container, series) {
  renderLineChart(container, metrics, series);
}

function renderLineChart(container, data, series) {
  const width = 860;
  const height = 315;
  const pad = { top: 20, right: 18, bottom: 42, left: 46 };
  const allValues = series.flatMap(({ key }) => data.map((d) => d[key]).filter((v) => v !== null && v !== undefined));
  if (allValues.length === 0) {
    container.innerHTML = `<div class="empty-chart">No trend data available yet</div>`;
    return;
  }
  const rawMin = Math.min(...allValues);
  const min = Math.floor(rawMin < 0 ? rawMin * 1.2 : rawMin * 0.8);
  const max = Math.ceil(Math.max(...allValues) * 1.12);
  const labels = data.map((d, i) => {
    const step = Math.max(1, Math.ceil(data.length / 8));
    if (i !== 0 && i !== data.length - 1 && i % step !== 0) return "";
    const x = pad.left + (i / Math.max(1, data.length - 1)) * (width - pad.left - pad.right);
    return `<text class="axis-label" x="${x}" y="${height - 16}" text-anchor="middle">${d.day.slice(5)}</text>`;
  }).join("");
  const lines = series.map(({ key, cls }) => {
    const { path, dots } = pointsFor(data, key, min, max, width, height, pad);
    return `<path class="${cls}" d="${path}"></path>${dots}`;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top}" y2="${pad.top}"></line>
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"></line>
      <text class="axis-label" x="8" y="${pad.top + 4}">${max}</text>
      <text class="axis-label" x="8" y="${height - pad.bottom + 4}">${min}</text>
      ${lines}
      ${labels}
    </svg>
  `;
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
  renderLines($("#power-chart"), [
    { key: "cycling_avg_power", cls: "line-avg" },
    { key: "cycling_np", cls: "line-np" },
  ]);
  renderLines($("#recovery-chart"), [
    { key: "sleep_hours", cls: "line-sleep" },
    { key: "hrv_value", cls: "line-hrv" },
  ]);
  renderLineChart($("#fitness-chart"), masters.fitness_trend || [], [
    { key: "fitness", cls: "line-fitness" },
    { key: "fatigue", cls: "line-fatigue" },
    { key: "form", cls: "line-form" },
  ]);
  renderLineChart($("#progression-chart"), masters.progression || [], [
    { key: "distance_km", cls: "line-fitness" },
    { key: "stress", cls: "line-form" },
  ]);
}

function applyPayload(payload) {
  FTP = payload.ftp;
  metrics = payload.metrics || [];
  recommendation = payload.recommendation;
  zones = payload.zones || {};
  masters = payload.masters || {};
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
    });
  });

  loadDashboard().catch((error) => setStatus(error.message, "warn"));
}

boot();
