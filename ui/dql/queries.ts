/**
 * DQL query builders.
 *
 * Every query the app runs is built here from the user's filter choices.
 * Field names were checked against a tenant with the new RUM experience
 * and user-interaction capture enabled (see README → "Data requirements").
 */

export type Timeframe = "24h" | "7d" | "30d";
export type Device = "all" | "desktop" | "tablet" | "mobile";
export type GroupBy = "sections" | "elements";

export interface Filters {
  appId: string;
  timeframe: Timeframe;
  device: Device;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escapes a value for use inside a double-quoted DQL string literal. */
export function dqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The application a user event belongs to. Newer environments name it in
 * `frontend.name`; older ones only carry the entity id in
 * `dt.rum.application.entity`. Fields that do not exist evaluate to null,
 * so the same expression works on both.
 */
const APP_EXPR = "coalesce(frontend.name, dt.rum.application.entity)";

function appFilter(appId: string): string {
  if (!appId) throw new Error("No application selected");
  return `| filter ${APP_EXPR} == ${dqlString(appId)}`;
}

function fromClause(timeframe: Timeframe): string {
  return `from:now()-${timeframe}`;
}

/**
 * Device is derived from the browser window width, which is present on every
 * web user event. Breakpoints follow common responsive-design defaults.
 */
function deviceFilter(device: Device): string {
  switch (device) {
    case "desktop":
      return "| filter browser.window.width >= 1024";
    case "tablet":
      return "| filter browser.window.width >= 768 and browser.window.width < 1024";
    case "mobile":
      return "| filter browser.window.width < 768";
    default:
      return "";
  }
}

/**
 * Page fields, added to every query that looks at pages:
 * - `fp_page`  the address without query string and fragment: one real page
 *              (each product page is its own page);
 * - `fp_host`, `fp_path`, `fp_query` and `fp_address` (the full address
 *   without fragment), used by the rules of page groups.
 *
 * `view.url.full` follows route changes in single-page apps; `page.url.full`
 * is the fallback for classic multi-page sites.
 */
const PAGE_FIELDS = lines(
  "| fieldsAdd fp_address = splitString(coalesce(view.url.full, page.url.full), \"#\")[0]",
  "| fieldsAdd fp_page = splitString(fp_address, \"?\")[0]",
  "| fieldsAdd fp_host = splitString(fp_page, \"/\")[2]",
  "| fieldsAdd fp_path_raw = substring(fp_page, from: stringLength(splitString(fp_page, \"/\")[0]) + 2 + stringLength(fp_host))",
  "| fieldsAdd fp_path = if(isNull(fp_path_raw) or fp_path_raw == \"\", \"/\", else: fp_path_raw)",
  "| fieldsAdd fp_query = if(fp_address != fp_page, substring(fp_address, from: stringLength(fp_page) + 1), else: \"\")",
);

/** Which part of the address a group rule looks at. */
export type UrlPart = "address" | "host" | "path" | "query";
export type RuleOp = "contains" | "not_contains" | "starts" | "ends" | "is";

export interface PageRule {
  part: UrlPart;
  op: RuleOp;
  value: string;
}

/** What the analysis covers: one page, or every page that matches all the rules of a group. */
export type PageScope = { kind: "page"; url: string } | { kind: "group"; rules: PageRule[] };

const PART_FIELD: Record<UrlPart, string> = { address: "fp_address", host: "fp_host", path: "fp_path", query: "fp_query" };

/** The rule's text as compared: lower case; paths start with "/" and lose a trailing "/". */
export function normaliseRuleValue(rule: PageRule): string {
  let v = rule.value.trim().toLowerCase();
  if (rule.part === "host") v = v.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
  if (rule.part === "query") v = v.replace(/^\?/, "");
  if (rule.part === "path" && (rule.op === "is" || rule.op === "starts") && !v.startsWith("/")) v = `/${v}`;
  if (rule.part === "path" && v.length > 1) v = v.replace(/\/+$/, "");
  return v;
}

function ruleExpr(rule: PageRule): string {
  const field = `lower(${PART_FIELD[rule.part]})`;
  const v = normaliseRuleValue(rule);
  switch (rule.op) {
    case "contains":
      return `contains(${field}, ${dqlString(v)})`;
    case "not_contains":
      return `not(contains(${field}, ${dqlString(v)}))`;
    case "starts":
      return `startsWith(${field}, ${dqlString(v)})`;
    case "ends":
      return rule.part === "path" ? `(endsWith(${field}, ${dqlString(v)}) or endsWith(${field}, ${dqlString(`${v}/`)}))` : `endsWith(${field}, ${dqlString(v)})`;
    case "is":
      return rule.part === "path" && v !== "/"
        ? `(${field} == ${dqlString(v)} or ${field} == ${dqlString(`${v}/`)})`
        : `${field} == ${dqlString(v)}`;
  }
}

export function validRules(rules: PageRule[]): PageRule[] {
  return rules.filter((r) => normaliseRuleValue(r) !== "" || (r.part === "query" && r.op === "is"));
}

/** True for events of the chosen page, or of every page of a group. */
function scopeExpr(scope: PageScope): string {
  if (scope.kind === "page") {
    if (!scope.url) throw new Error("No page selected");
    return `fp_page == ${dqlString(scope.url)}`;
  }
  const rules = validRules(scope.rules);
  if (rules.length === 0) throw new Error("This page group has no rule");
  return rules.length === 1 ? ruleExpr(rules[0]) : `(${rules.map(ruleExpr).join(" and ")})`;
}

/** Keeps the events of the chosen page, or of every page of a group. */
function scopeFilter(scope: PageScope): string {
  return `| filter ${scopeExpr(scope)}`;
}

/**
 * Events on Footprints' own panel are left out: older versions of the
 * extension could be recorded by the site's analytics.
 */
const NOT_OWN_UI = `| filter isNull(ui_element.xpath) or not(contains(toString(ui_element.xpath), "footprints-overlay-host"))`;

const CLICKS_ONLY = lines(`| filter characteristics.has_user_interaction == true and interaction.type == "click"`, NOT_OWN_UI);

function lines(...parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Applications for the picker: those that received clicks in the last 7 days,
 * busiest first. Applications without clicks have nothing to show.
 */
export function applicationsQuery(): string {
  return lines(
    "fetch user.events, from:now()-7d",
    CLICKS_ONLY,
    `| fieldsAdd app = ${APP_EXPR}`,
    "| filter isNotNull(app)",
    "| summarize clicks = count(), by: {app}",
    "| sort clicks desc",
    "| limit 200",
  );
}

/**
 * Readable names for older environments, where `app` above is an entity id
 * (APPLICATION-…). This data object does not exist on newer environments;
 * callers treat a failure as "no names available".
 */
export function applicationNamesQuery(): string {
  return lines(
    "fetch dt.entity.application, from:now()-7d",
    "| fields id, entity.name",
    "| limit 500",
  );
}

/**
 * Pages of an application that received clicks, most visited first: every
 * real address (without query string), optionally only those containing
 * `search`, or only those matching a group's rules.
 */
export function pagesQuery(f: Filters, opts: { search?: string; scope?: PageScope; limit?: number } = {}): string {
  const search = opts.search?.trim().toLowerCase();
  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    CLICKS_ONLY,
    deviceFilter(f.device),
    PAGE_FIELDS,
    "| filter isNotNull(fp_page)",
    search ? `| filter contains(lower(fp_page), ${dqlString(search)})` : "",
    opts.scope ? scopeFilter(opts.scope) : "",
    "| summarize clicks = count(), visits = countDistinct(dt.rum.session.id), by: {fp_page}",
    "| sort visits desc",
    `| limit ${opts.limit ?? PAGE_LIMIT}`,
  );
}

/** How many pages the page list loads; beyond that, searching asks Dynatrace. */
export const PAGE_LIMIT = 1000;

/** Visits to one page (or group): the denominator of every click rate. */
export function pageVisitsQuery(f: Filters, scope: PageScope): string {
  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    deviceFilter(f.device),
    PAGE_FIELDS,
    scopeFilter(scope),
    "| summarize visits = countDistinct(dt.rum.session.id)",
  );
}

