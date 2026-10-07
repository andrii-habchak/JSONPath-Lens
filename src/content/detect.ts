/** Decide whether the current document is a raw JSON/NDJSON response and extract its text. */

const JSON_TYPES = /^(?:application|text)\/(?:[\w.+-]+\+)?(?:json|x-ndjson|ndjson|jsonl|x-jsonlines|json-seq|x-json-stream)$/i;

export interface Detected {
  text: string;
  contentType: string;
}

/** Elements Chrome adds around a raw text/JSON response. */
function isBrowserChrome(el: Element): boolean {
  return el.tagName === 'PRE' || el.classList.contains('json-formatter-container') || el.tagName === 'STYLE' || el.tagName === 'SCRIPT';
}

export function looksLikeJsonText(text: string): boolean {
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i++;
  // Skip a common anti-XSSI prefix.
  if (text.startsWith(")]}'", i)) return true;
  const c = text[i];
  if (c !== '{' && c !== '[') return false;
  let j = text.length - 1;
  while (j > i && /\s/.test(text[j])) j--;
  const e = text[j];
  return e === '}' || e === ']';
}

export function detectJson(doc: Document): Detected | null {
  const contentType = (doc.contentType || '').toLowerCase();
  const isJsonType = JSON_TYPES.test(contentType);
  const isPlain = contentType === 'text/plain';
  if (!isJsonType && !isPlain) return null;
  const body = doc.body;
  if (!body) return null;
  for (const el of Array.from(body.children)) if (!isBrowserChrome(el)) return null;
  const pre = body.querySelector(':scope > pre');
  const text = pre ? pre.textContent ?? '' : body.textContent ?? '';
  if (!text.trim()) return null;
  if (isPlain && !looksLikeJsonText(text)) return null;
  return { text, contentType: isPlain ? 'text/plain' : contentType };
}
