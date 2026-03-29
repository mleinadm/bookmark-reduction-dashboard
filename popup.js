const GOAL_COUNT = 50;
const PLAN_DAYS = 14;
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
const remainingChartCanvas = document.getElementById("remaining-chart");
const reductionChartCanvas = document.getElementById("reduction-chart");
const intervalAlertEl = document.getElementById("interval-alert");
const intervalAlertTitleEl = document.getElementById("interval-alert-title");
const intervalAlertCopyEl = document.getElementById("interval-alert-copy");

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

function setStorage(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function getBookmarkTree() {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((tree) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tree);
    });
  });
}

function countBookmarks(nodes) {
  let bookmarks = 0;
  let folders = 0;
  let deepestLevel = 0;

  function traverse(nodeList, depth) {
    for (const node of nodeList) {
      if (node.url) {
        bookmarks += 1;
        deepestLevel = Math.max(deepestLevel, depth);
        continue;
      }

      if (node.children) {
        if (node.parentId !== undefined) {
          folders += 1;
          deepestLevel = Math.max(deepestLevel, depth);
        }

        traverse(node.children, depth + 1);
      }
    }
  }

  traverse(nodes, 0);
  return { bookmarks, folders, deepestLevel };
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
  const daysElapsed = Math.floor((fromDateKey(toDateKey(now)) - fromDateKey(toDateKey(startDate))) / 86400000);
  const progressDays = clamp(daysElapsed, 0, PLAN_DAYS - 1);
  const reductionSpan = Math.max(safeBaseline - GOAL_COUNT, 0);
  const perDayReduction = reductionSpan / Math.max(PLAN_DAYS - 1, 1);
  const target = Math.round(safeBaseline - (perDayReduction * progressDays));
  return Math.max(target, GOAL_COUNT);
}

