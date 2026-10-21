/**
 * User sections: the folders the reader files bots into (apps/desktop/src/plugins/hermes-bots/user-sections.ts).
 *
 * Membership lives on the bot, as `sectionId` and `sectionName` in its `ui_meta["hermes-bots"]`, so a
 * filing follows the profile to every client. The desktop keeps the section records themselves (their
 * order, empty sections) in its own local storage, which never leaves that machine; the phone rebuilds the
 * sections from their members exactly as a second desktop does (`adoptBotSectionsFromMeta`). Parity
 * deviations that follow from it: sections are ordered by name, and a section nobody is filed in does not
 * exist here. "Unassigned" is not a section: it is whatever is left, drawn last, and with no sections at
 * all the roster renders as the plain list.
 */

import type { Bot } from './roster.ts';

export type BotSection = { id: string; name: string };
/** `id` is null for Unassigned */
export type SectionBlock = { id: string | null; name: string; bots: Bot[] };

export const UNASSIGNED_SECTION_KEY = 'section:unassigned';
/** desktop `SectionNameDialog` `maxLength` */
export const MAX_SECTION_NAME = 40;

export function botSectionId(bot: Pick<Bot, 'meta'>): string | null {
  const id = bot.meta.sectionId;
  return typeof id === 'string' && id ? id : null;
}

/** the section name a bot carries with its filing, or null */
export function botSectionName(bot: Pick<Bot, 'meta'>): string | null {
  const name = bot.meta.sectionName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** desktop `newSectionId`, so both clients mint the same shape */
export function newSectionId(now = Date.now(), random = Math.random): string {
  return `sec-${now.toString(36)}-${random().toString(36).slice(2, 7)}`;
}

/**
 * Every section some bot is filed in, ordered by name. A section takes the name most of its members carry
 * (they disagree only while a rename elsewhere is still re-stamping them); one whose members carry no name
 * at all cannot be drawn, and they read as Unassigned, as on a desktop that never made it.
 */
export function rosterSections(bots: readonly Bot[]): BotSection[] {
  const tallies = new Map<string, Map<string, number>>();
  for (const bot of bots) {
    const id = botSectionId(bot);
    const name = botSectionName(bot);
    if (!id || !name) continue;
    const tally = tallies.get(id) ?? new Map<string, number>();
    tally.set(name, (tally.get(name) ?? 0) + 1);
    tallies.set(id, tally);
  }
  const sections: BotSection[] = [];
  for (const [id, tally] of tallies) {
    let name = '';
    let votes = 0;
    for (const [candidate, count] of tally) {
      if (count > votes) {
        name = candidate;
        votes = count;
      }
    }
    sections.push({ id, name });
  }
  return sections.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * desktop `groupRowsBySection`: split bots into blocks in section order, Unassigned last. Every bot lands in
 * exactly one block, in the order it came; a bot filed in a section not in `sections` falls to Unassigned,
 * never out of the list. Blocks with no bots are left out.
 */
export function groupBySection(bots: readonly Bot[], sections: readonly BotSection[]): SectionBlock[] {
  const members = new Map<string, Bot[]>(sections.map((section) => [section.id, []]));
  const loose: Bot[] = [];
  for (const bot of bots) {
    const id = botSectionId(bot);
    const into = id ? members.get(id) : undefined;
    if (into) into.push(bot);
    else loose.push(bot);
  }
  const blocks: SectionBlock[] = [];
  for (const section of sections) {
    const filed = members.get(section.id)!;
    if (filed.length > 0) blocks.push({ id: section.id, name: section.name, bots: filed });
  }
  if (loose.length > 0) blocks.push({ id: null, name: '', bots: loose });
  return blocks;
}

export const sectionMembers = (bots: readonly Bot[], id: string) => bots.filter((bot) => botSectionId(bot) === id);
