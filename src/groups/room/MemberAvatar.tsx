/**
 * A room member's face: the roster's bot avatar when the profile is still known locally, or a plain
 * initial tile when it is not (a remote member on another connection, or a bot since removed here).
 */
import { memo } from 'react';
import { Text, View } from 'react-native';

import { BotAvatar } from '../../bots/BotAvatar.tsx';
import type { Bot } from '../../bots/roster.ts';
import { useTokens } from '../../ui/tokens.ts';

type Props = {
  profile: string;
  label: string;
  size: number;
  roster: Readonly<Record<string, Bot>>;
  loadImage: (name: string) => Promise<string | null>;
};

function MemberAvatarImpl({ profile, label, size, roster, loadImage }: Props) {
  const t = useTokens();
  const bot = roster[profile];
  if (bot) return <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={size} loadImage={loadImage} />;
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.22, alignItems: 'center', justifyContent: 'center', backgroundColor: t.uiBgTertiary }}>
      <Text style={{ color: t.uiTextTertiary, fontSize: size * 0.5, fontWeight: '600' }}>{initial}</Text>
    </View>
  );
}

export const MemberAvatar = memo(MemberAvatarImpl);
