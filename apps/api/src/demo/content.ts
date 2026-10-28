/**
 * Demo interviews: plans, transcripts and feedback written by hand so a fresh install
 * shows what a finished interview looks like. Every company and person is fictional.
 */
import type { AnswerFeedback, PlanRound, TranscriptLine } from "@open-conversation/types";

export interface DemoAnswer {
  round: number;
  question: number;
  transcript?: TranscriptLine[];
  code?: string;
  language?: string;
  domain: number;
  communication: number;
  feedback: AnswerFeedback;
}

export interface DemoInterview {
  title: string;
  source: "RESUME" | "JOB_DESCRIPTION";
  company: string | null;
  role: string;
  domain: string;
  summary: string;
  jobDescription?: string;
  daysAgo: number;
  status: "READY" | "IN_PROGRESS" | "COMPLETED";
  proctoring: boolean;
  plan: PlanRound[];
  answers: DemoAnswer[];
  /** Minutes of live voice per answered question. */
  minutesPerQuestion: number;
  share?: boolean;
}

const fb = (analysis: string, strengths: string[], weaknesses: string[], suggestions: string[], correctedSnippet: string | null = null): AnswerFeedback => ({ analysis, strengths, weaknesses, suggestions, correctedSnippet });

const BACKEND_PLAN: PlanRound[] = [
  {
    name: "Introduction & Background",
    focus: "Communication and motivation",
    description: "How clearly the candidate tells their story and why this role fits it. Judged on structure and relevance to the resume.",
    questions: [
      { text: "Please introduce yourself and walk me through your background, from your first engineering role to the payments platform work at Fernhill.", code: false, language: null },
      { text: "You moved from a frontend team to backend infrastructure in 2023. What drew you to that move, and what was hardest about it?", code: false, language: null },
      { text: "What kind of engineering team do you do your best work in?", code: false, language: null },
    ],
  },
  {
    name: "Node & Distributed Systems",
    focus: "Depth in the stack on the resume",
    description: "Hands-on depth in Node.js services, queues and Postgres. Judged on accuracy, trade-offs and real examples from the candidate's projects.",
    questions: [
      { text: "At Fernhill you rebuilt the payout pipeline on BullMQ. How did you make a payout job safe to run twice?", code: false, language: null },
      { text: "Your resume mentions cutting p95 latency of the ledger API from 900 ms to 180 ms. Walk me through how you found and fixed the bottleneck.", code: false, language: null },
      { text: "How would you design a rate limiter that is shared by twenty API instances, and what happens when Redis is down?", code: false, language: null },
    ],
  },
  {
    name: "Coding & Problem-Solving",
    focus: "Implementation ability",
    description: "Correct, readable code under time pressure. Judged on correctness, complexity, edge cases and naming.",
    questions: [
      {
        text: "Problem: Given a list of payout events, each { id, accountId, amountCents, createdAt }, return the total amount per account for events in the last 24 hours, ignoring duplicate ids. Input: an array of events and the current time. Output: an object mapping accountId to total cents. Hints: Use a Set to skip duplicates. Consider events exactly 24 hours old. Sample: totals([{ id: 'a', accountId: 'x', amountCents: 500, createdAt: now - 1000 }], now) returns { x: 500 }. Write your solution in TypeScript.",
        code: true,
        language: "typescript",
      },
      {
        text: "Problem: Implement a function that merges overlapping time ranges, each [startMinute, endMinute], and returns them sorted. Hints: Sort by start first. Touching ranges ([1,3] and [3,5]) should merge. Sample: merge([[5,8],[1,3],[2,4]]) returns [[1,4],[5,8]]. Write your solution in TypeScript.",
        code: true,
        language: "typescript",
      },
    ],
  },
  {
    name: "Leadership & Teamwork",
    focus: "Behaviour in real situations",
    description: "Ownership, conflict and influence without authority. Judged on specific stories with a clear situation, action and result.",
    questions: [
      { text: "Tell me about a time an incident you were on call for went badly. What did you do in the first hour, and what changed afterwards?", code: false, language: null },
      { text: "Describe a technical disagreement with a senior engineer at Fernhill. How was it resolved?", code: false, language: null },
    ],
  },
  {
    name: "Goals & Culture Fit",
    focus: "Motivation and expectations",
    description: "Where the candidate wants to grow and what they need from the next team.",
    questions: [
      { text: "Where do you want to be in two years, and how does this role get you there?", code: false, language: null },
      { text: "What questions do you have for me about the team?", code: false, language: null },
    ],
  },
];

