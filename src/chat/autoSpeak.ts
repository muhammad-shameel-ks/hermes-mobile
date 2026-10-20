/**
 * "Read Responses Aloud" (desktop store/voice-prefs.ts `$autoSpeakReplies` and
 * use-auto-speak-replies.ts): a phone-local switch, persisted beside the
 * appearance prefs, that reads each finished reply aloud with the same voice as
 * the action bar's read aloud. Like the desktop it is not `voice.auto_tts`,
 * which belongs to the messaging gateway. Replies never overlap: one finishing
 * mid-playback is held and read when the playback ends, newest wins.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { File, Paths } from 'expo-file-system';

import { messageText } from './actionBar.ts';
import { idleTracker, lastReplyId, observeReply } from './autoSpeakTracker.ts';
import { openEntry } from './chatSlices.ts';
import type { ChatController } from './controller.ts';
import { readAloud, readAloudState, subscribeReadAloud, type ReadAloudOptions } from './readAloud.ts';

const prefsFile = () => new File(Paths.document, 'voice.json');

function loadEnabled(): boolean {
  try {
    const file = prefsFile();
    return file.exists ? (JSON.parse(file.textSync()) as { autoSpeak?: unknown }).autoSpeak === true : false;
  } catch {
    return false;
  }
}

let enabled: boolean | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const autoSpeakEnabled = () => (enabled ??= loadEnabled());

export function setAutoSpeak(on: boolean): void {
  enabled = on;
  try {
    const file = prefsFile();
    file.create({ overwrite: true });
    file.write(JSON.stringify({ autoSpeak: on }));
  } catch {
    // a convenience: a failed write keeps the choice for this run
  }
  for (const listener of listeners) listener();
}

export const useAutoSpeak = () => useSyncExternalStore(subscribe, autoSpeakEnabled);

/** while the switch is on, reads each reply that finishes in the open chat; mount once beside the transcript */
export function useAutoSpeakReplies(controller: ChatController, voice: () => ReadAloudOptions, onFailed: () => void): void {
  const on = useAutoSpeak();

  useEffect(() => {
    if (!on) return;
    let tracker = idleTracker();
    let held: string | null = null;

    const speak = () => {
      if (held === null || readAloudState().status !== 'idle') return;
      const message = openEntry(controller.getSnapshot()).transcript.messages.find((m) => m.id === held);
      held = null;
      if (message) readAloud(messageText(message), message.id, voice()).catch(onFailed);
    };

    const check = () => {
      const entry = openEntry(controller.getSnapshot());
      const step = observeReply(tracker, { session: entry.key, running: entry.transcript.running, lastReplyId: lastReplyId(entry.transcript.messages) });
      tracker = step.tracker;
      if (step.speak) {
        held = step.speak;
        speak();
      }
    };

    check();
    const stops = [controller.subscribe(check), subscribeReadAloud(speak)];
    return () => stops.forEach((stop) => stop());
  }, [controller, on, voice, onFailed]);
}
