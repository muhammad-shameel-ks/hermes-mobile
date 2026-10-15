/**
 * The composer's attachment chips and the three ways to add one.
 */

import { useCallback, useMemo, useState } from 'react';

import { pickFiles, pickPhotos, takePhoto, type PickOutcome } from './attachmentFiles.ts';
import { addAttachments, type ComposerAttachment } from './attachments.ts';

export type Attachments = {
  items: ComposerAttachment[];
  remove: (id: string) => void;
  clear: () => void;
  pickPhotos: () => void;
  takePhoto: () => void;
  pickFiles: () => void;
};

export function useAttachments(onNotice: (text: string) => void): Attachments {
  const [items, setItems] = useState<ComposerAttachment[]>([]);

  const run = useCallback(
    async (pick: () => Promise<PickOutcome>) => {
      const outcome = await pick();
      if (outcome.attachments.length) setItems((current) => addAttachments(current, outcome.attachments));
      if (outcome.notice) onNotice(outcome.notice);
    },
    [onNotice],
  );

  return useMemo(
    () => ({
      items,
      remove: (id) => setItems((current) => current.filter((item) => item.id !== id)),
      clear: () => setItems([]),
      pickPhotos: () => void run(pickPhotos),
      takePhoto: () => void run(takePhoto),
      pickFiles: () => void run(pickFiles),
    }),
    [items, run],
  );
}
