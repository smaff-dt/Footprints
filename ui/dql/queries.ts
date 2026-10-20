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
 * A page "template": the URL without query string, with numeric path
 * segments replaced by `*` (so /journeys/969 and /journeys/1601 are one page).
 * `view.url.full` follows route changes in single-page apps; `page.url.full`
 * is the fallback for classic multi-page sites.
 */
const PAGE_EXPR = `replacePattern(splitString(coalesce(view.url.full, page.url.full), "?")[0], "'/' DIGIT+", "/*")`;

const CLICKS_ONLY = `| filter characteristics.has_user_interaction == true and interaction.type == "click"`;

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

/** Pages of an application that received clicks, most visited first. */
export function pagesQuery(f: Filters): string {
  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    CLICKS_ONLY,
    deviceFilter(f.device),
    `| fieldsAdd page_template = ${PAGE_EXPR}`,
    "| filter isNotNull(page_template)",
    "| summarize clicks = count(), visits = countDistinct(dt.rum.session.id), " +
      "sample = takeAny(coalesce(view.url.full, page.url.full)), by: {page_template}",
    "| sort visits desc",
    "| limit 100",
  );
}

/** Visits to one page: the denominator of every click rate. */
export function pageVisitsQuery(f: Filters, page: string): string {
  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    deviceFilter(f.device),
    `| fieldsAdd page_template = ${PAGE_EXPR}`,
    `| filter page_template == ${dqlString(page)}`,
    "| summarize visits = countDistinct(dt.rum.session.id)",
  );
}

/**
 * Adds `pos_y`: the "y" of the event's (first) position, read from the text
 * of `positions`, e.g. {"x":0,"y":1585,"start_time":516} or [{"x":"952","y":"669"}].
 */
const POSITION_Y = String.raw`| parse toString(positions), "LD '\"y\"' SPACE? ':' SPACE? '\"'? INT:pos_y"`;

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
export function scrollDepthQuery(f: Filters, page: string): string {
  return lines(
    `fetch user.events, ${fromClause(f.timeframe)}`,
    appFilter(f.appId),
    deviceFilter(f.device),
    `| fieldsAdd page_template = ${PAGE_EXPR}`,
    `| filter page_template == ${dqlString(page)}`,
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
export function sectionsQuery(f: Filters, page: string, groupBy: GroupBy): string {
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
    `| fieldsAdd page_template = ${PAGE_EXPR}`,
    `| filter page_template == ${dqlString(page)}`,
    sectionExpr,
    "| summarize clicks = count(), visits = countDistinct(dt.rum.session.id), " +
      "name = takeAny(coalesce(ui_element.custom_name, ui_element.name, ui_element.detected_name)), " +
      "tag = takeAny(ui_element.tag_name), node = takeAny(arrayLast(ui_element.xpath)), by: {section}",
    "| sort visits desc",
    "| limit 200",
  );
}
