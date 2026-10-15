/**
 * The prompts the gateway blocks a turn on and a card cannot carry: the sudo
 * password, a skill's secret, and the vault family (unlock, save a login,
 * a one-time code). Ported from the desktop's components/prompt-overlays.tsx,
 * with the same copy and answers. Any way out of the sheet - Cancel, the scrim,
 * the back button - answers an empty value, a refusal on every prompt, so
 * silence is never mistaken for consent. Values live only in this sheet's state.
 */

import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '../ui/Sheet.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';
import { useRequests } from './RequestsContext.tsx';
import { RequestButton, RequestInput, TablerIcon, type TablerName } from './requestUi.tsx';
import { APPROVAL_COPY, PROMPT_COPY, PROMPT_REFUSAL, activePrompt, cleanVaultCode, type PromptRequest } from './requests.ts';

export function PromptSheet() {
  const { requests, actions } = useRequests();
  const prompt = activePrompt(requests);
  // the sheet fades out over the prompt it just answered, not an empty frame
  const last = useRef<PromptRequest | null>(null);
  if (prompt) last.current = prompt;
  const shown = prompt ?? last.current;

  return (
    <Sheet visible={prompt !== null} onClose={() => prompt && actions.answerPrompt(prompt, PROMPT_REFUSAL)}>
      {shown ? <PromptForm key={shown.requestId} prompt={shown} /> : null}
    </Sheet>
  );
}

function Header({ icon, title, description }: { icon: TablerName; title: string; description: string }) {
  const t = useTokens();
  return (
    <View style={styles.header}>
      <View style={styles.title}>
        <TablerIcon name={icon} size={16} color={t.uiTextPrimary} />
        <Text style={[styles.titleText, { color: t.uiTextPrimary }]} numberOfLines={2}>
          {title}
        </Text>
      </View>
      <Text style={[styles.description, { color: t.uiTextSecondary }]}>{description}</Text>
    </View>
  );
}

function Label({ children }: { children: ReactNode }) {
  const t = useTokens();
  return <Text style={[styles.label, { color: t.uiTextPrimary }]}>{children}</Text>;
}

function Footnote({ children }: { children: ReactNode }) {
  const t = useTokens();
  return <Text style={[styles.footnote, { color: t.uiTextSecondary }]}>{children}</Text>;
}

