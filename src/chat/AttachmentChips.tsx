/**
 * The composer's attachment chips (desktop app/chat/composer/attachments.tsx
 * `AttachmentPill`) and the picker behind its "+" button. Row actions are always
 * visible on touch, so the remove control is not hover-revealed.
 */

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionSheet, type SheetAction } from '../ui/Sheet.tsx';
import { Codicon } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { sizeLabel, type ComposerAttachment } from './attachments.ts';
import type { Attachments } from './useAttachments.ts';

export function AttachmentChips({ items, onRemove }: { items: readonly ComposerAttachment[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.list}>
      {items.map((attachment) => (
        <Chip key={attachment.id} attachment={attachment} onRemove={onRemove} />
      ))}
    </View>
  );
}

function Chip({ attachment, onRemove }: { attachment: ComposerAttachment; onRemove: (id: string) => void }) {
  const t = useTokens();
  const detail = attachment.size === undefined ? null : sizeLabel(attachment.size);
  return (
    <View style={styles.chipSlot}>
      <View
        style={[
          styles.chip,
          { borderRadius: t.radius['2xl'], borderColor: t.uiStrokeSecondary, backgroundColor: mixPct(t.dtBackground, 0.5, 'transparent') },
        ]}
      >
        <View style={[styles.thumb, { borderRadius: t.radius.lg, borderColor: t.uiStrokeSecondary, backgroundColor: t.uiBgTertiary }]}>
          {attachment.kind === 'image' ? (
            <Image accessibilityIgnoresInvertColors source={{ uri: attachment.uri }} style={styles.thumbImage} resizeMode="cover" />
          ) : (
            <Codicon name="file" size={14} color={t.uiTextTertiary} />
          )}
        </View>
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.label, { color: t.uiTextPrimary }]}>
            {attachment.label}
          </Text>
          {detail ? (
            <Text numberOfLines={1} style={[styles.detail, { color: t.uiTextTertiary }]}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${attachment.label}`}
        onPress={() => onRemove(attachment.id)}
        hitSlop={12}
        style={[styles.remove, { borderColor: t.uiStrokePrimary, backgroundColor: t.dtBackground }]}
      >
        <Codicon name="close" size={10} color={t.uiTextTertiary} />
      </Pressable>
    </View>
  );
}

/** desktop composer menu "Attach": Files…, Images…, plus the camera a phone has; `extra` lets other composer actions join it */
export function AttachMenu({
  visible,
  onClose,
  attachments,
  extra = [],
}: {
  visible: boolean;
  onClose: () => void;
  attachments: Pick<Attachments, 'pickFiles' | 'pickPhotos' | 'takePhoto'>;
  extra?: SheetAction[];
}) {
  const actions: SheetAction[] = [
    { label: 'Files…', onPress: attachments.pickFiles },
    { label: 'Images…', onPress: attachments.pickPhotos },
    { label: 'Take photo…', onPress: attachments.takePhoto },
    ...extra,
  ];
  return <ActionSheet visible={visible} title="Attach" actions={actions} onClose={onClose} />;
}

const styles = StyleSheet.create({
  // desktop `flex flex-wrap gap-1.5 px-1 pt-1`
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4, paddingTop: 4 },
  chipSlot: { maxWidth: 224, flexShrink: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  thumb: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1 },
  thumbImage: { width: '100%', height: '100%' },
  text: { flexShrink: 1, minWidth: 0 },
  // desktop text-[0.72rem] leading-4 font-medium; detail text-[0.62rem] leading-3.5
  label: { fontSize: 11.52, lineHeight: 16, fontWeight: '500' },
  detail: { fontSize: 9.92, lineHeight: 14 },
  remove: { position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
