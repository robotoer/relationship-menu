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
    "Sex with each other",
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
    "Massage",
    "Dancing together",
    "Sharing a bed without touching",
    "Talking about what we each enjoy physically",
    "Checking in during physical closeness",
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
    "Safety check-ins during dates",
    "Talking directly with metamours",
    "Talking about mental health",
    "Adapting to each other's communication needs",
    "Talking about love languages",
    "Saying when something is bothering us, early",
    "Agreeing how to disagree",
    "An emergency way to reach each other",
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
    "Sharing our locations",
    "Parallel style: little contact with metamours",
    "Plenty of time apart",
    "Separate friendships",
    "Pursuing our own interests",
    "Equal say in the relationship",
    "Veto over each other's other relationships",
    "Other romantic relationships",
    "Agreeing what's off the table for now",
    "Deciding together what needs a check-in",
    "Time alone every week",
    "Making everyday decisions without checking in",
    "Keeping some friendships separate",
    "Telling each other plans rather than asking permission",
    "No partner ranked above another",
    "A primary partner, with others alongside",
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
    "A non-legal commitment ceremony",
    "Merging finances",
    "Having or raising kids together",
    "Either of us marrying someone else",
    "Either of us having kids with someone else",
    "Birthdays together",
    "Some holidays together",
    "Most holidays together",
    "Coming first when plans clash",
    "Being named in each other's will",
    "Power of attorney for each other",
    "Long-term planning without a fixed timeline",
    "Talking about commitment before deciding anything",
    "Reserved rituals that are ours",
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
    "Garden-party style: friendly at gatherings",
    "Being glad about each other's other relationships",
    "Being openly polyamorous with friends",
    "Being openly polyamorous with family",
    "Being openly polyamorous at work",
    "Being out about us to family",
    "Being out about us at work",
    "Being each other's plus-one",
    "First pick as plus-one",
    "Deciding together who we're out to",
    "Being each other's first choice for events",
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
    "A joint account for shared costs only",
    "Telling each other about debts",
    "Agreeing who pays for what",
    "Full financial transparency",
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
    "Remembering important dates",
    "Venting without fixing",
    "Being called in a crisis",
    "Checking in when things are hard",
    "Rides to appointments",
    "Keeping secrets private",
    "Caring when sick",
    "Help with practical tasks",
    "Using barriers with each other",
    "Using barriers with other partners",
    "Knowing each other's medications and conditions",
    "Making medical decisions for each other",
    "Care through a long illness",
    "Supporting each other's therapy",
    "Knowing each other's triggers",
    "Sharing past hurts",
    "Telling each other how the day really went",
    "Talking openly about mental health",
    "Talking about what helps when either of us is low",
    "Being each other's executor",
    "Knowing who to call in an emergency",
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
    "Seeing each other once a week or less",
    "Seeing each other 2–3 days a week",
    "Seeing each other 4–5 days a week",
    "Seeing each other most days",
    "Some weekends together",
    "Most weekends together",
    "Every weekend together",
    "Scheduled time together each week",
    "Taking turns choosing what we do",
  ],
};

/** Template group names, by theme ("Pace" and "Other partners" mix themes, so they're left out). */
export const GROUP_THEMES: Record<Theme, string[]> = {
  closeness: [
    "Affection & intimacy",
    "Physical connection",
    "Romance",
    "Physical closeness",
    "Physical affection",
  ],
  talk: [
    "Communication",
    "Disclosure",
    "Staying in touch",
    "Communication cadence",
    "Getting to know each other",
  ],
  space: [
    "Boundaries & veto",
    "Space & privacy",
    "Structure",
    "Independence",
    "Other partners",
    "Pace",
    "Autonomy",
  ],
  roots: [
    "Future",
    "Commitment",
    "Commitment & boundaries",
    "Exclusivity",
    "Holidays & traditions",
    "Living arrangements",
    "Family & kids",
    "Future & commitment",
    "Milestones, one at a time",
    "Priorities & occasions",
    "Other relationships",
  ],
  spotlight: [
    "Social life",
    "Social & identity",
    "Metamours",
    "Social circles",
    "Guests",
    "Social life & public",
    "Being out & included",
  ],
  hearth: [
    "Practical life",
    "Scheduling & time",
    "Practical help",
    "Finances",
    "Chores",
    "Pets & plants",
    "Household & chores",
  ],
  care: [
    "Support & care",
    "Emotional connection",
    "Safer sex & health",
    "Emotional support",
    "Health & emergencies",
    "Emotional health",
  ],
  adventure: [
    "Time together",
    "Time together & apart",
    "How often we see each other",
  ],
};

