// Open42 marketing copy. Source of truth for the landing page.
//
// Open42 is a self-hostable Company Brain built on gbrain. The differentiator
// is Skills — any answer can become a reusable, one-click mini-app shaped by
// how the team actually works. Every answer carries receipts (source +
// version + freshness). Honest when it doesn't know. Yours to keep.

export const NAV_LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'Architecture', href: '#architecture' },
];

export const HERO = {
  eyebrow: 'Open42 · built on gbrain',
  heading: 'The AI that knows your company and turns answers into tools your team can reuse.',
  subhead:
    "Connect your docs, chats, and email. Open42 becomes your team's shared brain — answering with citations, and turning any answer into a one-click Skill anyone can run again.",
  secondaryCta: { label: 'See how it works', href: '#how' },
};

export const DEMO_ACCESS = {
  cta: 'Get Started',
  note: 'No waitlist BS. Sign in with any email and try Open42.',
  disclaimer: 'We are in beta.',
  billing:
    '$20/month for Open42 Cloud. No free trial. Payments are processed by Stripe and are non-refundable except where required by law.',
};

export const WAITLIST = {
  label: 'Get demo help',
  placeholder: 'you@company.com',
  cta: 'Ask for setup help',
  submitting: 'Sending...',
  note: "Already trying the demo? Drop your work email and we'll help with setup.",
  success: "Request received. We'll be in touch about demo setup.",
  invalid: 'Use a valid work email.',
  error: "Couldn't send that request. Email support@open42.ai and we'll add you.",
};

// Three pills directly under the hero. Each is a load-bearing claim that the
// rest of the page has to back up.
export const PROOF = [
  {
    label: 'Receipts',
    value: 'Every answer cites its source, version, and date.',
  },
  {
    label: 'Honest',
    value: "Admits when it doesn't know. Flags stale sources.",
  },
  {
    label: 'Yours',
    value: 'Self-host or cloud. One private brain per workspace.',
  },
];

// Three steps. This is the "what actually happens" arc — concrete, sequential,
// each step finishes in something real.
export const PROCESS = {
  eyebrow: '[ How it works ]',
  heading: 'Connect, ask, and turn the answer into a Skill.',
  steps: [
    {
      title: 'Connect your knowledge',
      description:
        "Notion, Drive, Slack, Gmail, GitHub, Linear — plug in the tools you already use. Each workspace gets its own private brain, on its own database. Never mixed with anyone else's.",
    },
    {
      title: 'Ask, and get receipts',
      description:
        "Every answer shows where it came from — the source, the version, the date. Click a citation to jump to the exact line. When Open42 doesn't know, it says so.",
    },
    {
      title: 'Save it as a Skill',
      description:
        "Save any useful answer as a Skill — a reusable mini-app. Ask once ('summarize this week's customer calls'), then anyone on your team can run it again with one click.",
    },
  ],
};

// Bento. Visual rhythm is wide / narrow / narrow / wide. Each card is an
// inline HTML mock; no marketing screenshots.
export const FEATURES = {
  eyebrow: "[ What's inside ]",
  heading: 'A brain that answers and turns those answers into tools.',
  subhead:
    'Open42 connects your knowledge to your team. It cites sources, flags stale info, and turns any answer into a Skill anyone can run again.',
  cards: [
    {
      id: 'receipts',
      title: 'Receipts on every answer.',
      description:
        'Source, version, and date on every line. No claim without a citation. You can always trace an answer back.',
      span: 'wide',
    },
    {
      id: 'skills',
      title: 'Skills, not just chat.',
      description:
        'Turn any answer into a one-click, reusable mini-app the whole team can run. Versioned. Shareable.',
      span: 'narrow',
    },
    {
      id: 'honest',
      title: "Honest when it doesn't know.",
      description:
        '"I don\'t have that in your brain." Stale sources get flagged. No confident wrong answers.',
      span: 'narrow',
    },
    {
      id: 'isolated',
      title: 'Your brain, fully isolated.',
      description:
        "One workspace, one private brain, one database. Cloud or self-hosted. Your data is never mixed with anyone else's.",
      span: 'wide',
    },
  ],
};

