/**
 * The clarify card: the agent's question, drawn in place of its tool row
 * (desktop components/assistant-ui/clarify/*). Answered, it reads as the
 * settled Q&A; waiting, it is one form for every question with a single
 * confirm, where picks and typed text stay local until "Confirm and continue"
 * sends the locks in order. A card whose request never reaches the phone says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { mixPct } from '../ui/color.ts';
import { useTokens, type Tokens } from '../ui/tokens.ts';
import { useRequests } from './RequestsContext.tsx';
import { KeyBadge, RequestButton, TablerIcon, type TablerName } from './requestUi.tsx';
import {
  CLARIFY_COPY,
  RECOMMENDED_LABEL,
  bareChoice,
  emptyStage,
  readClarifyArgs,
  readClarifyResult,
  setDraft,
  stageLocked,
  stagedAnswer,
  toggleChoice,
  type ClarifyQuestion,
  type ClarifyRequest,
  type Stage,
} from './requests.ts';
import type { ToolPart } from './transcript.ts';

/** how long a painted card may wait for its request before asking the backend to re-deliver it */
const DELIVERY_GRACE_MS = 4_000;

const letterFor = (index: number) => String.fromCharCode(65 + index);

/**
 * `fallback` is the plain tool row: a clarify the turn stopped on unanswered
 * leaves no dead interactive panel behind.
 */
export function ClarifyCard({ tool, fallback }: { tool: ToolPart; fallback: ReactNode }) {
  const { requests } = useRequests();
  const result = tool.result !== undefined ? tool.result : requests.answered[tool.id];
  if (result !== undefined) return <ClarifySettled result={result} fallback={fallback} />;

  const live = requests.clarify?.toolId === tool.id ? requests.clarify : null;
  if (live) return <ClarifyForm key={live.requestId} request={live} toolArgs={tool.args} />;
  if (tool.status === 'running') return <ClarifyWaiting toolArgs={tool.args} />;
  return <>{fallback}</>;
}

/** the question is on screen but its request has not arrived: shown disabled, and after a grace asks to be re-delivered */
function ClarifyWaiting({ toolArgs }: { toolArgs: unknown }) {
  const { actions } = useRequests();
  const [undelivered, setUndelivered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void actions.redeliver().then((parked) => {
        if (!cancelled && !parked) setUndelivered(true);
      });
    }, DELIVERY_GRACE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [actions]);

  return <ClarifyForm request={null} toolArgs={toolArgs} undelivered={undelivered} />;
}

