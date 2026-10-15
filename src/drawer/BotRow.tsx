/**
 * One bot row (apps/desktop/src/plugins/hermes-bots/bot-row.tsx): the 34 dp face, then the canonical Bot
 * Chat's status dot in the session row's own lead cell, the pinned and hidden marks, the name, the age,
 * and the preview line under it. Rows only: the pane decides what to list. A long-press opens the
 * action sheet in place of the context menu.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BotAvatar } from '../bots/BotAvatar.tsx';
import { faceMood } from '../bots/face.ts';
import { compactAge, type Bot } from '../bots/roster.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { tick } from '../ui/haptics.ts';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { useTokens } from '../ui/tokens.ts';
import { ROW_GAP } from './rowGeometry.ts';
import { DOT_LABELS, type DotState } from './sessionStatus.ts';
import { StatusDot } from './StatusDot.tsx';

type Props = {
  bot: Bot;
  now: number;
  selected: boolean;
  opening: boolean;
  thinking: boolean;
  state: DotState;
  onOpen: (bot: Bot) => void;
  onActions: (bot: Bot) => void;
  loadImage: (name: string) => Promise<string | null>;
};

function BotRowImpl({ bot, now, selected, opening, thinking, state, onOpen, onActions, loadImage }: Props) {
  const t = useTokens();
  const age = compactAge(bot.lastActive, now);
  const status = DOT_LABELS[state];

  return (
    <Pressable
      onPress={() => onOpen(bot)}
      onLongPress={() => {
        tick();
        onActions(bot);
      }}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={[bot.label, bot.pinned ? 'pinned' : '', bot.hidden ? 'hidden' : '', status ?? '', age].filter(Boolean).join(', ')}
      accessibilityHint="Long press for more actions"
      accessibilityState={{ selected, busy: opening }}
      style={({ pressed }) => [styles.row, { borderRadius: t.radius.md }, (selected || pressed) && { backgroundColor: selected ? t.uiRowActiveBackground : t.uiRowHoverBackground }]}
    >
      <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={38} loadImage={loadImage} mood={faceMood(thinking, bot.working)} />
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <View style={styles.name}>
            <StatusDot state={state} />
            {bot.pinned ? <Codicon name="pinned" size={13} color={t.uiTextQuaternary} /> : null}
            {bot.hidden ? <Codicon name="eye-closed" size={13} color={t.uiTextQuaternary} /> : null}
            <Text numberOfLines={1} style={[styles.nameText, { color: t.dtForeground }]}>
              {bot.label}
            </Text>
          </View>
          {opening ? <GlyphSpinner size={12} color={t.uiTextSecondary} label="Opening chat…" /> : null}
          {age ? <Text style={[styles.age, { color: t.uiTextQuaternary }]}>{age}</Text> : null}
        </View>
        {bot.preview ? (
          <Text numberOfLines={1} style={[styles.preview, { color: t.uiTextTertiary }]}>
            {bot.preview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const BotRow = memo(
  BotRowImpl,
  (a, b) => a.bot === b.bot && a.now === b.now && a.selected === b.selected && a.opening === b.opening && a.thinking === b.thinking && a.state === b.state && a.loadImage === b.loadImage,
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10, minHeight: 60 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: ROW_GAP },
  nameText: { flexShrink: 1, fontSize: 16, lineHeight: 21, fontWeight: '500' },
  age: { fontSize: 12, lineHeight: 16 },
  preview: { fontSize: 14, lineHeight: 19 },
});
