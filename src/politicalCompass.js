/**
 * Context & Stance-Aware Multi-Dimensional Political Position & Ideology Engine.
 *
 * Algorithmic references & theoretical foundations:
 * 1. Stance-Aware Subreddit Polarity & Interaction Inversion:
 *    Inspects user comments within specific subreddits to determine if they are in agreement
 *    or engaging in adversarial debate (e.g. anti-Trump user debating inside r/The_Donald).
 * 2. Propositional Stance Extraction:
 *    Extracts explicit affirmative and oppositional viewpoints with supporting evidence quotes
 *    across Secularism/Religion, Trump/MAGA, Party Politics, Economy, Healthcare, Civil Liberties,
 *    Culture & Media, and Criminal Justice.
 * 3. Multi-Axis Ideological Calibration:
 *    Computes calibrated Economic (-10 to +10), Social (-10 to +10), and Governance (-10 to +10) coordinates.
 */

// Axis convention:
// econ: -10 (Left / Socialist) to +10 (Right / Free Market)
// soc:  +10 (Traditional / Authoritarian) to -10 (Progressive / Secular / Libertarian)
// gov:  +10 (Statist / Order) to -10 (Civil Libertarian / Anti-Authoritarian)

const SUBREDDIT_POLITICAL_MAP = {
  // ── Left-Libertarian (Lib-Left) ──
  anarchism: { econ: -8.5, soc: -9.5, gov: -9.5, weight: 1.0, side: 'left' },
  anarchy101: { econ: -8.0, soc: -9.0, gov: -9.0, weight: 1.0, side: 'left' },
  completeanarchy: { econ: -8.5, soc: -9.0, gov: -9.0, weight: 1.0, side: 'left' },
  socialism: { econ: -8.5, soc: -5.0, gov: -4.0, weight: 1.0, side: 'left' },
  socialism_101: { econ: -8.0, soc: -5.0, gov: -4.0, weight: 0.9, side: 'left' },
  democraticsocialism: { econ: -7.5, soc: -6.5, gov: -6.0, weight: 1.0, side: 'left' },
  dankleft: { econ: -8.0, soc: -6.0, gov: -6.0, weight: 0.9, side: 'left' },
  antiwork: { econ: -7.0, soc: -6.0, gov: -6.0, weight: 0.85, side: 'left' },
  workreform: { econ: -6.5, soc: -5.5, gov: -5.0, weight: 0.85, side: 'left' },
  sandersforpresident: { econ: -7.0, soc: -6.0, gov: -5.5, weight: 0.9, side: 'left' },
  ourpresident: { econ: -7.0, soc: -6.0, gov: -5.5, weight: 0.8, side: 'left' },
  wayofthebern: { econ: -6.5, soc: -4.0, gov: -4.0, weight: 0.8, side: 'left' },
  progressive: { econ: -6.5, soc: -7.0, gov: -6.0, weight: 0.9, side: 'left' },
  progressivepolitics: { econ: -6.5, soc: -7.0, gov: -6.0, weight: 0.9, side: 'left' },
  democrats: { econ: -4.5, soc: -5.5, gov: -4.0, weight: 0.85, side: 'left' },
  liberal: { econ: -5.0, soc: -6.5, gov: -5.0, weight: 0.85, side: 'left' },
  vaushv: { econ: -7.5, soc: -7.0, gov: -7.0, weight: 0.85, side: 'left' },
  breadtube: { econ: -7.5, soc: -7.5, gov: -7.0, weight: 0.8, side: 'left' },
  hasan_piker: { econ: -7.5, soc: -6.5, gov: -6.0, weight: 0.8, side: 'left' },
  twoxchromosomes: { econ: -4.0, soc: -7.0, gov: -5.0, weight: 0.75, side: 'left' },
  witchesvspatriarchy: { econ: -5.5, soc: -8.0, gov: -7.0, weight: 0.75, side: 'left' },
  lgbt: { econ: -3.5, soc: -7.5, gov: -6.0, weight: 0.7, side: 'left' },
  transgender: { econ: -3.5, soc: -7.5, gov: -6.0, weight: 0.7, side: 'left' },
  greenandpleasant: { econ: -8.0, soc: -6.0, gov: -5.0, weight: 0.9, side: 'left' },
  labouruk: { econ: -5.5, soc: -5.0, gov: -4.0, weight: 0.8, side: 'left' },
  chomsky: { econ: -7.5, soc: -7.0, gov: -8.0, weight: 0.85, side: 'left' },
  latestagecapitalism: { econ: -8.5, soc: -5.0, gov: -5.0, weight: 0.9, side: 'left' },
  aboringdystopia: { econ: -6.5, soc: -5.0, gov: -5.0, weight: 0.75, side: 'left' },
  whitepeopletwitter: { econ: -4.5, soc: -6.0, gov: -4.5, weight: 0.7, side: 'left' },
  politicalhumor: { econ: -5.0, soc: -5.5, gov: -4.5, weight: 0.65, side: 'left' },
  atheism: { econ: -3.5, soc: -7.5, gov: -6.5, weight: 0.8, side: 'left' },
  secularism: { econ: -3.0, soc: -7.0, gov: -6.5, weight: 0.75, side: 'left' },
  exmormon: { econ: -3.0, soc: -6.5, gov: -5.5, weight: 0.65, side: 'left' },
  exmuslim: { econ: -2.5, soc: -6.5, gov: -5.5, weight: 0.65, side: 'left' },
  exchristian: { econ: -3.0, soc: -6.5, gov: -5.5, weight: 0.65, side: 'left' },
  canadaleft: { econ: -7.5, soc: -6.0, gov: -5.5, weight: 0.85, side: 'left' },
  onguardforthee: { econ: -5.5, soc: -6.0, gov: -5.0, weight: 0.8, side: 'left' },
  greenparty: { econ: -6.5, soc: -7.0, gov: -6.5, weight: 0.8, side: 'left' },
  lostgeneration: { econ: -7.0, soc: -5.0, gov: -5.0, weight: 0.75, side: 'left' },
  socialistRA: { econ: -8.0, soc: -8.0, gov: -8.5, weight: 0.9, side: 'left' },
  liberalgunowners: { econ: -4.0, soc: -7.0, gov: -7.5, weight: 0.8, side: 'left' },
  conservativeterrorism: { econ: -6.0, soc: -6.5, gov: -5.0, weight: 0.8, side: 'left' },

  // ── Left-Authoritarian (Auth-Left) ──
  communism: { econ: -9.5, soc: 4.0, gov: 7.5, weight: 1.0, side: 'left' },
  communism101: { econ: -9.5, soc: 4.0, gov: 7.0, weight: 1.0, side: 'left' },
  marxism: { econ: -9.0, soc: 2.5, gov: 4.5, weight: 1.0, side: 'left' },
  marxism_101: { econ: -9.0, soc: 2.5, gov: 4.5, weight: 0.9, side: 'left' },
  genzommunist: { econ: -9.0, soc: 3.5, gov: 6.0, weight: 0.9, side: 'left' },
  thedeprogram: { econ: -8.5, soc: 4.0, gov: 6.5, weight: 0.9, side: 'left' },
  sino: { econ: -6.0, soc: 6.5, gov: 9.0, weight: 0.85, side: 'left' },
  sendinthetanks: { econ: -9.0, soc: 6.0, gov: 8.5, weight: 0.9, side: 'left' },
  shitliberalssay: { econ: -8.5, soc: 3.5, gov: 6.0, weight: 0.85, side: 'left' },
  moretankiechapo: { econ: -9.0, soc: 5.0, gov: 8.0, weight: 0.9, side: 'left' },
  stupidpol: { econ: -7.0, soc: 1.0, gov: 3.0, weight: 0.8, side: 'left' },
  ussr: { econ: -9.0, soc: 5.0, gov: 8.0, weight: 0.85, side: 'left' },

  // ── Right-Authoritarian (Auth-Right) ──
  conservative: { econ: 7.5, soc: 6.5, gov: 6.0, weight: 1.0, side: 'right' },
  conservatives: { econ: 7.5, soc: 6.5, gov: 6.0, weight: 1.0, side: 'right' },
  republican: { econ: 7.0, soc: 6.0, gov: 5.5, weight: 0.9, side: 'right' },
  republicans: { econ: 7.0, soc: 6.0, gov: 5.5, weight: 0.9, side: 'right' },
  askconservatives: { econ: 6.5, soc: 5.5, gov: 5.0, weight: 0.85, side: 'right' },
  the_donald: { econ: 7.5, soc: 8.0, gov: 7.5, weight: 1.0, side: 'right' },
  walkaway: { econ: 7.0, soc: 6.5, gov: 6.0, weight: 0.85, side: 'right' },
  louderwithcrowder: { econ: 7.5, soc: 7.0, gov: 6.5, weight: 0.85, side: 'right' },
  jordanpeterson: { econ: 5.0, soc: 5.5, gov: 4.5, weight: 0.75, side: 'right' },
  tuckercarlson: { econ: 6.5, soc: 8.0, gov: 7.5, weight: 0.85, side: 'right' },
  dailywire: { econ: 7.0, soc: 6.5, gov: 6.0, weight: 0.8, side: 'right' },
  monarchism: { econ: 4.0, soc: 9.0, gov: 9.5, weight: 0.85, side: 'right' },
  catholicism: { econ: 4.0, soc: 7.0, gov: 6.0, weight: 0.75, side: 'right' },
  christianity: { econ: 2.5, soc: 5.5, gov: 4.5, weight: 0.55, side: 'right' },
  truechristian: { econ: 4.5, soc: 7.5, gov: 7.0, weight: 0.8, side: 'right' },
  tories: { econ: 6.5, soc: 5.0, gov: 5.0, weight: 0.8, side: 'right' },
  badunitedkingdom: { econ: 6.0, soc: 6.0, gov: 5.5, weight: 0.75, side: 'right' },
  reformuk: { econ: 7.5, soc: 7.5, gov: 7.0, weight: 0.9, side: 'right' },
  kotakuinaction: { econ: 4.0, soc: 5.5, gov: 4.0, weight: 0.65, side: 'right' },
  mensrights: { econ: 3.5, soc: 4.5, gov: 3.5, weight: 0.55, side: 'right' },
  conspiracy: { econ: 3.5, soc: 3.5, gov: -2.0, weight: 0.5, side: 'right' },
  conspiracy_commons: { econ: 3.5, soc: 3.5, gov: -2.0, weight: 0.5, side: 'right' },
  timpool: { econ: 6.0, soc: 6.0, gov: 5.0, weight: 0.75, side: 'right' },
  neoconnwo: { econ: 6.5, soc: 7.0, gov: 7.5, weight: 0.8, side: 'right' },
  metacanada: { econ: 7.0, soc: 6.5, gov: 6.0, weight: 0.8, side: 'right' },
  canada_sub: { econ: 6.5, soc: 6.0, gov: 5.5, weight: 0.8, side: 'right' },

  // ── Right-Libertarian (Lib-Right) ──
  libertarian: { econ: 7.5, soc: -3.5, gov: -8.5, weight: 1.0, side: 'right' },
  libertarianmeme: { econ: 7.5, soc: -3.0, gov: -8.0, weight: 0.9, side: 'right' },
  libertarianuncensored: { econ: 6.5, soc: -4.5, gov: -8.5, weight: 0.9, side: 'right' },
  anarcho_capitalism: { econ: 9.5, soc: -4.0, gov: -9.5, weight: 1.0, side: 'right' },
  goldandblack: { econ: 9.0, soc: -4.0, gov: -9.0, weight: 0.95, side: 'right' },
  capitalism: { econ: 8.5, soc: 0.0, gov: -3.0, weight: 0.85, side: 'right' },
  austrian_economics: { econ: 9.0, soc: -2.0, gov: -6.0, weight: 0.85, side: 'right' },
  freemarket: { econ: 8.5, soc: -2.0, gov: -6.0, weight: 0.85, side: 'right' },
  gunpolitics: { econ: 6.0, soc: -1.0, gov: -7.5, weight: 0.8, side: 'right' },
  firearms: { econ: 5.0, soc: -1.0, gov: -7.0, weight: 0.7, side: 'right' },
  progun: { econ: 5.5, soc: -1.0, gov: -7.5, weight: 0.75, side: 'right' },
  "2aliberals": { econ: -3.0, soc: -5.0, gov: -7.5, weight: 0.75, side: 'left' },

  // ── Centrist & Mixed Discussion ──
  politics: { econ: -4.0, soc: -4.5, gov: -3.5, weight: 0.5, side: 'left' },
  politicaldiscussion: { econ: -1.0, soc: -1.0, gov: -1.0, weight: 0.5, side: 'center' },
  moderatepolitics: { econ: 0.5, soc: 0.0, gov: 0.0, weight: 0.6, side: 'center' },
  centrist: { econ: 0.0, soc: 0.0, gov: 0.0, weight: 0.7, side: 'center' },
  neoliberal: { econ: 3.5, soc: -4.5, gov: -4.0, weight: 0.8, side: 'center' },
  destiny: { econ: -2.5, soc: -3.5, gov: -3.0, weight: 0.6, side: 'left' },
  politicalcompassmemes: { econ: 1.0, soc: 0.5, gov: 0.0, weight: 0.5, side: 'center' },
  neutralpolitics: { econ: 0.0, soc: 0.0, gov: 0.0, weight: 0.6, side: 'center' },
  ukpolitics: { econ: -1.5, soc: -2.0, gov: -1.5, weight: 0.5, side: 'center' },
  canadapolitics: { econ: -2.0, soc: -2.5, gov: -1.5, weight: 0.5, side: 'center' },
  australianpolitics: { econ: -2.0, soc: -2.5, gov: -1.5, weight: 0.5, side: 'center' },
};

