const GOAL_COUNT = 50;
const PLAN_DAYS = 14;
const STORAGE_KEY = "bookmarkDashboard";
const WORK_INTERVALS = [
  { startHour: 8, endHour: 11 },
  { startHour: 11, endHour: 14 },
  { startHour: 14, endHour: 17 }
];

const loadingEl = document.getElementById("loading");
const dashboardEl = document.getElementById("dashboard");
const emptyEl = document.getElementById("empty");
const errorEl = document.getElementById("error");
const footerEl = document.getElementById("footer");
const refreshButton = document.getElementById("refresh-button");
const manageButton = document.getElementById("manage-button");
const exportButton = document.getElementById("export-button");
const resetButton = document.getElementById("reset-button");
const openSuggestionButton = document.getElementById("open-suggestion-button");
const deleteSuggestionButton = document.getElementById("delete-suggestion-button");
const nextSuggestionButton = document.getElementById("next-suggestion-button");
const remainingChartCanvas = document.getElementById("remaining-chart");
const reductionChartCanvas = document.getElementById("reduction-chart");
const changeChartCanvas = document.getElementById("change-chart");
const intervalAlertEl = document.getElementById("interval-alert");
const intervalAlertTitleEl = document.getElementById("interval-alert-title");
const intervalAlertCopyEl = document.getElementById("interval-alert-copy");
const findDuplicatesButton = document.getElementById("find-duplicates-button");
const duplicatesBadgeEl = document.getElementById("duplicates-badge");
const duplicatesListEl = document.getElementById("duplicates-list");
const duplicatesNoneEl = document.getElementById("duplicates-none");
let currentSuggestedBookmark = null;

function getStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(items);
    });
  });
}

function sendMessage(message, retriesLeft = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          if (remaining > 0 && error.message.includes("Receiving end does not exist")) {
            setTimeout(() => attempt(remaining - 1), 300);
            return;
          }
          reject(new Error(error.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Unknown extension error."));
          return;
        }

        resolve(response.payload);
      });
    };
    attempt(retriesLeft);
  });
}

function formatCount(value) {
  return new Intl.NumberFormat().format(value);
}