// Connector strip. Reads as: "we plug into the tools you already pay for."
// Center pill is Open42 itself.
export const INTEGRATION = {
  eyebrow: '[ Connect ]',
  heading: 'Connect the tools your team already uses.',
  subhead:
    'Open42 pulls content from the tools your team already lives in. Every citation points back to the exact line in the original tool, so you can verify any answer in one click.',
  connectors: [
    'Notion',
    'Drive',
    'Slack',
    'Gmail',
    'GitHub',
    'Linear',
    'Open42',
    'Confluence',
    'Hubspot',
    'Intercom',
    'Zendesk',
    'Dropbox',
    'Figma',
  ],
};

// Architecture band. Shows the two-boundary model from the README so
// technical readers can map it to their own infra.
export const ARCHITECTURE = {
  eyebrow: '[ Architecture ]',
  heading: 'Two boundaries. One brain per workspace.',
  subhead:
    'Open42 handles users and metadata. gbrain runs the brain itself. Each workspace gets its own private brain on its own machine — no shared storage between workspaces.',
  nodes: [
    { title: 'User auth', detail: 'Magic-link sign-in. Open42 holds the server session.' },
    { title: 'Open42 API', detail: 'Sessions, connectors, chat routing, Skills.' },
    { title: 'Metadata DB', detail: 'Users, workspaces, and encrypted secrets.' },
    { title: 'gbrain runtime', detail: 'Private brain per workspace, with scoped OAuth access.' },
    { title: 'Workspace DB', detail: 'Pages, chunks, and embeddings. Isolated per workspace.' },
  ],
};

// "Built on gbrain" band. Sits right after Architecture so the reader has just
// seen "gbrain runtime" on the diagram and is primed to ask "what is that?".
// Every claim on the right-hand fact card maps to something in the public
// gbrain README — no invented numbers.
export const GBRAIN = {
  eyebrow: '[ Built on gbrain ]',
  heading: "We didn't reinvent the brain. We made it run for teams.",
  subhead:
    "gbrain is the open-source agent brain Garry Tan built to run his own daily work. It's fast, honest, and battle-tested on a real 17,000-page personal brain. Open42 takes that runtime and makes it something a team can actually run.",
  layers: [
    {
      title: 'Per-workspace runtime',
      body: 'Every workspace gets its own private gbrain instance, on its own machine and database. No shared retrieval layer between workspaces — ever.',
    },
    {
      title: 'Team auth, billing, and a real UI',
      body: "Magic-link sign-in, role-based access, workspace billing, and a UI that isn't a terminal. The pieces gbrain doesn't ship — because it was built for one operator, not a team.",
    },
    {
      title: 'Connectors out of the box',
      body: 'Composio-managed integrations for Notion, Drive, Slack, Gmail, GitHub, Linear, and more — pre-wired into your workspace brain with per-workspace OAuth.',
    },
    {
      title: 'Pinned and swappable',
      body: 'We run gbrain pinned at a verified version. You can fork it, swap in your own build, or run a different runtime entirely — the rest of Open42 keeps working.',
    },
  ],
  card: {
    repo: 'garrytan/gbrain',
    license: 'gbrain MIT · open source',
    tagline: 'Your AI agent is smart but forgetful. gbrain gives it a brain.',
    facts: [
      { label: 'Author', value: 'Garry Tan · President & CEO, Y Combinator' },
      { label: 'Powers', value: 'OpenClaw and Hermes — real agents in production' },
      { label: 'Scale', value: '17,888 pages · 4,383 people · 723 companies' },
      { label: 'Retrieval', value: 'BrainBench P@5 49.1 — beats vector-only RAG by +31 points' },
      { label: 'Surface', value: 'MCP server with OAuth 2.1 · 34 skills · 30+ tools' },
    ],
    cta: {
      label: 'Read the gbrain README',
      href: 'https://github.com/garrytan/gbrain',
    },
  },
};

