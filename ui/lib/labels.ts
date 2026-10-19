/**
 * Turns technical identifiers into names a business user can read.
 * Nothing technical (xpath, component tags, DQL) should reach the screen raw.
 */

const COMPONENT_PREFIXES = ["app-", "ng-", "my-", "x-", "ui-"];

function sentenceCase(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t;
}

/** `app-login-form` → "Login form"; `app-offers-list2` → "Offers list 2". */
export function sectionLabel(tag: string): string {
  let name = tag.toLowerCase();
  // `app-root` & co. wrap the whole application: not a meaningful section.
  if (!name || name === "(other)" || name.endsWith("-root")) return "Outside any section";
  const prefix = COMPONENT_PREFIXES.find((p) => name.startsWith(p) && name.length > p.length);
  if (prefix) name = name.slice(prefix.length);
  name = name.replace(/[-_]+/g, " ").replace(/([a-z])(\d+)$/, "$1 $2");
  return sentenceCase(name);
}

/**
 * Label for one clicked element. Prefers the element's captured name, then
 * its id (`button[@id="loginForm:submit"]` → "Submit (button)"), then its tag.
 */
export function elementLabel(name: string, node: string, tag: string): string {
  const cleanName = name && name !== "masked" ? name.trim() : "";
  const kind = tagLabel(tag || node.replace(/[[@].*$/, "").replace(/\d+$/, ""));
  if (cleanName && !/^[a-z-]+ \.[\w-]/.test(cleanName)) return `${cleanName} (${kind})`;
  const id = /@id=\\?"([^"\\]+)/.exec(node)?.[1];
  if (id) {
    const lastPart = id.split(/[:./]/).filter(Boolean).pop() ?? id;
    return `${sentenceCase(lastPart.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " "))} (${kind})`;
  }
  return sentenceCase(kind);
}

const TAGS: Record<string, string> = {
  a: "link",
  button: "button",
  input: "input field",
  select: "dropdown",
  textarea: "text box",
  img: "image",
  li: "list item",
  span: "text",
  div: "area",
  body: "page background",
  label: "label",
  svg: "icon",
  "fa-icon": "icon",
  h1: "heading",
  h2: "heading",
  h3: "heading",
};

function tagLabel(tag: string): string {
  const t = tag.toLowerCase();
  return TAGS[t] ?? t;
}

/** `https://shop.example.com/journeys/*\/book` → "/journeys/*\/book". */
export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "" ? "/" : u.pathname;
  } catch {
    return url;
  }
}

export function pageHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** "/journeys/*\/book" → "Journeys › * › Book"; "/" → "Home page". */
export function pageLabel(url: string): string {
  const path = pagePath(url);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "Home page";
  return parts
    .map((p) => (p === "*" ? "any" : sentenceCase(decodeURIComponent(p).replace(/[-_]+/g, " "))))
    .join(" › ");
}
