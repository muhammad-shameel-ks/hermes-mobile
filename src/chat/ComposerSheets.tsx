import { MentionSheet } from './MentionSheet.tsx';
import { SlashSheet } from './SlashSheet.tsx';
import type { SlashUi } from './slash.ts';
import type { ComposerSheet, SheetScope } from './useComposerTriggers.ts';

/** whichever completion sheet the composer's trigger calls for, docked `bottom` above the chat's foot */
export function ComposerSheets({
  sheet,
  scope,
  bottom,
  available,
  onUi,
}: {
  sheet: ComposerSheet | null;
  scope: SheetScope;
  bottom: number;
  /** room above the composer, for the list's height cap */
  available: number;
  onUi: (ui: SlashUi) => void;
}) {
  if (!sheet) return null;
  const maxHeight = Math.max(160, Math.min(available, 360));
  return sheet.trigger.kind === '/' ? (
    <SlashSheet sheet={sheet} scope={scope} bottom={bottom} maxHeight={maxHeight} onUi={onUi} />
  ) : (
    <MentionSheet sheet={sheet} scope={scope} bottom={bottom} maxHeight={maxHeight} />
  );
}
