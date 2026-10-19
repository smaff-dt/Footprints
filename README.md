# Footprints

**See which parts of a page your visitors click, use and ignore.**

Footprints is a Dynatrace app for business, marketing and CX teams. Pick a
website and one of its pages, choose a period and a device, and Footprints
ranks the page's sections by how many visits click them. Nobody needs to write
or read a query: everything is dropdowns, toggles and checkboxes.

It reads the user interactions captured by Dynatrace Real User Monitoring
(RUM) on Grail.

## What you can do today (phase 1)

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
those, switch to **Individual elements**. Phase 2 adds sections drawn by the
user on a snapshot of the page, which works on any site.

## Roadmap

| Phase | What it adds |
|---|---|
| 1 ✅ | Automatic sections, filters, ranking, plain-language details |
| 2 | Chrome extension that captures a page snapshot; sections drawn and renamed on the snapshot; colored overlay of the page |
| 3 | Conversion ("of the visits that clicked here, how many booked?"), comparison with a previous period or another segment, automatic insights |
| 4 | Click heatmap on the snapshot, frustration (rage) clicks |

## Data requirements

- A Dynatrace environment on the latest platform (Grail, AppEngine).
- The new RUM experience for web, with **user interaction capture turned on**
  for the applications you want to analyse. Without it Footprints shows
  "No clicks recorded".
- Fields used: `characteristics.has_user_interaction`, `interaction.type`,
  `ui_element.xpath`, `ui_element.name`, `ui_element.tag_name`,
  `view.url.full`, `page.url.full`, `browser.window.width`,
  `dt.rum.application.entity`, `dt.rum.session.id`. Several of these are marked
  *experimental* in the Semantic Dictionary and may change.

## Permissions

| Scope | Why |
|---|---|
| `storage:user.events:read` | Clicks and page views |
| `storage:buckets:read` | Required with the table permission to read Grail |
| `storage:entities:read` | Application list for the picker |

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
ui/
  App.tsx                 page layout, filters and state
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