// Propositional Stance Patterns - Directly detects stance and produces human-readable position statement
const PROPOSITION_PATTERNS = [
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

const DISAGREEMENT_WORDS = new Set([
  'cult', 'delusional', 'stupid', 'idiots', 'corrupt', 'fascist', 'insane', 'moron',
  'garbage', 'liar', 'scam', 'fake', 'disaster', 'evil', 'clown', 'unhinged', 'hypocrite'
]);

function sanitizeTextForPoliticalAnalysis(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText;
  text = text.replace(/^[ \t]*>.*$/gm, ' ');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, ' $1 ');
  text = text.replace(/https?:\/\/\S+/gi, ' ');
  text = text.replace(/(?:\/?r\/|\/?u\/)[A-Za-z0-9_]+/gi, ' ');
  text = text.replace(/\btraditional\s+(?:chinese|japanese|korean|art|drawing|painting|animation|media|food|recipe|dress|garb|instrument|music|dance|craft|tattoo|medicine)\b/gi, ' ');
  return text;
}

function getIdeologicalArchetype(econ, soc) {
  const isEconCenter = Math.abs(econ) <= 2.2;
  const isSocCenter = Math.abs(soc) <= 2.2;

  if (isEconCenter && isSocCenter) return 'Centrist / Moderate';
  if (isEconCenter && soc > 2.2) return 'Authoritarian Center (Auth-Center)';
  if (isEconCenter && soc < -2.2) return 'Libertarian Center (Lib-Center)';

  if (econ < -2.2 && isSocCenter) return 'Left-Center (Social Democrat / Left)';
  if (econ > 2.2 && isSocCenter) return 'Right-Center (Fiscal Conservative / Center-Right)';

  if (econ < -2.2 && soc > 2.2) return 'Authoritarian Left (Auth-Left)';
  if (econ > 2.2 && soc > 2.2) return 'Authoritarian Right (Auth-Right)';
  if (econ < -2.2 && soc < -2.2) return 'Libertarian Left (Lib-Left)';
  if (econ > 2.2 && soc < -2.2) return 'Libertarian Right (Lib-Right)';

  return 'Centrist / Moderate';
}

