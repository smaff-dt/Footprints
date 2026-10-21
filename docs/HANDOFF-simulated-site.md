# Footprints — handoff: simulated website and traffic for testing

This file lets a new conversation pick up the work. It sums up what Footprints
is, where it stands, how the owner likes to work, and the next task: a demo
website with simulated visitors, sending real RUM data to the owner's own
Dynatrace tenant, to validate Footprints on realistic traffic.

## Working with the owner

- The owner (Stefano) writes in **Italian**; answer in Italian.
- **Everything generated must be in English**: code, UI text, docs, commit messages.
- The owner is not a developer. Give **very simple, numbered, step-by-step
  instructions** (exact clicks, exact terminal lines to paste, one at a time),
  and say what they should see if it worked.
- Before big changes, the owner likes to **discuss first** ("prima di procedere
  dimmi che ne pensi"); once they say "ok procedi", go ahead.
- Commits end with the attribution lines given by the session; push to `main`.

## The project

- **Repository**: `smaff-dt/Footprints` (private, GitHub). Local clone on the
  owner's Mac: `~/Documents/GitHub/Footprints` (they use GitHub Desktop:
  Fetch origin → Pull origin).
- **What it is**: a Dynatrace AppEngine app (React, `dt-app`, Strato design
  system) plus a Chrome extension (Manifest V3). Zoning / heatmap / exposure
  analysis for business, marketing and CX users (an alternative to
  Contentsquare zoning), built on Dynatrace **new RUM** data (Grail
  `user.events`). No DQL in the UI: dropdowns, buttons, clicks only.
- **Run locally**: `npm install` (only after dependency changes), then
  `npm start` in the repo folder; the app opens in the Dynatrace tenant set in
  `app.config.json` (`environmentUrl`, currently the Dynatrace playground
  `https://wyq34449.sprint.apps.dynatracelabs.com`). Extension: load unpacked
  from `extension/` in `chrome://extensions`, current version **0.5.2**.
- **Read `README.md`** in the repo for the full description, layout and tests.

### How it works (current state)

1. **Snapshots screen**: choose application + page (or a page group made of
   rules: path / query / host / full address × contains / is / starts / ends /
   does not contain). Then **Desktop snapshot** or **Mobile snapshot**
   (automatic: the extension loads the page in a background tab through
   Chrome's debugger API at the most common window width, pictures it screen
   by screen, waits for pictures, measures clicked elements at the other common
   widths, progress bar in the app) or **Open the page** (manual: prepare the
   page by hand, then save). Saved snapshots are listed below (private
   Dynatrace documents).
2. **Analysis screen** (opens on a snapshot): period, conversion goal (a page
   or page group reached later in the visit). Views:
   - **Zones**: no zone at first; pointing outlines any block of the page;
     click turns it into a zone (shows the metric, blue→red), click again
     turns it off; zones never overlap; an "i" on a zone opens its card with
     numbers and the chain of nested blocks to pick a larger/smaller one;
     **Suggest zones** turns on the 2–3 most clicked; zoning and names are
     saved with the snapshot.
   - **Click heatmap**: click positions moved onto the snapshot relative to
     each element, using the layouts measured at visitors' window widths.
   - **Scroll heatmap**: share of visits reaching each height.
   - **Table**: clicked elements, sortable.
   - Metrics: **Click rate** (default), Click share, Exposure, Conversion.

### Data Footprints reads (must exist on the test tenant)

From `user.events` (new RUM for web, **user interaction capture on**):
`characteristics.has_user_interaction`, `interaction.type` (`click`,
`scroll`), `ui_element.xpath` (array), `ui_element.name`,
`ui_element.tag_name`, `positions` (array of JSON strings with `x`, `y`),
`browser.window.width`, `browser.window.height`, `view.url.full`,
`page.url.full`, `frontend.name`, `dt.rum.session.id`, `start_time`.
Device is derived from window width: desktop ≥ 1024, tablet 768–1023,
mobile < 768.

### Known limits of the playground (why we need our own data)

Traffic there is synthetic: every visitor uses a 1280 px window, clicks the
same 2 spots per product card, and ~99% of visits "convert". Footprints'
numbers can't be checked against reality there.

## Next task: simulated website + traffic on the owner's tenant

The owner has a **personal Dynatrace tenant** with no monitored website. Goal:
produce realistic RUM data there, with **known** behaviour, so Footprints'
numbers can be checked (we know what they should be).

### 1. Demo shop (static site, English)

- Pages: home, ~10 product pages (`/product/<ID>`), cart, checkout,
  order-confirmed (the conversion goal).
- Real-site difficulties on purpose:
  - a hero banner whose campaign changes over time (to test, later, the
    "same slot, different content" problem);
  - a cookie banner (bottom, fixed);
  - lazy-loaded product pictures (native `loading="lazy"` and script-loaded);
  - responsive layout (grid 4–5 columns on desktop, 2 on tablet, 1 on mobile;
    `<meta name="viewport">`);
  - links with `utm_` parameters (to test query-parameter page groups);
  - a sticky header.
- Hosting: free static hosting (GitHub Pages from a separate **public** repo,
  or Netlify / Cloudflare Pages). The site is public but unknown; the owner
  should confirm they are fine with that.
- The Dynatrace **RUM JavaScript snippet** of a web frontend created on the
  owner's tenant goes into every page (the owner creates the frontend and
  pastes the snippet / app ID; give them the exact clicks).

### 2. Visitor simulator

- A script (Playwright) that opens the shop like real people:
  - window widths with a realistic mix (e.g. 1366, 1440, 1536, 1920, 1280;
    mobile 390, 414, 360 with phone emulation);
  - scroll depth varying per visitor (many stop early, few reach the bottom);
  - clicks spread inside elements (random point within the element, not the
    centre), with chosen probabilities per element/zone;
  - a funnel home → product → cart → checkout → confirmed, with a realistic
    conversion (3–5%);
  - some visits arriving with `?utm_source=newsletter` etc.
- Every probability lives in one config file, so expected numbers are known
  (click rate per zone, conversion after a click, scroll reach…), and a small
  report can say what Footprints should show.
- Must look like a normal Chrome to Dynatrace (headless/automation browsers
  may be classified as robots and filtered): normal user agent, headed or
  `--headless=new` without automation markers; verify with the first data
  (DQL in a Notebook) that sessions are kept.
- Runs daily on **GitHub Actions** (cron), a few hundred visits per day, so the
  owner's computer can stay off. Mind GitHub Actions minutes (private repos
  have a monthly quota; public repos don't) and the tenant's RUM consumption
  (check the tenant type: trial / free / paid).

### 3. Then

- Point Footprints' `app.config.json` at the owner's tenant (or run against
  it), take snapshots of the demo shop, and compare Footprints' numbers with
  the simulator's expected ones.

## Roadmap after validation (agreed priorities)

1. Clean-up (remove legacy code paths: old live-page drawing in
   `extension/overlay.js`, old "areas"/templates compatibility), privacy of
   snapshot pictures (warning; masking form fields / personal text),
   performance (cache query results, show the picture first, limit periods).
2. Deploy the app to the tenant (`dt-app deploy`) and package the extension
   for colleagues.
3. Period comparison (before/after) on zones.
4. Content changes in the same slot (attribute clicks to the content shown;
   detect when a zone's content changes).
5. Export (PNG/PDF), snapshot thumbnails, snapshot rename.