/**
 * Keyword fallbacks for people's own items and groups (IN-2): the first match wins,
 * in this order. Kept conservative: an item no rule matches simply doesn't count.
 */
export const THEME_KEYWORDS: [Theme, RegExp][] = [
  [
    "hearth",
    /\b(chores?\b|clean|cook|dish|laundry|bills?\b|money|financ|rent\b|budget|expens|errands?\b|pets?\b|plants?\b|household|groceri|kitchen)/i,
  ],
  [
    "talk",
    /\b(text|messag|calls?\b|calling|phone|talk|communicat|check[- ]?ins?\b|chat|discuss|feedback|disclos|honest)/i,
  ],
  [
    "closeness",
    /\b(cuddl|hug|kiss|hold(ing)? hands|touch|intima|physical|affection|sex|snuggl|romanc|romantic|flirt|massag|gifts?\b)/i,
  ],
  [
    "care",
    /\b(support|caring|care\b|sick|comfort|emergenc|listen|vent\b|venting|crisis|celebrat|help)/i,
  ],
  [
    "space",
    /\b(alone|space|privacy|private|independen|solo\b|separate|quiet|apart|autonom|freedom|me[- ]time|boundar)/i,
  ],
  [
    "roots",
    /\b(future|commit|marr|wedding|kids?\b|child|famil|exclusiv|long[- ]term|moving in|move in|living together|engag|anniversar|forever)/i,
  ],
  [
    "spotlight",
    /\b(public|social|friends?\b|part(y|ies)\b|events?\b|posting|post\b|online|introduc|label|metamour)/i,
  ],
  [
    "adventure",
    /\b(travel|trips?\b|adventur|hobb|dates?\b|hang ?outs?\b|games?\b|outings?\b|explor|holiday|vacation|new things|hik(e|ing)\b|together\b)/i,
  ],
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

export const STYLES = [
  "curious",
  "wholehearted",
  "discerning",
  "decisive",
  "easygoing",
] as const;
export type Style = (typeof STYLES)[number];

/** Styles from the answer mix (IN-5): an adjective for the animal, and what it means. */
export const STYLE_TEXT: Record<
  Style,
  { adjective: string; description: string }
> = {
  curious: {
    adjective: "Curious",
    description: "Lots of Maybes: keeps the door open.",
  },
  wholehearted: {
    adjective: "Wholehearted",
    description: "Lots of Must haves: all in.",
  },
  discerning: {
    adjective: "Discerning",
    description: "Knows exactly where the lines are.",
  },
  decisive: { adjective: "Decisive", description: "Not a single Maybe." },
  easygoing: {
    adjective: "Easygoing",
    description: "A relaxed mix of answers.",
  },
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
  {
    kind: "effort" | "answers";
    emoji: string;
    name: string;
    earned: string;
    hint?: string;
  }
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
    earned: "Used all five answers.",
  },
};

// ---- Phase 2: character sheet and loot (IN-10..IN-13) ----

/**
 * Tender topics (IN-12): sex and sexual health, kids, other partners and veto,
 * marriage, past relationships and hurts, health and mental health, coming out,
 * politics. They're quoted on a loot item as things wanted, but never as "Immune
 * to" or "Unidentified", where they could read as a dig. (Phase 3's share card
 * starts these quotes unticked.)
 */
export const SENSITIVE_ITEMS: string[] = [
  "Sex with each other",
  "Sharing sexual health information",
  "Regular testing",
  "Using barriers with each other",
  "Using barriers with other partners",
  "Telling each other about new risks",
  "Knowing before things become physical",
  "Having or raising kids",
  "Having or raising kids together",
  "Either of us having kids with someone else",
  "Either of us marrying someone else",
  "Other romantic relationships",
  "Veto over each other's other relationships",
  "Co-parenting",
  "Involvement with existing children",
  "Exclusivity",
  "Talking about exclusivity soon",
  "Dating other people",
  "Still dating other people",
  "Telling each other about new interests",
  "Sharing details about dates",
  "Overnights with other partners",
  "Don't-ask-don't-tell arrangement",
  "No veto power",
  "Off-limits people or circles",
  "Nesting or primary partnership",
  "Equal footing for all partners",
  "Checking in before new relationships",
  "Advance notice of new relationships",
  "Knowing about other partners",
  "Meeting each other's partners",
  "Meeting metamours",
  "Being friendly with metamours",
  "Metamours in our home",
  "Kitchen-table style closeness",
  "Introducing others to family",
  "Bringing others to events",
  "Marriage or legal partnership",
  "Sharing past relationship history",
  "Sharing past hurts",
  "Talking about values and politics",
  "Being glad about each other's other relationships",
  "Garden-party style: friendly at gatherings",
  "Safety check-ins during dates",
  "Being out about us to family",
  "Being out about us at work",
  "Knowing each other's medications and conditions",
  "Making medical decisions for each other",
  "Care through a long illness",
  "Talking about mental health",
  "Knowing each other's triggers",
];

