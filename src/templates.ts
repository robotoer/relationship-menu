/**
 * Starting points for new menus: whole template menus and single ready-made groups.
 *
 * The wording is original. The topics follow those commonly covered by published
 * relationship menus, especially the Relationship Anarchy Smorgasbord (Lyrica Lawrence
 * and Heather Orr, Vancouver Polyamory, 2016), "non-escalator" relationship menus, and
 * Amy Gahran's "Stepping Off the Relationship Escalator" (2017). No source's list is
 * reproduced. Items are deliberately non-explicit.
 */

import { RelationshipMenu } from "./model/menu";

export type MenuTemplate = {
  id: string;
  name: string;
  description: string;
  groups: { [group: string]: string[] };
};

export type GroupTemplate = { name: string; items: string[] };

// Groups used both in a template and in the ready-made group picker, so the two
// never drift apart.

/**
 * A ladder: each step is its own item, so each person can mark what's too little,
 * what's right and what's too much, and a comparison shows where the ranges overlap.
 */
const HOW_OFTEN = [
  "Seeing each other once a week or less",
  "Seeing each other 2–3 days a week",
  "Seeing each other 4–5 days a week",
  "Seeing each other most days",
  "Some weekends together",
  "Most weekends together",
  "Every weekend together",
];

const PRIORITIES = [
  "Birthdays together",
  "Some holidays together",
  "Most holidays together",
  "Being each other's plus-one",
  "First pick as plus-one",
  "Coming first when plans clash",
];

const INDEPENDENCE = [
  "Plenty of time apart",
  "Separate friendships",
  "Pursuing our own interests",
  "Equal say in the relationship",
  "Sharing our locations",
  // Items are answered by both people and compared by their text, so each one names
  // an arrangement that applies to both of us. A "me" / "my partner" pair would
  // compare each row only with itself and could show agreement where there is none.
  "Veto over each other's other relationships",
];

const HEALTH_AND_EMERGENCIES = [
  "Knowing each other's medications and conditions",
  "Making medical decisions for each other",
  "Care through a long illness",
  "Being named in each other's will",
  "Power of attorney for each other",
];

