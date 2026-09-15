export const THEMES = {
  default: {
    dark: { bg: "#0d0d0d", accent: "#ff4500", tint: "#e6e4e1" },
    light: { bg: "#f3f4f6", accent: "#ff4500", tint: "#111827" }
  },
  nord: {
    dark: { bg: "#2e3440", accent: "#88c0d0" },
    light: { bg: "#eceff4", accent: "#5e81ac" }
  },
  catppuccin: {
    dark: { bg: "#1e1e2e", accent: "#cba6f7" },
    light: { bg: "#eff1f5", accent: "#8839ef" }
  },
  cyber: {
    dark: { bg: "#100a20", accent: "#fcee0a" },
    light: { bg: "#fcee0a", accent: "#100a20" }
  },
  mono: {
    dark: { bg: "#000000", accent: "#ffffff" },
    light: { bg: "#ffffff", accent: "#000000" }
  },
  gruvbox: {
    dark: { bg: "#282828", accent: "#ebdbb2" },
    light: { bg: "#fbf1c7", accent: "#3c3836" }
  },
  dracula: {
    dark: { bg: "#282a36", accent: "#ff79c6" },
    light: { bg: "#f8f8f2", accent: "#d0318d" }
  },
  solarized: {
    dark: { bg: "#002b36", accent: "#859900" },
    light: { bg: "#fdf6e3", accent: "#8b6e00" }
  },
  synthwave: {
    dark: { bg: "#2b213a", accent: "#f92aad" },
    light: { bg: "#f4ecf8", accent: "#f92aad" }
  }
};

export function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
}
export function mix(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return rgbToHex(r1 * t + r2 * (1 - t), g1 * t + g2 * (1 - t), b1 * t + b2 * (1 - t));
}
export function applyTheme(t, isDark) {
  const d = document.documentElement;
  const tint = t.tint || t.accent;
  const base = isDark ? "#ffffff" : "#000000";
  const tintBase = mix(tint, base, 0.3);
  d.style.cssText = [
    `--bg:${t.bg}`,
    `--accent:${t.accent}`,
    `--tint:${tint}`,
    `--text-base:${base}`,
    `--color-scheme:${isDark ? "dark" : "light"}`,
    `--accent-text:${mix(tint, base, 0.7)}`,
    `--text:${tintBase}`,
    `--text-muted:${mix(tint, mix(base, t.bg, 0.65), 0.3)}`,
    `--text-faint:${mix(tint, mix(base, t.bg, 0.45), 0.2)}`,
    `--border:${mix(tintBase, t.bg, 0.18)}`,
    `--border-hover:${mix(tintBase, t.bg, 0.28)}`,
    `--bg-elevated:${mix(tintBase, t.bg, 0.08)}`,
  ].join(";");
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.bg);
}

export function safeGet(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — theme still applies in-memory */
  }
}