/** People's own items on tender topics are treated the same way (IN-12). */
export const SENSITIVE_KEYWORDS =
  /\b(sex|sexual|sexy|naked|nude|kink|fetish|bdsm|oral\b|anal\b|orgasm|porn|condom|stis?\b|stds?\b|hiv\b|prep\b|pregnan|abortion|fertil|kids?\b|child|bab(y|ies)\b|veto|affairs?\b|cheat|divorc|ex(es)?\b|trauma|abuse|therap|religio|politic|threesome|swing|polyam|open relationship|metamour|other partners?\b|medic(al|ation)|mental health|illness|triggers?\b|disabilit|coming out|out about us|outed\b)/i;

export type CharacterClass = { name: string; flavor: string };

/** A class per theme (IN-10). */
export const THEME_CLASSES: Record<Theme, CharacterClass> = {
  closeness: {
    name: "Enchanter",
    flavor: "Casts Hold Hands at will. No saving throw.",
  },
  talk: { name: "Bard", flavor: "Wields words, mostly good-morning texts." },
  space: {
    name: "Ranger",
    flavor: "Roams the wilds alone, then comes home with stories.",
  },
  roots: { name: "Paladin", flavor: "Swore an oath. Intends to keep it." },
  spotlight: {
    name: "Herald",
    flavor: "Announces you wherever you go, at volume.",
  },
  hearth: { name: "Artificer", flavor: "Built a chore wheel. It's enchanted." },
  care: { name: "Cleric", flavor: "Heals 2d6 with soup and a blanket." },
  adventure: {
    name: "Swashbuckler",
    flavor: "Never met a side quest they didn't take.",
  },
};

/** The Chameleon's class (IN-10). */
export const SHAPESHIFTER: CharacterClass = {
  name: "Shapeshifter",
  flavor: "Takes whatever form the menu needs.",
};

/** What the loot is (IN-11): by the animal's theme, or `none` for the Chameleon. */
export const LOOT_BASES: Record<Theme | "none", string[]> = {
  closeness: ["Weighted Blanket", "Cuddle Gauntlets", "Locket"],
  talk: ["Speaking Stone", "Carrier Pigeon", "Scroll"],
  space: ["Cloak", "Tower Key", "Do-Not-Disturb Sign"],
  roots: ["Ring", "Anchor", "Pebble"],
  spotlight: ["Banner", "Megaphone", "Party Hat"],
  hearth: ["Chore Wheel", "Ladle", "Ledger"],
  care: ["Healing Potion", "Hot Water Bottle", "Soup Flask"],
  adventure: ["Compass", "Boots", "Picnic Basket"],
  none: ["Mimic Chest", "Mystery Box"],
};

/** "… of X" when no Must have can be quoted (IN-11). */
export const LOOT_SUFFIXES: Record<Theme | "none", string> = {
  closeness: "Snuggles",
  talk: "Long Talks",
  space: "Alone Time",
  roots: "Forever",
  spotlight: "Grand Entrances",
  hearth: "the Hearth",
  care: "Soup and Sympathy",
  adventure: "Side Quests",
  none: "the Unknown",
};

/** The loot's first word, by style (IN-11). */
export const LOOT_PREFIXES: Record<Style, string[]> = {
  curious: ["Unidentified", "Shimmering", "Curious"],
  wholehearted: ["Unwavering", "Blazing", "Wholehearted"],
  discerning: ["Warded", "Well-Fenced", "Discerning"],
  decisive: ["Sharpened", "Unhesitating", "Decisive"],
  easygoing: ["Comfy", "Well-Worn", "Easygoing"],
};

export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;
export type Rarity = (typeof RARITIES)[number];

/** Rarity comes from how much is answered, never which answers (IN-13). */
export const RARITY_TEXT: Record<Rarity, { label: string; flavor: string }> = {
  common: {
    label: "Common",
    flavor: "Still being forged. Answer more items to upgrade it.",
  },
  uncommon: {
    label: "Uncommon",
    flavor: "Taking shape. Answer more items to upgrade it.",
  },
  rare: {
    label: "Rare",
    flavor: "Well forged. A few more answers and it gleams.",
  },
  epic: { label: "Epic", flavor: "Nearly complete. It hums faintly." },
  legendary: {
    label: "Legendary",
    flavor: "Forged from a fully answered menu.",
  },
};
