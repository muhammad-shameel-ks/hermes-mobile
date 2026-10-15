/**
 * SVG for the preview viewer's native render (issue "Panes and desktop-only
 * power on a phone": static, remote refs and links stripped). react-native-svg's
 * SvgXml never runs script, but the document still comes from outside, so the
 * constructs that reach for the network, script or other documents are removed
 * before it is parsed. Text-level on purpose: no DOM exists here.
 */

const DROP_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animateTransform', 'animateMotion'];

function dropElement(xml: string, tag: string): string {
  const pair = new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}\\s*>)`, 'gi');
  const stray = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
  return xml.replace(pair, '').replace(stray, '');
}

/** An `href` that points inside the document or carries its own bytes. */
const isLocalRef = (value: string) => /^\s*(#|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(value);

export function sanitizeSvg(input: string): string {
  let xml = input
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?(?:\]\s*>|>)/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;'));

  for (const tag of DROP_ELEMENTS) xml = dropElement(xml, tag);

  // an <image> or <use> pointing outside the document is dropped whole
  xml = xml.replace(/<(image|use)\b[^>]*?>(?:\s*<\/\1\s*>)?/gi, (match) => {
    const ref = /\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match);
    return !ref || isLocalRef(ref[1] ?? ref[2] ?? '') ? match : '';
  });

  // links lose their anchor but keep their content
  xml = xml.replace(/<a\b[^>]*>/gi, '').replace(/<\/a\s*>/gi, '');

  return xml
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/(\b(?:xlink:)?href\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (match, lead: string, dq?: string, sq?: string) =>
      isLocalRef(dq ?? sq ?? '') ? match : `${lead}""`,
    )
    .replace(/@import[^;}]*;?/gi, '')
    .replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none');
}

export type PreparedSvg = { xml: string; aspect: number };

function numeric(value: string | undefined): number | null {
  const match = value ? /^\s*([\d.]+)(?:px)?\s*$/.exec(value) : null;
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Sanitise, then make the root scalable: a viewBox from the declared size when it
 * has none, and no fixed width/height so the viewer decides the box. `aspect` is
 * width over height, 1 when the document gives no way to tell.
 */
export function prepareSvg(input: string): PreparedSvg | null {
  const xml = sanitizeSvg(input);
  const open = /<svg\b[^>]*>/i.exec(xml);
  if (!open) return null;

  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(open[0]);
  const width = numeric(attr('width')?.[1] ?? attr('width')?.[2]);
  const height = numeric(attr('height')?.[1] ?? attr('height')?.[2]);
  const box = attr('viewBox');
  const parts = (box?.[1] ?? box?.[2] ?? '').trim().split(/[\s,]+/).map(Number);
  const boxOk = parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0;

  let tag = open[0].replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  let aspect: number | null = null;
  if (boxOk) {
    aspect = parts[2] / parts[3];
  } else if (width && height) {
    tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${width} ${height}"`);
    aspect = width / height;
  }
  return { xml: xml.replace(open[0], () => tag), aspect: aspect ?? 1 };
}
