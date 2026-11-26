/**
 * The words behind "Just for fun" (docs/spec/insights.md): theme tags for every
 * template item, keyword fallbacks for people's own items, and the animals, styles
 * and badges. Written once and read by a person before shipping (IN-8): nothing
 * here is generated while the app runs.
 */

export const THEMES = [
  "closeness",
  "talk",
  "space",
  "roots",
  "spotlight",
  "hearth",
  "care",
  "adventure",
] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  closeness: "Closeness",
  talk: "Talk",
  space: "Space",
  roots: "Roots",
  spotlight: "Spotlight",
  hearth: "Hearth",
  care: "Care",
  adventure: "Adventure",
};

/**
 * Every template item (src/templates.ts), by theme. Each text appears once; a test
 * checks that every template item is here (IN-2).
 */
export const ITEM_THEMES: Record<Theme, string[]> = {
  closeness: [
    "Calling each other pet names",
    "Holding hands",
    "Kissing",
    "Cuddling",
    "Sex",
    "Sleeping over",
    "Saying 'I love you'",
    "Hugging",
    "Sleeping in the same bed",
    "Flirting",
    "Romantic dates",
    "Giving gifts",
    "Calling it romantic",
    "Sitting close or cuddling",
    "Sharing a bed when traveling",
    "Physical touch while talking",
    "Romantic gestures",
    "Gifts",
    "Anniversaries",
    "Pet names",
  ],
  talk: [
    "Daily check-in messages",
    "Weekly relationship check-in",
    "Talking through conflict same day",
    "Sharing feelings openly",
    "Sharing sexual health information",
    "Frequent texting",
    "Regular phone or video calls",
    "Sharing day-to-day details",
    "Discussing our relationship openly",
    "Giving honest feedback",
    "Sharing hopes and fears",
    "Telling each other about new interests",
    "Sharing details about dates",
    "Knowing before things become physical",
    "Sharing relationship changes promptly",
    "Advance notice of plans",
    "Telling each other about new risks",
    "Checking in before new relationships",
    "Revisiting agreements regularly",
    "Texting most days",
    "Regular calls",
    "Honest advice when asked",
    "Talking about deep topics",
    "Discussing friendship conflicts openly",
    "Texting every day",
    "Good morning or night messages",
    "Calling instead of texting",
    "Replying within a few hours",
    "Saying how we feel early",
    "Sharing past relationship history",
    "Talking about values and politics",
    "Preferred way to resolve conflict",
    "Knowing about other partners",
    "Advance notice of new relationships",
    "Revisiting this menu regularly",
  ],
  space: [
    "Time alone respected",
    "Don't-ask-don't-tell arrangement",
    "Overnights with other partners",
    "No veto power",
    "Equal footing for all partners",
    "Okay to go quiet sometimes",
    "Taking things slowly",
    "Still dating other people",
    "Separate bedrooms",
    "Dedicated personal space",
    "Quiet hours",
    "Knocking before entering",
    "Separate homes",
    "Protected alone time",
    "Dating other people",
  ],
  roots: [
    "Exclusivity",
    "Living together",
    "Marriage or legal partnership",
    "Having or raising kids",
    "Making long-term plans together",
    "Planning far into the future",
    "Making decisions together",
    "Legal or financial ties",
    "Co-parenting",
    "Prioritising this relationship",
    "Off-limits people or circles",
    "Nesting or primary partnership",
    "Prioritising the friendship",
    "Living together someday",
    "Talking about exclusivity soon",
    "Deleting dating apps",
    "Defining the relationship",
    "Discussing long-term goals",
    "Alternating family holidays",
    "Creating our own traditions",
    "Keys to each other's places",
    "Moving cities together",
    "Involvement with existing children",
    "Long-term plans",
    "Shared big decisions",
    "Growing old together",
  ],
  spotlight: [
    "Meeting each other's friends",
    "Meeting each other's family",
    "Public displays of affection",
    "Posting about us online",
    "Attending events as a couple",
    "Using a relationship label",
    "Being introduced as partners",
    "Public affection",
    "Being included in family events",
    "Being publicly known as connected",
    "Meeting each other's partners",
    "Being friendly with metamours",
    "Spending group time together",
    "Metamours in our home",
    "Kitchen-table style closeness",
    "Introducing others to family",
    "Bringing others to events",
    "Including each other in group plans",
    "Calling ourselves best friends",
    "Meeting friends soon",
    "Meeting family",
    "Posting about each other online",
    "Overnight guests",
    "Hosting gatherings at home",
    "Family staying with us",
    "Hosting holidays",
    "Attending family events",
    "Meeting friends",
    "Posting together online",
    "Bringing each other to events",
    "Meeting metamours",
  ],
  hearth: [
    "Sharing a home",
    "Sharing finances",
    "Running errands for each other",
    "Helping with chores",
    "Caring for each other's pets",
    "Shared calendar",
    "Holidays split fairly",
    "Help moving house",
    "Borrowing and lending money",
    "Pet or plant sitting",
    "Joint bank account",
    "Splitting bills evenly",
    "Splitting by income",
    "Shared savings goals",
    "Checking before big purchases",
    "Fixed chore schedule",
    "Shared cooking",
    "Hiring cleaning help",
    "Equal share of mental load",
    "Notice before visitors",
    "Having pets",
    "Shared pet care",
    "Pets on the furniture",
    "Shared plant care",
    "Gift-giving budget",
    "Sharing expenses",
    "Joint accounts",
    "Lending money",
    "Paying for dates",
    "Shared financial goals",
    "Cleaning schedule",
    "Pet care",
  ],
  care: [
    "Emotional support in hard times",
    "Caring for each other when sick",
    "Celebrating each other's wins",
    "Being an emergency contact",
    "Being vulnerable with each other",
    "Being a go-to support person",
    "Prioritising each other emotionally",
    "Regular testing",
    "Agreed barrier practices",
    "Remembering important dates",
    "Venting without fixing",
    "Being called in a crisis",
    "Checking in when things are hard",
    "Rides to appointments",
    "Keeping secrets private",
    "Emotional support",
    "Caring when sick",
    "Help with practical tasks",
  ],
  adventure: [
    "Regular date nights",
    "Traveling together",
    "Shared hobbies",
    "Spending holidays together",
    "Protected time just for us",
    "Meeting up every week",
    "Regular hangouts",
    "Trying new things together",
    "Celebrating holidays together",
    "Planning the next date in advance",
    "Seeing each other weekly",
  ],
};

