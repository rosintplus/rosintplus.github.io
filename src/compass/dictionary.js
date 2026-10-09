/**
 * Political content-analysis dictionary.
 *
 * Structure follows the a-priori dictionary method of
 *   Laver, M. & Garry, J. (2000) "Estimating Policy Positions from Political
 *   Texts", British Journal of Political Science 30(4): 611-632,
 * as used by the Comparative Manifesto Project: text is coded into
 * *categories*, each category belongs to one policy dimension and to one
 * *pole* of that dimension, and a policy position is the relative balance of
 * the two poles (see textscore.js).
 *
 * Each entry declares `dims`, a map of dimension -> pole (-1 or +1). A single
 * phrase routinely signals more than one dimension ("universal healthcare" is
 * economically left *and* a statist reading of civil authority), so an entry
 * may score on several dimensions at once. `weight` is the category salience
 * used as the CMP-style category weight; it never exceeds 1 here because the
 * estimator is a ratio and per-category magnitudes would reintroduce the
 * arbitrariness this method exists to avoid.
 *
 * The three dimensions match the plotted grid (x = econ, y = gov):
 *   econ  -10 state / labour  ...  +10 free market
 *   soc   -10 progressive     ...  +10 traditional
 *   gov   -10 civil liberty   ...  +10 authority
 */

export const DIMENSIONS = ["econ", "soc", "gov"];

export const DIMENSION_LABELS = {
  econ: { neg: "State / Labour", pos: "Free Market" },
  soc: { neg: "Progressive", pos: "Traditional" },
  gov: { neg: "Civil Liberty", pos: "Authority" },
};

/**
 * Categories. `dims` gives the pole on each dimension the phrase implies.
 * A category with `invertOnNegate: true` is an *avowal* — "I support X" —
 * so a negated occurrence ("I don't support X") signals the opposite pole
 * rather than being discarded.
 */
