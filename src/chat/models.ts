/**
 * The model picker's pure half: display names and variant tags for model ids,
 * effort labels, and the grouped, filtered rows the picker renders.
 *
 * Ported from the desktop's lib/model-status-label.ts (`modelDisplayParts`),
 * lib/reasoning-effort.ts (short labels) and the grouping in
 * app/shell/model-catalog-menu.tsx. Wire ids never change; search uses the
 * shared `modelSearchText` aliases.
 */

import type { ModelOptionProvider } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { modelSearchText } from '../../vendor/hermes-shared/src/model-search-text.ts';
import { DEFAULT_REASONING_EFFORT, isReasoningEffort, REASONING_EFFORTS } from '../../vendor/hermes-shared/src/reasoning-effort.ts';

export type ModelSelection = { model: string; provider: string; effort?: string | null };

// ─── display names ───────────────────────────────────────────────────────────

const VARIANT_TAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-fast$/i, 'Fast'],
  [/-flash$/i, 'Flash'],
  [/-thinking$/i, 'Thinking'],
  [/-preview$/i, 'Preview'],
  [/-latest$/i, 'Latest'],
];

const VENDOR_CASING: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDeepseek\b/g, 'DeepSeek'],
  [/\bGlm\b/g, 'GLM'],
  [/\bMinimax\b/g, 'MiniMax'],
  [/\bOpenai\b/g, 'OpenAI'],
  [/\bErnie\b/g, 'ERNIE'],
  [/\bMimo\b/g, 'MiMo'],
  [/\bBge\b/g, 'BGE'],
  [/\bVl\b/g, 'VL'],
  [/\bIt\b/g, 'IT'],
  [/\bFp8\b/g, 'FP8'],
  [/\bAi\b/g, 'AI'],
];

const PARAMETER_COUNT = /\b(a?)(\d+(?:\.\d+)?)b\b/gi;

const titleCase = (text: string) => text.replace(/\b\w/g, (char) => char.toUpperCase()).trim();

function applyVendorCasing(text: string): string {
  let cased = text.replace(PARAMETER_COUNT, (_match, prefix: string, size: string) => `${prefix.toUpperCase()}${size}B`);
  for (const [pattern, replacement] of VENDOR_CASING) cased = cased.replace(pattern, replacement);
  return cased;
}

function prettifyBase(base: string): string {
  if (/^claude-/i.test(base)) {
    return applyVendorCasing(titleCase(base.replace(/^claude-/i, '').replace(/(\d)-(?=\d)/g, '$1.').replace(/-/g, ' ')));
  }
  if (/^gpt-/i.test(base)) return base.replace(/^gpt-/i, 'GPT-');
  if (/^gemini-/i.test(base)) return applyVendorCasing(titleCase(base.replace(/^gemini-/i, 'Gemini ').replace(/-/g, ' ')));
  return applyVendorCasing(titleCase(base.replace(/-/g, ' ')));
}

function splitTrailingTags(input: string): { base: string; variant: string; quant: string } {
  let base = input;
  let variant = '';
  let quant = '';
  for (let progress = true; progress; ) {
    progress = false;
    if (!variant) {
      for (const [pattern, label] of VARIANT_TAGS) {
        if (pattern.test(base)) {
          variant = label;
          base = base.replace(pattern, '');
          progress = true;
          break;
        }
      }
    }
    if (!quant) {
      const match = base.match(/-(?:UD-)?(Q\d(?:_[A-Z0-9]+)*|IQ\d(?:_[A-Z0-9]+)*|F16|BF16)$/i);
      if (match) {
        quant = match[1].split('_')[0].toUpperCase();
        base = base.slice(0, -match[0].length).replace(/-(?:Instruct|Chat)(?:-\d{4})?$/i, '');
        progress = true;
      }
    }
  }
  return { base, variant, quant };
}

export function modelBaseId(model: string): string {
  const trimmed = model.trim();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** A clean display name plus the grayed variant tag (`Flash`, `Preview`, a quant, `1M`). */
export function modelDisplayParts(model: string): { name: string; tag: string } {
  const split = splitTrailingTags(modelBaseId(model));
  let base = split.base;
  const tags = [split.variant, split.quant].filter(Boolean);
  const contextWindow = base.match(/\[(\d+[mk])\]$/i);
  if (contextWindow) {
    tags.push(contextWindow[1].toUpperCase());
    base = base.slice(0, -contextWindow[0].length);
  }
  base = base.replace(/-\d{8}$/, '');
  return { name: prettifyBase(base) || model.trim() || 'No model', tag: tags.join(' ') };
}

/** The composer pill's label: `Name · Tag`. */
export function modelPillLabel(model: string | null | undefined): string {
  if (!model) return 'Model';
  const { name, tag } = modelDisplayParts(model);
  return tag ? `${name} · ${tag}` : name;
}

// ─── effort ──────────────────────────────────────────────────────────────────

const SHORT_EFFORT: Record<string, string> = {
  none: 'Off',
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra',
};

const LONG_EFFORT: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
  ultra: 'Ultra',
};

export const EFFORT_OPTIONS = REASONING_EFFORTS.map((value) => ({ value, label: LONG_EFFORT[value] ?? value }));

