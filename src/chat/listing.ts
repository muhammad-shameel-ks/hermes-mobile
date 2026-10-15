/**
 * ```listing fences: property listings as native transcript cards. The portals
 * cannot be framed, so the agent authors normalized JSON and it renders as a
 * browsable card. This is the pure half (parse, validate, normalize); every
 * field is untrusted model output, and bad input degrades to a plain code block.
 * Port of the desktop's lib/listing-embed.
 */

const MAX_IMAGES = 40;
const MAX_LIST_ITEMS = 12;
const MAX_LISTINGS = 24;
const MAX_TEXT = 400;

export type ListingLink = { label: string; url: string };

export type Listing = {
  /** street address or headline; the card's identity */
  address: string;
  /** formatted as given ("$12,500/mo") */
  price?: string;
  beds?: number;
  baths?: number;
  /** interior size, already formatted ("2,136 sqft") */
  size?: string;
  /** why this one is worth the tour */
  note?: string;
  /** short amenity or spec chips */
  facts: string[];
  /** risks worth verifying before touring */
  catches: string[];
  /** gallery image URLs (https only) */
  images: string[];
  links: ListingLink[];
  id: string;
};

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, MAX_TEXT);
  return trimmed || undefined;
}

/** beds and baths arrive as `3` and `"3.5"`; absurd counts are rejected */
function count(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 99) return undefined;
  return Math.round(parsed * 10) / 10;
}

/** only absolute http(s); a card must never carry `javascript:` into a link */
function webUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  return /^https?:\/\/[^\s/]+/i.test(raw) ? raw : undefined;
}

function stringList(value: unknown, limit = MAX_LIST_ITEMS): string[] {
  if (!Array.isArray(value)) {
    const single = text(value);
    return single ? [single] : [];
  }
  const items: string[] = [];
  for (const entry of value) {
    const item = text(entry);
    if (item) items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

function urlList(value: unknown, limit = MAX_IMAGES): string[] {
  const urls: string[] = [];
  for (const entry of Array.isArray(value) ? value : [value]) {
    const url = webUrl(entry);
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length >= limit) break;
  }
  return urls;
}

/** `www.homes.com` reads as the portal's name */
export function hostLabel(url: string): string {
  const host = /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1];
  return host ? host.replace(/^www\./i, '') : 'Listing';
}

function linkList(value: unknown): ListingLink[] {
  const links: ListingLink[] = [];
  for (const entry of Array.isArray(value) ? value : [value]) {
    const record = typeof entry === 'object' && entry !== null ? (entry as { url?: unknown; label?: unknown }) : null;
    const url = webUrl(record ? record.url : entry);
    if (!url || links.some((existing) => existing.url === url)) continue;
    links.push({ label: (record ? text(record.label) : undefined) ?? hostLabel(url), url });
    if (links.length >= MAX_LIST_ITEMS) break;
  }
  return links;
}

function normalizeListing(raw: unknown, index: number): Listing | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const address = text(source.address) ?? text(source.title);
  if (!address) return null;
  return {
    address,
    baths: count(source.baths),
    beds: count(source.beds),
    catches: stringList(source.catches),
    facts: stringList(source.facts),
    id: text(source.id) ?? `${address}:${index}`,
    images: urlList(source.images ?? source.image),
    links: linkList(source.links ?? source.url),
    note: text(source.note) ?? text(source.why),
    price: text(source.price),
    size: text(source.size) ?? text(source.sqft),
  };
}

/** accepts one object, a bare array or `{ listings: [...] }`; anything unparseable is empty so the caller falls back to code */
export function parseListings(code: string): Listing[] {
  let data: unknown;
  try {
    data = JSON.parse(code);
  } catch {
    return [];
  }
  const entries = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { listings?: unknown }).listings)
      ? (data as { listings: unknown[] }).listings
      : [data];
  const listings: Listing[] = [];
  for (const [index, entry] of entries.slice(0, MAX_LISTINGS).entries()) {
    const listing = normalizeListing(entry, index);
    if (listing) listings.push(listing);
  }
  return listings;
}

/** "3 bd · 2.5 ba · 2,136 sqft" */
export function specLine(listing: Listing): string {
  const parts: string[] = [];
  if (listing.beds !== undefined) parts.push(`${listing.beds} bd`);
  if (listing.baths !== undefined) parts.push(`${listing.baths} ba`);
  if (listing.size) parts.push(listing.size);
  return parts.join(' · ');
}