/**
 * Adds `pos_y`: the "y" of the event's first position.
 *
 * On a real environment `positions` is an array of JSON *strings*, e.g.
 * ["{\"x\":0,\"y\":1585,\"start_time\":520}"]: its first element is plain JSON,
 * read here first. Environments that store real records instead are covered
 * by reading the text form of the whole field.
 */
const POSITION_Y = lines(
  String.raw`| parse arrayFirst(positions), "LD '\"y\"' SPACE? ':' SPACE? '\"'? INT:pos_y_text"`,
  String.raw`| parse toString(positions), "LD '\"y\"' SPACE? ':' SPACE? '\"'? INT:pos_y_record"`,
  "| fieldsAdd pos_y = coalesce(pos_y_text, pos_y_record)",
);

/** Adds `pos_x` and `pos_y`: where on the page the event happened (page coordinates, px). */
const POSITION_XY = lines(
  POSITION_Y,
  String.raw`| parse arrayFirst(positions), "LD '\"x\"' SPACE? ':' SPACE? '\"'? INT:pos_x_text"`,
  String.raw`| parse toString(positions), "LD '\"x\"' SPACE? ':' SPACE? '\"'? INT:pos_x_record"`,
  "| fieldsAdd pos_x = coalesce(pos_x_text, pos_x_record)",
);

