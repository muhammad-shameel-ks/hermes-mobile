/**
 * Entry points for the Files surface and the preview viewer. Each pushes a
 * full-screen route onto the overlay stack; call them with `useOverlay()`:
 *
 *   openFiles(overlay)                          the files root
 *   openPreview(overlay, { kind: 'file', ... }) a file, linked or under the files root
 *   openPreview(overlay, { kind: 'artifact', ... })
 *   openPreview(overlay, { kind: 'url', url })  hands off to the system browser
 */

import type { OverlayApi } from '../app/overlay.tsx';
import FilesScreen from './FilesScreen.tsx';
import PreviewScreen from './PreviewScreen.tsx';
import { isWebUrl, type PreviewTarget } from './preview.ts';
import { openInBrowser } from './transfer.ts';

function pushDirectory(overlay: OverlayApi, root: string, path: string) {
  overlay.push(`files:${path}`, (close) => (
    <FilesScreen
      root={root}
      path={path}
      onClose={close}
      onOpenDirectory={(nextRoot, next) => pushDirectory(overlay, nextRoot, next)}
      onOpenFile={(entry) => openPreview(overlay, { kind: 'file', origin: 'files', path: entry.path, size: entry.size ?? undefined, mimeType: entry.mime_type ?? undefined })}
    />
  ));
}

export function openFiles(overlay: OverlayApi): void {
  overlay.push('files', (close) => (
    <FilesScreen
      onClose={close}
      onOpenDirectory={(root, path) => pushDirectory(overlay, root, path)}
      onOpenFile={(entry) => openPreview(overlay, { kind: 'file', origin: 'files', path: entry.path, size: entry.size ?? undefined, mimeType: entry.mime_type ?? undefined })}
    />
  ));
}

export function openPreview(overlay: OverlayApi, target: PreviewTarget): void {
  if (target.kind === 'url') {
    if (isWebUrl(target.url)) void openInBrowser(target.url.trim());
    return;
  }
  const key = target.kind === 'file' ? `preview:${target.path}` : `preview:artifact:${target.label}:${target.content.length}`;
  overlay.push(key, (close) => <PreviewScreen target={target} onClose={close} />);
}
