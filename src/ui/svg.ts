/**
 * SVG renders natively through react-native-svg, never in a WebView - in the
 * transcript's inline blocks and the Files preview alike. The markup comes from
 * outside (model output, a file), so it is cut down to a static picture first:
 * scripts, foreign objects, event handlers, links and every reference that is
 * not internal to the document go (issue "Panes and desktop-only power on a
 * phone": static, refs stripped). Regex-based because there is no DOM; the
 * renderer's own parser ignores what it does not know. Pure.
 */

const BLOCKED_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animateTransform', 'animateMotion'];

function stripElement(xml: string, name: string): string {
  const pair = new RegExp(`<${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</${name}\\s*>)`, 'gi');
  const orphan = new RegExp(`</?${name}\\b[^>]*>`, 'gi');
  return xml.replace(pair, '').replace(orphan, '');
}

/** An `href` that points inside the document or carries its own raster bytes. */
const isLocalRef = (value: string) => /^\s*(#|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(value);

export function sanitizeSvg(source: string): string {
  let xml = source
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;'));

  for (const name of BLOCKED_ELEMENTS) xml = stripElement(xml, name);

  // a link wrapper goes, its content stays
  xml = xml.replace(/<\/?a\b[^>]*>/gi, '');

  // an <image> or <use> pointing outside the document is dropped whole
  xml = xml.replace(/<(image|use)\b[^>]*?>(?:\s*<\/\1\s*>)?/gi, (element) => {
    const ref = /\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(element);
    if (ref) return isLocalRef(ref[1] ?? ref[2] ?? '') ? element : '';
    return /\bhref\s*=/i.test(element) ? '' : element;
  });

  // event handlers
  xml = xml.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // href and xlink:href survive only as an internal `#id` or a data image
  xml = xml.replace(/\s+((?:xlink:)?href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (whole, _name, dq: string | undefined, sq: string | undefined) => {
    return isLocalRef(dq ?? sq ?? '') ? whole : '';
  });

  // remote url() paints and @import inside style attributes and <style>
  xml = xml.replace(/url\(\s*(["']?)\s*(?!#)[^)]*\1\s*\)/gi, 'none');
  xml = xml.replace(/@import[^;]*;?/gi, '');
  xml = xml.replace(/javascript:/gi, '');
  return xml.trim();
}

function rootTag(xml: string): string {
  return /<svg\b[^>]*>/i.exec(xml)?.[0] ?? '';
}

function numericAttribute(tag: string, name: string): number | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(?:px)?\\s*["']`, 'i').exec(tag);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** width over height from the viewBox, else the root's own size; null when the picture does not say */
export function svgAspectRatio(xml: string): number | null {
  const tag = rootTag(xml);
  const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
  if (box) {
    const width = Number(box[1]);
    const height = Number(box[2]);
    if (width > 0 && height > 0) return width / height;
  }
  const width = numericAttribute(tag, 'width');
  const height = numericAttribute(tag, 'height');
  return width && height ? width / height : null;
}

/** the markup with the root's own size removed, so the renderer fits it to the box it is given */
export function fitSvgToBox(xml: string): string {
  const tag = rootTag(xml);
  if (!tag) return xml;
  let next = tag.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  if (!/\sviewBox\s*=/i.test(next)) {
    const width = numericAttribute(tag, 'width');
    const height = numericAttribute(tag, 'height');
    if (width && height) next = next.replace(/<svg\b/i, `<svg viewBox="0 0 ${width} ${height}"`);
  }
  return xml.replace(tag, next);
}

export type PreparedSvg = { xml: string; aspect: number };

/** sanitised and scalable, with the aspect (1 when the document gives no way to tell); null when it has no <svg> root */
export function prepareSvg(input: string): PreparedSvg | null {
  const xml = sanitizeSvg(input);
  if (!rootTag(xml)) return null;
  return { xml: fitSvgToBox(xml), aspect: svgAspectRatio(xml) ?? 1 };
}