export function effortShortLabel(effort: string | null | undefined): string {
  const key = (effort ?? '').trim().toLowerCase();
  return key ? (SHORT_EFFORT[key] ?? key) : '';
}

const normalizeEffort = (effort: string | null | undefined) => (effort ?? '').trim().toLowerCase();

/** desktop lib/reasoning-effort.ts `resolveReasoningEffort`: the row's level, else the profile's, else Hermes' own */
export function resolveEffort(effort: string | null | undefined, defaultEffort: string | null | undefined): string {
  const own = normalizeEffort(effort);
  if (isReasoningEffort(own)) return own;
  const fallback = normalizeEffort(defaultEffort);
  return isReasoningEffort(fallback) ? fallback : DEFAULT_REASONING_EFFORT;
}

/** desktop `isThinkingEnabled`: only an explicit `none` (on the row or inherited from the profile) turns thinking off */
export function thinkingEnabled(effort: string | null | undefined, defaultEffort: string | null | undefined): boolean {
  return (normalizeEffort(effort) || normalizeEffort(defaultEffort)) !== 'none';
}

// ─── catalog rows ────────────────────────────────────────────────────────────

export const modelKey = (provider: string, model: string) => `${provider}::${model}`;

export type ModelRow = {
  key: string;
  provider: string;
  providerName: string;
  model: string;
  name: string;
  tag: string;
  favorite: boolean;
  current: boolean;
  /** the model takes a reasoning effort; a catalog that says nothing is read as yes, as the desktop reads it */
  reasoning: boolean;
  /** thinking can be switched off; only an explicit `can_disable_reasoning: false` says it cannot */
  canDisableReasoning: boolean;
};

export type ModelGroup = {
  id: string;
  label: string;
  /** right-aligned detail, e.g. "1 account" */
  detail: string | null;
  rows: ModelRow[];
};

function reasoningSupport(provider: ModelOptionProvider | undefined, model: string): Pick<ModelRow, 'reasoning' | 'canDisableReasoning'> {
  const caps = provider?.capabilities?.[model];
  return { reasoning: caps?.reasoning ?? true, canDisableReasoning: caps?.can_disable_reasoning !== false };
}

/** the row for the selected model, found in the catalog or, when the catalog doesn't list it, built from the id alone */
export function selectedModelRow(providers: readonly ModelOptionProvider[], selection: ModelSelection): ModelRow {
  const provider = providers.find((p) => p.slug === selection.provider);
  const { name, tag } = modelDisplayParts(selection.model);
  return {
    key: modelKey(selection.provider, selection.model),
    provider: selection.provider,
    providerName: provider?.name || selection.provider,
    model: selection.model,
    name,
    tag,
    favorite: false,
    current: true,
    ...reasoningSupport(provider, selection.model),
  };
}

/** the composer's reasoning pill (`Med`, `High`, `Off`); null when the model takes no effort, so the pill hides as the desktop's does */
export function effortPillLabel(providers: readonly ModelOptionProvider[], selection: ModelSelection | null): string | null {
  if (!selection || !selectedModelRow(providers, selection).reasoning) return null;
  const key = normalizeEffort(selection.effort);
  return effortShortLabel(key === 'none' ? key : resolveEffort(key, null));
}

function accountsLabel(provider: ModelOptionProvider): string | null {
  const count = provider.usage?.accounts?.length ?? 0;
  if (!count) return null;
  return `${count} ${count === 1 ? 'account' : 'accounts'}`;
}

function matches(row: ModelRow, terms: string[]): boolean {
  if (!terms.length) return true;
  const haystack = `${row.name} ${row.tag} ${modelSearchText(row.model)} ${row.providerName} ${row.provider}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Favorites first (in the order they were starred), then each provider's models as the gateway listed them. */
export function buildModelGroups(
  providers: readonly ModelOptionProvider[],
  options: { favorites: readonly string[]; current: ModelSelection | null; query?: string },
): ModelGroup[] {
  const terms = (options.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const favorites = new Set(options.favorites);
  const byKey = new Map<string, ModelRow>();
  const groups: ModelGroup[] = [];

  for (const provider of providers) {
    const unavailable = new Set(provider.unavailable_models ?? []);
    const rows: ModelRow[] = [];
    for (const model of provider.models ?? []) {
      if (unavailable.has(model)) continue;
      const key = modelKey(provider.slug, model);
      const { name, tag } = modelDisplayParts(model);
      const row: ModelRow = {
        key,
        provider: provider.slug,
        providerName: provider.name || provider.slug,
        model,
        name,
        tag,
        favorite: favorites.has(key),
        current: options.current?.provider === provider.slug && options.current?.model === model,
        ...reasoningSupport(provider, model),
      };
      byKey.set(key, row);
      if (matches(row, terms)) rows.push(row);
    }
    if (rows.length) groups.push({ id: provider.slug, label: provider.name || provider.slug, detail: accountsLabel(provider), rows });
  }

  const starred = options.favorites.map((key) => byKey.get(key)).filter((row): row is ModelRow => !!row && matches(row, terms));
  if (starred.length) groups.unshift({ id: '__favorites', label: 'Favorites', detail: null, rows: starred });
  return groups;
}
