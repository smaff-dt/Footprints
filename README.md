# Footprints

**See which parts of a page your visitors see, click and ignore.**

Footprints is a Dynatrace app for business, marketing and CX teams. It shows a
picture of a page with its areas colored by what visitors do there — how many
scroll far enough to see each area, how many click it — for any period and
device. Nothing has to be configured, and nobody needs to write or read a
query.

It reads the user interactions captured by Dynatrace Real User Monitoring
(RUM) on Grail. It has two parts:

- the **app** (`ui/`), which runs on Dynatrace, reads the data with the user's
  own login and is where the analysis happens;
- the **browser extension** (`extension/`), which opens the live page, shows a
  first view of the numbers on it and takes the snapshot. It never needs
  Dynatrace credentials.

## How it works

Footprints has two screens:

1. **Snapshots** — the snapshots you saved, as cards with a small picture of
   the page, its device, date and number of zones, grouped by application:
   the latest snapshot of each page comes first, older ones are behind
   **Show N older snapshots**. Search by page or application, filter by
   application or device. **New snapshot** opens a side panel: choose the
   application and the page (or a page group), then how to take it. The list
   of pages is loaded only when you open the page picker.
2. **Analysis** — opens when a snapshot is saved or picked from the list. The
   title row holds the page, one line of context (application, device, date,
   visits, share of clicks found, conversion to the goal), the **Period** and
   **Conversion goal** filters and a **⋮** menu (Delete snapshot). Below, one
   toolbar: the view (Zones, Click heatmap, Scroll heatmap, Table), the
   metric and its colors, **Suggest zones**, **Scroll lines** and the size of
   the page (**Fit**, **75%**, **50%**). The page sits on a grey ground with a
   side panel next to it that never moves the picture: zone details and the
   zones that are on, or what the heatmap shows. The numbers come from visits
   on the snapshot's kind of device.

The list of snapshots downloads no snapshot: each one has a second, tiny
document (`footprints-thumbnail`, the top of the page as a JPEG of about
10–30 KB, its name holding the zone count), made when the snapshot is saved —
or, for snapshots saved before thumbnails existed, the first time it is
opened. Thumbnails are downloaded only for the cards on screen, four at a
time, once per session.

### Taking a snapshot

| Option | How |
|---|---|
| **Desktop** | Automatic. The extension loads the page in a background tab at the window width most desktop visitors use, pictures it screen by screen at that window size (so the picture matches the measured map exactly; bars stuck to the bottom, such as cookie banners, are hidden), and measures where every clicked element is at the other common widths (up to 5, covering about 90% of clicks). |
| **Mobile** | The same, with the page loaded as a phone shows it (phone width and browser identity), using mobile visits only. |
| **By hand** | Manual. The live page opens with the clicks drawn on it; resize the window, accept cookies, open menus, then click **Save snapshot to Footprints**. |

While an automatic snapshot is taken (a few seconds), Chrome shows a bar
saying Footprints is debugging the browser: the extension uses Chrome's
debugging interface to load the page at a given width without touching your
window. Before the picture, every picture of the page is asked for and the
extension waits until they are loaded and ready to draw (a hidden tab
otherwise leaves pictures blank). The background tab closes by itself. It is shown at 100% zoom even
if you zoomed the site in Chrome (your own zoom is left as it is).

**By hand** opens the live page with a small Footprints panel: get the
page ready as visitors see it (close the cookie banner, open a menu, resize
the window), then click **Save snapshot to Footprints**. The live page only
prepares the snapshot; zones, heatmaps and numbers are in the app.

A snapshot stores the picture and a map of the page (where every visible
block is — texts, pictures, links and the boxes around them — and which
contains which), not the numbers: those are recomputed for whatever
period and device you choose. A snapshot taken today stays useful until the
page changes; Footprints shows how many of the period's clicks it finds on the
snapshot, and suggests a new one when that share drops.

Snapshots are Dynatrace documents, private to you by default. The zones you
turn on and their names are saved in the snapshot. A snapshot shows one kind of page — desktop,
tablet or mobile, from the window width when it was taken — and its numbers
always come from visits on that kind of device.

### Choosing pages

The page picker lists every page with clicks in the period — each real
address without its query string, so every product page is its own entry —
most visited first. Scroll the list, or type to filter it; when there are more
than 1,000 pages, typing searches all of them in Dynatrace.

To analyse several pages together, create a **page group** with dropdowns:
choose the part of the address (path, query parameters, host or full
address), a rule (contains, is exactly, starts with, ends with, does not
contain) and type the text. Rules can be combined; a page belongs to the group
when it matches all of them. Examples: *Path is exactly `/`* for the home
page, *Path contains `/product/`* for every product page, *Query parameters
contain `utm_source=newsletter`* for visits from the newsletter. A preview
shows which pages match before saving. Groups are saved privately in
Dynatrace and follow you across browsers.

### Views on the page map

