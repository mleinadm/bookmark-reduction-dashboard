# Bookmark Counter

A Chrome extension that turns bookmark cleanup into a lightweight daily dashboard.

Instead of only showing how many bookmarks you have, the popup tracks your remaining bookmark URLs against a reduction goal, shows a 14-day pace chart, highlights daily progress, and alerts you during work blocks when no bookmark has been cleared.

## Features

- Live bookmark stats for:
  - Remaining bookmark URLs
  - Folders
  - Deepest bookmark nesting level
  - Bookmarks reduced today
- Dynamic theme colors:
  - Green when bookmark URLs are below `50`
  - Yellow when bookmark URLs are above `50`
  - Red when bookmark URLs are above `100`
- A 14-day chart showing:
  - Remaining bookmarks
  - Target pace toward the goal of `50`
- A second 14-day chart showing daily bookmark reductions
- A workday reminder system for the blocks:
  - `8:00 AM - 11:00 AM`
  - `11:00 AM - 2:00 PM`
  - `2:00 PM - 5:00 PM`
- A top alert banner that shows `No Bookmark Cleared` if no reduction is recorded in the current 3-hour block
- Local progress persistence with `chrome.storage.local`
- Quick access to the Chrome bookmark manager

## How It Works

The extension reads your Chrome bookmark tree and counts bookmark URLs, folders, and depth.

It also stores a small local progress record in extension storage:

- A baseline bookmark count
- Daily remaining bookmark totals
- Inferred clear events when the current bookmark count drops below the previous stored count

That stored history is used to build the 14-day charts and the work-block alert logic.

## Goal Logic

The cleanup goal is to get bookmark URLs below `50`.

The current implementation uses a 14-day glide path:

- The target starts from the tracked baseline bookmark count
- It slopes down over `14` days
- The minimum target is capped at `50`

If your current bookmark URL count is:

- Less than or equal to the target for today, you are on pace or ahead
- Higher than the target for today, you are behind pace

## Project Files

- [`manifest.json`](/Users/tx/Documents/chrome/manifest.json)  
  Chrome extension manifest and permissions
- [`popup.html`](/Users/tx/Documents/chrome/popup.html)  
  Popup layout and styling
- [`popup.js`](/Users/tx/Documents/chrome/popup.js)  
  Bookmark counting, persistence, alert logic, and chart rendering
- [`icons/`](/Users/tx/Documents/chrome/icons)  
  Extension icon assets used by Chrome and the popup UI

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project folder:
   `/Users/tx/Documents/chrome`
5. Pin the extension if you want fast access from the toolbar

If you change the manifest or popup files, reload the unpacked extension from the extensions page.

## Usage

1. Open the extension popup
2. Review your remaining bookmark count and target pace
3. Clear bookmarks during the workday
4. Reopen or refresh the popup to record updated progress
5. Use `Open Bookmark Manager` to jump directly into Chrome bookmarks

The dashboard updates automatically when bookmark changes are detected while the popup is open.

## Permissions

- `bookmarks`  
  Needed to read the bookmark tree
- `storage`  
  Needed to store progress history, clear events, and daily totals

## Notes

- The charts are based on locally stored history, not cloud sync
- Bookmark reductions are inferred from drops in the total bookmark URL count
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