/** Template group names, by theme ("Pace" and "Other partners" mix themes, so they're left out). */
export const GROUP_THEMES: Record<Theme, string[]> = {
  closeness: ["Affection & intimacy", "Physical connection", "Romance", "Physical closeness", "Physical affection"],
  talk: ["Communication", "Disclosure", "Staying in touch", "Communication cadence", "Getting to know each other"],
  space: ["Boundaries & veto", "Space & privacy"],
  roots: [
    "Future",
    "Commitment",
    "Hierarchy & commitment",
    "Commitment & boundaries",
    "Exclusivity",
    "Holidays & traditions",
    "Living arrangements",
    "Family & kids",
    "Future & commitment",
  ],
  spotlight: ["Social life", "Social & identity", "Metamours", "Social circles", "Guests", "Social life & public"],
  hearth: [
    "Practical life",
    "Scheduling & time",
    "Practical help",
    "Finances",
    "Chores",
    "Pets & plants",
    "Household & chores",
  ],
  care: ["Support & care", "Emotional connection", "Safer sex & health", "Emotional support"],
  adventure: ["Time together", "Time together & apart"],
};

/**
 * Keyword fallbacks for people's own items and groups (IN-2): the first match wins,
 * in this order. Kept conservative: an item no rule matches simply doesn't count.
 */
export const THEME_KEYWORDS: [Theme, RegExp][] = [
  ["hearth", /\b(chores?\b|clean|cook|dish|laundry|bills?\b|money|financ|rent\b|budget|expens|errands?\b|pets?\b|plants?\b|household|groceri|kitchen)/i],
  ["talk", /\b(text|messag|calls?\b|calling|phone|talk|communicat|check[- ]?ins?\b|chat|discuss|feedback|disclos|honest)/i],
  ["closeness", /\b(cuddl|hug|kiss|hold(ing)? hands|touch|intima|physical|affection|sex|snuggl|romanc|romantic|flirt|massag|gifts?\b)/i],
  ["care", /\b(support|caring|care\b|sick|comfort|emergenc|listen|vent\b|venting|crisis|celebrat|help)/i],
  ["space", /\b(alone|space|privacy|private|independen|solo\b|separate|quiet|apart|autonom|freedom|me[- ]time|boundar)/i],
  ["roots", /\b(future|commit|marr|wedding|kids?\b|child|famil|exclusiv|long[- ]term|moving in|move in|living together|engag|anniversar|forever)/i],
  ["spotlight", /\b(public|social|friends?\b|part(y|ies)\b|events?\b|posting|post\b|online|introduc|label|metamour)/i],
  ["adventure", /\b(travel|trips?\b|adventur|hobb|dates?\b|hang ?outs?\b|games?\b|outings?\b|explor|holiday|vacation|new things|hik(e|ing)\b|together\b)/i],
];

export type Animal = { name: string; emoji: string; blurbs: string[] };