function PromptForm({ prompt }: { prompt: PromptRequest }) {
  const t = useTokens();
  const { actions } = useRequests();
  const [value, setValue] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = (answer: string) => {
    const failed = actions.answerPrompt(prompt, answer);
    if (failed) {
      setError(failed);
      return;
    }
    setSent(true);
    setValue('');
    setIdentifier('');
  };
  const cancel = () => send(PROMPT_REFUSAL);

  let header: ReactNode;
  let fields: ReactNode;
  let confirmLabel: string = PROMPT_COPY.send;
  let cancelLabel: string = PROMPT_COPY.cancel;
  let canSend = value !== '';
  let answer = value;

  switch (prompt.kind) {
    case 'sudo':
      header = <Header icon="lock" title={PROMPT_COPY.sudoTitle} description={PROMPT_COPY.sudoDesc} />;
      fields = (
        <>
          {prompt.command.trim() ? (
            <View style={styles.field}>
              <Label>{APPROVAL_COPY.command}</Label>
              <ScrollView style={[styles.log, { borderColor: t.uiStrokeTertiary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius.lg }]} nestedScrollEnabled>
                <Text selectable style={[styles.logText, { color: t.uiTextPrimary }]}>
                  {prompt.command}
                </Text>
              </ScrollView>
            </View>
          ) : (
            <Text style={[styles.description, { color: t.uiTextSecondary }]} accessibilityRole="alert">
              {PROMPT_COPY.sudoCommandUnavailable}
            </Text>
          )}
          <RequestInput value={value} onChangeText={setValue} placeholder={PROMPT_COPY.sudoPlaceholder} secureTextEntry autoFocus editable={!sent} onSubmitEditing={() => send(value)} />
        </>
      );
      // an empty sudo password is allowed to send: the backend treats it as a failed sudo, so no command runs
      canSend = true;
      break;
    case 'secret':
      header = <Header icon="key" title={prompt.envVar || PROMPT_COPY.secretTitle} description={prompt.prompt || PROMPT_COPY.secretDesc} />;
      fields = (
        <RequestInput
          value={value}
          onChangeText={setValue}
          placeholder={prompt.envVar || PROMPT_COPY.secretPlaceholder}
          secureTextEntry
          autoFocus
          editable={!sent}
          onSubmitEditing={() => canSend && send(value)}
        />
      );
      break;
    case 'vault-unlock':
      header = <Header icon="shield-lock" title={PROMPT_COPY.vaultUnlockTitle(prompt.displayName)} description={PROMPT_COPY.vaultUnlockDesc(prompt.displayName)} />;
      fields = (
        <RequestInput
          value={value}
          onChangeText={setValue}
          placeholder={PROMPT_COPY.vaultUnlockPlaceholder}
          secureTextEntry
          autoComplete="current-password"
          autoFocus
          editable={!sent}
          onSubmitEditing={() => canSend && send(value)}
        />
      );
      cancelLabel = PROMPT_COPY.vaultUnlockKeepLocked;
      confirmLabel = PROMPT_COPY.vaultUnlockConfirm;
      break;
    case 'vault-save':
      header = <Header icon="shield-lock" title={PROMPT_COPY.vaultSaveTitle(prompt.site)} description={PROMPT_COPY.vaultSaveDesc(prompt.origin)} />;
      fields = (
        <>
          <View style={styles.field}>
            <Label>{PROMPT_COPY.vaultSaveIdentifierLabel}</Label>
            <RequestInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={PROMPT_COPY.vaultSaveIdentifierPlaceholder}
              autoComplete="username"
              keyboardType="email-address"
              autoFocus
              editable={!sent}
            />
          </View>
          <View style={styles.field}>
            <Label>{PROMPT_COPY.vaultSavePasswordPlaceholder}</Label>
            <RequestInput value={value} onChangeText={setValue} secureTextEntry autoComplete="current-password" editable={!sent} />
          </View>
          <Footnote>{PROMPT_COPY.vaultSaveFootnote}</Footnote>
        </>
      );
      cancelLabel = PROMPT_COPY.vaultSaveDecline;
      confirmLabel = PROMPT_COPY.vaultSaveConfirm;
      canSend = Boolean(identifier.trim()) && Boolean(value);
      answer = JSON.stringify({ identifier: identifier.trim(), password: value });
      break;
    case 'vault-code':
      header = <Header icon="shield-lock" title={PROMPT_COPY.vaultCodeTitle(prompt.site)} description={PROMPT_COPY.vaultCodeDesc(prompt.site)} />;
      fields = (
        <>
          <View style={styles.field}>
            <Label>{PROMPT_COPY.vaultCodeLabel}</Label>
            {/* a code is shown as typed: it is short, and a typo should be visible */}
            <RequestInput
              value={value}
              onChangeText={setValue}
              placeholder="123 456"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
              editable={!sent}
              onSubmitEditing={() => canSend && send(cleanVaultCode(value))}
            />
          </View>
          <Footnote>{PROMPT_COPY.vaultCodeFootnote}</Footnote>
        </>
      );
      cancelLabel = PROMPT_COPY.vaultCodeSkip;
      confirmLabel = PROMPT_COPY.vaultCodeConfirm;
      canSend = cleanVaultCode(value) !== '';
      answer = cleanVaultCode(value);
      break;
  }

  return (
    <View style={styles.body}>
      {header}
      {fields}
      {error ? (
        <Text style={[styles.error, { color: t.dtDestructive }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <RequestButton label={cancelLabel} variant="ghost" disabled={sent} onPress={cancel} />
        <RequestButton label={confirmLabel} disabled={sent || !canSend} busy={sent} onPress={() => send(answer)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 4, gap: 12 },
  header: { gap: 6 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleText: { flex: 1, fontSize: 17, fontWeight: '600' },
  description: { fontSize: 13, lineHeight: 19 },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '500' },
  footnote: { fontSize: 12, lineHeight: 16 },
  log: { maxHeight: 192, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8 },
  logText: { fontFamily: MONO, fontSize: 12, lineHeight: 12 * 1.5 },
  error: { fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
});