function buildHistorySeries(historyMap, baselineCount, startDate, now, currentBookmarkCount) {
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

    const reduced = Math.max(previousRemaining - remaining, 0);
    previousRemaining = remaining;

    return {
      key,
      date,
      target,
      remaining,
      reduced
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

function getIntervalStatus(clearEvents, now) {
  const currentInterval = getCurrentInterval(now);
  const lastClearedEvent = clearEvents.length > 0 ? clearEvents[clearEvents.length - 1] : null;

  if (!currentInterval) {
    const nextInterval = getNextInterval(now);
    return {
      showAlert: false,
      title: "Outside Work Block",
      copy: `Next clearing block starts at ${formatTimestamp(nextInterval)}.`,
      intervalMessage: `Outside the 8:00 AM to 5:00 PM tracking window. Next block begins at ${formatTimestamp(nextInterval)}.`,
      lastClearedMessage: lastClearedEvent
        ? `${formatCount(lastClearedEvent.amount)} cleared at ${formatTimestamp(new Date(lastClearedEvent.timestamp))}.`
        : "No bookmark reduction recorded yet."
    };
  }

  const clearedThisInterval = clearEvents.some((event) => {
    const timestamp = new Date(event.timestamp);
    return timestamp >= currentInterval.start && timestamp < currentInterval.end;
  });

  if (!clearedThisInterval) {
    return {
      showAlert: true,
      title: "No Bookmark Cleared",
      copy: `No bookmark reduction has been recorded in this ${formatTimestamp(currentInterval.start)} to ${formatTimestamp(currentInterval.end)} block.`,
      intervalMessage: `Current block: ${formatTimestamp(currentInterval.start)} to ${formatTimestamp(currentInterval.end)}. No bookmark cleared yet.`,
      lastClearedMessage: lastClearedEvent
        ? `${formatCount(lastClearedEvent.amount)} cleared at ${formatTimestamp(new Date(lastClearedEvent.timestamp))}.`
        : "No bookmark reduction recorded yet."
    };
  }

  return {
    showAlert: false,
    title: "On Track",
    copy: `At least one bookmark has already been cleared in the ${formatTimestamp(currentInterval.start)} to ${formatTimestamp(currentInterval.end)} block.`,
    intervalMessage: `Current block: ${formatTimestamp(currentInterval.start)} to ${formatTimestamp(currentInterval.end)}. At least one bookmark cleared.`,
    lastClearedMessage: lastClearedEvent
      ? `${formatCount(lastClearedEvent.amount)} cleared at ${formatTimestamp(new Date(lastClearedEvent.timestamp))}.`
      : "No bookmark reduction recorded yet."
  };
}

function resizeCanvasForDisplay(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 420;
  const height = canvas.clientHeight || 180;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
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

  context.strokeStyle = "rgba(255,255,255,0.55)";
  context.lineWidth = 1;

  for (let i = 0; i <= 3; i += 1) {
    const y = padding.top + (chartHeight * i) / 3;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }

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
  context.strokeStyle = "rgba(92, 111, 100, 0.75)";
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
  gradient.addColorStop(0, colorWithAlpha(brandSoft, 0.38));
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
  context.font = "11px 'Segoe UI', sans-serif";
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

  const padding = { top: 10, right: 10, bottom: 28, left: 14 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxReduction = Math.max(...series.map((entry) => entry.reduced), 1);
  const barWidth = chartWidth / Math.max(series.length, 1) - 4;
  const styles = getComputedStyle(document.body);
  const brand = styles.getPropertyValue("--brand").trim();
  const brandSoft = styles.getPropertyValue("--brand-soft").trim() || brand;
  const textColor = styles.getPropertyValue("--text").trim();

  context.strokeStyle = "rgba(255,255,255,0.55)";
  context.lineWidth = 1;
  for (let i = 0; i <= 3; i += 1) {
    const y = padding.top + (chartHeight * i) / 3;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }

  series.forEach((entry, index) => {
    const barHeight = (entry.reduced / maxReduction) * chartHeight;
    const x = padding.left + index * (barWidth + 4);
    const y = padding.top + chartHeight - barHeight;
    const radius = 10;
    const gradient = context.createLinearGradient(0, y, 0, y + Math.max(barHeight, 1));
    gradient.addColorStop(0, brandSoft);
    gradient.addColorStop(1, brand);

    context.beginPath();
    context.moveTo(x, y + radius);
    context.arcTo(x, y, x + radius, y, radius);
    context.lineTo(x + barWidth - radius, y);
    context.arcTo(x + barWidth, y, x + barWidth, y + radius, radius);
    context.lineTo(x + barWidth, y + barHeight);
    context.lineTo(x, y + barHeight);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
  });

  context.fillStyle = textColor;
  context.font = "11px 'Segoe UI', sans-serif";
  context.textAlign = "center";
  series.forEach((entry, index) => {
    if (index % 3 === 0 || index === series.length - 1) {
      const x = padding.left + index * (barWidth + 4) + barWidth / 2;
      context.fillText(formatShortWeekday(entry.date), x, height - 10);
    }
  });
}

function showMessage(element, message) {
  element.textContent = message;
  element.classList.add("show");
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

function hideMessage(element) {
  element.classList.remove("show");
}

function setBusyState(isBusy) {
  loadingEl.style.display = isBusy ? "block" : "none";
  refreshButton.disabled = isBusy;
}

function renderDashboard(data) {
  const {
    bookmarks,
    folders,
    deepestLevel,
    todayTarget,
    remainingToGoal,
    dailyDelta,
    paceDelta,
    intervalStatus,
    series,
    lastUpdatedAt
  } = data;

  applyTheme(bookmarks);
  document.getElementById("hero-remaining").textContent = formatCount(bookmarks);
  document.getElementById("hero-status").textContent = bookmarks <= GOAL_COUNT
    ? "Goal reached"
    : `${formatCount(remainingToGoal)} to go`;

  document.getElementById("url-count").textContent = formatCount(bookmarks);
  document.getElementById("folder-count").textContent = formatCount(folders);
  document.getElementById("depth-count").textContent = formatCount(deepestLevel);
  document.getElementById("reduced-today").textContent = formatCount(dailyDelta);
  document.getElementById("reduced-today-detail").textContent = dailyDelta > 0
    ? `You have already cleared ${formatCount(dailyDelta)} bookmark${dailyDelta === 1 ? "" : "s"} today.`
    : "No reductions have been recorded yet today.";

  document.getElementById("daily-target").textContent = formatCount(todayTarget);
  document.getElementById("daily-target-copy").textContent = `Today's target remaining count is ${formatCount(todayTarget)}.`;

  document.getElementById("pace-delta").textContent = paceDelta === 0
    ? "0"
    : `${paceDelta < 0 ? "-" : "+"}${formatCount(Math.abs(paceDelta))}`;
  document.getElementById("pace-copy").textContent = paceDelta < 0
    ? `${formatCount(Math.abs(paceDelta))} below target, which means you are ahead of plan.`
    : paceDelta > 0
      ? `${formatCount(paceDelta)} above target, which means you are behind plan.`
      : "Exactly on target for today.";

  document.getElementById("remaining-to-goal").textContent = formatCount(remainingToGoal);
  document.getElementById("goal-copy").textContent = remainingToGoal === 0
    ? "You are already at or below 50 bookmarks."
    : `${formatCount(remainingToGoal)} more bookmark${remainingToGoal === 1 ? "" : "s"} to clear.`;

  document.getElementById("snapshot-caption").textContent = `Updated ${formatTimestamp(lastUpdatedAt)}`;
  document.getElementById("target-caption").textContent = `${formatDateLabel(series[0].date)} to ${formatDateLabel(series[series.length - 1].date)}`;
  document.getElementById("interval-status").textContent = intervalStatus.intervalMessage;
  document.getElementById("last-cleared-status").textContent = intervalStatus.lastClearedMessage;
  document.getElementById("remaining-chart-note").textContent = `Start point: ${formatCount(series[0].remaining)} remaining. Goal: ${GOAL_COUNT}.`;
  document.getElementById("reduction-chart-note").textContent = `Total reduced over the last 14 days: ${formatCount(series.reduce((sum, entry) => sum + entry.reduced, 0))}.`;

  intervalAlertTitleEl.innerHTML = `<strong>${intervalStatus.title}</strong>`;
  intervalAlertCopyEl.textContent = intervalStatus.copy;
  intervalAlertEl.classList.toggle("show", intervalStatus.showAlert);

  drawRemainingChart(series);
  drawReductionChart(series);

  dashboardEl.style.display = "grid";
  footerEl.textContent = `Last synced at ${formatTimestamp(lastUpdatedAt)} on ${formatDateLabel(lastUpdatedAt)}.`;
}

async function refreshStats() {
  hideMessage(errorEl);
  hideMessage(emptyEl);
  dashboardEl.style.display = "none";
  setBusyState(true);

  try {
    const [tree, storage] = await Promise.all([
      getBookmarkTree(),
      getStorage(["bookmarkDashboard"])
    ]);

    const stats = countBookmarks(tree);
    const now = new Date();

    if (stats.bookmarks === 0 && stats.folders === 0) {
      applyTheme(0);
      showMessage(emptyEl, "No bookmark URLs were found yet. Save a few bookmarks in Chrome to begin tracking.");
      footerEl.textContent = "Waiting for bookmarks...";
      return;
    }

    const persisted = storage.bookmarkDashboard || {};
    const history = persisted.history || {};
    const clearEvents = Array.isArray(persisted.clearEvents) ? persisted.clearEvents : [];
    const previousCount = typeof persisted.lastBookmarkCount === "number" ? persisted.lastBookmarkCount : stats.bookmarks;
    const baselineCount = Math.max(persisted.baselineCount || stats.bookmarks, stats.bookmarks);
    const trackingStartDate = persisted.startDate ? fromDateKey(persisted.startDate) : now;
    const todayKey = toDateKey(now);
    const updatedHistory = { ...history };
    const updatedClearEvents = clearEvents.filter((event) => now.getTime() - event.timestamp <= PLAN_DAYS * 86400000);

    if (stats.bookmarks < previousCount) {
      updatedClearEvents.push({
        timestamp: now.getTime(),
        amount: previousCount - stats.bookmarks
      });
    }

    updatedHistory[todayKey] = {
      date: todayKey,
      remaining: stats.bookmarks,
      folders: stats.folders,
      deepestLevel: stats.deepestLevel,
      updatedAt: now.toISOString()
    };

    const validKeys = new Set(buildPastDateKeys(now, PLAN_DAYS));
    for (const key of Object.keys(updatedHistory)) {
      if (!validKeys.has(key)) {
        delete updatedHistory[key];
      }
    }

    const series = buildHistorySeries(updatedHistory, baselineCount, trackingStartDate, now, stats.bookmarks);
    const yesterdayRemaining = series.length > 1 ? series[series.length - 2].remaining : baselineCount;
    const dailyDelta = Math.max(yesterdayRemaining - stats.bookmarks, 0);
    const todayTarget = getTodayTarget(baselineCount, trackingStartDate, now);
    const remainingToGoal = Math.max(stats.bookmarks - GOAL_COUNT, 0);
    const paceDelta = stats.bookmarks - todayTarget;
    const intervalStatus = getIntervalStatus(updatedClearEvents, now);

    await setStorage({
      bookmarkDashboard: {
        baselineCount,
        startDate: toDateKey(trackingStartDate),
        lastBookmarkCount: stats.bookmarks,
        lastUpdatedAt: now.toISOString(),
        history: updatedHistory,
        clearEvents: updatedClearEvents
      }
    });

    renderDashboard({
      bookmarks: stats.bookmarks,
      folders: stats.folders,
      deepestLevel: stats.deepestLevel,
      todayTarget,
      remainingToGoal,
      dailyDelta,
      paceDelta,
      intervalStatus,
      series,
      lastUpdatedAt: now
    });
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