/** Width of one step of the scroll-depth distribution, in pixels. */
export const SCROLL_STEP = 50;

/**
 * How far down the page each visit got: the distribution of the deepest
 * point seen, in steps of SCROLL_STEP pixels.
 *
 * - A scroll of the page records its scroll position in `positions` (y, in
 *   pixels from the top of the page). The deepest point seen is that
 *   position plus the browser window height. Scrolls inside an element
 *   (a carousel, a menu) are left out: only `html`/`body` count.
 * - A click records where it happened on the page, which was on screen.
 * - Any other event means the visit saw at least the first screen.
 *
 * `positions` is an array on some events and a single record on others, and
 * its numbers can arrive as text. Direct field access returned nothing on a
 * real environment, so the value of "y" is read from the field's text form,
 * which works for every one of these shapes.
 */
export function scrollDepthQuery(f: Filters, scope: PageScope): string {
  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    deviceFilter(f.device),
    PAGE_FIELDS,
    scopeFilter(scope),
    NOT_OWN_UI,
    POSITION_Y,
    "| fieldsAdd window_h = toDouble(browser.window.height), pos_y = toDouble(pos_y)",
    "| fieldsAdd page_scroll = interaction.type == \"scroll\" and (isNull(ui_element.tag_name) or ui_element.tag_name == \"html\" or ui_element.tag_name == \"body\")",
    // Each kind of evidence on its own field, so a missing value never hides another.
    "| fieldsAdd scroll_seen = if(page_scroll == true, pos_y + window_h), click_seen = if(interaction.type == \"click\", pos_y)",
    "| summarize screen = max(window_h), scrolled = max(scroll_seen), clicked = max(click_seen), by: {dt.rum.session.id}",
    // The first screen is always seen; scrolling or clicking further down extends it.
    "| fieldsAdd seen = arrayMax(arrayRemoveNulls(array(screen, scrolled, clicked)))",
    "| filter isNotNull(seen) and seen > 0",
    `| summarize visits = count(), by: {depth = bin(seen, ${SCROLL_STEP})}`,
    "| sort depth asc",
    "| limit 2000",
  );
}

/**
 * Clicks and visits per section of a page.
 *
 * - "sections": a click belongs to the innermost custom element in its xpath
 *   (component frameworks such as Angular or Web Components name them with a
 *   hyphen, e.g. `app-login-form`). Icon elements (`fa-icon`, `mat-icon`…)
 *   and app shells (`app-root`) are ignored: they are not sections of the page.
 *   Clicks outside any component are "(other)".
 * - "elements": one row per clicked element (its full xpath).
 */
export function sectionsQuery(f: Filters, scope: PageScope, groupBy: GroupBy): string {
  const sectionExpr =
    groupBy === "sections"
      ? lines(
          "| fieldsAdd components = arrayRemoveNulls(iCollectArray(if(" +
            `contains(ui_element.xpath[], "-") and not(contains(ui_element.xpath[], "@")) and not(contains(ui_element.xpath[], "[")) and not(endsWith(ui_element.xpath[], "-icon")) and not(endsWith(ui_element.xpath[], "-root")), ` +
            "ui_element.xpath[])))",
          `| fieldsAdd section = coalesce(arrayLast(components), "(other)")`,
        )
      : "| fieldsAdd section = toString(ui_element.xpath)";

  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    CLICKS_ONLY,
    deviceFilter(f.device),
    PAGE_FIELDS,
    scopeFilter(scope),
    sectionExpr,
    "| summarize clicks = count(), visits = countDistinct(dt.rum.session.id), " +
      "name = takeAny(coalesce(ui_element.custom_name, ui_element.name, ui_element.detected_name)), " +
      "tag = takeAny(ui_element.tag_name), node = takeAny(arrayLast(ui_element.xpath)), by: {section}",
    "| sort visits desc",
    "| limit 200",
  );
}