function formatTimestamp(date) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatShortWeekday(date) {
  return new Intl.DateTimeFormat([], {
    weekday: "short"
  }).format(date);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(key) {
  return new Date(`${key}T00:00:00`);
}

function buildPastDateKeys(endDate, totalDays) {
  const keys = [];

  for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(endDate);
    date.setDate(date.getDate() - offset);
    keys.push(toDateKey(date));
  }

  return keys;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function computeStreak(events, removedToday) {
  const removedDays = new Set();
  for (const event of events) {
    if (event.type === "removed") {
      removedDays.add(toDateKey(new Date(event.timestamp)));
    }
  }
  const todayKey = toDateKey(new Date());
  if (removedToday > 0) {
    removedDays.add(todayKey);
  }
  let streak = 0;
  const cursor = new Date();
  if (!removedDays.has(todayKey)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (removedDays.has(toDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function applyTheme(bookmarkCount) {
  document.body.classList.remove("theme-green", "theme-yellow", "theme-red");

  if (bookmarkCount > 100) {
    document.body.classList.add("theme-red");
    return;
  }

  if (bookmarkCount > 50) {
    document.body.classList.add("theme-yellow");
    return;
  }

  document.body.classList.add("theme-green");
}

function getTodayTarget(baselineCount, startDate, now) {
  const safeBaseline = Math.max(baselineCount, GOAL_COUNT);
  const start = fromDateKey(toDateKey(startDate));
  const today = fromDateKey(toDateKey(now));
  const daysElapsed = Math.floor((today - start) / 86400000);
  const progressDays = clamp(daysElapsed, 0, PLAN_DAYS - 1);
  const reductionSpan = Math.max(safeBaseline - GOAL_COUNT, 0);
  const perDayReduction = reductionSpan / Math.max(PLAN_DAYS - 1, 1);
  const target = Math.round(safeBaseline - perDayReduction * progressDays);
  return Math.max(target, GOAL_COUNT);
}

function buildDailyChangesSeries(events, now) {
  const keys = buildPastDateKeys(now, PLAN_DAYS);
  const byDay = new Map(keys.map((key) => [key, { added: 0, removed: 0 }]));

  for (const event of events) {
    const key = toDateKey(new Date(event.timestamp));
    const entry = byDay.get(key);
    if (!entry) {
      continue;
    }

    if (event.type === "added") {
      entry.added += event.amount;
    } else if (event.type === "removed") {
      entry.removed += event.amount;
    }
  }

  return keys.map((key) => ({
    key,
    date: fromDateKey(key),
    ...byDay.get(key)
  }));
}

function buildHistorySeries(historyMap, baselineCount, startDate, now, currentBookmarkCount, dailyChanges) {
  const keys = buildPastDateKeys(now, PLAN_DAYS);
  const safeBaseline = Math.max(baselineCount, currentBookmarkCount, GOAL_COUNT);
  const startKey = toDateKey(startDate);
  let previousRemaining = safeBaseline;

  return keys.map((key) => {
    const rawEntry = historyMap[key];
    const date = fromDateKey(key);
    const target = getTodayTarget(safeBaseline, startDate, date);
    let remaining = key === toDateKey(now) ? currentBookmarkCount : previousRemaining;

    if (rawEntry && typeof rawEntry.remaining === "number") {
      remaining = rawEntry.remaining;
    } else if (key < startKey) {
      remaining = safeBaseline;
    }

    const changes = dailyChanges.find((entry) => entry.key === key) || { added: 0, removed: 0 };
    previousRemaining = remaining;

    return {
      key,
      date,
      target,
      remaining,
      reduced: changes.removed,
      added: changes.added
    };
  });
}

function getCurrentInterval(now) {
  for (const interval of WORK_INTERVALS) {
    const start = new Date(now);
    start.setHours(interval.startHour, 0, 0, 0);

    const end = new Date(now);
    end.setHours(interval.endHour, 0, 0, 0);

    if (now >= start && now < end) {
      return { start, end };
    }
  }

  return null;
}

function getNextInterval(now) {
  for (const interval of WORK_INTERVALS) {
    const start = new Date(now);
    start.setHours(interval.startHour, 0, 0, 0);
    if (now < start) {
      return start;
    }
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(WORK_INTERVALS[0].startHour, 0, 0, 0);
  return tomorrow;
}

function getIntervalStatus(events, now) {
  const removedEvents = events.filter((event) => event.type === "removed");
  const currentInterval = getCurrentInterval(now);
  const lastRemovedEvent = removedEvents.length > 0 ? removedEvents[removedEvents.length - 1] : null;

  if (!currentInterval) {
    const nextInterval = getNextInterval(now);
    return {
      showAlert: false,
      title: "Outside Work Block",
      copy: `Next clearing block starts at ${formatTimestamp(nextInterval)}.`,
      intervalMessage: `Outside the 8:00 AM to 5:00 PM workday. Next block begins at ${formatTimestamp(nextInterval)}.`,
      lastClearedMessage: lastRemovedEvent
        ? `${formatCount(lastRemovedEvent.amount)} cleared at ${formatTimestamp(new Date(lastRemovedEvent.timestamp))}.`
        : "No bookmark reduction recorded yet."
    };
  }

  const removedThisInterval = removedEvents.some((event) => {
    const timestamp = new Date(event.timestamp);
    return timestamp >= currentInterval.start && timestamp < currentInterval.end;
  });

  if (!removedThisInterval) {
    return {
      showAlert: true,
      title: "No Bookmark Cleared",
      copy: `No bookmark reduction has been recorded in this ${formatTimestamp(currentInterval.start)} to ${formatTimestamp(currentInterval.end)} block.`,
      intervalMessage: `Current block: ${formatTimestamp(currentInterval.start)} to ${formatTimestamp(currentInterval.end)}. No bookmark cleared yet.`,
      lastClearedMessage: lastRemovedEvent
        ? `${formatCount(lastRemovedEvent.amount)} cleared at ${formatTimestamp(new Date(lastRemovedEvent.timestamp))}.`
        : "No bookmark reduction recorded yet."
    };
  }

  return {
    showAlert: false,
    title: "On Track",
    copy: `At least one bookmark has already been cleared in the ${formatTimestamp(currentInterval.start)} to ${formatTimestamp(currentInterval.end)} block.`,
    intervalMessage: `Current block: ${formatTimestamp(currentInterval.start)} to ${formatTimestamp(currentInterval.end)}. At least one bookmark cleared.`,
    lastClearedMessage: lastRemovedEvent
      ? `${formatCount(lastRemovedEvent.amount)} cleared at ${formatTimestamp(new Date(lastRemovedEvent.timestamp))}.`
      : "No bookmark reduction recorded yet."
  };
}

function resizeCanvasForDisplay(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 420;
  const height = canvas.clientHeight || 170;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function colorWithAlpha(color, alpha) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  const resolved = context.fillStyle;

  if (resolved.startsWith("#")) {
    let hex = resolved.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map((value) => value + value).join("");
    }

    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  return resolved.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

function drawGrid(context, width, chartHeight, padding) {
  context.strokeStyle = "rgba(255,255,255,0.55)";
  context.lineWidth = 1;
  for (let index = 0; index <= 3; index += 1) {
    const y = padding.top + (chartHeight * index) / 3;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }
}

function drawRemainingChart(series) {
  const { context, width, height } = resizeCanvasForDisplay(remainingChartCanvas);
  context.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.body);
  const brand = styles.getPropertyValue("--brand").trim();
  const brandSoft = styles.getPropertyValue("--brand-soft").trim() || brand;
  const textColor = styles.getPropertyValue("--text").trim();

  const padding = { top: 12, right: 10, bottom: 28, left: 14 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...series.map((entry) => Math.max(entry.remaining, entry.target)), GOAL_COUNT, 1);
  const minValue = Math.min(...series.map((entry) => Math.min(entry.remaining, entry.target)), GOAL_COUNT);
  const valueRange = Math.max(maxValue - minValue, 10);
  const xAt = (index) => padding.left + (chartWidth * index) / Math.max(series.length - 1, 1);
  const yAt = (value) => padding.top + ((maxValue - value) / valueRange) * chartHeight;

  drawGrid(context, width, chartHeight, padding);

  context.beginPath();
  series.forEach((entry, index) => {
    const x = xAt(index);
    const y = yAt(entry.target);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = colorWithAlpha(textColor, 0.45);
  context.setLineDash([6, 6]);
  context.lineWidth = 2;
  context.stroke();
  context.setLineDash([]);

  context.beginPath();
  series.forEach((entry, index) => {
    const x = xAt(index);
    const y = yAt(entry.remaining);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  const gradient = context.createLinearGradient(0, padding.top, 0, height);
  gradient.addColorStop(0, colorWithAlpha(brandSoft, 0.55));
  gradient.addColorStop(1, colorWithAlpha(brandSoft, 0));
  context.lineTo(xAt(series.length - 1), height - padding.bottom);
  context.lineTo(xAt(0), height - padding.bottom);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  series.forEach((entry, index) => {
    const x = xAt(index);
    const y = yAt(entry.remaining);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = brand;
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = textColor;
  context.font = "11px Inter, sans-serif";
  context.textAlign = "center";
  series.forEach((entry, index) => {
    if (index % 3 === 0 || index === series.length - 1) {
      context.fillText(formatShortWeekday(entry.date), xAt(index), height - 10);
    }
  });
}

function drawReductionChart(series) {
  const { context, width, height } = resizeCanvasForDisplay(reductionChartCanvas);
  context.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.body);
  const brand = styles.getPropertyValue("--brand").trim();
  const brandSoft = styles.getPropertyValue("--brand-soft").trim() || brand;
  const textColor = styles.getPropertyValue("--text").trim();
  const padding = { top: 10, right: 10, bottom: 28, left: 14 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxReduction = Math.max(...series.map((entry) => entry.reduced), 1);
  const gap = 4;
  const barWidth = chartWidth / Math.max(series.length, 1) - gap;

  drawGrid(context, width, chartHeight, padding);

  series.forEach((entry, index) => {
    const barHeight = (entry.reduced / maxReduction) * chartHeight;
    const x = padding.left + index * (barWidth + gap);
    const y = padding.top + chartHeight - barHeight;
    const gradient = context.createLinearGradient(0, y, 0, y + Math.max(barHeight, 1));
    gradient.addColorStop(0, colorWithAlpha(brandSoft, 0.9));
    gradient.addColorStop(1, brand);

    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(x, y, Math.max(barWidth, 2), barHeight, 8);
    context.fill();
  });

  context.fillStyle = textColor;
  context.font = "11px Inter, sans-serif";
  context.textAlign = "center";
  series.forEach((entry, index) => {
    if (index % 3 === 0 || index === series.length - 1) {
      const x = padding.left + index * (barWidth + gap) + barWidth / 2;
      context.fillText(formatShortWeekday(entry.date), x, height - 10);
    }
  });
}

function drawChangeChart(series) {
  const { context, width, height } = resizeCanvasForDisplay(changeChartCanvas);
  context.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.body);
  const removedColor = styles.getPropertyValue("--brand").trim();
  const addedColor = styles.getPropertyValue("--accent").trim();
  const textColor = styles.getPropertyValue("--text").trim();
  const padding = { top: 10, right: 10, bottom: 28, left: 14 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxChange = Math.max(...series.map((entry) => Math.max(entry.added, entry.removed)), 1);
  const groupWidth = chartWidth / Math.max(series.length, 1);
  const barWidth = Math.max((groupWidth - 6) / 2, 3);

  drawGrid(context, width, chartHeight, padding);

  series.forEach((entry, index) => {
    const groupX = padding.left + index * groupWidth + 1;
    const removedHeight = (entry.reduced / maxChange) * chartHeight;
    const addedHeight = (entry.added / maxChange) * chartHeight;

    context.fillStyle = removedColor;
    context.beginPath();
    context.roundRect(groupX, padding.top + chartHeight - removedHeight, barWidth, removedHeight, 7);
    context.fill();

    context.fillStyle = addedColor;
    context.beginPath();
    context.roundRect(groupX + barWidth + 4, padding.top + chartHeight - addedHeight, barWidth, addedHeight, 7);
    context.fill();
  });

  context.fillStyle = textColor;
  context.font = "11px Inter, sans-serif";
  context.textAlign = "center";
  series.forEach((entry, index) => {
    if (index % 3 === 0 || index === series.length - 1) {
      const x = padding.left + index * groupWidth + groupWidth / 2;
      context.fillText(formatShortWeekday(entry.date), x, height - 10);
    }
  });
}

function showMessage(element, message) {
  element.textContent = message;
  element.classList.add("show");
}

function hideMessage(element) {
  element.classList.remove("show");
}

function setBusyState(isBusy) {
  loadingEl.style.display = isBusy ? "block" : "none";
  refreshButton.disabled = isBusy;
  exportButton.disabled = isBusy;
  resetButton.disabled = isBusy;
  deleteSuggestionButton.disabled = isBusy || !currentSuggestedBookmark;
  openSuggestionButton.disabled = isBusy || !currentSuggestedBookmark;
  nextSuggestionButton.disabled = isBusy;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderDashboard({ dashboard, stats, now }) {
  const timestamp = new Date(now);
  const dailyChanges = buildDailyChangesSeries(dashboard.events || [], timestamp);
  const series = buildHistorySeries(
    dashboard.history || {},
    dashboard.baselineCount || stats.bookmarks,
    dashboard.startDate ? fromDateKey(dashboard.startDate) : timestamp,
    timestamp,
    stats.bookmarks,
    dailyChanges
  );
  const remainingToGoal = Math.max(stats.bookmarks - GOAL_COUNT, 0);
  const startDate = dashboard.startDate ? fromDateKey(dashboard.startDate) : timestamp;
  const daysElapsed = Math.max(Math.floor((fromDateKey(toDateKey(timestamp)) - fromDateKey(toDateKey(startDate))) / 86400000), 0);
  const daysRemaining = Math.max(PLAN_DAYS - daysElapsed, 1);
  const todayTarget = Math.ceil(remainingToGoal / daysRemaining);
  const removedToday = dailyChanges[dailyChanges.length - 1]?.removed || 0;
  const addedToday = dailyChanges[dailyChanges.length - 1]?.added || 0;
  const paceDelta = removedToday - todayTarget;
  const intervalStatus = getIntervalStatus(dashboard.events || [], timestamp);
  const totalRemoved = dailyChanges.reduce((sum, entry) => sum + entry.removed, 0);
  const totalAdded = dailyChanges.reduce((sum, entry) => sum + entry.added, 0);
  currentSuggestedBookmark = dashboard.suggestedBookmark || null;

  applyTheme(stats.bookmarks);
  document.getElementById("hero-remaining").textContent = formatCount(stats.bookmarks);
  document.getElementById("hero-status").textContent = remainingToGoal === 0
    ? "Goal reached"
    : `${formatCount(remainingToGoal)} to go`;
  document.getElementById("url-count").textContent = formatCount(stats.bookmarks);
  document.getElementById("folder-count").textContent = formatCount(stats.folders);
  document.getElementById("depth-count").textContent = formatCount(stats.deepestLevel);
  document.getElementById("reduced-today").textContent = formatCount(removedToday);
  document.getElementById("reduced-today-detail").textContent = removedToday > 0
    ? `${formatCount(removedToday)} removed today, ${formatCount(addedToday)} added back.`
    : "No removals recorded yet today.";
  document.getElementById("daily-target").textContent = formatCount(todayTarget);
  document.getElementById("daily-target-copy").textContent = `Clear ${formatCount(todayTarget)} per day to reach 50 in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`;
  document.getElementById("pace-delta").textContent = paceDelta === 0
    ? "On target"
    : paceDelta > 0
      ? `${formatCount(paceDelta)} ahead`
      : `${formatCount(Math.abs(paceDelta))} behind`;
  document.getElementById("pace-copy").textContent = paceDelta < 0
    ? `You are ${formatCount(Math.abs(paceDelta))} behind pace.`
    : paceDelta > 0
      ? `You are ${formatCount(paceDelta)} ahead of pace.`
      : `You have cleared exactly ${formatCount(removedToday)}, matching today's target.`;
  document.getElementById("remaining-to-goal").textContent = formatCount(remainingToGoal);
  document.getElementById("goal-copy").textContent = remainingToGoal === 0
    ? "Already at or below 50."
    : `${formatCount(remainingToGoal)} bookmarks left to clear.`;
  const streak = computeStreak(dashboard.events || [], removedToday);
  document.getElementById("streak-value").textContent = streak;
  document.getElementById("streak-copy").textContent = streak === 0
    ? "Clear at least one bookmark to start a streak."
    : `${streak} day${streak === 1 ? "" : "s"} in a row with at least one removal.`;
  document.getElementById("snapshot-caption").textContent = `Updated ${formatTimestamp(timestamp)}`;
  document.getElementById("target-caption").textContent = `${formatDateLabel(series[0].date)} to ${formatDateLabel(series[series.length - 1].date)}`;
  document.getElementById("interval-status").textContent = intervalStatus.intervalMessage;
  document.getElementById("last-cleared-status").textContent = intervalStatus.lastClearedMessage;
  document.getElementById("remaining-chart-note").textContent = `Baseline ${formatCount(dashboard.baselineCount || stats.bookmarks)}. Goal ${GOAL_COUNT}.`;
  document.getElementById("reduction-chart-note").textContent = `${formatCount(totalRemoved)} bookmarks removed across the last 14 days.`;
  document.getElementById("change-chart-note").textContent = `${formatCount(totalAdded)} added and ${formatCount(totalRemoved)} removed over the last 14 days.`;
  document.getElementById("suggestion-name").textContent = currentSuggestedBookmark?.title || "No bookmark suggestion available";
  document.getElementById("suggestion-url").textContent = currentSuggestedBookmark?.url || "There are no bookmark URLs available to suggest right now.";
  document.getElementById("suggestion-meta").textContent = currentSuggestedBookmark?.proposedAt
    ? `Suggested at ${formatTimestamp(new Date(currentSuggestedBookmark.proposedAt))}. Open it or delete it from here.`
    : "Add bookmarks to start receiving hourly suggestions.";

  intervalAlertTitleEl.innerHTML = `<strong>${intervalStatus.title}</strong>`;
  intervalAlertCopyEl.textContent = intervalStatus.copy;
  intervalAlertEl.classList.toggle("show", intervalStatus.showAlert);

  drawRemainingChart(series);
  drawReductionChart(series);
  drawChangeChart(series);

  dashboardEl.style.display = "grid";
  footerEl.textContent = `Last synced at ${formatTimestamp(timestamp)} on ${formatDateLabel(timestamp)}.`;
  setBusyState(false);
}

async function refreshStats() {
  hideMessage(errorEl);
  hideMessage(emptyEl);
  dashboardEl.style.display = "none";
  setBusyState(true);

  try {
    const payload = await sendMessage({ type: "sync-dashboard" });
    const { dashboard, stats, now } = payload;

    if (stats.bookmarks === 0 && stats.folders === 0) {
      applyTheme(0);
      showMessage(emptyEl, "No bookmark URLs were found yet. Save a few bookmarks in Chrome to begin tracking.");
      footerEl.textContent = "Waiting for bookmarks...";
      return;
    }

    renderDashboard({ dashboard, stats, now });
  } catch (error) {
    showMessage(errorEl, `Unable to build the bookmark dashboard right now. ${error.message}`);
    footerEl.textContent = "Last refresh failed.";
  } finally {
    setBusyState(false);
  }
}

refreshButton.addEventListener("click", () => {
  refreshStats();
});

manageButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://bookmarks/" }, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      footerEl.textContent = "Chrome blocked opening the bookmark manager from this popup.";
    }
  });
});

exportButton.addEventListener("click", async () => {
  try {
    const storage = await getStorage([STORAGE_KEY]);
    const timestamp = toDateKey(new Date());
    downloadJson(`bookmark-dashboard-history-${timestamp}.json`, storage[STORAGE_KEY] || {});
    footerEl.textContent = "Progress history exported.";
  } catch (error) {
    showMessage(errorEl, `Unable to export progress history right now. ${error.message}`);
  }
});

resetButton.addEventListener("click", async () => {
  const confirmed = window.confirm("Reset the 14-day baseline and clear tracked progress history?");
  if (!confirmed) {
    return;
  }

  try {
    setBusyState(true);
    const payload = await sendMessage({ type: "reset-baseline" });
    renderDashboard(payload);
    footerEl.textContent = "Baseline reset to the current bookmark count.";
  } catch (error) {
    showMessage(errorEl, `Unable to reset the baseline right now. ${error.message}`);
  } finally {
    setBusyState(false);
  }
});

openSuggestionButton.addEventListener("click", () => {
  if (!currentSuggestedBookmark?.url) {
    return;
  }

  chrome.tabs.create({ url: currentSuggestedBookmark.url });
});

deleteSuggestionButton.addEventListener("click", async () => {
  if (!currentSuggestedBookmark?.id) {
    return;
  }

  try {
    setBusyState(true);
    const payload = await sendMessage({ type: "delete-suggested-bookmark" });
    renderDashboard(payload);
    footerEl.textContent = "Suggested bookmark deleted.";
  } catch (error) {
    showMessage(errorEl, `Unable to delete the suggested bookmark right now. ${error.message}`);
    setBusyState(false);
  }
});

nextSuggestionButton.addEventListener("click", async () => {
  try {
    setBusyState(true);
    const payload = await sendMessage({ type: "refresh-suggested-bookmark" });
    renderDashboard(payload);
    footerEl.textContent = "Picked a new bookmark suggestion.";
  } catch (error) {
    showMessage(errorEl, `Unable to refresh the bookmark suggestion right now. ${error.message}`);
    setBusyState(false);
  }
});

function renderDuplicates(groups) {
  duplicatesListEl.innerHTML = "";

  if (groups.length === 0) {
    duplicatesNoneEl.style.display = "block";
    duplicatesBadgeEl.textContent = "None found";
    return;
  }

  duplicatesNoneEl.style.display = "none";
  const extraCount = groups.reduce((sum, g) => sum + g.copies.length - 1, 0);
  duplicatesBadgeEl.textContent = `${groups.length} ${groups.length === 1 ? "group" : "groups"}, ${extraCount} extra`;

  for (const group of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "duplicate-group";

    const urlEl = document.createElement("div");
    urlEl.className = "duplicate-url";
    urlEl.textContent = group.url;
    groupEl.appendChild(urlEl);

    for (const copy of group.copies) {
      const itemEl = document.createElement("div");
      itemEl.className = "duplicate-item";

      const pathEl = document.createElement("span");
      pathEl.className = "duplicate-path";
      pathEl.title = `${copy.folderPath} — ${copy.title}`;
      pathEl.textContent = copy.folderPath;

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-dupe-btn";
      deleteBtn.type = "button";
      deleteBtn.dataset.id = copy.id;
      deleteBtn.dataset.title = copy.title;
      deleteBtn.textContent = "Delete";

      itemEl.appendChild(pathEl);
      itemEl.appendChild(deleteBtn);
      groupEl.appendChild(itemEl);
    }

    duplicatesListEl.appendChild(groupEl);
  }
}

findDuplicatesButton.addEventListener("click", async () => {
  duplicatesListEl.innerHTML = "";
  duplicatesNoneEl.style.display = "none";
  duplicatesBadgeEl.textContent = "Scanning...";
  findDuplicatesButton.disabled = true;

  try {
    const groups = await sendMessage({ type: "get-duplicates" });
    renderDuplicates(groups);
  } catch (error) {
    duplicatesBadgeEl.textContent = "Failed";
    duplicatesListEl.innerHTML = `<div class="duplicate-none">${error.message}</div>`;
  } finally {
    findDuplicatesButton.disabled = false;
  }
});

duplicatesListEl.addEventListener("click", async (event) => {
  const btn = event.target.closest(".delete-dupe-btn");
  if (!btn) return;

  const { id, title } = btn.dataset;
  if (!window.confirm(`Delete bookmark "${title}"?`)) return;

  btn.disabled = true;
  duplicatesBadgeEl.textContent = "Deleting...";

  try {
    const groups = await sendMessage({ type: "delete-bookmark", id });
    renderDuplicates(groups);
    footerEl.textContent = `Deleted "${title}".`;
  } catch (error) {
    btn.disabled = false;
    duplicatesBadgeEl.textContent = "Error";
    footerEl.textContent = `Failed to delete: ${error.message}`;
  }
});

chrome.bookmarks.onCreated.addListener(refreshStats);
chrome.bookmarks.onRemoved.addListener(refreshStats);
chrome.bookmarks.onChanged.addListener(refreshStats);
chrome.bookmarks.onMoved.addListener(refreshStats);
chrome.bookmarks.onChildrenReordered.addListener(refreshStats);
chrome.bookmarks.onImportEnded.addListener(refreshStats);

window.addEventListener("resize", () => {
  if (dashboardEl.style.display !== "none") {
    refreshStats();
  }
});

refreshStats();