/** One animal per theme (IN-4). Blurbs are about the animal, never a verdict on the answers (IN-8). */
export const THEME_ANIMALS: Record<Theme, Animal> = {
  closeness: {
    name: "Otter",
    emoji: "🦦",
    blurbs: [
      "Holds hands while sleeping so nobody drifts away.",
      "Keeps a favourite rock in a pocket and would love to show it to you. Up close.",
    ],
  },
  talk: {
    name: "Parrot",
    emoji: "🦜",
    blurbs: [
      "Will tell you about their day. All of it. Possibly twice.",
      "Learns your words and repeats them back, lovingly.",
    ],
  },
  space: {
    name: "Cat",
    emoji: "🐈",
    blurbs: [
      "Loves you very much, from the other end of the sofa.",
      "Will come and sit with you. On their own schedule.",
    ],
  },
  roots: {
    name: "Penguin",
    emoji: "🐧",
    blurbs: [
      "Has already found the perfect pebble for you.",
      "Picks a partner and waddles back to them, year after year.",
    ],
  },
  spotlight: {
    name: "Peacock",
    emoji: "🦚",
    blurbs: [
      "Believes love is better with an audience.",
      "Would like everyone at the party to meet you, please.",
    ],
  },
  hearth: {
    name: "Beaver",
    emoji: "🦫",
    blurbs: [
      "Has opinions about the dishwasher. Builds the dam anyway.",
      "Shows love through a well-kept lodge and a shared calendar.",
    ],
  },
  care: {
    name: "Elephant",
    emoji: "🐘",
    blurbs: [
      "Never forgets your birthday, or your bad day.",
      "Will stand next to you, quietly, for as long as it takes.",
    ],
  },
  adventure: {
    name: "Dolphin",
    emoji: "🐬",
    blurbs: [
      "Always up for one more lap.",
      "Turns any errand into a side quest.",
    ],
  },
};

/** When no theme has a score yet (IN-4). */
export const CHAMELEON: Animal = {
  name: "Chameleon",
  emoji: "🦎",
  blurbs: [
    "Homebrewed so thoroughly it defies classification.",
    "Changes colour to match whatever menu it's sitting on.",
  ],
};

export const EGG_EMOJI = "🥚";

export const STYLES = ["curious", "wholehearted", "discerning", "decisive", "easygoing"] as const;
export type Style = (typeof STYLES)[number];

/** Styles from the answer mix (IN-5): an adjective for the animal, and what it means. */
export const STYLE_TEXT: Record<Style, { adjective: string; description: string }> = {
  curious: { adjective: "Curious", description: "Lots of Maybes: keeps the door open." },
  wholehearted: { adjective: "Wholehearted", description: "Lots of Must haves: all in." },
  discerning: { adjective: "Discerning", description: "Knows exactly where the lines are." },
  decisive: { adjective: "Decisive", description: "Not a single Maybe." },
  easygoing: { adjective: "Easygoing", description: "A relaxed mix of answers." },
};

export const BADGE_IDS = [
  "hatched",
  "cartographer",
  "well-rounded",
  "fine-print",
  "homebrewer",
  "boundary-keeper",
  "full-spectrum",
] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

/**
 * "effort" badges can show as not yet earned, with a hint; "answers" badges only
 * appear once earned, so no answer is ever a goal (IN-7).
 */
export const BADGE_TEXT: Record<
  BadgeId,
  { kind: "effort" | "answers"; emoji: string; name: string; earned: string; hint?: string }
> = {
  hatched: {
    kind: "effort",
    emoji: "🐣",
    name: "Hatched",
    earned: "Answered enough items to meet the animal.",
    hint: "Answer 5 items.",
  },
  cartographer: {
    kind: "effort",
    emoji: "🗺️",
    name: "Cartographer",
    earned: "Answered every item on the menu.",
    hint: "Answer every item (a menu of 10 or more).",
  },
  "well-rounded": {
    kind: "effort",
    emoji: "🧭",
    name: "Well-Rounded",
    earned: "Has a score in all eight themes.",
    hint: "Answer 2 items in every theme. Ready-made groups can fill the gaps.",
  },
  "fine-print": {
    kind: "effort",
    emoji: "📜",
    name: "Fine Print",
    earned: "Added notes to 5 items.",
    hint: "Add notes to 5 items.",
  },
  homebrewer: {
    kind: "effort",
    emoji: "🧪",
    name: "Homebrewer",
    earned: "Wrote 3 items that aren't from any template.",
    hint: "Write 3 items of your own.",
  },
  "boundary-keeper": {
    kind: "answers",
    emoji: "🛡️",
    name: "Boundary Keeper",
    earned: "Marked something Off limits, and said so clearly.",
  },
  "full-spectrum": {
    kind: "answers",
    emoji: "🌈",
    name: "Full Spectrum",
    earned: "Used all four answers.",
  },
};