function Shell({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTokens();
  return <View style={[styles.shell, { backgroundColor: t.uiWidgetSurfaceBackground, borderRadius: t.radius['3xl'] }, style]}>{children}</View>;
}

/** a line led by its text with a quiet glyph trailing (desktop `ClarifyLine`) */
function Line({ icon, children }: { icon: TablerName; children: ReactNode }) {
  const t = useTokens();
  return (
    <View style={styles.line}>
      <View style={styles.lineBody}>{children}</View>
      <View style={styles.lineIcon}>
        <TablerIcon name={icon} size={16} color={t.uiTextTertiary} />
      </View>
    </View>
  );
}

const questionText = (t: Tokens) => ({ color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.lineHeight, fontWeight: '500' as const });

function ClarifySettled({ result, fallback }: { result: unknown; fallback: ReactNode }) {
  const t = useTokens();
  const { outcome, responses } = readClarifyResult(result);
  if (responses.length === 0) return <>{fallback}</>;
  // skip, and a stopped turn, both end the batch as `cancelled`: the reader chose not to answer
  const cancelled = outcome === 'cancelled';

  return (
    <Shell style={styles.settled}>
      {responses.map((row, index) => {
        const answer = Array.isArray(row.answer) ? row.answer.join(', ') : (row.answer ?? '');
        const blank = !answer.trim();
        return (
          <View key={`${index}-${row.question ?? ''}`} style={styles.pair}>
            {row.question ? (
              <Line icon="message-question">
                <Text style={questionText(t)}>{row.question}</Text>
              </Line>
            ) : null}
            <Line icon="circle-letter-a">
              <Text
                style={[
                  { color: blank ? t.uiTextTertiary : t.uiTextSecondary, fontSize: t.type.text, lineHeight: t.type.lineHeight },
                  blank && { fontStyle: 'italic' },
                ]}
              >
                {blank ? (row.unanswered && !cancelled ? CLARIFY_COPY.noAnswer : CLARIFY_COPY.skipped) : answer}
              </Text>
            </Line>
          </View>
        );
      })}
    </Shell>
  );
}

/** the live batch: all questions at once, staged locally, one confirm */
function ClarifyForm({ request, toolArgs, undelivered = false }: { request: ClarifyRequest | null; toolArgs: unknown; undelivered?: boolean }) {
  const t = useTokens();
  const { actions } = useRequests();
  const ready = request !== null && request.questions.length > 0;

  // the args are a display fallback only: they carry no qids to answer under
  const preview = useMemo<ClarifyQuestion[]>(
    () => (readClarifyArgs(toolArgs).questions ?? []).map((q, index) => ({ qid: `args-${index}`, question: q.question, choices: q.choices, multiSelect: q.multiSelect })),
    [toolArgs],
  );
  const questions = ready ? request.questions : preview;

  const [staged, setStaged] = useState<Record<string, Stage>>({});
  const [submitting, setSubmitting] = useState(false);
  const seen = useRef<Record<string, string | null>>({});

  // locked answers (a reconnect replay, or text typed in the composer) stage their questions
  const locked = request?.lockedAnswers;
  useEffect(() => {
    if (!locked) return;
    const before = seen.current;
    seen.current = locked;
    setStaged((current) => stageLocked(questions, locked, before, current));
    // keyed by the replay map only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  const answered = questions.filter((q) => stagedAnswer(q, staged[q.qid]) !== null).length;
  const canConfirm = ready && answered > 0;
  const disabled = submitting || !ready;

  const confirm = useCallback(async () => {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    const sent = await actions.confirmClarify(questions.map((q) => ({ qid: q.qid, answer: stagedAnswer(q, staged[q.qid]) })));
    if (!sent) setSubmitting(false);
  }, [actions, canConfirm, questions, staged, submitting]);

  if (questions.length === 0) {
    return (
      <Shell style={styles.loading}>
        <ActivityIndicator size="small" color={t.uiTextTertiary} accessibilityLabel={CLARIFY_COPY.loadingQuestion} />
      </Shell>
    );
  }

  return (
    <View style={styles.form} accessibilityLabel={undelivered || ready ? undefined : CLARIFY_COPY.loadingQuestion}>
      <Shell style={styles.batch}>
        <View style={styles.progress}>
          <Text style={[styles.progressText, { color: t.uiTextTertiary }]}>
            {questions.length === 1 ? CLARIFY_COPY.oneQuestion : CLARIFY_COPY.questionProgress(answered, questions.length)}
          </Text>
          <TablerIcon name="message-question" size={16} color={t.uiTextTertiary} />
        </View>
        {undelivered ? <UndeliveredNotice /> : null}
        {questions.map((question) => (
          <QuestionBlock
            key={question.qid}
            question={question}
            stage={staged[question.qid]}
            disabled={disabled}
            onPick={(choice) => setStaged((cur) => ({ ...cur, [question.qid]: toggleChoice(question, cur[question.qid], choice) }))}
            onDraft={(value) => setStaged((cur) => ({ ...cur, [question.qid]: setDraft(question, cur[question.qid], value) }))}
          />
        ))}
      </Shell>

      {undelivered ? null : (
        <View style={styles.confirmBar}>
          <RequestButton size="xs" variant="text" label={CLARIFY_COPY.skip} disabled={disabled} onPress={actions.skipClarify} />
          <RequestButton size="xs" label={CLARIFY_COPY.confirmAndContinueLabel} disabled={disabled || !canConfirm} busy={submitting} onPress={() => void confirm()} />
        </View>
      )}
    </View>
  );
}

/** heads a card whose request never reached the phone: nothing on it can answer, so say so */
function UndeliveredNotice() {
  const t = useTokens();
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.notice,
        { borderRadius: t.radius.lg, borderColor: mixPct(t.dtPrimarySolid, 0.3, 'transparent'), backgroundColor: mixPct(t.dtPrimarySolid, 0.04, t.uiBgEditor) },
      ]}
    >
      <TablerIcon name="alert-triangle" size={16} color={t.dtPrimarySolid} />
      <Text style={[styles.noticeText, { color: t.uiTextSecondary }]}>{CLARIFY_COPY.notDelivered}</Text>
    </View>
  );
}

