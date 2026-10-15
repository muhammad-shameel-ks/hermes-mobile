/**
 * The empty-chat intro copy and the composer's resting placeholders, ported from
 * the desktop: apps/desktop/src/components/chat/intro.tsx + intro-copy.jsonl
 * (bodies only; the desktop never renders the headlines) and the i18n
 * `newSessionPlaceholders` / `followUpPlaceholders` lists. The personality comes
 * from the profile's `display.personality`; a name with no stock copy gets the
 * desktop's custom-personality fallback.
 */

const NEUTRAL = new Set(['', 'default', 'none', 'neutral']);

const STOCK: Record<string, readonly string[]> = {
  helpful: [
    "Ask me to open a repo, run tests, fix a bug, or draft a PR. I'll walk through the steps with you.",
    "Point me at a file, paste an error, or describe what you're building. I'll take it from there.",
    "Try: review my diff, run the test suite, or explain this function. Ask anything about your code.",
    "I can edit files, run commands, search the web, and walk you through tricky bugs. Just describe the task.",
    "Share a repo path or a question to start. I keep replies clear and link back to the files I touch.",
  ],
  concise: [
    "Describe the task. I'll do it.",
    "Paste code, errors, or a goal. Short answers, fast edits.",
    "Ask. I'll read files, run tests, ship patches. No filler.",
    "One line is enough. I'll expand only when it matters.",
    "Command, question, or file path. I handle the rest.",
  ],
  technical: [
    "Provide repo path, failing test, or stack trace. Tools: fs, git, exec, search, patch, http.",
    "Send a prompt to trigger tool calls. Supports multi-file edits, test runs, git ops, and web fetches.",
    "Enter task. I will plan, call tools, verify output. Logs stream inline; diffs returned pre-apply.",
    "Accepts natural language or structured commands. Typical flow: read -> plan -> patch -> test -> report.",
    "filesystem, terminal, git, browser, search. Describe the change; I return diffs and test output.",
  ],
  creative: [
    "What shall we build? Paste an idea, a half-broken function, or a dream. I'll sketch it into shape.",
    "Give me a spark - a feature, a refactor, a wild prototype - and I'll turn it into code you can run.",
    "Describe the thing that doesn't exist yet. I'll pull tests, files, and APIs into a working draft.",
    "Bring an intent, not a spec. We can prototype fast, refine later, and rewrite the world in the margins.",
    "Tell me what you're chasing. I'll remix examples, adapt snippets, and leave a tidy commit behind.",
  ],
  teacher: [
    "Ask about any file, concept, or error. I'll explain the why, not just the fix, and show a worked example.",
    "Paste code to review, a bug to debug, or a concept to unpack. I'll guide you step by step.",
    "Share the problem. I'll break it into parts, explain each, and leave you able to solve the next one alone.",
    "We'll read the code together, find the root cause, and build a mental model you can reuse next time.",
    "Name the topic or paste the snippet. Expect explanations, diagrams in prose, and practice prompts.",
  ],
  kawaii: [
    "paste a bug or a file path and i'll fix it super gently. tests, diffs, PRs - all with extra care! *sparkle*",
    "tell me what you're making! i love refactors, tiny helpers, and big scary repos alike (>w<)",
    "drop an error, a goal, or a whole folder. i'll tidy it up with lots of love and a clean commit message!",
    "one task at a time, done neatly! i can run tests, patch files, and make your repo feel cozy again <3",
    "say hi or paste a stack trace! no task too small, no repo too tangled. we'll untangle it together!",
  ],
  catgirl: [
    "paste a file, paw at a bug, or toss me a repo. i'll pounce on failing tests and leave clean diffs, nyan~",
    "describe the task. i'll patch, test, and purr over your PR. careful - i nip at unused imports!",
    "give me a goal and i'll chase it through the codebase. reads, edits, runs - all with a twitchy tail.",
    "paste an error or a plan. i debug like i hunt: quietly, thoroughly, with the occasional zoomie.",
    "say the word and i'll read your files, run your tests, and curl up in your branch with a tidy commit.",
  ],
  pirate: [
    "Name yer quarry - a bug, a feature, a cursed test - and I'll chase it down, matey. Diffs for plunder.",
    "Point me at the charts (the code) and I'll patch the hull, fire the cannons (tests), hoist a clean PR.",
    "Paste an error or a plan, ye scurvy dog. I'll navigate the stack trace and bring back treasure: green tests.",
    "Tell me where X marks the spot. I read, edit, and commit with the discipline of a proper crew, arrr.",
    "Throw me a bug, a repo path, or a wild idea. I'll plunder the docs and return with workin' code.",
  ],
  shakespeare: [
    "Speak thy bug, thy file, thy weary test, and I shall mend it with a scholar's hand and honest diff.",
    "Name the code that vexeth thee. I shall read, revise, and render a patch most fair and clean.",
    "Present thy stack trace or thy dream. I'll traverse files, run tests, and report in plainest verse.",
    "Describe thy aim, good sir or madam. Thy branches shall be trimmed, thy bugs cast from the realm.",
    "A line of intent sufficeth. I read, I edit, I commit - and leave thy history unblemished.",
  ],
  surfer: [
    "Drop a file, a bug, a gnarly stack trace - I'll ride it out. Clean diffs, green tests, no wipeouts.",
    "Paste your repo path or the bug that's bumming you out. We'll paddle in, fix it, paddle out. Easy.",
    "Tell me the vibe: feature, refactor, hotfix. I'll run tests, ship the patch, and keep it mellow, brah.",
    "Big bug? Little typo? Whole rewrite? Just point. I handle the code; you chill with the rad commits.",
    "Name the task and we're off. I read, edit, test, and leave a commit smoother than a dawn patrol.",
  ],
  noir: [
    "Tell me what's broken. I'll read the files, dust for prints, and leave a diff on the desk by morning.",
    "You've got a bug. I've got patience and a terminal. Name the case and I'll work it till it talks.",
    "Paste the stack trace, the suspect file, the alibi. I read between the lines and return with the truth.",
    "Every bug leaves a trail. Give me the repo and a lead - I'll follow it, patch it, and close the file.",
    "A typo, a segfault, a whole rotten architecture - hand me the keys. I'll bring back clean tests.",
  ],
  uwu: [
    "paste a buggy fiwe or a goaw~ i'll wead, patch, and test, aww with tiny pawprints on the diff owo",
    "teww me the task, no matter how smoww~ i pwomise cwean commits and gentwe refactors, nyuu~",
    "dwop yur ewwor message hewe! i'll find the cuwpwit, fix it, and weave a happy test suite behind me owo",
    "give me a wepo path ow a buggo and i'll take cawe of it uwu. gwr at bad code, kind to yu~",
    "i can wun tests, edit fiwes, and open pwease-wook PRs. just say da wowd, fwend uwu",
  ],
  philosopher: [
    "What problem sits before you? Describe it, and we shall examine its form, its cause, and its solution.",
    "Every bug is a question in disguise. Share yours; I'll read, reason, and return an answer - and a patch.",
    "What do you wish to build, or to understand? I'll reason from first principles, edit, and verify with tests.",
    "Describe the end you seek. I pursue it through files, tests, and docs, and report what I found on the way.",
    "Share a path, a puzzle, or a principle. I'll trace the logic, propose a change, and justify each edit.",
  ],
  hype: [
    "Paste that bug, that repo, that wild feature idea - I AM LOCKED IN. Clean diffs. Green tests. RIGHT NOW.",
    "Drop your task and watch me cook. Files read, tests run, PRs opened - we are NOT losing today, friend.",
    "Bring the gnarliest bug you've got. I'll read, patch, test, commit like my life depends on it. LET'S GO.",
    "Describe the task. I'll blitz through files, crush failing tests, and leave a commit that SLAPS. Go go go.",
    "Tiny typo or huge refactor - doesn't matter. I'm shipping clean code today. Name the task and let's WORK.",
  ],
  none: [
    "Ask a question, paste an error, or point me at a repo. I can read code, run tools, and help you ship.",
    "Describe the task in your own words. I'll pick the right tools, explain my plan, and check in before risky steps.",
    "Drop a file path, a traceback, or a rough idea. I'll investigate, suggest next steps, and keep things reversible.",
    "Search the repo, edit files, run tests, open PRs. Tell me the goal and I'll handle the mechanical parts.",
    "Type a task, question, or snippet. I remember the session, cite my sources, and stop to ask when I'm unsure.",
  ],
};

const titleize = (value: string) =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

function customCopy(personality: string): string[] {
  const label = titleize(personality);
  return [
    "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo.",
    "Bring the context or the stuck part. I'll adapt to your configured personality.",
    "Send the problem, file, or idea. I'll follow the personality you've configured.",
    "Drop the task here. I'll keep the work grounded in the repo.",
    `Give me the context and I'll answer in ${label} mode.`,
  ];
}

export function normalizePersonality(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase();
  return NEUTRAL.has(key) ? '' : key;
}

export function introBody(personality: string | null | undefined, seed: number): string {
  const key = normalizePersonality(personality);
  const bodies = STOCK[key] ?? (key ? customCopy(key) : STOCK.none);
  return bodies[Math.abs(seed) % bodies.length];
}

export const NEW_SESSION_PLACEHOLDERS = [
  'What are we building?',
  'Give Hermes a task',
  "What's on your mind?",
  'Describe what you need',
  'What should we tackle?',
  'Ask anything',
  'Start with a goal',
] as const;

export const FOLLOW_UP_PLACEHOLDERS = [
  'Send a follow-up',
  'Add more context',
  'Refine the request',
  "What's next?",
  'Keep it going',
  'Push it further',
  'Adjust or continue',
] as const;
