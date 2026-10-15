/**
 * The dispatch for tool calls that render as their own panel. A card tool the
 * cards below draw gets its card; anything else - a clarification, a connector
 * offer, a failed call, a call that was sealed without a result - gets the
 * generic row the caller passes, exactly as the desktop falls back to
 * ToolFallback. The desktop's connection, catalog, theme and setup cards are
 * driven by live server requests and desktop-only tools; they stay generic rows.
 */

import type { ReactElement } from 'react';

import { toolFailed } from '../toolView.ts';
import type { ToolPart } from '../transcript.ts';
import { DelegateCard } from './DelegateCard.tsx';
import { GeneratedImageCard, hasGeneratedImage } from './GeneratedImageCard.tsx';

/** a call sealed without a result (the turn stopped, the completion was lost) is neither pending nor done */
const settledWithoutResult = (tool: ToolPart) => tool.status === 'done' && tool.result === undefined && tool.resultText === undefined;

export function ToolCard({ tool, fallback }: { tool: ToolPart; fallback: ReactElement }): ReactElement {
  if (tool.name === 'delegate_task') {
    // a call that failed outright dispatched nothing: only the generic row can explain it
    return toolFailed(tool) || settledWithoutResult(tool) ? fallback : <DelegateCard tool={tool} />;
  }
  if (tool.name === 'image_generate') {
    return settledWithoutResult(tool) || !hasGeneratedImage(tool) ? fallback : <GeneratedImageCard tool={tool} />;
  }
  return fallback;
}