function QuestionBlock({
  question,
  stage,
  disabled,
  onPick,
  onDraft,
}: {
  question: ClarifyQuestion;
  stage: Stage | undefined;
  disabled: boolean;
  onPick: (choice: string) => void;
  onDraft: (value: string) => void;
}) {
  const t = useTokens();
  const current = stage ?? emptyStage;
  const choices = question.choices ?? [];

  const draftInput = (placeholder: string) => (
    <TextInput
      value={current.draft}
      onChangeText={onDraft}
      editable={!disabled}
      multiline
      placeholder={placeholder}
      placeholderTextColor={t.uiTextTertiary}
      selectionColor={t.uiAccent}
      accessibilityLabel={placeholder}
      style={[
        styles.textarea,
        { color: t.uiTextPrimary, borderColor: t.uiStrokeSecondary, backgroundColor: t.uiBgEditor, borderRadius: t.radius.md, opacity: disabled ? 0.5 : 1 },
      ]}
    />
  );

  return (
    <View style={styles.question}>
      <View style={styles.questionHead}>
        <Text style={[questionText(t), styles.questionLabel]}>{question.question}</Text>
        {choices.length > 0 ? (
          <View style={[styles.modePill, { backgroundColor: t.uiControlHoverBackground, borderRadius: t.radius.sm }]}>
            <Text style={[styles.modeText, { color: t.uiTextTertiary }]}>
              {question.multiSelect ? CLARIFY_COPY.multiSelectHint : CLARIFY_COPY.singleSelectHint}
            </Text>
          </View>
        ) : null}
      </View>

      {choices.length > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.choices}>
          {choices.map((choice, index) => {
            const selected = current.choices.includes(choice);
            return (
              <Pressable
                key={`${index}-${choice}`}
                disabled={disabled}
                onPress={() => onPick(choice)}
                accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
                accessibilityState={{ selected, checked: selected, disabled }}
                style={({ pressed }) => [styles.option, { borderRadius: 4, opacity: disabled ? 0.5 : 1 }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
              >
                <KeyBadge char={letterFor(index)} selected={selected} />
                <Text style={[styles.optionText, { color: selected ? t.uiTextPrimary : t.uiTextSecondary, fontSize: t.type.text, lineHeight: t.type.lineHeight }]}>
                  <ChoiceLabel choice={choice} />
                </Text>
              </Pressable>
            );
          })}
          <View style={[styles.option, styles.other, { borderRadius: 4 }]}>
            <KeyBadge char={letterFor(choices.length)} selected={Boolean(current.draft.trim())} disabled={disabled} />
            <View style={styles.otherInput}>{draftInput(CLARIFY_COPY.other)}</View>
          </View>
        </View>
      ) : (
        draftInput(CLARIFY_COPY.placeholder)
      )}
    </View>
  );
}

/** the backend tags the agent's preferred option; the tag reads quieter than the option itself */
function ChoiceLabel({ choice }: { choice: string }) {
  const t = useTokens();
  const bare = bareChoice(choice);
  if (bare === choice) return <>{choice}</>;
  return (
    <>
      {bare} <Text style={{ color: t.uiTextTertiary }}>{RECOMMENDED_LABEL}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  shell: { paddingHorizontal: 14, paddingVertical: 12 },
  settled: { marginVertical: 6, gap: 10 },
  loading: { marginVertical: 6, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  pair: { gap: 4 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineBody: { flex: 1, minWidth: 0 },
  lineIcon: { marginTop: 1 },
  form: { marginVertical: 6, gap: 16 },
  batch: { gap: 12 },
  progress: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  progressText: { flex: 1, fontSize: 11, lineHeight: 16 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 16 },
  question: { gap: 4 },
  questionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  questionLabel: { flex: 1 },
  modePill: { marginTop: 1, paddingHorizontal: 4, paddingVertical: 1 },
  modeText: { fontSize: 10, lineHeight: 14 },
  choices: { gap: 1 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 6, paddingVertical: 4 },
  optionText: { flex: 1 },
  other: { alignItems: 'center' },
  otherInput: { flex: 1 },
  textarea: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, lineHeight: 16, maxHeight: 160, textAlignVertical: 'top' },
  confirmBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
});