// Replaces the testimonials band. We don't have customer quotes yet — and
// inventing them would directly contradict the page's own pitch. So we show
// the engineering principles the product is built on instead.
export const PRINCIPLES = {
  eyebrow: '[ Principles ]',
  heading: 'Trust is the product.',
  subhead:
    'Built for teams who need answers they can defend, not demos they can show. These are the rules we hold the product to.',
  items: [
    {
      title: 'Receipts beat vibes.',
      body: "If we can't cite the source, version, and date of a claim, we don't make the claim. Every answer is inspectable.",
    },
    {
      title: 'Skills beat chat.',
      body: "A chat that disappears is a chat you'll have to run again. Any answer worth keeping becomes a reusable tool the team can run again.",
    },
    {
      title: 'Honesty beats coverage.',
      body: '"I don\'t have that in your brain" is a feature. A confident wrong answer is the worst possible failure.',
    },
    {
      title: 'One brain per workspace.',
      body: "One workspace, one private brain, one database. There's no shared layer to leak from. Cross-workspace leakage is impossible by design.",
    },
    {
      title: 'Calm beats spectacle.',
      body: 'No spinners as theater. No flashy gradients. The interface stays out of the way so the answer can be the moment.',
    },
    {
      title: 'Yours to keep.',
      body: 'Self-hostable end to end. Bring your own API keys. The whole stack runs on your infrastructure whenever you want it to.',
    },
  ],
};

export const FAQ = {
  eyebrow: '[ FAQ ]',
  heading: 'Common questions, clear answers.',
  subhead: 'How the brain stays accurate, where your data lives, and what a Skill actually is.',
  items: [
    {
      q: 'What is a Skill?',
      a: "A Skill is a saved answer. Ask once — 'summarize this week's customer calls' or 'draft the weekly investor update' — and Open42 saves the steps as a reusable mini-app. Anyone on your team can run it again in one click. Skills are versioned, so each run uses the latest sources, not a stale snapshot.",
    },
    {
      q: 'What stops it from hallucinating?',
      a: "Open42 only answers from your workspace brain. When the answer isn't in there, it says so — 'I don't have anything about this in your brain' — instead of guessing. Every claim links back to the exact source line, with the version and date it came from.",
    },
    {
      q: 'Where does my data live?',
      a: "Each workspace gets its own brain — a private runtime with its own database. On Open42 Cloud, that's a dedicated machine with its own volume. Self-hosted, it's a Docker container with its own volume. There is no shared storage between workspaces, ever.",
    },
    {
      q: 'Do my API keys ever leave my control?',
      a: "No. Your workspace brain never sees your real Anthropic or OpenAI key. It calls a proxy with a proxy token, and the proxy swaps in the real key on the way out — yours if you brought one, otherwise ours. The brain itself can't read or leak your keys.",
    },
    {
      q: 'How does billing work?',
      a: 'Open42 Cloud is $20/month, billed monthly through Stripe. There is no free trial. You can cancel before the next renewal from workspace settings; payments already made are non-refundable except where required by law.',
    },
  ],
};

export const OPEN42_REPO_URL = 'https://github.com/interfacelabs/open42';

export const CTA = {
  heading: 'Give your AI the company memory it keeps pretending to have.',
  subhead:
    'Open42 Cloud demo access is open. Start with a small docs repo, ask questions with receipts, and turn useful answers into reusable automations.',
  secondary: {
    label: 'GitHub',
    href: OPEN42_REPO_URL,
  },
};

export const FOOTER = {
  tagline:
    'Self-hostable Company Brain. Built on gbrain. Answers with receipts. Skills your team builds together.',
  columns: [
    {
      title: 'Product',
      links: [
        { label: 'Skills', href: '#skills' },
        { label: 'How it works', href: '#how' },
        { label: 'Architecture', href: '#architecture' },
      ],
    },
    {
      title: 'Source',
      links: [
        { label: 'GitHub', href: OPEN42_REPO_URL },
        { label: 'Docs', href: '#docs' },
        { label: 'Status', href: '#status' },
        { label: 'License', href: '#license' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'About us', href: '/about' },
        { label: 'Terms of Service', href: '/terms' },
        { label: 'Privacy Policy', href: '/privacy' },
        { label: 'Refund Policy', href: '/refund-policy' },
      ],
    },
  ],
  copyright: '© 2026 Interface Labs Ltd. Open42 is in beta.',
  status: 'Stripe checkout ready',
};