| View | What it shows |
|---|---|
| **Zones** | The page opens with no zone. Point at it: the block under the pointer is outlined — any block of the page, clicked or not. Click it to turn it into a zone: it stays on and shows the metric chosen in **Show**, colored from blue (lowest among the zones on) to red (highest); a click anywhere in a zone that is on turns it off. Pointing at a zone shows an **i**, which shows its details in the side panel. Zones never overlap: turning on a zone inside, around or across another turns the other one off. The details list the blocks around it, from the smallest to the largest (wrappers exactly as big as the block they hold are skipped), to pick the right one; pointing at a level outlines it first. **Suggest zones** replaces the zones that are on with the 2–3 zones that get the most clicks. The side panel ranks the zones that are on, to rename or turn off |
| **Click heatmap** | Where visitors click, from the click positions recorded by Dynatrace. A position belongs to the layout the visitor saw, which depends on the window width; each click is moved onto the same element of the snapshot, at the same spot within it (30% from its left, 60% from its top…) when the page was measured at that width, or estimated from how the element's clicks are spread otherwise. Footprints says how many clicks were placed exactly |
| **Scroll heatmap** | The page colored by the share of visits that get down to each height (red: everyone, blue: few); point anywhere to read the share |
| **Table** | The clicked elements, sortable by clicks, click share, visits, click rate, exposure or conversion; **Show** turns one into a zone on the picture |

Heatmaps are read through their colors: nothing to select on them.

### Conversions

Choose a **Conversion goal** in the filters — a page or a page group, for
example a group *Path contains `/checkout/`*. A visit converts when it
reaches the goal **after** landing on the page (page average) or **after
clicking** in a zone. Each zone then shows the share of visits that clicked
in it and went on to reach the goal, next to the page average.

### Metrics

| Metric | Meaning |
|---|---|
| **Click rate** | Of the visits that saw the zone, the share that clicked in it (the default) |
| **Click share** | Of all the clicks on the page, the share that happens in the zone |
| **Exposure** | The share of visits that scrolled far enough to see the zone |
| **Conversion** | Of the visits that clicked in the zone, the share that then reached the conversion goal |

The visits that clicked in a zone are counted by Dynatrace when the zone is
turned on (one small query per zone), so a visit that clicks several elements
of a zone counts once. Until the answer arrives, or for zones holding more
than 400 different clicked elements, the details show an estimate (≈). The
**i** next to the metric explains it. Dashed lines mark where 75%, 50% and 25%
of visits stop scrolling.

### How exposure is measured

For every visit to the page, Footprints takes the deepest point seen: the
page's scroll position plus the browser window height, for each scroll of the
page itself (scrolls inside a carousel or a menu are left out); the position
of each click; at least the first screen for any visit. An area counts as seen
when half of it — or its first 300 px, if it is taller — came into view.

Page lengths differ a lot between desktop and mobile, so choose one device for
exact numbers. Only vertical scrolling is measured: slides hidden inside a
horizontal carousel count as seen when the carousel is.

### Keeping the website's analytics clean

The website's own RUM records every click on its pages. On the live page the
Footprints panel runs inside an extension frame, so clicks on it are not
visible to the website and are not recorded. Drawings on the page never
receive clicks. Your visit itself (the page view and scrolling) is recorded
like any other visit.

## Install the extension (Chrome or Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder of this
   repository.

After updating the repository, click the reload icon on the Footprints card,
then reload the Footprints tab.

## Roadmap

| Step | What it adds |
|---|---|
| ✅ | List view, filters, plain-language details |
| ✅ | Live page: automatic areas, exposure, isolated panel |
| ✅ | Snapshots saved in Dynatrace; page map with metrics, renaming |
| next | Content changes: clicks attributed to the content shown (link, picture, text) and changes over time detected; share of visits that click anywhere in an area |
| next | Conversion ("of the visits that clicked here, how many booked?"), comparison with a previous period or another segment, automatic insights |
| later | Mobile snapshots, sharing snapshots with the team, click heatmap, frustration (rage) clicks |

## Look and feel

The app is built with Strato, the Dynatrace design system (components,
icons, colors and type from `@dynatrace/strato-*`), so it looks like the
other Dynatrace apps and follows the platform's light or dark theme. Only the
picture of the page — zones, heatmaps, scroll lines — is drawn by Footprints,
with its own warm colors for zones and a cold-to-hot scale for heatmaps.

## Data requirements

- A Dynatrace environment on the latest platform (Grail, AppEngine).
- The new RUM experience for web, with **user interaction capture turned on**
  for the applications you want to analyse.
- Fields used: `characteristics.has_user_interaction`, `interaction.type`,
  `ui_element.xpath`, `ui_element.name`, `ui_element.tag_name`, `positions`,
  `view.url.full`, `page.url.full`, `browser.window.width`,
  `browser.window.height`, `frontend.name` (or `dt.rum.application.entity` on
  older environments), `dt.rum.session.id`. Several are marked *experimental*
  in the Semantic Dictionary and may change.

## Permissions

