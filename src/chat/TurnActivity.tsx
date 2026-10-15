/**
 * The transcript's tail activity row (desktop components/assistant-ui/thread/
 * status.tsx: ResponseLoadingIndicator and TurnActivityIndicator): the dithered
 * square on the shared pulse beat, a shimmering name for the wait when it has
 * one, and the seconds it has run. The rules for when it shows live in
 * turnActivity.ts.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mixPct } from '../ui/color.ts';
import { Dither } from '../ui/Dither.tsx';
import { StatusPulse } from '../ui/loaders/StatusPulse.tsx';
import { ShimmerText, useScaffoldShimmer } from '../ui/ShimmerText.tsx';
import { SCAFFOLD_OPACITY, useTokens } from '../ui/tokens.ts';
import { formatElapsed } from './actionBar.ts';
import { awaitingInput as isAwaitingInput } from './requests.ts';
import { useRequests } from './RequestsContext.tsx';
import type { Message } from './transcript.ts';
import {
  activitySignature,
  DRAFTING_REVEAL_MS,
  idleWait,
  parseModelLoadWait,
  tailParts,
  tailSlot,
  toolNarratesWait,
  TURN_QUIET_S,
  waitHint,
  type TurnWait,
} from './turnActivity.ts';

const PULSE = 12;
/** the timer's 0.56rem against the 0.6875rem tool size */
const TIMER_SCALE = 0.56 / 0.6875;

type Tail = { messages: readonly Message[]; running: boolean; wait: TurnWait };

/**
 * The open chat's turn state. A context rather than props, so the row inside the
 * tail message follows the turn even when the list does not re-render that row.
 */
export const TurnActivityContext = createContext<Tail>({ messages: [], running: false, wait: idleWait() });

/**
 * Where the row mounts. As on the desktop it belongs to the tail reply, just under
 * its content (`message`); until a reply bubble exists it follows the prompt
 * from the list's footer (`footer`, with the rows' inset).
 */
export function TurnActivity({ placement, inset = 0 }: { placement: 'message' | 'footer'; inset?: number }) {
  const tail = useContext(TurnActivityContext);
  const tailIsReply = tail.messages[tail.messages.length - 1]?.role === 'assistant';
  if (!tail.running || tailIsReply !== (placement === 'message')) return null;
  return <TailActivity {...tail} inset={inset} />;
}

function TailActivity({ messages, running, wait, inset }: Tail & { inset: number }) {
  // a clarify, approval or prompt is open: the turn is paused on the user, not working
  const awaitingInput = isAwaitingInput(useRequests().requests);
  const turnStartedAt = useTurnStart(running, messages);
  const revealed = useDraftReveal(wait.drafting?.name ?? '');
  const hint = waitHint(wait, revealed);
  const parts = tailParts(messages);
  const signature = activitySignature(parts);
  const narrating = toolNarratesWait(parts);
  const placeholder = tailSlot(messages) === 'placeholder';

  // the moment the turn last showed something, held once the quiet spell qualifies
  const [quietSince, setQuietSince] = useState<number | undefined>(undefined);
  useEffect(() => {
    setQuietSince(undefined);
    const seenAt = Date.now();
    const id = setTimeout(() => setQuietSince(seenAt), TURN_QUIET_S * 1000);
    return () => clearTimeout(id);
  }, [signature]);

  // the user handing the turn back is progress too: the wait after it shows at once, timed from then
  const [handBack, setHandBack] = useState({ awaitingInput, turnStartedAt });
  if (handBack.awaitingInput !== awaitingInput || handBack.turnStartedAt !== turnStartedAt) {
    setHandBack({ awaitingInput, turnStartedAt });
    if (turnStartedAt !== undefined && turnStartedAt !== handBack.turnStartedAt) setQuietSince(turnStartedAt);
    else if (handBack.awaitingInput && !awaitingInput) setQuietSince(Date.now());
  }

  const active = running && (placeholder || (!awaitingInput && !narrating && (Boolean(hint) || quietSince !== undefined)));
  // compaction and the pre-first-token wait own the whole turn; any other gap counts from its own mark
  const since = placeholder || wait.compacting ? turnStartedAt : (quietSince ?? wait.drafting?.since ?? turnStartedAt);
  const elapsed = useElapsedSeconds(active, since);

  if (!active) return null;
  return <ActivityRow hint={hint} elapsed={elapsed} inset={inset} />;
}