export const MENU_TEMPLATES: MenuTemplate[] = [
  {
    id: "romantic-starter",
    name: "Romantic Relationship Starter",
    description:
      "A broad starting point for any romantic couple who wants to talk through expectations.",
    groups: {
      Communication: [
        "Daily check-in messages",
        "Weekly relationship check-in",
        "Talking through conflict same day",
        "Sharing feelings openly",
        "Calling each other pet names",
      ],
      "Affection & intimacy": [
        "Holding hands",
        "Kissing",
        "Cuddling",
        "Sex with each other",
        "Sleeping over",
        "Sharing sexual health information",
      ],
      "Time together": [
        "Regular date nights",
        "Traveling together",
        "Shared hobbies",
        "Spending holidays together",
        "Time alone respected",
      ],
      "Social life": [
        "Meeting each other's friends",
        "Meeting each other's family",
        "Public displays of affection",
        "Posting about us online",
        "Attending events as a couple",
      ],
      "Support & care": [
        "Emotional support in hard times",
        "Caring for each other when sick",
        "Celebrating each other's wins",
        "Being an emergency contact",
      ],
      Future: [
        "Exclusivity",
        "Living together",
        "Marriage or legal partnership",
        "Having or raising kids",
        "Making long-term plans together",
      ],
    },
  },
  {
    id: "relationship-anarchy-smorgasbord",
    name: "Relationship Anarchy Smorgasbord",
    description:
      "For people who want to build any relationship, romantic or not, from individual pieces instead of preset labels.",
    groups: {
      Communication: [
        "Frequent texting",
        "Regular phone or video calls",
        "Sharing day-to-day details",
        "Discussing our relationship openly",
        "Giving honest feedback",
      ],
      "Emotional connection": [
        "Being vulnerable with each other",
        "Saying 'I love you'",
        "Sharing hopes and fears",
        "Being a go-to support person",
        "Prioritising each other emotionally",
      ],
      "Physical connection": [
        "Hugging",
        "Holding hands",
        "Cuddling",
        "Kissing",
        "Massage",
        "Dancing together",
        "Sex with each other",
        "Sleeping in the same bed",
        "Sharing a bed without touching",
      ],
      Romance: [
        "Flirting",
        "Romantic dates",
        "Giving gifts",
        "Calling it romantic",
      ],
      "Practical life": [
        "Sharing a home",
        "Sharing finances",
        "Running errands for each other",
        "Helping with chores",
        "Caring for each other's pets",
        "Sharing our locations",
      ],
      "Social & identity": [
        "Using a relationship label",
        "Being introduced as partners",
        "Public affection",
        "Being included in family events",
        "Being publicly known as connected",
      ],
      Commitment: [
        "Planning far into the future",
        "Making decisions together",
        "Legal or financial ties",
        "A non-legal commitment ceremony",
        "Co-parenting",
        "Prioritising this relationship",
      ],
    },
  },
  {
    id: "polyamory-agreements",
    name: "Polyamory & Open Agreements",
    description:
      "For partners in, or moving toward, polyamorous or open relationships who want to agree on how other connections fit in.",
    groups: {
      Structure: [
        "Kitchen-table style closeness",
        "Garden-party style: friendly at gatherings",
        "Parallel style: little contact with metamours",
        "Don't-ask-don't-tell arrangement",
        "Nesting or primary partnership",
        "Equal footing for all partners",
      ],
      Disclosure: [
        "Telling each other about new interests",
        "Sharing details about dates",
        "Knowing before things become physical",
        "Sharing relationship changes promptly",
        "Safety check-ins during dates",
      ],
      Metamours: [
        "Meeting each other's partners",
        "Being friendly with metamours",
        "Talking directly with metamours",
        "Spending group time together",
        "Metamours in our home",
        "Being glad about each other's other relationships",
      ],
      "Scheduling & time": [
        "Shared calendar",
        "Protected time just for us",
        "Advance notice of plans",
        "Overnights with other partners",
        "Holidays split fairly",
      ],
      "Safer sex & health": [
        "Sharing sexual health information",
        "Regular testing",
        "Using barriers with each other",
        "Using barriers with other partners",
        "Telling each other about new risks",
      ],
      "Boundaries & veto": [
        "No veto power",
        "Checking in before new relationships",
        "Off-limits people or circles",
        "Revisiting agreements regularly",
      ],
      "Being out & included": [
        "Introducing others to family",
        "Bringing others to events",
        "Being openly polyamorous with friends",
        "Being openly polyamorous with family",
        "Being openly polyamorous at work",
      ],
    },
  },
  {
    id: "off-the-escalator",
    name: "Off the Escalator",
    description:
      "For partners who want to choose each step of a relationship on its own, instead of following the usual order of milestones.",
    groups: {
      "Milestones, one at a time": [
        "Using a relationship label",
        "Exclusivity",
        "Living together",
        "Merging finances",
        "Marriage or legal partnership",
        "A non-legal commitment ceremony",
        "Having or raising kids together",
      ],
      "How often we see each other": HOW_OFTEN,
      "Priorities & occasions": PRIORITIES,
      Independence: INDEPENDENCE,
      "Other relationships": [
        "Other romantic relationships",
        "Either of us marrying someone else",
        "Either of us having kids with someone else",
      ],
      "Health & emergencies": HEALTH_AND_EMERGENCIES,
    },
  },
  {
    id: "close-friendship",
    name: "Close Friendship",
    description:
      "For friends who want to name what they value and expect from a close platonic friendship.",
    groups: {
      "Staying in touch": [
        "Texting most days",
        "Regular calls",
        "Meeting up every week",
        "Okay to go quiet sometimes",
        "Remembering important dates",
      ],
      "Emotional support": [
        "Venting without fixing",
        "Honest advice when asked",
        "Being called in a crisis",
        "Talking about deep topics",
        "Checking in when things are hard",
      ],
      "Time together": [
        "Regular hangouts",
        "Trying new things together",
        "Traveling together",
        "Celebrating holidays together",
        "Including each other in group plans",
      ],
      "Physical closeness": [
        "Hugging",
        "Sitting close or cuddling",
        "Sharing a bed when traveling",
        "Physical touch while talking",
      ],
      "Practical help": [
        "Help moving house",
        "Borrowing and lending money",
        "Pet or plant sitting",
        "Rides to appointments",
        "Being an emergency contact",
      ],
      "Commitment & boundaries": [
        "Calling ourselves best friends",
        "Prioritising the friendship",
        "Keeping secrets private",
        "Discussing friendship conflicts openly",
        "Living together someday",
      ],
    },
  },
  {
    id: "early-dating",
    name: "Early Dating",
    description:
      "For people in the first weeks or months of dating who want to align on pace and expectations.",
    groups: {
      "Communication cadence": [
        "Texting every day",
        "Good morning or night messages",
        "Calling instead of texting",
        "Replying within a few hours",
        "Planning the next date in advance",
      ],
      Pace: [
        "Taking things slowly",
        "Seeing each other weekly",
        "Sleeping over",
        "Sex with each other",
        "Kissing",
        "Saying how we feel early",
      ],
      Exclusivity: [
        "Talking about exclusivity soon",
        "Still dating other people",
        "Deleting dating apps",
        "Defining the relationship",
      ],
      "Social circles": [
        "Meeting friends soon",
        "Meeting family",
        "Posting about each other online",
        "Public affection",
      ],
      "Getting to know each other": [
        "Sharing past relationship history",
        "Discussing long-term goals",
        "Sharing sexual health information",
        "Talking about values and politics",
      ],
    },
  },
  {
    id: "co-living-partnership",
    name: "Co-living & Practical Partnership",
    description:
      "For partners or housemates sharing a home who want to divide life admin fairly.",
    groups: {
      Finances: [
        "Joint bank account",
        "Splitting bills evenly",
        "Splitting by income",
        "Shared savings goals",
        "Checking before big purchases",
      ],
      Chores: [
        "Fixed chore schedule",
        "Shared cooking",
        "Hiring cleaning help",
        "Equal share of mental load",
      ],
      "Space & privacy": [
        "Separate bedrooms",
        "Dedicated personal space",
        "Quiet hours",
        "Knocking before entering",
      ],
      Guests: [
        "Overnight guests",
        "Notice before visitors",
        "Hosting gatherings at home",
        "Family staying with us",
      ],
      "Pets & plants": [
        "Having pets",
        "Shared pet care",
        "Pets on the furniture",
        "Shared plant care",
      ],
      "Holidays & traditions": [
        "Alternating family holidays",
        "Creating our own traditions",
        "Hosting holidays",
        "Gift-giving budget",
      ],
    },
  },
];