function getDimensionLabels(econ, soc, gov) {
  const econLabel = econ <= -6.0 ? "Socialist / Democratic Left" : econ <= -2.0 ? "Social Market / Mixed Left" : econ <= 2.0 ? "Centrist / Mixed Economy" : econ <= 6.0 ? "Fiscal Conservative / Pro-Market" : "Laissez-Faire Free Market";
  const socLabel = soc <= -4.0 ? "Progressive / Secular" : soc <= 2.0 ? "Pluralist / Moderate" : "Traditional / Social Conservative";
  const govLabel = gov <= -4.0 ? "Civil Libertarian / Anti-Authoritarian" : gov <= 2.0 ? "Balanced Governance" : "Statist / Law & Order";

  return { econLabel, socLabel, govLabel };
}

function isSarcastic(rawText, snippet) {
  if (!rawText && !snippet) return false;
  const combined = `${rawText} ${snippet}`;

  // Explicit /s or /Sarcasm or (sarcasm)
  if (/(?:^|\s)\/s(?:arcasm)?(?:\s|$|[.!?,;])/i.test(combined)) return true;
  if (/\((?:sarcasm|\?!)\)/i.test(combined) || /\?!\?/i.test(combined)) return true;

  // Mocking alternating caps (e.g. "tOtAlLy gEnIuS")
  if (/(?:[a-z][A-Z][a-z][A-Z]|[A-Z][a-z][A-Z][a-z]){2,}/.test(combined)) return true;

  // Sarcastic rhetorical phrases with quotes/exclamation
  if (/\b(?:yeah right|oh sure|surely|totally|obviously|what could possibly go wrong|because that always works)\b/i.test(combined) && (/[!"]/.test(combined) || combined.toLowerCase().includes("genius"))) return true;

  return false;
}

/**
 * Main Political Compass & Propositional Stance Evaluation
 */
export function evaluatePoliticalCompass({ stats = {}, posts = [], comments = [] } = {}) {
  let totalWeight = 0;
  let weightedEcon = 0;
  let weightedSoc = 0;
  let weightedGov = 0;

  const topSubSignals = [];
  const detectedPositions = [];
  const matchedTopicSet = new Set();

  const subCounts = stats?.subredditCounts || {};

  // 1. Stance-Aware Subreddit Context & Interaction Tone
  // Group user comments by subreddit to check if they were in agreement or debating
  const subCommentMap = new Map();
  for (const c of (comments || [])) {
    const sub = (c.subreddit || '').toLowerCase();
    if (!subCommentMap.has(sub)) subCommentMap.set(sub, []);
    subCommentMap.get(sub).push(c.body || '');
  }
  for (const item of (stats?.sampleItems || [])) {
    const sub = (item.subreddit || '').toLowerCase();
    if (!subCommentMap.has(sub)) subCommentMap.set(sub, []);
    subCommentMap.get(sub).push(item.body || '');
  }

  for (const [subName, count] of Object.entries(subCounts)) {
    const lower = subName.toLowerCase();
    let entry = SUBREDDIT_POLITICAL_MAP[lower];

    if (!entry) {
      if (lower.includes('conserv')) entry = { econ: 6.5, soc: 5.5, gov: 5.0, weight: 0.8, side: 'right' };
      else if (lower.includes('republican') || lower.includes('trump') || lower.includes('maga')) entry = { econ: 7.0, soc: 6.5, gov: 6.0, weight: 0.85, side: 'right' };
      else if (lower.includes('socialis') || lower.includes('communis') || lower.includes('marx')) entry = { econ: -8.0, soc: 2.0, gov: 4.0, weight: 0.85, side: 'left' };
      else if (lower.includes('anarch')) entry = { econ: -7.5, soc: -8.5, gov: -9.0, weight: 0.85, side: 'left' };
      else if (lower.includes('libertarian')) entry = { econ: 7.0, soc: -3.5, gov: -8.0, weight: 0.85, side: 'right' };
      else if (lower.includes('democrat') || lower.includes('liberal') || lower.includes('progressive')) entry = { econ: -5.0, soc: -5.5, gov: -4.5, weight: 0.8, side: 'left' };
      else if (lower.includes('atheis')) entry = { econ: -3.5, soc: -7.5, gov: -6.0, weight: 0.8, side: 'left' };
    }

    if (entry) {
      // Analyze user's tone inside this specific subreddit
      const userSubTexts = (subCommentMap.get(lower) || []).join(' ').toLowerCase();
      const wordsInSub = userSubTexts.split(/[^a-z0-9_-]+/);
      let disagreeCount = 0;
      for (const w of wordsInSub) {
        if (DISAGREEMENT_WORDS.has(w)) disagreeCount++;
      }

      // Only tag if user was engaged in oppositional debate / argument
      let effectiveEcon = entry.econ;
      let effectiveSoc = entry.soc;
      let effectiveGov = entry.gov ?? entry.soc;
      let interactionTag = null;

      if (disagreeCount >= 2 || (disagreeCount >= 1 && count <= 2)) {
        // Invert polarity: user is debating against the subreddit's ideology
        if (entry.side === 'right') {
          effectiveEcon = -5.0;
          effectiveSoc = -5.0;
          effectiveGov = -4.0;
          interactionTag = "Debating";
        } else if (entry.side === 'left') {
          effectiveEcon = 5.0;
          effectiveSoc = 4.0;
          effectiveGov = 3.0;
          interactionTag = "Debating";
        }
      }

      // Pre-existing standard: Log-frequency community weighting (Waller & Anderson, ACM WWW '24)
      const effectiveWeight = Math.log1p(count) * entry.weight;
      weightedEcon += effectiveEcon * effectiveWeight;
      weightedSoc += effectiveSoc * effectiveWeight;
      weightedGov += effectiveGov * effectiveWeight;
      totalWeight += effectiveWeight;

      topSubSignals.push({
        sub: subName,
        count,
        econ: effectiveEcon,
        soc: effectiveSoc,
        interactionTag,
        weight: effectiveWeight,
      });
    }
  }

  // 2. Propositional Stance & Viewpoint Extraction from Comments & Posts
  // Pool active items + all background crawled sample items (hundreds/thousands of historical items)
  const sampleItems = [
    ...(comments || []),
    ...(posts || []),
    ...(stats?.sampleItems || [])
  ];

  for (const item of sampleItems) {
    const rawText = item.body || item.title || item.selftext || '';
    if (!rawText || rawText === '[deleted]' || rawText === '[removed]') continue;
    const text = sanitizeTextForPoliticalAnalysis(rawText);

    // Test each Propositional Stance Pattern
    for (const prop of PROPOSITION_PATTERNS) {
      const match = text.match(prop.pattern);
      if (match && match.index != null) {
        const start = Math.max(0, match.index - 70);
        const end = Math.min(text.length, match.index + match[0].length + 70);
        const snippet = text.slice(start, end).trim();

        // Check Sarcasm
        const sarcastic = isSarcastic(rawText, snippet);

        let effectiveEcon = prop.econ;
        let effectiveSoc = prop.soc;
        let effectiveGov = prop.gov;
        let effectiveStance = prop.stance;
        let effectivePolarity = prop.polarity;

        if (sarcastic) {
          // Invert stance and polarity for sarcastic statements
          effectiveEcon = -prop.econ;
          effectiveSoc = -prop.soc;
          effectiveGov = -prop.gov;
          effectivePolarity = "Opposition";
          effectiveStance = prop.stance.replace(/Supports\s+/i, "Critical of (Sarcastic) ").replace(/Strong\s+Support\s+for/i, "Critical of (Sarcastic)");
          if (!effectiveStance.includes("Sarcastic")) {
            effectiveStance += " (Sarcastic)";
          }
        }

        const w = 4.0; // High confidence propositional assertion
        weightedEcon += effectiveEcon * w;
        weightedSoc += effectiveSoc * w;
        weightedGov += effectiveGov * w;
        totalWeight += w;

        if (!matchedTopicSet.has(prop.topic)) {
          matchedTopicSet.add(prop.topic);
          detectedPositions.push({
            topic: prop.topic,
            stance: effectiveStance,
            polarity: effectivePolarity,
            keyword: prop.searchKw,
            snippet: snippet.length > 90 ? `"...${snippet}..."` : `"${snippet}"`,
            econ: effectiveEcon,
            soc: effectiveSoc
          });
        }
      }
    }
  }

  // 3. Minimum Signal Threshold Calibration
  const hasRealSignal = totalWeight >= 2.5 || detectedPositions.length > 0;

  let econ = 0;
  let soc = 0;
  let gov = 0;
  let confidence = 'Low (Few political markers)';
  let archetype = 'Undetermined / Non-Political Activity';

  if (hasRealSignal && totalWeight > 0) {
    econ = Math.max(-10, Math.min(10, Math.round((weightedEcon / totalWeight) * 10) / 10));
    soc = Math.max(-10, Math.min(10, Math.round((weightedSoc / totalWeight) * 10) / 10));
    gov = Math.max(-10, Math.min(10, Math.round((weightedGov / totalWeight) * 10) / 10));

    if (totalWeight >= 15 || detectedPositions.length >= 2) confidence = 'High (Strong propositional evidence)';
    else if (totalWeight >= 6 || detectedPositions.length >= 1) confidence = 'Moderate (Corroborating positions)';
    else confidence = 'Low (Emerging policy markers)';

    archetype = getIdeologicalArchetype(econ, soc);
  }

  const { econLabel, socLabel, govLabel } = getDimensionLabels(econ, soc, gov);

  return {
    econ,
    soc,
    gov,
    hasSignal: hasRealSignal,
    archetype,
    confidence,
    dimensions: {
      econ: { score: econ, label: hasRealSignal ? econLabel : "Non-Political" },
      soc: { score: soc, label: hasRealSignal ? socLabel : "Non-Political" },
      gov: { score: gov, label: hasRealSignal ? govLabel : "Non-Political" },
    },
    detectedPositions,
    topSubSignals: topSubSignals.sort((a, b) => b.weight - a.weight).slice(0, 6),
  };
}