function ActivityRow({ hint, elapsed, inset }: { hint: string; elapsed: number; inset: number }) {
  const t = useTokens();
  // in the footer the row pads itself like a transcript row; inside the reply the message's gap spaces it
  const footer = inset > 0;
  const load = hint ? parseModelLoadWait(hint) : null;
  const label = hint ? (load?.label ?? hint) : 'Hermes is working';
  const labelStyle = { color: t.conversationScaffoldText, fontSize: t.type.tool, lineHeight: t.type.lineHeight };
  const highlight = useScaffoldShimmer();

  return (
    <View
      style={[styles.row, { paddingHorizontal: inset, paddingVertical: footer ? 6 : 0, minHeight: t.type.lineHeight }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      <StatusPulse kind="opacity" style={[styles.pulse, { borderRadius: 2 }]}>
        <Dither size={PULSE} color={mixPct(t.dtMidground, 0.8, 'transparent')} />
      </StatusPulse>
      {hint ? (
        <View style={styles.hint}>
          <ShimmerText style={labelStyle} fontSize={t.type.tool} highlight={highlight}>
            {load?.label ?? hint}
          </ShimmerText>
          {load?.percent != null ? (
            <>
              <View style={[styles.track, { backgroundColor: t.uiBgTertiary }]}>
                <View style={[styles.fill, { width: `${Math.max(2, load.percent)}%`, backgroundColor: t.dtMidground }]} />
              </View>
              <Text style={[labelStyle, styles.tabular]}>{`${load.percent}%`}</Text>
            </>
          ) : null}
        </View>
      ) : null}
      <Text
        style={[styles.timer, styles.tabular, { color: mixPct(t.dtMidground, 0.55, 'transparent'), fontSize: t.type.tool * TIMER_SCALE, letterSpacing: t.type.tool * TIMER_SCALE * 0.02 }]}
      >
        {formatElapsed(elapsed)}
      </Text>
    </View>
  );
}

/** epoch ms the open turn began: seeded from its prompt when the chat opens mid-turn, else the moment it started */
function useTurnStart(running: boolean, messages: readonly Message[]): number | undefined {
  const [start, setStart] = useState<number | undefined>(() => (running ? promptTime(messages) : undefined));
  const [was, setWas] = useState(running);
  if (was !== running) {
    setWas(running);
    setStart(running ? Date.now() : undefined);
  }
  return start;
}

function promptTime(messages: readonly Message[]): number {
  const prompt = [...messages].reverse().find((m) => m.role === 'user');
  return prompt?.timestamp ? prompt.timestamp * 1000 : Date.now();
}

/** a drafted tool is named only once it has streamed for DRAFTING_REVEAL_MS */
function useDraftReveal(name: string): boolean {
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => {
    if (!name) return;
    const id = setTimeout(() => setRevealed(name), DRAFTING_REVEAL_MS);
    return () => clearTimeout(id);
  }, [name]);
  return Boolean(name) && revealed === name;
}

function useElapsedSeconds(active: boolean, since: number | undefined): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, since]);
  return since === undefined ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 6, opacity: SCAFFOLD_OPACITY },
  pulse: { width: PULSE, height: PULSE, overflow: 'hidden' },
  hint: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, gap: 8 },
  track: { width: 96, height: 4, borderRadius: 9999, overflow: 'hidden', flexShrink: 0 },
  fill: { height: '100%', borderRadius: 9999 },
  timer: { flexShrink: 0, includeFontPadding: false },
  tabular: { fontVariant: ['tabular-nums'] },
});
