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

1. **In Footprints**, choose an application and a page (or a page group),
   then click **Show on the page**.
2. **On the page** that opens, the extension divides the page into areas
   automatically and shows on each one its share of clicks or how many visits
   see it. When the division looks right (use the **Detail** slider if
   needed), click **Save snapshot to Footprints**.
3. **Back in Footprints**, the snapshot appears under **Page map**: the
   picture of the page with its areas colored by the metric you choose at the
   top. Point at anything on the picture — an area, or any element such as
   the logo or the cart icon, clicked or not — for its numbers; click to keep
   it selected in the sidebar. The sidebar also ranks the areas and lets you
   **rename** them.

A snapshot stores the picture and a map of the page (where every area and
clickable element is), not the numbers: those are recomputed for whatever
period and device you choose. A snapshot taken today stays useful until the
page changes; Footprints shows how many of the period's clicks it finds on the
snapshot, and suggests a new one when that share drops.

Snapshots are Dynatrace documents, private to you by default. Names given to
areas are saved in the snapshot. A snapshot shows one kind of page — desktop,
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

### Metrics

| Metric | Meaning |
|---|---|
| **Seen by** | Share of visits that scrolled far enough to see the area |
| **Share of clicks** | Share of the page's clicks that happen in the area |
| **Clicks per 100 views** | Clicks in the area for every 100 visits that saw it |
| *(elements)* **Click rate** | Share of visits that click the element |
| *(elements)* **Clicked by, of those who saw it** | Visits that clicked ÷ visits that saw it |

Choose the metric from the **Show** dropdown. Dashed lines mark where 75%,
50% and 25% of visits stop scrolling (lines that nearly coincide share one
label).

### How areas are found

The extension looks at the page itself: landmarks (header, navigation,
footer, main content), named components (`app-login-form`), and large visual
blocks such as banners, cards and lists. Each area gets a name from the page
(its heading, label or role); you can rename it. The **Detail** slider goes
from a few large areas to many small ones; the page opens at the first level
where no single area takes more than 75% of the clicks.

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

## The list view

**List** ranks the page's sections (or individual elements) by share of
visits that click, number of clicks or visits that click, with a
plain-language summary of the selected one. Sections there come from
component names (`app-login-form` → "Login form") and work best on sites
built with components; the page map works on any site.

## Roadmap

| Step | What it adds |
|---|---|
| ✅ | List view, filters, plain-language details |
| ✅ | Live page: automatic areas, exposure, isolated panel |
| ✅ | Snapshots saved in Dynatrace; page map with metrics, renaming |
| next | Content changes: clicks attributed to the content shown (link, picture, text) and changes over time detected; share of visits that click anywhere in an area |
| next | Conversion ("of the visits that clicked here, how many booked?"), comparison with a previous period or another segment, automatic insights |
| later | Mobile snapshots, sharing snapshots with the team, click heatmap, frustration (rage) clicks |

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
| `document:documents:write` | Save page snapshots and area names |

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
  App.tsx                 page layout, filters, view switch, receives snapshots
  components/SnapshotPanel  snapshots of a page: list, load, rename, delete
  components/SnapshotView   the page map: metric dropdown, colored areas, any element selectable, sidebar
  components/PagePicker   searchable page list and the page group editor
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
- Snapshots follow the window width: for a mobile snapshot, open the page in
  a narrow window or in the browser's device mode.
- "Visits" are RUM sessions.
- Pages are opened at an address seen in the data: pages that need a login or
  the company network open only if your browser can reach them.

## Tests

Headless Chromium tests (Python Playwright):

```bash
python3 tests/overlay/run.py             # finds elements (both xpath spellings), areas at each detail level
python3 tests/overlay/inspect_test.py    # numbers on hover, page keeps working, scrolling works
python3 tests/overlay/exposure_test.py   # exposure from a known scroll distribution
python3 tests/overlay/autodetail_test.py # pictures named from their card; sensible starting detail
python3 tests/overlay/e2e.py             # real extension: app → page → isolated panel → snapshot back to the app
python3 tests/overlay/capture_test.py    # long page with sticky header and cookie bar stitched cleanly
python3 tests/overlay/frame_test.py      # extension reached from sandboxed frames like the Dynatrace app
# app page map, rendered outside Dynatrace with the snapshot from e2e.py:
node_modules/.bin/esbuild tests/app/harness.tsx --bundle --outfile=tests/app/harness.js --format=iife --jsx=automatic
python3 tests/app/snapshot_view_test.py
```
