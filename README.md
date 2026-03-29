# Bookmark Counter

> A Chrome extension that turns bookmark cleanup into a lightweight daily dashboard.

Track your remaining bookmarks against a 14-day reduction goal, visualize progress across three charts, and stay on pace with workday block alerts and hourly suggestions.

---

## Features

### Stats & Themes

| Metric | Description |
|---|---|
| Remaining URLs | Live count of saved bookmark URLs |
| Folders | Total number of bookmark folders |
| Deepest Level | Maximum nesting depth in the tree |
| Reduced Today | Bookmarks cleared since midnight |

The popup theme **and toolbar icon badge** shift automatically based on your current URL count:

| Count | Theme | Badge color |
|---|---|---|
| ≤ 50 | 🟢 Green | Green |
| 51 – 100 | 🟡 Yellow | Yellow |
| > 100 | 🔴 Red | Red |

The badge always shows the live remaining count directly on the extension icon.

### Charts

- **Remaining vs Target** — 14-day line chart of actual count against the daily pace target
- **Daily Reductions** — Bar chart of bookmarks cleared per day over 14 days
- **Added vs Removed** — Daily comparison of bookmarks added and removed

### Streak

The **Streak** card counts how many consecutive days you have cleared at least one bookmark. The streak resets if a day passes with no removal.

### Duplicate Detection

The **Find Duplicate Bookmarks** button scans your full bookmark tree and groups URLs that resolve to the same address (ignoring `http/https`, `www.`, and trailing slashes). Each duplicate group shows:

- The shared URL
- The folder path of every copy
- A **Delete** button per copy that removes it immediately and refreshes the list

### Workday Alerts

Monitors three 3-hour blocks each weekday:

```
8:00 AM – 11:00 AM   ·   11:00 AM – 2:00 PM   ·   2:00 PM – 5:00 PM
```

A banner appears at the top of the popup if no bookmark was cleared in the current block. Background notifications fire for any missed block after it ends.

### Suggestions

An hourly suggestion card surfaces one of your saved bookmarks with quick actions to **open**, **delete**, or **skip** to the next suggestion.

### Data & Controls

- Progress persisted locally via `chrome.storage.local`
- Export full dashboard history as JSON
- Reset the 14-day baseline to the current bookmark count
- One-click access to the Chrome bookmark manager

---

## How It Works

On each sync the extension reads the full Chrome bookmark tree and records:

- **Baseline count** — the starting bookmark total when tracking began
- **Daily snapshots** — remaining URL count stored once per day
- **Change events** — adds and removes inferred from count deltas
- **Suggested bookmark** — one bookmark rotated hourly from the full URL list

That history drives the charts, the glide-path target, background notifications, and the work-block alert logic.

---

## Goal & Pace Logic

The target is to get below **50 bookmark URLs** within 14 days.

**Daily target** = bookmarks above 50 ÷ days remaining in the plan:

$$\text{daily target} = \left\lceil \frac{\max(\text{count} - 50,\, 0)}{\text{days remaining}} \right\rceil$$

**Ahead / Behind** compares how many you cleared today against that daily target:

$$\text{pace delta} = \text{removed today} - \text{daily target}$$

| Status | Condition |
|---|---|
| Ahead of pace | Removed today > daily target |
| Behind pace | Removed today < daily target |
| On target | Removed today = daily target |

---

## Project Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest and permissions |
| `popup.html` | Popup layout and styling |
| `popup.js` | Stats, charts, alert logic, and UI interactions |
| `background.js` | Background sync, notifications, and baseline reset |
| `icons/` | Icon assets used by Chrome and the popup UI |

---

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this folder: `~/Documents/chrome`
5. Pin the extension from the toolbar for quick access

> After editing any source file, click the reload icon on the extensions page to apply changes.

---

## Usage

| Action | How |
|---|---|
| Refresh stats | Click **Refresh** in the popup |
| Clear bookmarks | Use **Open Bookmark Manager** or the suggestion card |
| Export progress | Click **Export History** to download a JSON snapshot |
| Reset plan | Click **Reset Baseline** to restart the 14-day window |
| Act on a suggestion | Open, delete, or skip it from the suggestion card |
| Find duplicates | Click **Find Duplicate Bookmarks** at the bottom of the dashboard |

The dashboard syncs automatically whenever Chrome detects a bookmark change.

## Permissions

- `bookmarks`  
  Needed to read the bookmark tree
- `storage`  
  Needed to store progress history, clear events, and daily totals
- `alarms`  
  Needed for background periodic sync and missed-block checks
- `notifications`  
  Needed to alert you when a work block ends without any bookmark being cleared

## Notes

- The charts are based on locally stored history, not cloud sync
- Bookmark reductions and additions are inferred from changes in the total bookmark URL count
- If bookmarks are added back later, the dashboard will reflect the new remaining total
- The popup is designed as a compact Windows-inspired glass dashboard

## Verification

Basic script validation can be run with:

```bash
node --check popup.js
```

## Future Ideas

- Export progress history
- Add notification support for missed work blocks
- Add a reset option for the 14-day baseline
- Add a separate chart for bookmarks added vs removed