// ── Click heatmap ────────────────────────────────────────────────────────────

/** Clicks per browser window width: the layout a visitor saw depends on it. */
export function clickWidthsQuery(f: Filters, scope: PageScope): string {
  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    CLICKS_ONLY,
    deviceFilter(f.device),
    PAGE_FIELDS,
    scopeFilter(scope),
    "| summarize clicks = count(), by: {width = browser.window.width}",
    "| sort clicks desc",
    "| limit 100",
  );
}

/** Size of a heatmap cell, in page pixels. */
export const HEAT_CELL = 8;

/**
 * Where on the page clicks happened, in cells of HEAT_CELL pixels, for visits
 * whose window was between `minWidth` and `maxWidth` pixels wide (so they saw
 * about the same layout as the snapshot).
 */
export function clickPositionsQuery(f: Filters, scope: PageScope, minWidth: number, maxWidth: number): string {
  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    CLICKS_ONLY,
    deviceFilter(f.device),
    `| filter browser.window.width >= ${Math.floor(minWidth)} and browser.window.width <= ${Math.ceil(maxWidth)}`,
    PAGE_FIELDS,
    scopeFilter(scope),
    POSITION_XY,
    "| filter isNotNull(pos_x) and isNotNull(pos_y)",
    `| summarize clicks = count(), by: {x = bin(toDouble(pos_x), ${HEAT_CELL}), y = bin(toDouble(pos_y), ${HEAT_CELL})}`,
    "| sort clicks desc",
    "| limit 5000",
  );
}

// ── Conversions ──────────────────────────────────────────────────────────────

/**
 * For each visit to the page (or group): when it first got there, when it
 * last reached the goal, and each element it clicked with the time of the
 * click. A visit converts when it reaches the goal after landing on the page
 * (or, for an element, after clicking it).
 */
function conversionBase(f: Filters, scope: PageScope, goal: PageScope): string {
  return lines(
    // user.events carry their time in start_time; timestamp is the generic fallback.
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    deviceFilter(f.device),
    PAGE_FIELDS,
    `| fieldsAdd fp_in = ${scopeExpr(scope)}, fp_goal = ${scopeExpr(goal)}`,
    "| filter fp_in == true or fp_goal == true",
    "| fieldsAdd fp_at = coalesce(start_time, timestamp)",
    "| fieldsAdd fp_click = if(fp_in == true and characteristics.has_user_interaction == true and interaction.type == \"click\" " +
      "and not(contains(toString(ui_element.xpath), \"footprints-overlay-host\")), toString(ui_element.xpath))",
    "| summarize goal_at = max(if(fp_goal == true, fp_at)), landed_at = min(if(fp_in == true, fp_at)), " +
      "clicked = arrayRemoveNulls(collectArray(if(isNotNull(fp_click), record(section = fp_click, at = fp_at)))), " +
      "by: {session = dt.rum.session.id}",
    "| filter isNotNull(landed_at)",
  );
}

/** Visits to the page, and how many of them reached the goal afterwards. */
export function pageConversionQuery(f: Filters, scope: PageScope, goal: PageScope): string {
  return lines(
    conversionBase(f, scope, goal),
    "| summarize visits = count(), converted = countIf(isNotNull(goal_at) and goal_at > landed_at)",
  );
}

/** Per clicked element: visits that clicked it, and how many reached the goal afterwards. */
export function elementConversionQuery(f: Filters, scope: PageScope, goal: PageScope): string {
  return lines(
    conversionBase(f, scope, goal),
    "| expand clicked",
    "| summarize first_click = min(clicked[at]), goal_at = takeAny(goal_at), by: {section = clicked[section], session}",
    "| summarize visits = count(), converted = countIf(isNotNull(goal_at) and goal_at > first_click), by: {section}",
    "| sort visits desc",
    "| limit 3000",
  );
}
