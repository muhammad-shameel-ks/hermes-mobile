/**
 * Inline audio (expo-audio). The desktop leans on the browser's `<audio
 * controls>`; RN has no native control strip, so this is a quiet one in the
 * same bordered panel: play and pause, a seekable track, elapsed and total.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { Codicon } from '../../ui/Codicon.tsx';
import { useTokens } from '../../ui/tokens.ts';
import { formatClock, mediaName } from '../media.ts';
import type { PlaybackSource } from '../mediaResolver.ts';
import { FileCard } from './FileCard.tsx';
import { usePlaybackSource } from './useMedia.ts';

function Controls({ source }: { source: PlaybackSource }) {
  const t = useTokens();
  const audio = useMemo(() => ({ uri: source.uri, headers: source.headers }), [source.uri, source.headers]);
  const player = useAudioPlayer(audio);
  const status = useAudioPlayerStatus(player);
  const [track, setTrack] = useState(0);

  useEffect(() => {
    if (status.didJustFinish) {
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const toggle = () => (status.playing ? player.pause() : player.play());

  return (
    <View style={styles.controls}>
      <Pressable
        onPress={toggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause' : 'Play'}
        style={[styles.button, { backgroundColor: t.uiBgSecondary }]}
      >
        <Codicon name={status.playing ? 'debug-pause' : 'play'} size={14} color={t.uiTextPrimary} />
      </Pressable>
      <Pressable
        onLayout={(event) => setTrack(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (track > 0 && status.duration > 0) void player.seekTo((event.nativeEvent.locationX / track) * status.duration);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        style={styles.trackHit}
      >
        <View style={[styles.track, { backgroundColor: t.uiBgPrimary }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: t.uiAccent }]} />
        </View>
      </Pressable>
      <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool, fontVariant: ['tabular-nums'] }}>
        {formatClock(status.currentTime)} / {formatClock(status.duration)}
      </Text>
    </View>
  );
}

function AudioCardImpl({ path }: { path: string }) {
  const t = useTokens();
  const source = usePlaybackSource(path);
  const name = mediaName(path);

  if (source.status === 'failed') return <FileCard path={path} />;

  return (
    <View style={[styles.panel, { borderColor: t.uiStrokeTertiary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['3xl'] }]}>
      <Text numberOfLines={1} style={[styles.name, { color: t.uiTextSecondary, fontSize: t.type.caption }]}>
        {name}
      </Text>
      {source.status === 'ready' ? (
        <Controls source={source.value} />
      ) : (
        <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>{`Loading ${name}…`}</Text>
      )}
    </View>
  );
}

export const AudioCard = memo(AudioCardImpl);

const styles = StyleSheet.create({
  panel: { borderWidth: StyleSheet.hairlineWidth, padding: 12, marginVertical: 8, maxWidth: 448 },
  name: { fontWeight: '500', marginBottom: 8 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  button: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  trackHit: { flex: 1, height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
