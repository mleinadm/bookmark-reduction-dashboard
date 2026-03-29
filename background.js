const PLAN_DAYS = 14;
const WORK_INTERVALS = [
  { startHour: 8, endHour: 11 },
  { startHour: 11, endHour: 14 },
  { startHour: 14, endHour: 17 }
];
const STORAGE_KEY = "bookmarkDashboard";
const SYNC_ALARM = "bookmark-dashboard-sync";
const SUGGESTION_ALARM = "bookmark-suggestion-hourly";

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

function flattenBookmarkUrls(nodes) {
  const bookmarks = [];

  function traverse(nodeList) {
    for (const node of nodeList) {
      if (node.url) {
        bookmarks.push({
          id: node.id,
          title: node.title || node.url,
          url: node.url
        });
        continue;
      }

      if (node.children) {
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return bookmarks;
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

function getCurrentDashboard(storage) {
  return storage[STORAGE_KEY] || {};
}

function trimDashboardData(dashboard, now) {
  const validKeys = new Set(buildPastDateKeys(now, PLAN_DAYS));
  const history = { ...(dashboard.history || {}) };

  for (const key of Object.keys(history)) {
    if (!validKeys.has(key)) {
      delete history[key];
    }
  }

  const cutoff = now.getTime() - PLAN_DAYS * 86400000;
  const events = Array.isArray(dashboard.events)
    ? dashboard.events.filter((event) => event.timestamp >= cutoff)
    : [];

  const notifiedIntervals = {};
  const sourceIntervals = dashboard.notifiedIntervals || {};
  for (const [key, value] of Object.entries(sourceIntervals)) {
    const [dateKey] = key.split("|");
    if (validKeys.has(dateKey)) {
      notifiedIntervals[key] = value;
    }
  }

  return {
    ...dashboard,
    history,
    events,
    notifiedIntervals,
    suggestedBookmark: dashboard.suggestedBookmark || null
  };
}

function chooseSuggestedBookmark(bookmarks, previousSuggestionId) {
  if (bookmarks.length === 0) {
    return null;
  }

  const candidates = bookmarks.filter((bookmark) => bookmark.id !== previousSuggestionId);
  const pool = candidates.length > 0 ? candidates : bookmarks;
  const index = Math.floor(Math.random() * pool.length);
  const bookmark = pool[index];

  return {
    ...bookmark,
    proposedAt: new Date().toISOString()
  };
}

async function syncDashboard() {
  const [tree, storage] = await Promise.all([
    getBookmarkTree(),
    getStorage([STORAGE_KEY])
  ]);

  const now = new Date();
  const stats = countBookmarks(tree);
  const flatBookmarks = flattenBookmarkUrls(tree);
  const existing = trimDashboardData(getCurrentDashboard(storage), now);
  const previousCount = typeof existing.lastBookmarkCount === "number" ? existing.lastBookmarkCount : stats.bookmarks;
  const baselineCount = Math.max(existing.baselineCount || stats.bookmarks, stats.bookmarks);
  const startDate = existing.startDate || toDateKey(now);
  const history = { ...(existing.history || {}) };
  const events = [...(existing.events || [])];
  const todayKey = toDateKey(now);
  const delta = stats.bookmarks - previousCount;

  if (delta !== 0) {
    events.push({
      timestamp: now.getTime(),
      amount: Math.abs(delta),
      type: delta > 0 ? "added" : "removed"
    });
  }

  history[todayKey] = {
    date: todayKey,
    remaining: stats.bookmarks,
    folders: stats.folders,
    deepestLevel: stats.deepestLevel,
    updatedAt: now.toISOString()
  };

  const dashboard = {
    baselineCount,
    startDate,
    lastBookmarkCount: stats.bookmarks,
    lastUpdatedAt: now.toISOString(),
    history,
    events,
    notifiedIntervals: existing.notifiedIntervals || {},
    suggestedBookmark: existing.suggestedBookmark || null
  };

  if (dashboard.suggestedBookmark) {
    const stillExists = flatBookmarks.some((bookmark) => bookmark.id === dashboard.suggestedBookmark.id);
    if (!stillExists) {
      dashboard.suggestedBookmark = chooseSuggestedBookmark(flatBookmarks, null);
    }
  } else {
    dashboard.suggestedBookmark = chooseSuggestedBookmark(flatBookmarks, null);
  }

  await setStorage({ [STORAGE_KEY]: dashboard });
  return { dashboard, stats, now: now.toISOString() };
}

async function resetBaseline() {
  const tree = await getBookmarkTree();
  const now = new Date();
  const stats = countBookmarks(tree);
  const dateKey = toDateKey(now);

  const dashboard = {
    baselineCount: stats.bookmarks,
    startDate: dateKey,
    lastBookmarkCount: stats.bookmarks,
    lastUpdatedAt: now.toISOString(),
    history: {
      [dateKey]: {
        date: dateKey,
        remaining: stats.bookmarks,
        folders: stats.folders,
        deepestLevel: stats.deepestLevel,
        updatedAt: now.toISOString()
      }
    },
    events: [],
    notifiedIntervals: {},
    suggestedBookmark: chooseSuggestedBookmark(flattenBookmarkUrls(tree), null)
  };

  await setStorage({ [STORAGE_KEY]: dashboard });
  return { dashboard, stats, now: now.toISOString() };
}

async function refreshSuggestedBookmark() {
  const [tree, storage] = await Promise.all([
    getBookmarkTree(),
    getStorage([STORAGE_KEY])
  ]);

  const flatBookmarks = flattenBookmarkUrls(tree);
  const dashboard = trimDashboardData(getCurrentDashboard(storage), new Date());
  const nextSuggestion = chooseSuggestedBookmark(flatBookmarks, dashboard.suggestedBookmark?.id || null);
  const updatedDashboard = {
    ...dashboard,
    suggestedBookmark: nextSuggestion
  };

  await setStorage({ [STORAGE_KEY]: updatedDashboard });
  return {
    dashboard: updatedDashboard,
    stats: countBookmarks(tree),
    now: new Date().toISOString()
  };
}

async function deleteSuggestedBookmark() {
  const storage = await getStorage([STORAGE_KEY]);
  const dashboard = getCurrentDashboard(storage);
  const suggestedBookmark = dashboard.suggestedBookmark;

  if (!suggestedBookmark?.id) {
    throw new Error("No suggested bookmark is available to delete.");
  }

  await new Promise((resolve, reject) => {
    chrome.bookmarks.remove(suggestedBookmark.id, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });

  return syncDashboard();
}

function intervalKey(date, startHour) {
  return `${toDateKey(date)}|${startHour}`;
}

function buildEndedIntervalsForToday(now) {
  return WORK_INTERVALS
    .map((interval) => {
      const start = new Date(now);
      start.setHours(interval.startHour, 0, 0, 0);

      const end = new Date(now);
      end.setHours(interval.endHour, 0, 0, 0);

      return {
        key: intervalKey(now, interval.startHour),
        start,
        end
      };
    })
    .filter((interval) => now >= interval.end);
}

function hasRemovedEventBetween(events, start, end) {
  return events.some((event) => {
    if (event.type !== "removed") {
      return false;
    }

    return event.timestamp >= start.getTime() && event.timestamp < end.getTime();
  });
}

async function notifyMissedWorkBlocks() {
  const storage = await getStorage([STORAGE_KEY]);
  const dashboard = trimDashboardData(getCurrentDashboard(storage), new Date());
  const now = new Date();
  const endedIntervals = buildEndedIntervalsForToday(now);
  const notifiedIntervals = { ...(dashboard.notifiedIntervals || {}) };
  let changed = false;

  for (const interval of endedIntervals) {
    if (notifiedIntervals[interval.key]) {
      continue;
    }

    const removedInBlock = hasRemovedEventBetween(dashboard.events || [], interval.start, interval.end);
    if (removedInBlock) {
      notifiedIntervals[interval.key] = "cleared";
      changed = true;
      continue;
    }

    chrome.notifications.create(`bookmark-missed-${interval.key}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "No Bookmark Cleared",
      message: `No bookmarks were cleared between ${interval.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} and ${interval.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
    });

    notifiedIntervals[interval.key] = "notified";
    changed = true;
  }

  if (changed) {
    await setStorage({
      [STORAGE_KEY]: {
        ...dashboard,
        notifiedIntervals
      }
    });
  }
}

async function syncAndNotify() {
  await syncDashboard();
  await notifyMissedWorkBlocks();
}

function ensureAlarm() {
  chrome.alarms.create(SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 15
  });

  chrome.alarms.create(SUGGESTION_ALARM, {
    delayInMinutes: 60,
    periodInMinutes: 60
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  syncAndNotify().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  syncAndNotify().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    syncAndNotify().catch(() => {});
    return;
  }

  if (alarm.name === SUGGESTION_ALARM) {
    refreshSuggestedBookmark().catch(() => {});
  }
});

chrome.bookmarks.onCreated.addListener(() => {
  syncDashboard().catch(() => {});
});

chrome.bookmarks.onRemoved.addListener(() => {
  syncDashboard().catch(() => {});
});

chrome.bookmarks.onChanged.addListener(() => {
  syncDashboard().catch(() => {});
});

chrome.bookmarks.onMoved.addListener(() => {
  syncDashboard().catch(() => {});
});

chrome.bookmarks.onChildrenReordered.addListener(() => {
  syncDashboard().catch(() => {});
});

chrome.bookmarks.onImportEnded.addListener(() => {
  syncDashboard().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "sync-dashboard") {
    syncDashboard()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "reset-baseline") {
    resetBaseline()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "refresh-suggested-bookmark") {
    refreshSuggestedBookmark()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "delete-suggested-bookmark") {
    deleteSuggestedBookmark()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
