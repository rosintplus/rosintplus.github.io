/** Propositional stance patterns and disagreement lexicon. */
export const PROPOSITION_PATTERNS = [
  // 0. Political Compass Self-Identifications (Strict 1st-Person Declarations)
  {
    pattern: /\b(?:i(?:'m| am| consider myself| identify as)|as a(?:n)?|am i the only)\s+(?:[\w-]+\s+){0,6}(?:libleft|lib[- ]?left|libertarian[- ]?left(?:ist)?|libertarian\s+socialist)\b|\b(?:my fellow)\s+(?:liblefts?|lib[- ]?lefts?)\b/i,
    topic: "Ideological Alignment",
    stance: "Self-Identified Libertarian Left (Lib-Left)",
    polarity: "Lib-Left",
    econ: -7.5, soc: -7.5, gov: -8.0,
    searchKw: "libleft"
  },
  {
    pattern: /\b(?:i(?:'m| am| consider myself| identify as)|as a(?:n)?|am i the only)\s+(?:[\w-]+\s+){0,6}(?:authleft|auth[- ]?left|authoritarian[- ]?left(?:ist)?|marxist[- ]?leninist)\b|\b(?:my fellow)\s+(?:authlefts?|marxists?)\b/i,
    topic: "Ideological Alignment",
    stance: "Self-Identified Authoritarian Left (Auth-Left)",
    polarity: "Auth-Left",
    econ: -8.5, soc: 4.0, gov: 7.5,
    searchKw: "authleft"
  },
  {
    pattern: /\b(?:i(?:'m| am| consider myself| identify as)|as a(?:n)?|am i the only)\s+(?:[\w-]+\s+){0,6}(?:libright|lib[- ]?right|libertarian[- ]?right(?:ist)?|anarcho[- ]?capitalist|ancap)\b|\b(?:my fellow)\s+(?:librights?|ancaps?)\b/i,
    topic: "Ideological Alignment",
    stance: "Self-Identified Libertarian Right (Lib-Right)",
    polarity: "Lib-Right",
    econ: 8.5, soc: -3.5, gov: -8.5,
    searchKw: "libright"
  },
  {
    pattern: /\b(?:i(?:'m| am| consider myself| identify as)|as a(?:n)?|am i the only)\s+(?:[\w-]+\s+){0,6}(?:authright|auth[- ]?right|authoritarian[- ]?right(?:ist)?)\b|\b(?:my fellow)\s+(?:authrights?)\b/i,
    topic: "Ideological Alignment",
    stance: "Self-Identified Authoritarian Right (Auth-Right)",
    polarity: "Auth-Right",
    econ: 7.5, soc: 7.5, gov: 7.0,
    searchKw: "authright"
  },

  // Quadrant Critiques
  {
    pattern: /\b(?:libright|lib[- ]?right|anarcho[- ]?capitalis\w*|ancaps?)\s+(?:is|are|were)?\s*(?:\w+\s+){0,3}(?:stupid|cringe|morons?|idiots?|delusional|evil|trash|worst|fascist|clowns?|insane)\b|\bfuck\s+(?:libright|lib[- ]?right|ancaps?)\b/i,
    topic: "Ideological Critique",
    stance: "Critical of Libertarian Right / Ancap Ideology",
    polarity: "Opposition",
    econ: -6.0, soc: -5.0, gov: -4.0,
    searchKw: "libright"
  },
  {
    pattern: /\b(?:libleft|lib[- ]?left)\s+(?:is|are|were)?\s*(?:\w+\s+){0,3}(?:stupid|cringe|morons?|idiots?|delusional|evil|trash|worst|clowns?|insane)\b|\bfuck\s+(?:libleft|lib[- ]?left)\b/i,
    topic: "Ideological Critique",
    stance: "Critical of Libertarian Left Ideology",
    polarity: "Opposition",
    econ: 6.0, soc: 4.0, gov: 3.0,
    searchKw: "libleft"
  },

  // 1. Trump & MAGA Stances
  {
    pattern: /\b(?:trump|maga)\s+(?:is|was|are)?\s*(?:\w+\s+){0,3}(?:cult|felon|criminal|con\s*artist|traitor|fascist|fraud|clown|disaster|threat|corrupt|grifter|evil|liar|danger|crook|guilty)\b|\b(?:fuck|impeach|prosecute|jail)\s+trump\b|\bnever\s+trump\b|\banti[- ]?trump\b/i,
    topic: "Donald Trump & MAGA",
    stance: "Opposes Donald Trump & MAGA Movement",
    polarity: "Opposition",
    econ: -5.0, soc: -6.0, gov: -5.0,
    searchKw: "trump"
  },
  {
    pattern: /\b(?:trump|maga)\s+(?:is|was|are)?\s*(?:\w+\s+){0,3}(?:right|best|great|won|2024|patriot|legend|hero|smart|leader)\b|\b(?:love|support|voted?\s+for)\s+trump\b|\bstand\s+with\s+trump\b|\bmaga\s+forever\b/i,
    topic: "Donald Trump & MAGA",
    stance: "Supports Donald Trump & MAGA Movement",
    polarity: "Support",
    econ: 7.0, soc: 7.5, gov: 6.5,
    searchKw: "trump"
  },

  // 2. Religion & Secularism Stances
  {
    pattern: /\b(?:religion|theocracy|christianity|church|christian\s+nationalism)\s+(?:is|was|are)?\s*(?:\w+\s+){0,3}(?:cult|harmful|poison|delusion|fiction|myth|toxic|evil|scam|brainwashing|dogma|danger)\b|\bseparation\s+of\s+church\s+and\s+state\b|\bsecular\s+(?:government|society|democracy)\b|\banti[- ]?theist\b|\bgod\s+is\s+not\s+real\b/i,
    topic: "Secularism & Religion",
    stance: "Strongly Secularist & Anti-Theocracy",
    polarity: "Progressive",
    econ: -3.0, soc: -8.5, gov: -7.0,
    searchKw: "religion"
  },
  {
    pattern: /\b(?:faith|christian\s+values|biblical\s+truth|god\s+fearing|traditional\s+faith|god\s+is\s+good|glory\s+to\s+god)\b|\bchristian\s+nation\b/i,
    topic: "Secularism & Religion",
    stance: "Pro-Faith & Traditional Christian Values",
    polarity: "Traditional",
    econ: 3.5, soc: 7.5, gov: 5.5,
    searchKw: "christian"
  },

  // 3. Republican Party & Conservatism Stances
  {
    pattern: /\b(?:gop|republicans?|conservatives?|tories)\s+(?:are|is|were)?\s*(?:\w+\s+){0,3}(?:evil|corrupt|insane|fascists?|hypocrites?|liars?|destroying|clowns?|unhinged|morons?|criminals?|crooks?)\b|\bfuck\s+the\s+(?:gop|republicans|tories)\b|\bvote\s+blue\b/i,
    topic: "Party Politics",
    stance: "Critical of Republican / Conservative Parties",
    polarity: "Opposition",
    econ: -5.5, soc: -5.5, gov: -4.5,
    searchKw: "republicans"
  },
  {
    pattern: /\b(?:democrats?|liberals?|leftists?|socialists?)\s+(?:are|is|were)?\s*(?:\w+\s+){0,3}(?:evil|corrupt|insane|ruining|communists?|woke\s+clowns?|hypocrites?|liars?|destroying)\b|\bvote\s+red\b|\bfuck\s+biden\b/i,
    topic: "Party Politics",
    stance: "Critical of Democratic / Left Parties",
    polarity: "Opposition",
    econ: 6.0, soc: 6.0, gov: 4.5,
    searchKw: "democrats"
  },

  // 4. Healthcare & Welfare
  {
    pattern: /\b(?:universal\s+healthcare|single\s+payer|medicare\s+for\s+all|nhs|healthcare\s+is\s+a\s+human\s+right|free\s+healthcare)\b/i,
    topic: "Healthcare Policy",
    stance: "Supports Universal / Single-Payer Healthcare",
    polarity: "Progressive",
    econ: -8.0, soc: -5.0, gov: -4.0,
    searchKw: "healthcare"
  },
  {
    pattern: /\b(?:wealth\s+tax|tax\s+the\s+rich|billionaires\s+should\s+not\s+exist|living\s+wage|rent\s+control|cancel\s+student\s+debt|union\s+strong|unionize)\b/i,
    topic: "Labor & Wealth",
    stance: "Supports Wealth Taxation & Worker Unionization",
    polarity: "Socialist/Left",
    econ: -8.5, soc: -5.0, gov: -5.0,
    searchKw: "wealth tax"
  },
  {
    pattern: /\b(?:taxation\s+is\s+theft|deregulat(?:e|ion)|free\s+market\s+capitalism|privatiz(?:e|ation)|cut\s+taxes|small\s+government|cut\s+spending)\b/i,
    topic: "Economy & Taxation",
    stance: "Supports Free-Market Capitalism & Low Taxes",
    polarity: "Fiscal Conservative",
    econ: 8.5, soc: -1.0, gov: -5.0,
    searchKw: "deregulation"
  },

  // 5. Civil Liberties & Firearms
  {
    pattern: /\b(?:second\s+amendment|2a\s+rights?|gun\s+rights|constitutional\s+carry|shall\s+not\s+be\s+infringed|pro[- ]?gun)\b/i,
    topic: "Civil Liberties & 2A",
    stance: "Strong Support for 2nd Amendment & Gun Rights",
    polarity: "Libertarian/Pro-2A",
    econ: 0.0, soc: -3.0, gov: -8.0,
    searchKw: "second amendment"
  },
  {
    pattern: /\b(?:ban\s+assault\s+weapons|gun\s+control\s+now|universal\s+background\s+checks|ban\s+ar[- ]?15|red\s+flag\s+laws)\b/i,
    topic: "Firearms Policy",
    stance: "Supports Stricter Firearms Regulation",
    polarity: "Regulatory",
    econ: -3.0, soc: 2.0, gov: 4.0,
    searchKw: "gun control"
  },

  // 6. Reproductive & Social Rights
  {
    pattern: /\b(?:pro[- ]?choice|abortion\s+rights|reproductive\s+freedom|bodily\s+autonomy|roe\s+v\s+wade|my\s+body\s+my\s+choice)\b/i,
    topic: "Social & Bodily Autonomy",
    stance: "Pro-Choice & Bodily Autonomy",
    polarity: "Progressive",
    econ: -3.0, soc: -8.5, gov: -6.0,
    searchKw: "pro-choice"
  },
  {
    pattern: /\b(?:pro[- ]?life|anti[- ]?abortion|ban\s+abortion|sanctity\s+of\s+life|heartbeat\s+bill|unborn\s+babies)\b/i,
    topic: "Social & Bodily Autonomy",
    stance: "Pro-Life / Anti-Abortion",
    polarity: "Traditionalist",
    econ: 3.0, soc: 8.5, gov: 6.0,
    searchKw: "pro-life"
  },

  // 7. Climate & Environment
  {
    pattern: /\b(?:green\s+new\s+deal|climate\s+crisis|climate\s+change\s+is\s+real|renewable\s+energy|carbon\s+tax|stop\s+fossil\s+fuels)\b/i,
    topic: "Climate & Ecology",
    stance: "Supports Aggressive Climate Action",
    polarity: "Environmentalist",
    econ: -7.0, soc: -5.0, gov: -2.0,
    searchKw: "climate change"
  },

  // 8. Immigration & Borders
  {
    pattern: /\b(?:secure\s+the\s+border|build\s+the\s+wall|mass\s+deportation|illegal\s+alien\s+invasion|close\s+the\s+border)\b/i,
    topic: "Immigration & Borders",
    stance: "Supports Strict Border Enforcement & Deportation",
    polarity: "Law & Order",
    econ: 4.0, soc: 7.5, gov: 6.5,
    searchKw: "border"
  },
  {
    pattern: /\b(?:pathway\s+to\s+citizenship|abolish\s+ice|refugees\s+welcome|sanctuary\s+city|humane\s+immigration|dreamers|daca)\b/i,
    topic: "Immigration & Borders",
    stance: "Supports Comprehensive Immigration Reform & Asylum",
    polarity: "Humanitarian",
    econ: -4.0, soc: -7.5, gov: -5.0,
    searchKw: "immigration"
  }
];

export const DISAGREEMENT_WORDS = new Set([
  'cult', 'delusional', 'stupid', 'idiots', 'corrupt', 'fascist', 'insane', 'moron',
  'garbage', 'liar', 'scam', 'fake', 'disaster', 'evil', 'clown', 'unhinged', 'hypocrite'
]);
