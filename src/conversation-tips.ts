/**
 * Tips for hard conversations (spec CV-13), adapted from relationship research and
 * practice: the Gottman Institute, PREP, Imago Dialogue, Nonviolent Communication,
 * Emotionally Focused Therapy, DBT interpersonal skills and consent education.
 * They are tips, not therapy: no statistics, no promises, and nothing that nudges
 * anyone away from an Off limits answer. Evidence notes: docs/spec/conversation-tips.md.
 */

export type TipStage = "before" | "opening" | "listening" | "heated" | "boundaries" | "closing" | "between";

export const TIP_STAGES: { id: TipStage; label: string }[] = [
  {
    "id": "before",
    "label": "Before you start"
  },
  {
    "id": "opening",
    "label": "Opening"
  },
  {
    "id": "listening",
    "label": "Listening"
  },
  {
    "id": "heated",
    "label": "When it gets heated"
  },
  {
    "id": "boundaries",
    "label": "Off limits and boundaries"
  },
  {
    "id": "closing",
    "label": "Closing"
  },
  {
    "id": "between",
    "label": "Between conversations"
  }
];

export type Tip = { id: string; stage: TipStage; title: string; text: string; sources: string[] };

export const TIPS: Tip[] = [
  {
    "id": "B1",
    "stage": "before",
    "title": "Check you both feel safe",
    "text": "These tips assume you both feel safe to speak freely. If you're afraid of how your partner might react, or feel pressured or controlled, skip this conversation. You can talk confidentially with a domestic abuse advocate instead.",
    "sources": [
      "S20",
      "S21"
    ]
  },
  {
    "id": "B2",
    "stage": "before",
    "title": "Pick a time, not a moment",
    "text": "Choose a calm time you both agree on, not late at night or in passing. Some couples set a regular weekly check-in so hard topics never feel like an ambush.",
    "sources": [
      "S9"
    ]
  },
  {
    "id": "B3",
    "stage": "before",
    "title": "Set a time limit and a focus",
    "text": "Agree how long you'll talk, say 30–45 minutes, and pick one or two items to start. You don't need to cover every difference at once. The menu will still be here next time.",
    "sources": [
      "S9",
      "S12"
    ]
  },
  {
    "id": "B4",
    "stage": "before",
    "title": "Agree a pause signal",
    "text": "Before you begin, agree on a word or gesture either of you can use to pause, and promise to come back. Knowing you can stop makes it easier to stay.",
    "sources": [
      "S6",
      "S12"
    ]
  },
  {
    "id": "B5",
    "stage": "before",
    "title": "Find the story behind your answer",
    "text": "Look at your Must haves and Off limits and ask yourself: what hope, value or past experience sits behind this one? Sharing that \"why\" usually lands better than the answer alone.",
    "sources": [
      "S8"
    ]
  },
  {
    "id": "O1",
    "stage": "opening",
    "title": "Start gently",
    "text": "Open with \"I\" and something specific rather than \"you always…\". Try: \"I feel ___ about ___, and I'd love ___.\" A gentle opening makes it easier for your partner to listen instead of defend.",
    "sources": [
      "S1",
      "S13"
    ]
  },
  {
    "id": "O2",
    "stage": "opening",
    "title": "Begin with common ground",
    "text": "Start with items you both marked Must have or Like to have. Naming what you share first can make the differences feel like something you're facing together.",
    "sources": [
      "S10",
      "S2"
    ]
  },
  {
    "id": "O3",
    "stage": "opening",
    "title": "Describe, don't diagnose",
    "text": "Point to what's actually there (\"You marked this Off limits\") rather than a judgment (\"You're so closed off\"). Neutral, specific words are easier to hear.",
    "sources": [
      "S17",
      "S19"
    ]
  },
  {
    "id": "O4",
    "stage": "opening",
    "title": "Feeling, need, request",
    "text": "Share a feeling, the need behind it, and one doable request: \"I feel lonely when we skip date night. I need closeness. Could we plan one evening a week?\" A request leaves room for \"no\". A demand doesn't.",
    "sources": [
      "S17",
      "S18"
    ]
  },
  {
    "id": "O5",
    "stage": "opening",
    "title": "Ask clearly for what you want",
    "text": "Describe the situation, say how you feel, ask plainly for what you'd like, and say why it would matter to you. Then stay on topic and be open to a different version of your ask.",
    "sources": [
      "S19"
    ]
  },
  {
    "id": "O6",
    "stage": "opening",
    "title": "Understand first, solve later",
    "text": "Decide together whether this talk is for understanding or for deciding. Many couples find it helps to fully hear each other first and save problem-solving for later.",
    "sources": [
      "S12",
      "S11"
    ]
  },
  {
    "id": "L1",
    "stage": "listening",
    "title": "Take turns holding the floor",
    "text": "Hold an object to show who's speaking. The listener's only job is to sum up what they heard, in their own words, until the speaker says \"yes, that's it.\" Then swap. No solving yet.",
    "sources": [
      "S11",
      "S12"
    ]
  },
  {
    "id": "L2",
    "stage": "listening",
    "title": "Mirror back",
    "text": "Repeat back what you heard, then ask: \"Did I get that? Is there more?\" Keep going until your partner feels fully heard. Mirroring isn't agreeing. It shows you were really listening.",
    "sources": [
      "S15"
    ]
  },
  {
    "id": "L3",
    "stage": "listening",
    "title": "Validate without agreeing",
    "text": "Let your partner know their view makes sense from where they stand: \"Given what you've told me, I can see why you'd want that.\" You can validate and still keep your own answer.",
    "sources": [
      "S15",
      "S19"
    ]
  },
  {
    "id": "L4",
    "stage": "listening",
    "title": "Guess the feeling, then check",
    "text": "Try naming what your partner might feel (\"I imagine you might feel nervous about this?\") and let them correct you. A guess that's a bit off, followed by a check, still shows you care.",
    "sources": [
      "S15",
      "S17"
    ]
  },
  {
    "id": "L5",
    "stage": "listening",
    "title": "Find the part you can say yes to",
    "text": "Look for some part of your partner's view you can genuinely accept, even a small one. Letting each other's perspective shape decisions tends to help both people feel respected.",
    "sources": [
      "S7"
    ]
  },
  {
    "id": "L6",
    "stage": "listening",
    "title": "Keep it gentle and interested",
    "text": "Keep your tone gentle, put the phone away, and show interest with eye contact and questions. A little lightness helps too. How you listen matters as much as what you say.",
    "sources": [
      "S19"
    ]
  },
  {
    "id": "H1",
    "stage": "heated",
    "title": "Swap the four conversation-killers",
    "text": "Watch for criticism, contempt (eye-rolls, mockery), defensiveness and shutting down. If you notice one, swap it: a gentle restart, an appreciation, owning your part, or a calming break.",
    "sources": [
      "S2"
    ]
  },
  {
    "id": "H2",
    "stage": "heated",
    "title": "Own a piece of it",
    "text": "Instead of defending, find even a small part you can own: \"You're right, I did change the subject.\" Taking some responsibility often lowers the temperature for both of you.",
    "sources": [
      "S2"
    ]
  },
  {
    "id": "H3",
    "stage": "heated",
    "title": "Offer and accept repairs",
    "text": "A joke, a touch, \"Can we start over?\" or \"I'm getting defensive\" are all ways to repair. When your partner offers one, try to take it, even if it's clumsy.",
    "sources": [
      "S3",
      "S4"
    ]
  },
  {
    "id": "H4",
    "stage": "heated",
    "title": "Take a real break when flooded",
    "text": "If your heart is racing or you can't think straight, say \"I'm overwhelmed, I need a break\" and agree when you'll come back. Take at least 20 minutes doing something calming, not replaying the argument.",
    "sources": [
      "S6"
    ]
  },
  {
    "id": "H5",
    "stage": "heated",
    "title": "Name the loop, not the villain",
    "text": "If one of you pushes to keep talking and the other pulls away, that's a very common loop, not a character flaw. Try naming it together: \"We're in our chase-and-retreat pattern again.\"",
    "sources": [
      "S22",
      "S27"
    ]
  },
  {
    "id": "H6",
    "stage": "heated",
    "title": "Share the softer feeling",
    "text": "Under anger there's often worry, hurt or fear of losing each other. Try saying that softer part out loud: \"I get loud because I'm scared this matters less to you.\"",
    "sources": [
      "S22"
    ]
  },
  {
    "id": "H7",
    "stage": "heated",
    "title": "Some differences are for keeping",
    "text": "Many differences between partners never fully go away, and that's normal. The goal can be understanding each other and finding a way to live with it, not deciding who's right.",
    "sources": [
      "S5"
    ]
  },
  {
    "id": "H8",
    "stage": "heated",
    "title": "Get curious about the dream",
    "text": "When you're stuck, swap persuading for curiosity: \"What does this mean to you? Is there a story behind it? What would your ideal look like?\" Don't try to solve it yet.",
    "sources": [
      "S8"
    ]
  },
  {
    "id": "X1",
    "stage": "boundaries",
    "title": "\"No\" is a complete answer",
    "text": "An Off limits answer doesn't need a reason or a defense. You can gently ask if they'd like to share more, but it's completely fine if they don't.",
    "sources": [
      "S29"
    ]
  },
  {
    "id": "X2",
    "stage": "boundaries",
    "title": "Don't negotiate a no",
    "text": "This isn't the place to talk someone out of an Off limits. Repeated asking, bargaining or guilt turns a \"yes\" into something that isn't freely given.",
    "sources": [
      "S29"
    ]
  },
  {
    "id": "X3",
    "stage": "boundaries",
    "title": "Answers can change, both ways",
    "text": "Anyone can change an answer at any time, including from yes to no. Saying yes to one thing doesn't mean yes to anything related.",
    "sources": [
      "S29"
    ]
  },
  {
    "id": "X4",
    "stage": "boundaries",
    "title": "Thank them for their honesty",
    "text": "Hearing a no can sting. Try \"Thanks for telling me\" before anything else. Honest limits are what make the yeses trustworthy.",
    "sources": [
      "S29",
      "S19"
    ]
  },
  {
    "id": "X5",
    "stage": "boundaries",
    "title": "When a Must have meets an Off limits",
    "text": "If something you need is off limits for your partner, that's important to know, not a failure. Talk about what each of you can live with. Some differences need outside support or more time.",
    "sources": [
      "S5"
    ]
  },
  {
    "id": "X6",
    "stage": "boundaries",
    "title": "When \"no\" doesn't feel safe",
    "text": "If saying no to your partner feels scary, or a no has led to threats, punishment or pressure, that's not a communication problem. You can get confidential support any time.",
    "sources": [
      "S20",
      "S21"
    ]
  },
  {
    "id": "C1",
    "stage": "closing",
    "title": "Sum up together",
    "text": "Before you finish, each say one thing you heard and any small next step you agreed. \"We understand each other better and we'll come back to this\" is a fine ending.",
    "sources": [
      "S12"
    ]
  },
  {
    "id": "C2",
    "stage": "closing",
    "title": "End with appreciations",
    "text": "Each name something you appreciated, about the conversation or each other. Specific beats general: \"I appreciated you staying with it when it got hard.\"",
    "sources": [
      "S9",
      "S2"
    ]
  },
  {
    "id": "C3",
    "stage": "closing",
    "title": "One thing for this week",
    "text": "Ask each other: \"What's one small thing I could do this week that would help you feel closer?\" Keep it doable.",
    "sources": [
      "S9"
    ]
  },
  {
    "id": "C4",
    "stage": "closing",
    "title": "Leave it unfinished if needed",
    "text": "If you didn't get through everything, that's okay. Agree when you'll pick it up again rather than pushing on while tired.",
    "sources": [
      "S6",
      "S9"
    ]
  },
  {
    "id": "A1",
    "stage": "between",
    "title": "Keep up the small positives",
    "text": "Everyday thanks, interest and affection build a cushion for hard talks. Couples who stay together tend to have far more warm moments than negative ones, even when they disagree.",
    "sources": [
      "S10",
      "S14"
    ]
  },
  {
    "id": "A2",
    "stage": "between",
    "title": "Come back to a talk that went badly",
    "text": "If a conversation went wrong, revisit it once you're calm: \"Can we talk about how that went?\" Share what each of you felt, without re-arguing the topic.",
    "sources": [
      "S3"
    ]
  },
  {
    "id": "A3",
    "stage": "between",
    "title": "Check in regularly",
    "text": "A short weekly check-in, starting with what's going well, makes it easier to raise things early before they grow.",
    "sources": [
      "S9"
    ]
  },
  {
    "id": "A4",
    "stage": "between",
    "title": "Revisit the menu",
    "text": "Your answers can change as you do. Agree to look at the menu again in a few months, and treat changed answers with curiosity rather than suspicion.",
    "sources": [
      "S29",
      "S5"
    ]
  },
  {
    "id": "A5",
    "stage": "between",
    "title": "Know when to get more support",
    "text": "If the same topic keeps ending in hurt, or one of you dreads these talks, a qualified couples counsellor or a relationship-education course can help. This app isn't a substitute for that.",
    "sources": [
      "S12",
      "S23",
      "S28"
    ]
  }
];

