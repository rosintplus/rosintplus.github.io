export const weightedCache = new Map();

export function getArchetypeColorClass(archetype = '') {
  const a = archetype.toLowerCase();
  if (!a || a.includes('insufficient') || a.includes('non-political')) {
    return "bg-[color:var(--bg)] text-[color:var(--text-muted)] border border-[color:var(--border)]";
  }
  if (a.includes('auth-left') || a.includes('socialist') || a.includes('communist')) {
    return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 font-medium";
  }
  if (a.includes('auth-right') || a.includes('conservative') || a.includes('traditional')) {
    return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 font-medium";
  }
  if (a.includes('lib-left') || a.includes('progressive') || a.includes('social democrat')) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-medium";
  }
  if (a.includes('lib-right') || a.includes('libertarian right') || a.includes('capitalist')) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-medium";
  }
  if (a.includes('libertarian') || a.includes('lib-center')) {
    return "bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30 font-medium";
  }
  if (a.includes('auth-center') || a.includes('statist')) {
    return "bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 font-medium";
  }
  return "bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/30 font-medium";
}

export function getPolarityColorClass(polarity = '') {
  const p = polarity.toLowerCase();
  if (p.includes('left') || p.includes('prog')) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30";
  }
  if (p.includes('right') || p.includes('trad')) {
    return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30";
  }
  if (p.includes('libertarian') || p.includes('lib')) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30";
  }
  if (p.includes('statist') || p.includes('auth') || p.includes('order')) {
    return "bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30";
  }
  return "bg-[color:var(--bg)] text-[color:var(--text-muted)] border border-[color:var(--border)]";
}

export function getQuadrantArchetype(econ = 0, gov = 0, rawArchetype = '') {
  const a = (rawArchetype || '').trim();
  // Thresholds ±2.2 to match getIdeologicalArchetype (econ × gov quadrant).
  const isLeft = econ < -2.2;
  const isRight = econ > 2.2;
  const isAuth = gov > 2.2;
  const isLib = gov < -2.2;

  if (isAuth && isLeft) {
    if (a && (a.toLowerCase().includes('auth-left') || a.toLowerCase().includes('socialist') || a.toLowerCase().includes('communist') || (a.toLowerCase().includes('left') && !a.toLowerCase().includes('lib')))) return a;
    return "Authoritarian Left (Auth-Left)";
  }
  if (isAuth && isRight) {
    if (a && (a.toLowerCase().includes('auth-right') || a.toLowerCase().includes('conservative') || a.toLowerCase().includes('traditional') || a.toLowerCase().includes('nationalist') || (a.toLowerCase().includes('right') && !a.toLowerCase().includes('lib')))) return a;
    return "Authoritarian Right (Auth-Right)";
  }
  if (isLib && isLeft) {
    if (a && (a.toLowerCase().includes('lib-left') || a.toLowerCase().includes('social democrat') || a.toLowerCase().includes('democratic socialist') || (a.toLowerCase().includes('left') && a.toLowerCase().includes('lib')))) return a;
    return "Libertarian Left (Lib-Left)";
  }
  if (isLib && isRight) {
    if (a && (a.toLowerCase().includes('lib-right') || a.toLowerCase().includes('capitalist') || a.toLowerCase().includes('market') || a.toLowerCase().includes('classical liberal') || (a.toLowerCase().includes('right') && a.toLowerCase().includes('lib')))) return a;
    return "Libertarian Right (Lib-Right)";
  }
  if (isLib) return a && a.toLowerCase().includes('lib') ? a : "Libertarian Center";
  if (isAuth) return a && a.toLowerCase().includes('auth') ? a : "Authoritarian Center";
  if (isLeft) return a && a.toLowerCase().includes('left') ? a : "Center-Left";
  if (isRight) return a && a.toLowerCase().includes('right') ? a : "Center-Right";
  return a || "Centrist / Moderate";
}