const PM_PLAN: PlanRound[] = [
  {
    name: "Introduction & Motivation",
    focus: "Story and fit with Example Labs",
    description: "Why this candidate, why this company, why now.",
    questions: [
      { text: "Please introduce yourself and tell me why the Senior Product Manager role on the Example Labs analytics team caught your attention.", code: false, language: null },
      { text: "What do you know about how Example Labs customers use dashboards today, and what would you want to learn first?", code: false, language: null },
    ],
  },
  {
    name: "Product Sense & Analytics",
    focus: "Judgement on the job's core responsibilities",
    description: "Prioritisation, metrics and discovery for a self-serve analytics product, as the job description asks.",
    questions: [
      { text: "The job description says activation for new workspaces is flat. How would you find out why, and what would you measure?", code: false, language: null },
      { text: "You have engineering time for one of: scheduled reports, a SQL editor, or Slack alerts. How do you decide?", code: false, language: null },
      { text: "How would you define success for the first version of anomaly alerts?", code: false, language: null },
    ],
  },
  {
    name: "Stakeholders & Delivery",
    focus: "Working across teams",
    description: "Influencing sales, design and engineering; shipping on time.",
    questions: [
      { text: "Tell me about a time sales promised a feature that was not on your roadmap. What did you do?", code: false, language: null },
      { text: "How do you keep a launch on track when design and engineering disagree on scope?", code: false, language: null },
    ],
  },
];

const t = (pairs: [string, string][]): TranscriptLine[] => pairs.map(([r, text]) => ({ role: r === "i" ? "interviewer" : "candidate", text }));