/** Where each tip comes from ("adapted from"). */
export const TIP_SOURCES: Record<string, { label: string; url: string }> = {
  "S1": {
    "label": "Gottman Institute. \"Softening Startup.\" gottman.com blog",
    "url": "https://www.gottman.com/blog/softening-startup/"
  },
  "S2": {
    "label": "Lisitsa, E. / Gottman Institute. \"The Four Horsemen: The Antidotes.\" gottman.com blog",
    "url": "https://www.gottman.com/blog/the-four-horsemen-the-antidotes/"
  },
  "S3": {
    "label": "Gottman Institute. \"Repair Attempts.\" gottman.com blog",
    "url": "https://www.gottman.com/blog/repair-attempts/"
  },
  "S4": {
    "label": "Gottman Institute. \"Research FAQ\" (defines a repair attempt)",
    "url": "https://www.gottman.com/about/research/faq/"
  },
  "S5": {
    "label": "Gottman Institute. \"Managing Conflict: Solvable vs. Perpetual Problems.\"",
    "url": "https://www.gottman.com/blog/managing-conflict-solvable-vs-perpetual-problems/"
  },
  "S6": {
    "label": "Gottman Institute. \"How to Practice Self-Soothing\" (flooding; at least 20-minute break)",
    "url": "https://www.gottman.com/blog/how-to-practice-self-soothing/"
  },
  "S7": {
    "label": "Gottman, J. M., Coan, J., Carrère, S., & Swanson, C. (1998). Predicting marital happiness and stability from newlywed interactions. Journal of Marriage and the Family, 60(1), 5–22. doi:10.2307/353438",
    "url": "https://www.gottman.com/blog/managing-conflict-accepting-influence/"
  },
  "S8": {
    "label": "Gottman Institute. \"Overcoming Gridlocked Conflict\" (dreams within conflict)",
    "url": "https://www.gottman.com/blog/overcoming-gridlocked-conflict/"
  },
  "S9": {
    "label": "Gottman Institute. \"How to Have a State of the Union Meeting.\"",
    "url": "https://www.gottman.com/blog/how-to-have-a-state-of-the-union-meeting/"
  },
  "S10": {
    "label": "Benson, K. / Gottman Institute. \"The Magic Relationship Ratio, According to Science.\"",
    "url": "https://www.gottman.com/blog/the-magic-relationship-ratio-according-science/"
  },
  "S11": {
    "label": "Markman, H. J., Stanley, S. M., & Blumberg, S. L. (2010). Fighting for Your Marriage (3rd ed.). Jossey-Bass/Wiley. The 4th edition (2024) adds Rhoades, G. & Levine, J",
    "url": "https://www.du.edu/news/research-backed-ways-save-your-marriage-and-avoid-divorce"
  },
  "S12": {
    "label": "PREP Inc. \"Our Research.\"",
    "url": "https://prepinc.com/pages/our-research"
  },
  "S13": {
    "label": "Carrère, S., & Gottman, J. M. (1999). Predicting divorce among newlyweds from the first three minutes of a marital conflict discussion. Family Process, 38(3), 293–301",
    "url": "https://pubmed.ncbi.nlm.nih.gov/10526767/"
  },
  "S14": {
    "label": "Gottman, J. M., & Levenson, R. W. (1992). Marital processes predictive of later dissolution: Behavior, physiology, and health. Journal of Personality and Social Psychology, 63(2), 221–233",
    "url": "https://pubmed.ncbi.nlm.nih.gov/1403613/"
  },
  "S15": {
    "label": "Hendrix, H., & Hunt, H. L. \"The Way We Talk and the Way We Listen Changes Everything.\" harvilleandhelen.com (official site)",
    "url": "https://harvilleandhelen.com/relationships/the-way-we-talk-and-the-way-we-listen-changes-everything/"
  },
  "S17": {
    "label": "Center for Nonviolent Communication. \"Introduction to NVC (NVC 101).\"",
    "url": "https://www.cnvc.org/learn/nvc-101"
  },
  "S18": {
    "label": "Evidence: \"Non-violent communication as a technology in interpersonal relationships in health work: a scoping review\" (2024). BMC Health Services Research",
    "url": "https://link.springer.com/article/10.1186/s12913-024-10753-2"
  },
  "S19": {
    "label": "Linehan, M. M. (2014). DBT Skills Training Handouts and Worksheets (2nd ed.). Guilford Press (Interpersonal Effectiveness: DEAR MAN, GIVE, FAST)",
    "url": "https://guilford.com/books/DBT-Skills-Training-Handouts-and-Worksheets/Marsha-Linehan/9781572307810/contents"
  },
  "S20": {
    "label": "National Domestic Violence Hotline: why couples counselling isn't advised with an abusive partner",
    "url": "https://www.thehotline.org/"
  },
  "S21": {
    "label": "National Domestic Violence Hotline. \"Can I Save Them?\" (does not recommend couples counselling in abusive relationships)",
    "url": "https://www.thehotline.org/resources/can-i-save-them/"
  },
  "S22": {
    "label": "Johnson, S. (2008). Hold Me Tight: Seven Conversations for a Lifetime of Love. Little, Brown Spark (Hachette)",
    "url": "https://www.hachettebookgroup.com/titles/sue-johnson-edd/hold-me-tight/9780316113007/"
  },
  "S23": {
    "label": "Wiebe, S. A., & Johnson, S. M. (2016). A review of the research in Emotionally Focused Therapy for couples. Family Process, 55(3), 390–407",
    "url": "https://pubmed.ncbi.nlm.nih.gov/27273169/"
  },
  "S27": {
    "label": "Christensen, A., & Heavey, C. L. (1990). Gender and social structure in the demand/withdraw pattern of marital conflict. Journal of Personality and Social Psychology, 59(1), 73–81",
    "url": "https://doi.org/10.1037/0022-3514.59.1.73"
  },
  "S28": {
    "label": "Conradi, H. J., et al. (2018). Effectiveness of the \"Hold me Tight\" relationship enhancement program in a self-referred and a clinician-referred sample. Family Process",
    "url": "https://pubmed.ncbi.nlm.nih.gov/28870000/"
  },
  "S29": {
    "label": "Planned Parenthood. \"Sexual Consent\" (FRIES: Freely given, Reversible, Informed, Enthusiastic, Specific)",
    "url": "https://www.plannedparenthood.org/learn/relationships/sexual-consent"
  }
};

/** Tips that fit each kind of topic, shown on its card (CV-13). */
const FOR_KIND: Record<"celebrate" | "explore" | "conflict" | "check-in", string[]> = {
  celebrate: ["O2", "C2", "L6", "A1"],
  explore: ["L2", "L3", "H8", "L5", "O4", "L4"],
  conflict: ["X1", "X2", "X4", "X5", "H4", "H6"],
  "check-in": ["X3", "B5", "O6"],
};

const byId = new Map(TIPS.map((t) => [t.id, t]));

/** One tip for a topic, chosen by its key so it stays the same each visit. */
export const tipFor = (kind: keyof typeof FOR_KIND, key: string): Tip => {
  const ids = FOR_KIND[kind];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return byId.get(ids[h % ids.length])!;
};

export const tipsIn = (stage: TipStage) => TIPS.filter((t) => t.stage === stage);
