/**
 * The slices of the chat snapshot the drawer's panes subscribe to (see `useChatSelector`). Each pane
 * subscribes on its own, inside the `<Activity>` that hides it, so a hidden pane (or a closed drawer)
 * holds no subscription and costs the store nothing; it catches up when it is shown again.
 *
 * The panes read live chats only through their activity, so a slice carries `stableActivities`
 * rather than `entries`: streaming replaces the open entry on every token, but its activity changes a
 * few times a turn. Stateful, so create one per subscriber.
 */

import type { ChatSnapshot } from '../chat/controller.ts';
import { NO_ACTIVITIES, stableActivities, type Activities } from './dotStates.ts';

export type SessionsSlice = Pick<ChatSnapshot, 'sessions' | 'openKey' | 'finishedAway' | 'profile'> & { activities: Activities };

export function createSessionsSlice() {
  let activities = NO_ACTIVITIES;
  return (snapshot: ChatSnapshot): SessionsSlice => {
    activities = stableActivities(activities, snapshot.entries);
    return { sessions: snapshot.sessions, openKey: snapshot.openKey, finishedAway: snapshot.finishedAway, profile: snapshot.profile, activities };
  };
}

export type BotsSlice = Pick<ChatSnapshot, 'openKey' | 'openingBot' | 'finishedAway' | 'link'> &
  Pick<ChatSnapshot['roster'], 'visible' | 'hidden' | 'loaded' | 'loading' | 'error'> & {
    activities: Activities;
    /** the bot whose Bot Chat is on screen */
    selected: string | null;
    /** `selected` while its turn runs */
    thinking: string | null;
  };

export function createBotsSlice() {
  let activities = NO_ACTIVITIES;
  return (snapshot: ChatSnapshot): BotsSlice => {
    activities = stableActivities(activities, snapshot.entries);
    const open = snapshot.entries[snapshot.openKey];
    const selected = open?.isBotChat ? open.bot : null;
    return {
      visible: snapshot.roster.visible,
      hidden: snapshot.roster.hidden,
      loaded: snapshot.roster.loaded,
      loading: snapshot.roster.loading,
      error: snapshot.roster.error,
      openKey: snapshot.openKey,
      openingBot: snapshot.openingBot,
      finishedAway: snapshot.finishedAway,
      link: snapshot.link,
      activities,
      selected,
      thinking: selected && open?.transcript.running ? selected : null,
    };
  };
}

export type FooterSlice = Pick<ChatSnapshot, 'link' | 'profile'>;

export const footerSlice = (snapshot: ChatSnapshot): FooterSlice => ({ link: snapshot.link, profile: snapshot.profile });
