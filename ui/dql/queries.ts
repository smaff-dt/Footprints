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

const APP_ID_PATTERN = /^APPLICATION-[A-F0-9]+$/;

function appFilter(appId: string): string {
  if (!APP_ID_PATTERN.test(appId)) throw new Error(`Invalid application id: ${appId}`);
  return `| filter dt.rum.application.entity == ${dqlString(appId)}`;
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

/** RUM applications for the application picker. */
export function applicationsQuery(): string {
  return lines(
    "fetch dt.entity.application, from:now()-24h",
    "| fields id, entity.name",
    "| sort entity.name asc",
    "| limit 200",
  );
}

/** Fallback when the entity list is empty: applications seen in user events. */
export function applicationsFromEventsQuery(): string {
  return lines(
    "fetch user.events, from:now()-24h",
    "| filter isNotNull(dt.rum.application.entity)",
    "| summarize events = count(), by: {id = dt.rum.application.entity}",
    "| sort events desc",
    "| limit 200",
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
    "| summarize clicks = count(), visits = countDistinct(dt.rum.session.id), by: {page_template}",
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
