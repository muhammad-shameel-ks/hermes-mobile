/**
 * Composer attachments: photos and files only (issue "Transcript and composer
 * parity on touch" drops folder, screenshot and drag-drop). A phone is always a
 * remote client, so bytes cross the socket the way the desktop's remote path does
 * (use-prompt-actions/index.ts `uploadComposerAttachment`): an image rides
 * `image.attach_bytes` and is consumed by the next `prompt.submit`, a file rides
 * `file.attach` and comes back as an `@file:` ref that leads the prompt text.
 */

export type ComposerAttachment = {
  /** `kind:uri`, so attaching the same photo or file twice is one chip */
  id: string;
  kind: 'image' | 'file';
  label: string;
  /** a `file://` or `content://` uri the bytes are read from at send */
  uri: string;
  mime?: string;
  size?: number;
};

/** a gateway call, as the chat controller's `rpc` shapes it */
export type AttachRpc = (method: 'image.attach_bytes' | 'file.attach' | 'image.detach', params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;

/**
 * The largest attachment the phone reads into memory. The gateway accepts 25 MB
 * images and 256 MB files; a phone holds the base64 string and its JSON frame at
 * once, so it stops sooner.
 */
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

const UPLOAD_TIMEOUT_MS = 300_000;

/** the gateway's own allow-list (`cli._IMAGE_EXTENSIONS`) */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};
const IMAGE_SUFFIXES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/** shown when attachments meet a running turn; the queue, when it lands, takes them instead */
export const ATTACH_WHILE_RUNNING = 'Attachments send once the running turn finishes.';

export const attachmentId = (kind: ComposerAttachment['kind'], uri: string) => `${kind}:${uri}`;

/** desktop `pathLabel` */
export function uriLabel(uri: string): string {
  const last = uri.split(/[\\/]/).filter(Boolean).pop() ?? uri;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** desktop `pasteSizeLabel`'s byte format, for the chip's second line */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The filename an image goes up under. The gateway trusts a filename's suffix
 * over the bytes and rejects any suffix outside its list, so a picker's
 * `IMG_0001.HEIC` that arrived as JPEG is renamed to what it now is; with no
 * trustworthy suffix the name goes bare and the magic bytes decide.
 */
export function imageUploadName(label: string, mime?: string): string {
  const dot = label.lastIndexOf('.');
  const stem = dot > 0 ? label.slice(0, dot) : label;
  const suffix = dot > 0 ? label.slice(dot).toLowerCase() : '';
  const fromMime = mime ? IMAGE_EXTENSIONS[mime.toLowerCase()] : undefined;
  if (fromMime) return `${stem}${fromMime}`;
  return IMAGE_SUFFIXES.has(suffix) ? label : stem;
}

export function imageAttachment(asset: { uri: string; fileName?: string | null; mimeType?: string; fileSize?: number }): ComposerAttachment {
  return {
    id: attachmentId('image', asset.uri),
    kind: 'image',
    label: asset.fileName || uriLabel(asset.uri),
    uri: asset.uri,
    mime: asset.mimeType,
    size: asset.fileSize,
  };
}

export function fileAttachment(asset: { uri: string; name?: string; mimeType?: string; size?: number }): ComposerAttachment {
  return {
    id: attachmentId('file', asset.uri),
    kind: 'file',
    label: asset.name || uriLabel(asset.uri),
    uri: asset.uri,
    mime: asset.mimeType,
    size: asset.size,
  };
}

/** desktop `upsertAttachment`: a repeat replaces its chip in place */
export function addAttachments(current: readonly ComposerAttachment[], added: readonly ComposerAttachment[]): ComposerAttachment[] {
  const next = [...current];
  for (const attachment of added) {
    const at = next.findIndex((item) => item.id === attachment.id);
    if (at < 0) next.push(attachment);
    else next[at] = attachment;
  }
  return next;
}

/** desktop `friendlyRemoteAttachError`'s sentence, for a size known before any bytes are read */
export function tooLargeNotice(label: string, size: number | undefined, limit = MAX_ATTACHMENT_BYTES): string | null {
  if (size === undefined || size <= limit) return null;
  return `${label} is too large to upload to the remote gateway (max ${Math.floor(limit / (1024 * 1024))} MB).`;
}

/** what the user message bubble shows: what was typed, else the names (desktop `submit.ts` `bubbleText`) */
export function bubbleText(text: string, attachments: readonly ComposerAttachment[]): string {
  return text || attachments.map((attachment) => attachment.label).join(', ');
}

export type StagedAttachments = {
  /** `@file:` refs the gateway minted for files, in attach order */
  refs: string[];
  /** where the gateway queued each image, for `image.detach` if the send fails */
  imagePaths: string[];
};

type AttachResult = { attached?: boolean; message?: string | null; path?: string | null; ref_text?: string | null };

const dataUrl = (mime: string | undefined, base64: string) => `data:${mime || 'application/octet-stream'};base64,${base64}`;

/** takes queued images back out of the session, so a send that failed does not leak them into the next prompt */
export async function detachImages(rpc: AttachRpc, target: { sessionId: string; profile: string }, paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => rpc('image.detach', { session_id: target.sessionId, profile: target.profile, path }).catch(() => undefined)));
}

/**
 * Uploads each attachment into the live session, one after another as the
 * desktop does. `read` hands back a uri's bytes as base64. The first failure
 * detaches what was already queued and rethrows.
 */
export async function stageAttachments(
  rpc: AttachRpc,
  target: { sessionId: string; profile: string },
  attachments: readonly ComposerAttachment[],
  read: (uri: string) => Promise<string>,
): Promise<StagedAttachments> {
  const staged: StagedAttachments = { refs: [], imagePaths: [] };
  try {
    for (const attachment of attachments) {
      const tooLarge = tooLargeNotice(attachment.label, attachment.size);
      if (tooLarge) throw new Error(tooLarge);
      const base64 = await read(attachment.uri);
      if (!base64) throw new Error(`Could not read ${attachment.label}`);
      if (attachment.kind === 'image') {
        const result = (await rpc(
          'image.attach_bytes',
          { session_id: target.sessionId, profile: target.profile, content_base64: base64, filename: imageUploadName(attachment.label, attachment.mime) },
          UPLOAD_TIMEOUT_MS,
        )) as AttachResult;
        if (!result.attached) throw new Error(result.message || `Could not attach ${attachment.label}`);
        if (result.path) staged.imagePaths.push(result.path);
      } else {
        const result = (await rpc(
          'file.attach',
          { session_id: target.sessionId, profile: target.profile, name: attachment.label, data_url: dataUrl(attachment.mime, base64) },
          UPLOAD_TIMEOUT_MS,
        )) as AttachResult;
        if (!result.attached || !result.ref_text) throw new Error(result.message || `Could not attach ${attachment.label}`);
        staged.refs.push(result.ref_text);
      }
    }
  } catch (error) {
    await detachImages(rpc, target, staged.imagePaths);
    throw error;
  }
  return staged;
}

/**
 * The text `prompt.submit` carries (desktop `buildContextText`): the file refs,
 * then what was typed; an image sent alone asks the question the desktop asks.
 */
export function promptText(text: string, staged: StagedAttachments, hasImage: boolean): string {
  return [staged.refs.join('\n'), text].filter(Boolean).join('\n\n') || (hasImage ? 'What do you see in this image?' : '');
}
