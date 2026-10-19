# Footprints

**See which parts of a page your visitors click, use and ignore.**

Footprints is a Dynatrace app for business, marketing and CX teams. Pick a
website and one of its pages, choose a period and a device, and click
**Show on the page**: the live page opens with its areas colored by how much
they are clicked. Nothing has to be configured, and nobody needs to write or
read a query.

It reads the user interactions captured by Dynatrace Real User Monitoring
(RUM) on Grail. It has two parts:

- the **app** (`ui/`), which runs on Dynatrace and reads the data with the
  user's own login;
- the **browser extension** (`extension/`), which draws the data on the live
  page. It never needs Dynatrace credentials: the app hands it the data.

## Show on the page (prototype)

1. In the app, choose an application and a page, then click **Show on the page**.
2. The page opens in a new tab. The extension:
   - finds every clicked element on the page;
   - divides the page into **areas automatically**, from what the page looks
     like: header, navigation, footer, named components, large visual blocks
     such as banners, cards and lists;
   - names each area from the page itself (its heading, its label, its role);
   - colors each area by its share of the page's clicks and lists the most
     clicked ones in a side panel. Pointing at an area shows what is clicked
     inside it.
3. **Inspect** (on by default): point at anything on the page — a button, a
   banner, an empty part of a card — and the panel shows its numbers: share of
   visits that click it, visits, clicks, clicks per visit, and the area it
   belongs to. Click to keep it selected; Esc releases it. While inspecting,
   clicks do not reach the site, but the page still scrolls. Switch to
   **Use the site** to navigate normally.
4. A **Detail** slider switches between fewer, larger areas and more, smaller
   ones.

If the app cannot reach the extension, it offers **Copy page data**: open the
page, click the Footprints icon in the browser toolbar and choose
**Show copied data on this tab**.

### Install the extension (Chrome or Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder of this
   repository.

After updating the repository, click the reload icon on the Footprints card
in the same page.

## The report view (phase 1)

- Choose an **application** and one of its **pages**. Pages are grouped
  automatically: query strings are removed and numeric ids become `*`, so
  `/journeys/969` and `/journeys/1601` count as one page.
- Filter by **period** (24 hours, 7 days, 30 days) and **device** (desktop,
  tablet, mobile — derived from the browser window width).
- See the page's **sections** (or, if you prefer, its **individual elements**)
  ranked by:
  - **share of visits that click** — visits that clicked the section ÷ visits to
    the page,
  - **number of clicks**,
  - **visits that click**.
- Select a section to read it in plain language: *"8,816 of 26,329 visits
  clicked this section, on average 2.8 times each."*
- Sections with too little data (fewer than 20 visits) are hidden by default.

### How sections are found

On sites built with components (Angular, Web Components, Lit…) every part of
the page is a custom element with a hyphen in its name, such as
`app-login-form`. Footprints assigns each click to the innermost such element
around it and turns the name into a readable label ("Login form"). Icons
(`fa-icon`, `mat-icon`) and the application shell (`app-root`) are skipped.

Sites without components show most clicks under "Outside any section"; for
those, switch to **Individual elements**, or better, use **Show on the page**,
which works on any site.

## Roadmap

| Step | What it adds |
|---|---|
| 1 ✅ | Report view: automatic sections, filters, ranking, plain-language details |
| 2 🧪 | Show on the page: automatic areas drawn on the live page (prototype) |
| 3 | Rename an area once for everyone; visits per area (not only clicks); save a snapshot of the colored page in the app |
| 4 | Conversion ("of the visits that clicked here, how many booked?"), comparison with a previous period or another segment, automatic insights |
| 5 | Click heatmap, frustration (rage) clicks |

## Data requirements

- A Dynatrace environment on the latest platform (Grail, AppEngine).
- The new RUM experience for web, with **user interaction capture turned on**
  for the applications you want to analyse. Without it Footprints shows
  "No clicks recorded".
- Fields used: `characteristics.has_user_interaction`, `interaction.type`,
  `ui_element.xpath`, `ui_element.name`, `ui_element.tag_name`,
  `view.url.full`, `page.url.full`, `browser.window.width`,
  `frontend.name` (or `dt.rum.application.entity` on older environments),
  `dt.rum.session.id`. Several of these are marked
  *experimental* in the Semantic Dictionary and may change.

## Permissions

| Scope | Why |
|---|---|
| `storage:user.events:read` | Clicks and page views |
| `storage:buckets:read` | Required with the table permission to read Grail |
| `storage:entities:read` | Application names on older environments, where events only carry an entity id |

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

The first `start` or `deploy` opens a browser to sign in to Dynatrace. Your
account needs permission to deploy apps.

## Project layout

```
extension/
  manifest.json           Chrome extension (Manifest V3)
  bridge.js               runs in the app's frame; relays the app's requests
  background.js           opens the page and draws the overlay once it has loaded
  overlay.js              finds clicked elements, builds areas, draws them
  popup.html/js           "Show copied data on this tab" fallback
ui/
  App.tsx                 page layout, filters and state
  components/ShowOnPage   the "Show on the page" button and its fallback
  lib/extension.ts        messages between the app and the extension
  components/             dropdowns, toggles, ranking list, details, empty/error states
  dql/queries.ts          every DQL query, built from the filter choices
  dql/client.ts           runs queries and polls long-running ones
  hooks/data.ts           turns query rows into applications, pages and sections
  lib/labels.ts           technical names → readable labels
```

## Known limitations

- Two xpath spellings exist in the data (`div2` / `div[2]`), probably from
  different RUM JavaScript versions. In **Individual elements** the same element
  can therefore appear twice. Normalisation is planned.
- On sites without component tags, automatic sections are not useful yet (see
  phase 2).
- "Visits" are RUM sessions.
- On the live page, areas show their **share of clicks**. Visits per area
  (how many visits clicked somewhere in it) come in step 3.
- Elements that are not on screen when the page opens (closed menus, pop-ups,
  content that changed since the clicks happened) cannot be drawn; the panel
  says how many clicks that concerns.
- Pages are opened at an address seen in the data. Addresses that only work
  inside the company network, or pages that need a login, open only if your
  browser can reach them.

## Tests

`tests/overlay/` holds two test pages built from xpaths recorded on a real
environment (both spellings), and scripts that check the overlay with a
headless Chromium (Python Playwright):

```bash
python3 tests/overlay/run.py         # finds elements, builds areas at each detail level
python3 tests/overlay/e2e.py         # real extension: app → new tab → overlay → reload
python3 tests/overlay/frame_test.py  # same, from a sandboxed frame like the Dynatrace app
python3 tests/overlay/inspect_test.py # inspect: numbers on hover, clicks blocked, scrolling works
```