export const CATEGORIES = [
  // ── Economic: state vs market ──────────────────────────────────────────────
  {
    topic: "Universal Healthcare",
    stance: "Supports universal public healthcare",
    dims: { econ: -1, gov: -1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "healthcare",
    patterns: [
      /\b(?:universal\s+healthcare|medicare\s+for\s+all|single\s+payer|nationali[sz]ed\s+health(?:care)?|nhs\s+style)\b/i,
      /\bhealthcare\s+is\s+a\s+(?:human|fundamental)\s+right\b/i,
      /\b(?:free|public)\s+healthcare\b/i,
    ],
  },
  {
    topic: "Market Healthcare",
    stance: "Prefers market-based healthcare",
    dims: { econ: +1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "healthcare",
    patterns: [
      /\b(?:privati[sz]e|deregulate)\s+(?:the\s+)?(?:healthcare|nhs|health\s+system)\b/i,
      /\b(?:free\s+market|market\s+based)\s+healthcare\b/i,
      /\bobamacare\s+(?:is\s+a\s+)?(?:disaster|failure|trainwreck|socialism)\b/i,
    ],
  },
  {
    topic: "Taxation & Redistribution",
    stance: "Supports progressive taxation and redistribution",
    dims: { econ: -1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "tax",
    patterns: [
      /\b(?:tax\s+the\s+rich|wealth\s+tax|higher\s+taxes\s+on\s+(?:the\s+)?(?:rich|wealthy|billionaires?))\b/i,
      /\b(?:billionaires?\s+should\s+not\s+exist|eat\s+the\s+rich|there\s+should\s+be\s+no\s+billionaires?)\b/i,
      /\b(?:living\s+wage|raise\s+the\s+minimum\s+wage|rent\s+control|cancel\s+student\s+debt)\b/i,
    ],
  },
  {
    topic: "Low Tax & Small State",
    stance: "Supports low taxation and limited government spending",
    dims: { econ: +1, gov: +1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "taxes",
    patterns: [
      /\b(?:taxation\s+is\s+theft|taxes?\s+are\s+(?:theft|too\s+high)|cut\s+(?:taxes|spending))\b/i,
      /\b(?:small\s+government|limited\s+government|fiscal\s+responsibility|balanced\s+budget)\b/i,
      /\b(?:deregulat(?:e|ion)|privati[sz](?:e|ation)|free\s+market\s+capitalism|laissez\s*faire)\b/i,
    ],
  },
  {
    topic: "Labour & Unions",
    stance: "Supports organised labour and worker power",
    dims: { econ: -1 },
    invertOnNegate: true,
    weight: 0.9,
    searchKw: "unions",
    patterns: [
      /\b(?:unioni[sz]e|union\s+strong|solidarity\s+with\s+(?:the\s+)?workers?|workers?\s+of\s+the\s+world)\b/i,
      /\b(?:workers?\s+rights|collective\s+bargaining|strike\s+for\s+(?:better|fair))\b/i,
    ],
  },
  {
    topic: "Corporate Power",
    stance: "Critical of corporate and landlord power",
    dims: { econ: -1 },
    invertOnNegate: true,
    weight: 0.9,
    searchKw: "corporations",
    patterns: [
      /\b(?:corporate\s+greed|greedy\s+(?:landlords?|corporations?)|exploit(?:ed|ation)\s+by\s+(?:the\s+)?rich)\b/i,
      /\b(?:late\s+stage\s+capitalism|end\s+capitalism|down\s+with\s+capitalism)\b/i,
    ],
  },

  // ── Social: progressive vs traditional ────────────────────────────────────
  {
    topic: "Reproductive Rights",
    stance: "Supports abortion access and reproductive autonomy",
    dims: { soc: -1, gov: -1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "abortion",
    patterns: [
      /\b(?:pro[- ]?choice|abortion\s+(?:rights?|access)|reproductive\s+(?:freedom|rights|justice))\b/i,
      /\b(?:my\s+body\s+my\s+choice|bodily\s+autonomy|roe\s+v\.?\s*wade)\b/i,
    ],
  },
  {
    topic: "Opposition to Abortion",
    stance: "Opposes abortion access",
    dims: { soc: +1, gov: +1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "pro-life",
    patterns: [
      /\b(?:pro[- ]?life|anti[- ]?abortion|ban\s+abortion|sanctity\s+of\s+(?:human\s+)?life)\b/i,
      /\b(?:heartbeat\s+bill|unborn\s+(?:babies|children)|life\s+begins\s+at\s+conception)\b/i,
    ],
  },
  {
    topic: "LGBTQ+ Rights",
    stance: "Supports LGBTQ+ rights and acceptance",
    dims: { soc: -1, gov: -1 },
    invertOnNegate: true,
    weight: 0.95,
    searchKw: "lgbtq",
    patterns: [
      /\b(?:lgbtq?\+?\s+rights?|marriage\s+equality|same\s+sex\s+marriage|trans\s+rights)\b/i,
      /\b(?:homophobia|transphobia)\s+(?:is|are)\s+(?:wrong|unacceptable|disgusting)\b/i,
    ],
  },
  {
    topic: "Traditional Social Order",
    stance: "Values traditional family and social roles",
    dims: { soc: +1 },
    invertOnNegate: true,
    weight: 0.9,
    searchKw: "tradition",
    patterns: [
      /\b(?:traditional\s+(?:family|values|marriage)|family\s+values|gender\s+roles)\b/i,
      /\b(?:western\s+(?:civilisation|civilization|values)\s+(?:is|are)\s+(?:worth|worthwhile|under\s+threat))\b/i,
    ],
  },
  {
    topic: "Secular Government",
    stance: "Supports separation of church and state",
    dims: { soc: -1, gov: -1 },
    invertOnNegate: true,
    weight: 0.9,
    searchKw: "secularism",
    patterns: [
      /\b(?:separation\s+of\s+church\s+and\s+state|secular\s+(?:government|society|democracy))\b/i,
      /\b(?:anti[- ]?theist|god\s+is\s+not\s+real|religion\s+(?:is|has\s+no\s+place)\s+(?:a\s+)?(?:poison|in\s+politics))\b/i,
    ],
  },
  {
    topic: "Religious Public Role",
    stance: "Values religious faith in public life",
    dims: { soc: +1, gov: +1 },
    invertOnNegate: true,
    weight: 0.9,
    searchKw: "faith",
    patterns: [
      /\b(?:christian\s+(?:nation|values)|biblical\s+(?:truth|values)|god\s+fearing|faith\s+based)\b/i,
      /\b(?:god\s+is\s+good|glory\s+to\s+god|praise\s+(?:god|the\s+lord))\b/i,
    ],
  },
  {
    topic: "Climate Action",
    stance: "Supports aggressive climate policy",
    dims: { econ: -1, soc: -1, gov: -1 },
    invertOnNegate: true,
    weight: 0.95,
    searchKw: "climate",
    patterns: [
      /\b(?:green\s+new\s+deal|climate\s+crisis|climate\s+change\s+is\s+real|climate\s+emergency)\b/i,
      /\b(?:renewable\s+energy|carbon\s+tax|stop\s+fossil\s+fuels|net\s+zero)\b/i,
    ],
  },
  {
    topic: "Climate Scepticism",
    stance: "Sceptical of climate policy and climate science",
    dims: { econ: +1, soc: +1 },
    invertOnNegate: true,
    weight: 0.95,
    searchKw: "climate",
    patterns: [
      /\b(?:climate\s+(?:hoax|scam|alarmis\w+|change\s+is\s+(?:fake|a\s+hoax)))\b/i,
      /\b(?:it'?s\s+(?:just\s+)?weather|nothing\s+to\s+do\s+with\s+humans?|co2\s+is\s+(?:plant\s+food|not\s+a\s+pollutant))\b/i,
    ],
  },
  {
    topic: "Immigration Restriction",
    stance: "Favours restricting immigration",
    dims: { soc: +1, gov: +1 },
    invertOnNegate: true,
    weight: 0.95,
    searchKw: "immigration",
    patterns: [
      /\b(?:secure\s+the\s+border|build\s+the\s+wall|mass\s+deportation|close\s+the\s+border)\b/i,
      /\b(?:illegal\s+alien|illegal\s+invasion|remigration|great\s+replacement)\b/i,
    ],
  },
  {
    topic: "Immigrant Rights",
    stance: "Supports immigrant rights and asylum",
    dims: { soc: -1, gov: -1 },
    invertOnNegate: true,
    weight: 0.95,
    searchKw: "immigration",
    patterns: [
      /\b(?:pathway\s+to\s+citizenship|abolish\s+ice|refugees?\s+welcome|sanctuary\s+city)\b/i,
      /\b(?:humane\s+immigration|dreamers?|daca|no\s+human\s+is\s+illegal)\b/i,
    ],
  },

  // ── Civil authority: liberty vs order ─────────────────────────────────────
  {
    topic: "Gun Rights",
    stance: "Supports broad firearm ownership rights",
    dims: { gov: -1, econ: +1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "guns",
    patterns: [
      /\b(?:second\s+amendment|2a\s+rights?|gun\s+rights|constitutional\s+carry)\b/i,
      /\b(?:shall\s+not\s+be\s+infringed|pro[- ]?gun|the\s+right\s+to\s+bear\s+arms)\b/i,
    ],
  },
  {
    topic: "Gun Control",
    stance: "Supports firearm restrictions",
    dims: { gov: +1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "gun control",
    patterns: [
      /\b(?:gun\s+control|ban\s+(?:assault\s+weapons?|ar[- ]?15)|universal\s+background\s+checks)\b/i,
      /\b(?:red\s+flag\s+laws?|nobody\s+needs\s+(?:a\s+)?(?:assault\s+rifle|gun))\b/i,
    ],
  },
  {
    topic: "Civil Liberties & Privacy",
    stance: "Opposes surveillance, censorship and state overreach",
    dims: { gov: -1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "privacy",
    patterns: [
      /\b(?:mass\s+surveillance|government\s+overreach|warrantless\s+(?:searches|surveillance))\b/i,
      /\b(?:right\s+to\s+privacy|end[- ]to[- ]end\s+encryption|digital\s+privacy|anti\s+censorship)\b/i,
      /\b(?:freedom\s+of\s+speech\s+is\s+(?:under\s+attack|absolute)|defend\s+free\s+speech)\b/i,
    ],
  },
  {
    topic: "Law & Order",
    stance: "Values policing, enforcement and public order",
    dims: { gov: +1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "law and order",
    patterns: [
      /\b(?:law\s+and\s+order|back\s+the\s+blue|blue\s+lives\s+matter|support\s+the\s+police)\b/i,
      /\b(?:tough\s+on\s+crime|lock\s+(?:them|him|her)\s+up|crack\s+down\s+on\s+crime)\b/i,
    ],
  },
  {
    topic: "Policing Criticism",
    stance: "Critical of police power and conduct",
    dims: { gov: -1 },
    invertOnNegate: true,
    weight: 1,
    searchKw: "police",
    patterns: [
      /\b(?:police\s+brutality|defund\s+the\s+police|acab|all\s+cops\s+are\s+bastards)\b/i,
      /\b(?:end\s+qualified\s+immunity|police\s+(?:violence|state|reform))\b/i,
    ],
  },
  {
    topic: "Drug Decriminalisation",
    stance: "Supports drug decriminalisation or legalisation",
    dims: { gov: -1, soc: -1 },
    invertOnNegate: true,
    weight: 0.85,
    searchKw: "drugs",
    patterns: [
      /\b(?:legali[sz]e\s+(?:it|cannabis|marijuana|weed|drugs)|end\s+the\s+war\s+on\s+drugs)\b/i,
      /\b(?:decriminali[sz]e\s+drugs|drug\s+policy\s+reform|harm\s+reduction)\b/i,
    ],
  },
  {
    topic: "Military & Foreign Intervention",
    stance: "Supports military strength or intervention",
    dims: { gov: +1, econ: +1 },
    invertOnNegate: true,
    weight: 0.85,
    searchKw: "military",
    patterns: [
      /\b(?:peace\s+through\s+strength|strong\s+(?:military|defence|defense)|support\s+our\s+troops)\b/i,
      /\b(?:we\s+need\s+to\s+(?:invade|bomb|intervene)|boots\s+on\s+the\s+ground)\b/i,
    ],
  },
  {
    topic: "Anti-Interventionism",
    stance: "Opposes military intervention and war",
    dims: { gov: -1, econ: -1 },
    invertOnNegate: true,
    weight: 0.85,
    searchKw: "anti-war",
    patterns: [
      /\b(?:anti[- ]?war|end\s+(?:the\s+)?wars?|no\s+more\s+forever\s+wars)\b/i,
      /\b(?:bring\s+the\s+troops\s+home|war\s+(?:is\s+a\s+)?racket|stop\s+the\s+bombing)\b/i,
    ],
  },

  // ── Explicit self-identification (highest salience, CMP "per6xx" style) ────
  {
    topic: "Ideological Self-Identification",
    stance: "Declares an explicit political identity",
    dims: {},
    identity: true,
    weight: 1,
    searchKw: "identity",
    patterns: [
      // Left-libertarian family
      /\b(?:i(?:'m| am| consider myself| identify as)|as\s+a)\s+(?:[\w-]+\s+){0,4}(?:libleft|lib[- ]?left|libertarian\s+(?:left|socialist)|democratic\s+socialist|socialist|anarchist|anarcho[\s-]?(?:syndicalist|communist))\b/i,
      // Authoritarian left
      /\b(?:i(?:'m| am| consider myself| identify as)|as\s+a)\s+(?:[\w-]+\s+){0,4}(?:authleft|auth[- ]?left|authoritarian\s+left|marxist[\s-]?leninist|communist|tankie)\b/i,
      // Right-libertarian family
      /\b(?:i(?:'m| am| consider myself| identify as)|as\s+a)\s+(?:[\w-]+\s+){0,4}(?:libright|lib[- ]?right|libertarian\s+right|anarcho[\s-]?capitalist|ancap|classical\s+liberal|objectivist)\b/i,
      // Authoritarian right
      /\b(?:i(?:'m| am| consider myself| identify as)|as\s+a)\s+(?:[\w-]+\s+){0,4}(?:authright|auth[- ]?right|authoritarian\s+right|monarchist|fascist|nationalist|paleoconservative|theocrat)\b/i,
      // Centrist / other
      /\b(?:i(?:'m| am| consider myself| identify as)|as\s+a)\s+(?:[\w-]+\s+){0,4}(?:centrist|moderate|neoliberal|social\s+democrat|green|libertarian)\b/i,
    ],
  },

  // ── Party / factional alignment ───────────────────────────────────────────
  {
    topic: "Left Party Alignment",
    stance: "Aligns with left or progressive parties",
    dims: { econ: -1, soc: -1, gov: -1 },
    invertOnNegate: true,
    weight: 0.9,
    searchKw: "vote blue",
    patterns: [
      /\b(?:vote\s+blue|blue\s+wave|i\s+vote(?:d)?\s+(?:labour|labour|democrat|green|left))\b/i,
      /\b(?:the\s+)?(?:gop|republicans?|tories)\s+(?:are|is|were)\s+(?:[\w\s]{0,24})(?:evil|corrupt|insane|fascists?|clowns?|unhinged|morons?|a\s+threat)\b/i,
      /\b(?:fuck|impeach|prosecute|jail)\s+(?:trump|the\s+gop|the\s+republicans)\b|\bnever\s+trump\b|\banti[- ]?trump\b/i,
    ],
  },
  {
    topic: "Right Party Alignment",
    stance: "Aligns with right or conservative parties",
    dims: { econ: +1, soc: +1, gov: +1 },
    invertOnNegate: true,
    weight: 0.9,
    searchKw: "vote red",
    patterns: [
      /\b(?:vote\s+red|red\s+wave|trump\s+202[48]|maga\s+forever|let'?s\s+go\s+brandon)\b/i,
      /\b(?:i\s+vote(?:d)?\s+(?:tory|conservative|republican|gop|right))\b/i,
      /\b(?:the\s+)?(?:democrats?|liberals?|leftists?|socialists?)\s+(?:are|is|were)\s+(?:[\w\s]{0,24})(?:evil|corrupt|insane|ruining|communists?|clowns?|destroying)\b/i,
      /\b(?:love|support|voted?\s+for)\s+trump\b|\bstand\s+with\s+trump\b/i,
    ],
  },
];

/**
 * Words signalling that the author is *arguing against* the community they are
 * posting in, rather than with it. Used only to discount community evidence,
 * never to flip a textual position.
 */
export const DISAGREEMENT_WORDS = new Set([
  "no", "nope", "wrong", "disagree", "disagreeing", "disagreed", "nonsense",
  "rubbish", "garbage", "bullshit", "bs", "ridiculous", "absurd", "false",
  "debunked", "debunk", "myth", "lies", "lying", "liar", "propaganda",
  "actually", "however", "but", "except", "unfortunately", "regardless",
  "oppose", "opposed", "opposing", "against", "reject", "rejected", "rejecting",
  "deny", "denies", "denying", "refute", "refuted", "refuting", "counter",
  "misleading", "misinformation", "disinformation", "delusional", "cult",
  "brainwashed", "sheep", "ignorant", "stupid", "idiot", "idiots", "moron",
  "morons", "clown", "clowns", "disgrace", "embarrassing", "shameful",
  "never", "stop", "quit", "enough", "tired", "sick", "hate", "worst",
  "criticise", "criticize", "criticised", "criticized", "criticism",
]);

/**
 * Negation cues. A negation flips the pole of an avowal category within its
 * scope window (see textscore.js). Standard content-analysis practice:
 * "I do not support universal healthcare" must not code as support.
 */
export const NEGATION_CUES = new Set([
  "not", "no", "never", "dont", "don't", "doesnt", "doesn't", "didnt",
  "didn't", "wont", "won't", "wouldnt", "wouldn't", "cant", "can't",
  "cannot", "couldnt", "couldn't", "shouldnt", "shouldn't", "isnt", "isn't",
  "arent", "aren't", "wasnt", "wasn't", "werent", "weren't", "aint", "ain't",
  "without", "against", "oppose", "opposed", "opposing", "reject", "rejected",
  "rejecting", "refuse", "refused", "refusing", "stop", "end", "abolish",
  "repeal", "ban", "block", "deny", "denied", "doubt", "skeptical", "sceptical",
  "skeptic", "sceptic", "fake", "hoax", "myth", "lie", "lies", "nonsense",
]);

/** Cues that the sentence is a question, not an assertion of position. */
export const QUESTION_CUES = /^(?:who|what|when|where|why|how|is|are|was|were|do|does|did|can|could|would|should|will|shall|has|have|had|am|if|whether|anyone|someone|anybody|somebody|does\s+anyone|is\s+it\s+true)\b/i;