export const GROUP_TEMPLATES: GroupTemplate[] = [
  {
    name: "Communication",
    items: [
      "Daily check-in messages",
      "Weekly relationship check-in",
      "Preferred way to resolve conflict",
      "Sharing feelings openly",
      "Giving honest feedback",
    ],
  },
  {
    name: "Physical affection",
    items: [
      "Hugging",
      "Holding hands",
      "Cuddling",
      "Kissing",
      "Sex with each other",
      "Sleeping over",
      "Sharing sexual health information",
    ],
  },
  {
    name: "Living arrangements",
    items: [
      "Living together",
      "Separate homes",
      "Keys to each other's places",
      "Sleeping in the same bed",
      "Moving cities together",
    ],
  },
  {
    name: "Finances",
    items: [
      "Sharing expenses",
      "Joint accounts",
      "Lending money",
      "Paying for dates",
      "Shared financial goals",
    ],
  },
  {
    name: "Family & kids",
    items: [
      "Meeting family",
      "Attending family events",
      "Having or raising kids",
      "Co-parenting",
      "Involvement with existing children",
    ],
  },
  {
    name: "Social life & public",
    items: [
      "Meeting friends",
      "Public displays of affection",
      "Posting together online",
      "Using a relationship label",
      "Bringing each other to events",
      "Being out about us to family",
      "Being out about us at work",
    ],
  },
  {
    name: "Time together & apart",
    items: [
      "Regular date nights",
      "Traveling together",
      "Shared hobbies",
      "Protected alone time",
      "Spending holidays together",
    ],
  },
  { name: "How often we see each other", items: HOW_OFTEN },
  { name: "Priorities & occasions", items: PRIORITIES },
  { name: "Independence", items: INDEPENDENCE },
  {
    name: "Other partners",
    items: [
      "Exclusivity",
      "Dating other people",
      "Knowing about other partners",
      "Meeting metamours",
      "Advance notice of new relationships",
    ],
  },
  {
    name: "Support & care",
    items: [
      "Emotional support in hard times",
      "Caring when sick",
      "Being an emergency contact",
      "Help with practical tasks",
      "Celebrating each other's wins",
    ],
  },
  {
    name: "Emotional health",
    items: [
      "Talking about mental health",
      "Supporting each other's therapy",
      "Knowing each other's triggers",
      "Sharing past hurts",
      "Adapting to each other's communication needs",
      "Talking about love languages",
    ],
  },
  { name: "Health & emergencies", items: HEALTH_AND_EMERGENCIES },
  {
    name: "Future & commitment",
    items: [
      "Long-term plans",
      "Marriage or legal partnership",
      "Shared big decisions",
      "Growing old together",
      "Revisiting this menu regularly",
    ],
  },
  {
    name: "Romance",
    items: [
      "Flirting",
      "Romantic gestures",
      "Gifts",
      "Anniversaries",
      "Pet names",
    ],
  },
  {
    name: "Household & chores",
    items: [
      "Shared cooking",
      "Cleaning schedule",
      "Pet care",
      "Running errands for each other",
    ],
  },
];

/** A template as an (unanswered) menu. */
export const templateMenu = (template: MenuTemplate): RelationshipMenu => {
  const menu: RelationshipMenu = Object.create(null);
  for (const [group, items] of Object.entries(template.groups)) {
    menu[group] = items.map((item) => ({ item }));
  }
  return menu;
};

/** Total number of items in a template. */
export const templateItemCount = (template: MenuTemplate) =>
  Object.values(template.groups).reduce((n, items) => n + items.length, 0);
