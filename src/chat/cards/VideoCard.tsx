/**
 * Inline video (expo-video): the desktop's bordered media panel - the file name
 * above a player capped to a 16:9 frame - with the platform's native controls.
 * A source that will not play degrades to copy-path, as the desktop's falls back
 * to "Open video file".
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useTokens } from '../../ui/tokens.ts';
import { mediaName } from '../media.ts';
import type { PlaybackSource } from '../mediaResolver.ts';
import { FileCard } from './FileCard.tsx';
import { usePlaybackSource } from './useMedia.ts';

function Player({ source, onFailed }: { source: PlaybackSource; onFailed: () => void }) {
  const t = useTokens();
  const video = useMemo(() => ({ uri: source.uri, headers: source.headers }), [source.uri, source.headers]);
  const player = useVideoPlayer(video);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status === 'error') onFailed();
  }, [status, onFailed]);
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={[styles.video, { borderRadius: t.radius.lg }]}
    />
  );
}

function VideoCardImpl({ path }: { path: string }) {
  const t = useTokens();
  const source = usePlaybackSource(path);
  const [failed, setFailed] = useState(false);
  const name = mediaName(path);

  if (source.status === 'failed' || failed) return <FileCard path={path} />;

  return (
    <View style={[styles.panel, { borderColor: t.uiStrokeTertiary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['3xl'] }]}>
      <Text numberOfLines={1} style={[styles.name, { color: t.uiTextSecondary, fontSize: t.type.caption }]}>
        {name}
      </Text>
      {source.status === 'ready' ? (
        <Player source={source.value} onFailed={() => setFailed(true)} />
      ) : (
        <View style={[styles.video, styles.loading, { borderRadius: t.radius.lg }]}>
          <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>{`Loading ${name}…`}</Text>
        </View>
      )}
    </View>
  );
}

export const VideoCard = memo(VideoCardImpl);

const styles = StyleSheet.create({
  panel: { borderWidth: StyleSheet.hairlineWidth, padding: 12, marginVertical: 8, maxWidth: 672 },
  name: { fontWeight: '500', marginBottom: 8 },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  loading: { alignItems: 'center', justifyContent: 'center' },
});