| Scope | Why |
|---|---|
| `storage:user.events:read` | Clicks, scrolls and page views |
| `storage:buckets:read` | Required with the table permission to read Grail |
| `storage:entities:read` | Application names on older environments |
| `document:documents:read` | Read your page snapshots |
| `document:documents:write` | Save page snapshots, area names and page groups |

The browser extension asks for: access to web pages (to read and picture the
page you analyse), `scripting`, `storage`, and `debugger` (automatic
snapshots at a chosen width, in a background tab).

## Develop and deploy

Requires Node.js; version 24 is the one officially supported by `dt-app`.

```bash
npm install
# set "environmentUrl" in app.config.json to your environment, e.g.
#   https://<your-environment>.apps.dynatrace.com
npm start          # local development, opens the app against your environment
npm run typecheck  # TypeScript checks
npm run deploy     # build and install the app on the environment
```

The first `start` or `deploy` opens a browser to sign in to Dynatrace.

## Project layout

```
extension/
  manifest.json           Chrome extension (Manifest V3)
  bridge.js               runs in the app's frame; relays requests and snapshots
  background.js           opens pages, takes pictures, delivers snapshots (kept if the app is closed)
  overlay.js              finds clicked elements, builds areas, draws them, captures snapshots
  panel.html/js           the panel on the live page, isolated from the website
  popup.html/js           "Show copied data on this tab" fallback
ui/
  App.tsx                 the two screens, page groups, receives snapshots from the extension
  screens/SnapshotsScreen  new snapshot (application, page, capture options) and the list of saved snapshots
  screens/AnalysisScreen   one snapshot: period, goal, page map or list, rename, delete
  components/SnapshotView   the page map: metric dropdown, colored areas, any element selectable, sidebar
  components/PagePicker   searchable page list and the page group editor (also used for the goal)
  components/Heatmaps     click and scroll heatmap layers
  lib/pages.ts            pages and page groups (rules, storage)
  components/ShowOnPage   the "Show on the page" button and its fallback
  lib/snapshots.ts        snapshots as Dynatrace documents
  lib/snapshotMath.ts     matching recorded clicks to the map; metrics; exposure
  lib/extension.ts        messages between the app and the extension
  dql/queries.ts          every DQL query, built from the filter choices
  hooks/data.ts           query rows → applications, pages, elements, scroll depth
```

## Known limitations

- Clicks are matched to the snapshot by the element's position in the page
  structure. If the content in a position changes (a banner with a new
  campaign), the clicks are still counted together; attribution by content is
  the next step.
- Elements not on screen when the snapshot is taken (closed menus, pop-ups)
  are not on the map; their clicks count as "not on this snapshot".
- Pages longer than 16,000 pixels are cut at that height.
- Automatic snapshots do not accept cookie banners or open menus: use
  **By hand** for that. Pages behind a login work if your browser is
  logged in.
- Opening a page (automatically or by hand) counts as a visit in the site's
  own analytics.
- "Visits" are RUM sessions.
- Pages are opened at an address seen in the data: pages that need a login or
  the company network open only if your browser can reach them.

## Tests

Headless Chromium tests (Python Playwright):

```bash
python3 tests/overlay/run.py             # finds elements (both xpath spellings), areas at each detail level
python3 tests/overlay/e2e.py             # real extension: app → page → isolated panel → snapshot back to the app
python3 tests/overlay/capture_test.py    # long page with sticky header and cookie bar stitched cleanly
python3 tests/overlay/frame_test.py      # extension reached from sandboxed frames like the Dynatrace app
python3 tests/overlay/auto_test.py       # automatic desktop and mobile snapshots, measured at other widths
# the same in a real browser window with the site zoomed to 90% (picture must still match the map):
ZOOM=0.9 HEADED=1 xvfb-run -a -s "-screen 0 1400x900x24" python3 tests/overlay/auto_test.py
# app page map, rendered outside Dynatrace with the snapshot from e2e.py:
node_modules/.bin/esbuild tests/app/harness.tsx --bundle --outfile=tests/app/harness.js --format=iife --jsx=automatic --loader:.woff2=dataurl --loader:.woff=dataurl --define:process.env.NODE_ENV='"production"'
python3 tests/app/snapshot_view_test.py
# the whole app with a simulated Dynatrace (SDKs replaced by tests/app/mock):
node_modules/.bin/esbuild tests/app/app_harness.tsx --bundle --outfile=tests/app/app_harness.js --format=iife --jsx=automatic --loader:.woff2=dataurl --loader:.woff=dataurl --define:process.env.NODE_ENV='"production"' \
  --alias:@dynatrace-sdk/client-query=./tests/app/mock/query.ts --alias:@dynatrace-sdk/client-document=./tests/app/mock/document.ts
python3 tests/app/app_test.py
# clicks from other window widths placed on the right element (uses auto_test.py's output):
node_modules/.bin/esbuild tests/app/place_test.ts --bundle --platform=node --format=esm --outfile=/tmp/place.mjs && node /tmp/place.mjs
```