export const MAIN_INTERVIEWS: DemoInterview[] = [
  {
    title: "Senior Backend Engineer interview",
    source: "RESUME",
    company: null,
    role: "Senior Backend Engineer",
    domain: "Software Engineering",
    summary: "Backend engineer with six years of experience, the last three on payments infrastructure at Fernhill: Node.js and TypeScript services, BullMQ queues and Postgres. Moved from frontend to backend in 2023, led the payout pipeline rebuild and a ledger API latency project. Looking for a senior role with more system design ownership.",
    daysAgo: 2,
    status: "COMPLETED",
    proctoring: true,
    plan: BACKEND_PLAN,
    minutesPerQuestion: 3,
    share: true,
    answers: [
      {
        round: 0,
        question: 0,
        transcript: t([
          ["i", "Hi, I'm Avani. Let's begin. Please introduce yourself and walk me through your background, from your first engineering role to the payments platform work at Fernhill."],
          ["c", "Sure. I started as a frontend developer at a small agency, building React dashboards for logistics clients. After two years I joined Fernhill on the web team, and in 2023 I moved to the payments infrastructure team, where I've spent the last three years on payouts and the ledger."],
          ["i", "What does the payments infrastructure team own, day to day?"],
          ["c", "Everything between a merchant's balance and money actually leaving: the payout scheduler, the ledger API, and the reconciliation jobs that compare our books with the bank files every night."],
          ["i", "Great, thank you. Let's move on."],
        ]),
        domain: 82,
        communication: 88,
        feedback: fb(
          "A clear, chronological introduction that ties each step to the role. The candidate named concrete systems (payout scheduler, ledger API, reconciliation) without drifting into detail, which makes the follow-ups easy.\n\nIt could land harder with one number or outcome per stage.",
          ["Chronological and easy to follow", "Named the systems they own", "Kept it under two minutes"],
          ["No measurable outcomes in the story", "Did not say why they joined Fernhill"],
          ["Add one result per role (for example the latency win)", "Close with one sentence on why this role is the next step"],
        ),
      },
      {
        round: 0,
        question: 1,
        transcript: t([
          ["i", "You moved from a frontend team to backend infrastructure in 2023. What drew you to that move, and what was hardest about it?"],
          ["c", "I kept getting pulled into incidents where the frontend was fine and the problem was a queue backing up. I wanted to fix those. The hardest part was on-call: suddenly an alert at 3 a.m. was about real money."],
          ["i", "How did you get comfortable with that?"],
          ["c", "I shadowed two rotations, wrote runbooks for every alert I didn't understand, and paired with the team lead on the first few incidents."],
        ]),
        domain: 78,
        communication: 84,
        feedback: fb(
          "A believable motivation grounded in real incidents, and a practical answer about ramping up on call. Writing runbooks for unfamiliar alerts is a strong signal of ownership.",
          ["Motivation came from real problems", "Concrete ramp-up steps", "Honest about the hard part"],
          ["Could say what they learned technically, not only process"],
          ["Mention one backend concept that surprised you and how you learned it"],
        ),
      },
      {
        round: 0,
        question: 2,
        transcript: t([
          ["i", "What kind of engineering team do you do your best work in?"],
          ["c", "Small teams with clear ownership and written design reviews. I like when decisions are written down so new people can see why."],
        ]),
        domain: 70,
        communication: 80,
        feedback: fb("Short and specific. Written design reviews is a good, concrete preference. A brief example of a team that did this well would make it memorable.", ["Specific preference", "Values documentation"], ["Very short", "No example"], ["Give one example of a team practice you introduced or loved"]),
      },
      {
        round: 1,
        question: 0,
        transcript: t([
          ["i", "At Fernhill you rebuilt the payout pipeline on BullMQ. How did you make a payout job safe to run twice?"],
          ["c", "Each payout has an idempotency key derived from the payout id. The job first takes a row lock on the payout, checks its status, and only calls the bank if it is still pending. The bank call carries the same key, so even if we crash after the call, a retry gets the original result instead of a second transfer."],
          ["i", "What if the bank times out and you don't know whether the transfer happened?"],
          ["c", "We mark it as unknown and a reconciliation job asks the bank for the transfer by key before anything else is retried. We never blind-retry an unknown."],
          ["i", "Very good. Thank you."],
        ]),
        domain: 91,
        communication: 87,
        feedback: fb(
          "Excellent answer: idempotency key end to end, a row lock with a status check, and the critical insight that an unknown outcome must be reconciled, not retried. This is exactly the reasoning the round looks for.",
          ["Idempotency key passed to the bank", "Handles the unknown-outcome case", "Clear sequence of steps"],
          ["Did not mention how keys expire on the bank side"],
          ["Mention key retention windows and what happens after they expire"],
        ),
      },
      {
        round: 1,
        question: 1,
        transcript: t([
          ["i", "Your resume mentions cutting p95 latency of the ledger API from 900 ms to 180 ms. Walk me through how you found and fixed the bottleneck."],
          ["c", "Tracing showed most of the time in one query that summed entries per account. It was doing a sequential scan. I added a covering index on account id and created at, and moved the running balance into a summary table updated in the same transaction as each entry."],
          ["i", "How did you keep the summary table correct?"],
          ["c", "Same transaction, and a nightly job that recomputes a sample of balances and alerts on any mismatch."],
        ]),
        domain: 86,
        communication: 82,
        feedback: fb(
          "Good diagnosis story: tracing, the specific query, and two fixes with clear trade-offs. The nightly verification job shows care for correctness.",
          ["Started from measurement", "Index plus denormalisation", "Verification job"],
          ["Did not quantify what each change contributed", "Skipped how the change was rolled out"],
          ["Split the win between the index and the summary table", "Describe the migration and backfill plan"],
        ),
      },
      {
        round: 1,
        question: 2,
        transcript: t([
          ["i", "How would you design a rate limiter that is shared by twenty API instances, and what happens when Redis is down?"],
          ["c", "A token bucket per key in Redis, updated with a Lua script so it's atomic. If Redis is down I'd fall back to a local in-memory limiter per instance with the same budget, so we degrade instead of failing every request."],
        ]),
        domain: 80,
        communication: 76,
        feedback: fb(
          "Solid: atomic Lua script and a local fallback. Worth noting that the fallback multiplies the effective budget by the number of instances, and deciding whether that is acceptable.",
          ["Atomic update", "Graceful degradation"],
          ["Did not mention the budget multiplication during fallback", "No discussion of key choice"],
          ["Discuss per-user versus per-IP keys", "Call out the fallback trade-off explicitly"],
        ),
      },
      {
        round: 2,
        question: 0,
        code: `type PayoutEvent = { id: string; accountId: string; amountCents: number; createdAt: number };

export function totals(events: PayoutEvent[], now: number): Record<string, number> {
  const seen = new Set<string>();
  const out: Record<string, number> = {};
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const e of events) {
    if (seen.has(e.id) || e.createdAt < cutoff) continue;
    seen.add(e.id);
    out[e.accountId] = (out[e.accountId] ?? 0) + e.amountCents;
  }
  return out;
}`,
        language: "typescript",
        domain: 88,
        communication: 90,
        feedback: fb(
          "Correct, linear-time and readable. Duplicates are skipped before the time filter would matter, and the cutoff includes events exactly 24 hours old, which matches the hint.",
          ["O(n) with a single pass", "Clear names", "Handles duplicates and the boundary"],
          ["Future-dated events are counted", "No guard for negative amounts"],
          ["Ignore events with createdAt after now", "Decide how refunds (negative amounts) should behave"],
          "if (seen.has(e.id) || e.createdAt < cutoff || e.createdAt > now) continue;",
        ),
      },
      {
        round: 2,
        question: 1,
        code: `export function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s < last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}`,
        language: "typescript",
        domain: 72,
        communication: 85,
        feedback: fb(
          "Nearly right and nicely written, but touching ranges do not merge: [1,3] and [3,5] stay separate because the comparison is strict. The hint asked for them to merge.",
          ["Sorts a copy, not the input", "Clean loop"],
          ["Strict comparison misses touching ranges"],
          ["Use <= when comparing the start with the previous end", "Add a test for touching ranges"],
          "if (last && s <= last[1]) last[1] = Math.max(last[1], e);",
        ),
      },
      {
        round: 3,
        question: 0,
        transcript: t([
          ["i", "Tell me about a time an incident you were on call for went badly. What did you do in the first hour, and what changed afterwards?"],
          ["c", "A bank file arrived late and our reconciliation flagged thousands of false mismatches, which paged everyone. In the first hour I paused the alerting job, confirmed with the bank that the file was late, and posted updates every fifteen minutes. Afterwards we added a check that the file's date matches the run before comparing anything."],
        ]),
        domain: 84,
        communication: 89,
        feedback: fb("A strong STAR answer: clear situation, calm first actions, regular updates and a preventive fix. Pausing the noisy job first shows good incident judgement.", ["Calm prioritisation", "Regular communication", "Preventive follow-up"], ["Did not mention a written post-incident review"], ["Mention the review and who you shared it with"]),
      },
      {
        round: 3,
        question: 1,
        transcript: t([
          ["i", "Describe a technical disagreement with a senior engineer at Fernhill. How was it resolved?"],
          ["c", "We disagreed on moving reconciliation to a streaming system. I thought nightly batch was enough. We wrote a one-page comparison together, ran a cost estimate, and agreed to keep batch with a faster partial run at noon."],
        ]),
        domain: 76,
        communication: 83,
        feedback: fb("Good: disagreement resolved with a written comparison and a compromise. It would help to say what you learned or what you would argue differently now.", ["Resolved with data", "Found a compromise"], ["Little reflection"], ["Say what you learned from the other side's view"]),
      },
      {
        round: 4,
        question: 0,
        transcript: t([
          ["i", "Where do you want to be in two years, and how does this role get you there?"],
          ["c", "Leading the design of a system end to end, not only parts of it. This role owns a whole platform area, which is what I'm missing now."],
        ]),
        domain: 74,
        communication: 81,
        feedback: fb("Clear and tied to the role. Adding what you would deliver in the first six months would make it more concrete.", ["Ambition tied to the role"], ["Brief"], ["Describe a first-six-months goal"]),
      },
    ],
  },
  {
    title: "Senior Product Manager at Example Labs",
    source: "JOB_DESCRIPTION",
    company: "Example Labs",
    role: "Senior Product Manager",
    domain: "Product Management",
    summary: "Senior PM for the self-serve analytics team at Example Labs: dashboards, scheduled reports and alerts for small and mid-sized businesses. Owns activation and retention metrics, works with sales and two engineering squads.",
    jobDescription:
      "Example Labs is hiring a Senior Product Manager for our analytics team. You will own the roadmap for dashboards, scheduled reports and alerts used by thousands of small and mid-sized businesses. Activation for new workspaces has been flat for two quarters; you will lead discovery and experiments to change that. You will work closely with sales, design and two engineering squads, define success metrics, and communicate trade-offs clearly. Requirements: 5+ years of product management, experience with B2B SaaS analytics, strong data skills (SQL a plus), and a record of shipping measurable improvements.",
    daysAgo: 6,
    status: "COMPLETED",
    proctoring: false,
    plan: PM_PLAN,
    minutesPerQuestion: 4,
    answers: [
      {
        round: 0,
        question: 0,
        transcript: t([
          ["i", "Hi, I'm Avani. Let's begin. Please introduce yourself and tell me why the Senior Product Manager role on the Example Labs analytics team caught your attention."],
          ["c", "I've been a product manager for six years, the last three on a reporting product for retail chains. I'm interested because activation is exactly the problem I worked on last year, and I'd like to do it for a broader customer base."],
        ]),
        domain: 75,
        communication: 82,
        feedback: fb("Relevant and concise, with a direct link to the activation problem in the job description.", ["Linked experience to the role", "Concise"], ["No outcome from the activation work"], ["Quantify last year's activation result"]),
      },
      {
        round: 0,
        question: 1,
        transcript: t([
          ["i", "What do you know about how Example Labs customers use dashboards today, and what would you want to learn first?"],
          ["c", "From the public docs, most customers start from templates. I'd want to know how many workspaces create a second dashboard, because that's usually where real adoption shows."],
        ]),
        domain: 72,
        communication: 78,
        feedback: fb("Good instinct to look for a 'second dashboard' activation signal. More research up front would strengthen it.", ["Clear activation hypothesis"], ["Thin on research"], ["Mention talking to five recent sign-ups in week one"]),
      },
      {
        round: 1,
        question: 0,
        transcript: t([
          ["i", "The job description says activation for new workspaces is flat. How would you find out why, and what would you measure?"],
          ["c", "I'd map the first-week funnel: sign-up, connect a data source, first dashboard, first share. Then look for the biggest drop and watch session recordings and talk to people who dropped there. I'd measure the share of workspaces reaching first share within seven days."],
        ]),
        domain: 85,
        communication: 86,
        feedback: fb("Structured funnel thinking with qualitative follow-up and a clear north-star activation metric.", ["Funnel with clear steps", "Mixes data and interviews", "Concrete metric"], ["Did not segment by company size or source"], ["Segment the funnel by acquisition channel and size"]),
      },
      {
        round: 1,
        question: 1,
        transcript: t([
          ["i", "You have engineering time for one of: scheduled reports, a SQL editor, or Slack alerts. How do you decide?"],
          ["c", "I'd tie each to the activation and retention goals, estimate reach and effort, and check sales notes for lost deals. I suspect scheduled reports, because they bring people back weekly without effort."],
        ]),
        domain: 79,
        communication: 80,
        feedback: fb("Reasonable framework and a hypothesis. Naming the evidence that would change the decision would make it stronger.", ["Goal-driven", "Uses sales input"], ["No falsifiable criterion"], ["Say what data would make you pick Slack alerts instead"]),
      },
      {
        round: 1,
        question: 2,
        transcript: t([
          ["i", "How would you define success for the first version of anomaly alerts?"],
          ["c", "Adoption, so the share of active workspaces with at least one alert, and precision: how many alerts users mark as useful. If precision is low, people mute them and we lose trust."],
        ]),
        domain: 83,
        communication: 79,
        feedback: fb("Strong pairing of adoption with a quality metric (precision) and the risk of alert fatigue.", ["Adoption plus quality", "Names the trust risk"], ["No target numbers"], ["Propose starting targets, for example 60% marked useful"]),
      },
      {
        round: 2,
        question: 0,
        transcript: t([
          ["i", "Tell me about a time sales promised a feature that was not on your roadmap. What did you do?"],
          ["c", "A large prospect was promised custom branding. I met the account executive, understood the actual need, which was white-labelled PDF exports, and we shipped that small version in two weeks instead of full theming."],
        ]),
        domain: 81,
        communication: 87,
        feedback: fb("Good: found the underlying need and shipped a smaller solution quickly. Mention how you prevented it from happening again.", ["Found the real need", "Fast, scoped delivery"], ["No process change"], ["Describe the pre-sales review you set up afterwards"]),
      },
    ],
  },
  {
    title: "Data Analyst interview",
    source: "RESUME",
    company: null,
    role: "Data Analyst",
    domain: "Data Analytics",
    summary: "Analyst with three years of SQL, Python and dashboarding experience in e-commerce. Built the weekly cohort retention report and an A/B testing checklist used by the growth team.",
    daysAgo: 0,
    status: "READY",
    proctoring: false,
    minutesPerQuestion: 0,
    plan: [
      { name: "Introduction & Background", focus: "Story and motivation", description: "Background and why analytics.", questions: [{ text: "Please introduce yourself and walk me through how you got into analytics.", code: false, language: null }, { text: "Which analysis you built had the biggest impact on a decision, and why?", code: false, language: null }] },
      { name: "SQL & Experimentation", focus: "Hands-on analysis", description: "Correct SQL and sound experiment design.", questions: [{ text: "How did you build the weekly cohort retention report, and how did you validate it?", code: false, language: null }, { text: "Problem: Given a table orders(order_id, customer_id, created_at, total), write a query returning, for each customer, their first order date and total spend in their first 30 days. Hints: Use a window function or a join on the first order. Write your solution in SQL.", code: true, language: "sql" }] },
      { name: "Goals & Culture Fit", focus: "Motivation", description: "What the candidate wants next.", questions: [{ text: "What would you want to learn in your next role?", code: false, language: null }] },
    ],
    answers: [],
  },
];

/** Shorter finished interviews for the other demo people, so the admin numbers are not one person's. */
export const OTHER_INTERVIEWS: { title: string; role: string; domain: string; scores: [number, number][] }[] = [
  { title: "Frontend Engineer interview", role: "Frontend Engineer", domain: "Software Engineering", scores: [[78, 82], [70, 75], [84, 80], [66, 72]] },
  { title: "UX Designer at Example Studio", role: "UX Designer", domain: "Design", scores: [[80, 88], [76, 84], [72, 79]] },
  { title: "Machine Learning Engineer interview", role: "Machine Learning Engineer", domain: "Data Science", scores: [[86, 78], [81, 74], [69, 70], [88, 80]] },
];
