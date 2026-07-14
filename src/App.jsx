import { useState, useCallback, useEffect, useMemo, Component, memo, useRef } from "react";


function downloadFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── API Config ───────────────────────────────────────────────────────────────

const ARCTIC   = "https://arctic-shift.photon-reddit.com";
const PULLPUSH = "https://api.pullpush.io";
const REDDIT_BASE = "https://www.reddit.com";
const LIMIT = 100;

// Usernames that have requested removal. Lowercase, no "u/" prefix.
// Adding a name here makes the site refuse to query the archives for it.
// SHA-256 hashes of removed usernames (lowercased, "u/" stripped).
// Hashed so the names appear nowhere in the repo or the shipped bundle.
const BLOCKED_HASHES = [
    "8bd59e71d4a48c92f73d33cfb78ef5a269522357c0588b4b9445d47aaca52405",
    "b8d2f2804ee639cb85854c23f923c62e9885c109de66f38ba54defdfb6e1660c",
    "583be79a3d8aee4309ba3d41d01422159077cc8aae9de40595c1f2831a38f8da",
    "bec537572fbafac5d44dfb065d815ebd4d21861e93587c358e75b0d2ef8dbba6",
    "af73b329e7b4d79252e07829c5a9634d3d48e199a306bff3e6904e9588a29a1e",
    "7d63776df7e0f3f0b2887c712f06c6ef2ec232f24dee686d0af3e0b9664acb89",
    "13cdc20417809368f182116d8003c138f44dbf58f8a8f95fe4b8375613246313",
    "7ffb36a07c0c8505032b119f0db6cc1851dbbfac30f8aefd3702b58d160c9d3f",
    "f677d7f57fd90e759d40372ff796563d240c184be9cf3676c820dd1cf5a17461",
    "7d42355a149b227b525a246d624bdf4351f3059d457095077372a8b64b0609b7",
    "dd3e1d8fc94877e1970764a7075c1616c6bd02f480e7b4c2e63ac4f00364f925",
    "ae27b421885247f764ee8753cf7c3e3a3b1c1963618a27a18683347766255e94",
    "23619d18b6f19ec12fd864c23c4d0ffc1214c25b5a55ec5998ddc6ddeef9df47",
    "93b378a0b8911af4d5395bb88ddcfbc81f76cc6e8c40defabdcc145e2d022c88",
    "040cff49d19c5134ccc4cb1a239e199f188a46c42d5cc3e594f7ca7d003daf2e",
    "17a2b6d95d245f38b387b2e7131af50f39f88943fdec91940038ed4f5f5eb3fb",
    "2a4c3a5844c8689713583c6af2df8f257b9d17e718dfefa060043799e6e45e17",
    "29a1c927cf8f595f9adb6551c6cb633c0bf0024541459f73db99a295e5e99e24",
    "084d1c94a29de378aa8490e420dff45c429a48493eb7a975a70bddcc32003526",
    "79d21778a44478aa491753befc4fd8f170e1e4b66123549481a7f984caa0ce8d",
    "da0d42d0b53e491d1c0acf8480f8d73ac4b264ae6b7cdf08f59bab1afb39dc02",
    "5b90dd4eca41403b8954709c286127f76f6d56aaf235db020ebba53a11fc0132",
    "d8d0d3a78028ae99d6cc5cf98c846332daeb9865fd1d54f3deee135844a67d5d",
    "4ffd5cbb86357bcfae141ac6e4859cdd9985dad3116c22feb30e486ae4d379d2",
    "d336a76c9607e41bc72134037cc1e8818d6548550eb9de32384a6123b50464bd",
    "756552c5903fd2fb88d8cb9f398eb0ec429e6b7e2581455197c82adaf1ded3ec",
    "26653de8bd258a0c348b9b3e3bc92235be6e0a09a1656e5365070f4fc6528889",
    "c23033e8d65daeca5b8878fac380c6a88119140fa9168f63c0940aa2d77a5b6d",
    "736cb54695611602105f36c7ecfa50cc0c2dc203f739679b884657c526568567",
    "3f000e3cb52822a4790325a4e7d1925134238d158ae09129d23aee30e07b1e49",
    "41791bd986b32b7ef22c43687802b23a9b5bcd1cfaff75d37f44806c71bfec44",
    "fff65ed78c51bacf83c6ef0b58bfb4ea387273c8f336b4693d10597dad14034d",
    "8ff9e4dc6fa5ceb7ab4f7bfb31253f63b56fd7fad26f943f383989fe4518dd86",
    "8f596967a0dd7d76d4fe653eeda763d475d0e29734c7d2e70948aeb7cbcca089",
    "8e1bb9c645ad76c3085cff5272f85230acaeb5d47cc2b214c37381abbd42a96a",
    "98a8a752238eef907f9e69bdd2ef8a802d2846b20e0eba85efbd8fe7f7f37f73",
    "92a656b3b5e41de62a21fdc03953d53f9b5698c8a39a7effb2660bb52034c20b",
    "45c4f2d945d857b55363f7d3229e4e6e14a0b61ead60af9aaf7a8a2ede136fe3",
    "2ff45adab30d7c6e0b5690c36498916c35e796365f2b3d8e06297d3f8a647642",
    "436fb7acf92e3fe749226f39452ca2cdb77905cb3c844c30392bb125ecd68572",
    "7dd1634e9c3658f9ba83126298fb6abc3cf80d42c98975e63b0fec1016181d0f",
    "aa1ce5a250dfea9a6a896e4c286f5455f4df4265d231ad1e81b62e58782d4c42",
    "cbb246910799a45592bf6e5c56689eaf4c5f126e0ab15a0d9fe2561828dfbbc8",
    "01028ef25029a0f7980fe4f7913dbd4971fd7f57546cd84d317e30d963f69d88",
    "6b01a248ecd6c229aec29c799f2282841da8d5d0310db0a5178ac2e2cfc59c9f",
    "0606cacac6070843928fee448c74023c497f84fd8fe9792c70928910a4552dc0",
    "c0a520b1a48cee4cbda1c8c6d7a53660f774e20459dc536726a6d37bdd57cb31",
    "68aa629eecb8a4be931a406714d01108e1dc271f36fa4d7a625a6aea051979f9",
    "f1db369cdb945be52691345a150978897a9f51d8f4780be67f8a042860df89f9",
    "eee98ebf4a5a27181cbdfe07fc6e134d6f69f6459458d28cb918791b5dde9b15",
    "148682b6ec13b5a2d7c3af93504940e172ffb9ecd8939852b6e9dcfa75be7ec0",
    "378014fb44e18c9adcad0dc6748bec267ddcd8efa21e48bf2b35b4985b0d3e7f",
    "a8519803b3bd803fe06c7d33e128baab28daf61b8e9272dd9101664528e8cb6e",
    "812a2a2a218e67e29e7953ec64f784f93bf8e3e5b472ec0c3c380ec834bbccef",
    "f791fcc22d559470bc7427ff5003c3583cd8fe423361ce7b6e254b7eb82f2696",
    "60cbf58bbe7db7da0910f2e55eecf0602b08612234429a79731a5b6a6e7bb613",
    "5c8eaa30e52203f4ba1636c4055706afad818d7ec6b7475fdb319cf537ac0e71",
    "2317b657e1713844acfe0195ee45a7af0d7d48dbd1ecfd094603c6dbcd7491f7",
    "209f4cde08a9cbaf362d0304a5589f9bd87944d36f12329e893a0b30a9e054b5",
    "401d71835b22f55c5a52bd7b2a4d9c9cd42c8073ce95b88f80f5f43a723a25f2",
    "8c1fecb83af9aecf17e943b18e3ce12937d99151cbf68dd3eb294c672c24a8ae",
    "1828ae338086c8f8fc5366a7bf86a145fae6e662e7833c597c37873c44ccf757",
    "34066647a7368b2dbf0ec1f1415e0e23ecdc8340fdb9a74d0132e529619e3fa0",
    "e6a0cf39e603716e7a01641afae9930d17225ce18c3e0ce4b9b586dfd045a32c",
    "3cb9fb9a376a84b290e464cc4d7b442c208c7e25747ca3895c6f8f1a65ab4538",
    "1a1758564c8899fa784e982fcd11e61235b17c0ab05795deac4b3706fef6511b",
    "b15b37f137afe4ebc4c252063d994ce6eb0c38644c033f0961a5bbee0c1d17fb",
    "feacc31099d96b5d5cd1421d03b95fc4ddd7014f5e9e0ffe994e10511155096e",
    "86797e5a810b1d2e9792da810d2e8bedaaffe0babf86902bef218c1c138e0c77",
    "58a835fe77843692f683a97869fbb10868dc1291e1ff7809181a3043871d5e5e",
    "fc9d5879ecfc2cbe373b0bc0cedc42b7173b3038c65a38ac26a26eb7493bda15",
    "9b30fcb4eaa40234d09779df93d4618b6583f1ff2123ba6d15ba0073a1ab51fc"
];
// Strip anything users paste around a username: @, leading slashes, full
// reddit URLs, and u/ /u/ user/ prefixes. Returns the bare username.
function normalizeUsername(input) {
    let s = String(input || "").trim();
    // Full URL → keep only the path after the domain
    s = s.replace(/^https?:\/\/(www\.|old\.|new\.)?reddit\.com/i, "");
    // Leading slashes, then optional u/ /user/ prefix, then a leading @
    s = s.replace(/^\/+/, "").replace(/^(u|user)\//i, "").replace(/^@/, "");
    // Drop any trailing slash / query / whitespace
    s = s.replace(/[/?#].*$/, "").trim();
    return s;
}

async function isBlockedUser(name) {
    const norm = normalizeUsername(name).toLowerCase();
    if (!norm) return false;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return BLOCKED_HASHES.includes(hex);
}

function buildUrls(username, type, pagination = {}, dateFilters = {}) {
    const base = [
        `limit=${LIMIT}`,
        `sort=desc`,
        `author=${encodeURIComponent(username)}`,
    ];

    if (dateFilters.subreddit) {
        base.push(`subreddit=${encodeURIComponent(dateFilters.subreddit)}`);
    }

    // NSFW is a post-only field; Arctic Shift honors over_18 server-side.
    if (type === "posts" && dateFilters.over18 != null) {
        base.push(`over_18=${dateFilters.over18}`);
    }

    if (pagination.before) {
        base.push(`before=${pagination.before}`);
    } else if (dateFilters.dateTo) {
        base.push(`before=${dateFilters.dateTo}`);
    }

    if (pagination.after) {
        base.push(`after=${pagination.after}`);
    } else if (dateFilters.dateFrom) {
        base.push(`after=${dateFilters.dateFrom}`);
    }

    const qs = base.join("&");

    return {
        arctic: type === "posts"
            ? `${ARCTIC}/api/posts/search?${qs}`
            : `${ARCTIC}/api/comments/search?${qs}`,
        pullpush: type === "posts"
            ? `${PULLPUSH}/reddit/search/submission/?test&${qs}`
            : `${PULLPUSH}/reddit/search/comment/?test&${qs}`,
    };
}

// ─── Helpers ───────

function timeAgo(utc) {
    const s = Math.floor(Date.now() / 1000 - utc);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 365) return `${d}d ago`;
    return `${Math.floor(d / 365)}y ago`;
}

function fullTimestamp(utc) {
    // Reddit created_utc is UTC seconds; rendered in the viewer's local timezone.
    return new Date(utc * 1000).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
    });
}

// Relative date ("3d ago") with a fast custom tooltip showing the exact time on
// hover. Uses a scoped group (group/time) so it isn't triggered by the card's
// own group-hover, and a 75ms fade instead of the browser's slow native title.
function HoverTime({ utc }) {
    return (
        <span className="relative inline-block group/time">
            {timeAgo(utc)}
            <span className="pointer-events-none absolute top-full left-0 mt-1 z-50 whitespace-nowrap rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] px-2 py-1 text-[11px] text-[color:var(--text)] opacity-0 group-hover/time:opacity-100 transition-opacity duration-75 shadow-lg shadow-black/40">
                {fullTimestamp(utc)}
            </span>
        </span>
    );
}

// Wraps a clickable image and shows a hint that follows the cursor. Uses a
// fixed-position tooltip so it appears instantly at the pointer and isn't
// clipped by the card's overflow-hidden.
function HoverImageHint({ hint, className = "", children }) {
    const [pos, setPos] = useState(null);
    const track = (e) => setPos({ x: e.clientX, y: e.clientY });
    let style;
    if (pos) {
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        // Keep the tooltip on-screen near the right edge; fall back to a plain
        // offset if the viewport width isn't available.
        const left = vw ? Math.min(pos.x + 14, vw - 180) : pos.x + 14;
        style = { left, top: pos.y + 14 };
    }
    return (
        <div className={className} onMouseEnter={track} onMouseMove={track} onMouseLeave={() => setPos(null)}>
            {children}
            {pos && (
                <span
                    className="pointer-events-none fixed z-[100] whitespace-nowrap rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] px-2 py-1 text-[11px] text-[color:var(--text)] shadow-lg shadow-black/40"
                    style={style}
                >
                    {hint}
                </span>
            )}
        </div>
    );
}

function fmtNum(n) {
    if (n == null) return "0";
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function fmtBig(n) {
    if (n == null) return null;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}m`;
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function getPostThumbnail(post) {
    try {
        if (post.preview?.images?.length) {
            const src = post.preview.images[0].source?.url;
            if (src) return src.replace(/&amp;/g, "&");
        }
    } catch { /* ignore */ }
    try {
        if (post.media_metadata) {
            const first = Object.values(post.media_metadata)[0];
            if (first?.s?.u) return first.s.u.replace(/&amp;/g, "&");
        }
    } catch { /* ignore */ }
    const imageExts = ["jpg", "jpeg", "png", "gif"];
    if (post.url && imageExts.includes(post.url.split(".").pop()?.toLowerCase()))
        return post.url;
    return null;
}

function getCommentImage(comment) {
    try {
        if (comment.media_metadata) {
            const first = Object.values(comment.media_metadata)[0];
            if (first?.s?.u) return first.s.u.replace(/&amp;/g, "&");
        }
    } catch { /* ignore */ }
    return null;
}

const FETCH_CACHE = new Map();
function safeFetch(url, { bypassCache = false } = {}) {
    if (!bypassCache) {
        const cached = FETCH_CACHE.get(url);
        if (cached && (Date.now() - cached.ts < 5 * 60 * 1000)) {
            return cached.promise;
        }
    }
    const promise = fetch(url, { headers: { Accept: "application/json" } })
        .then(async (res) => {
            if (!res.ok) return { data: [], ok: false };
            const json = await res.json();
            return { data: json?.data ?? [], ok: true };
        })
        .catch(() => ({ data: [], ok: false }));
    
    promise.then((res) => {
        if (!res.ok || res.data.length === 0) {
            FETCH_CACHE.delete(url);
        }
    });

    FETCH_CACHE.set(url, { ts: Date.now(), promise });
    return promise;
}

async function fetchTimeSeries(key, { precision = "hour", hours = 24 } = {}) {
    const before = Date.now();
    const after = before - hours * 60 * 60 * 1000;

    const url =
        `${ARCTIC}/api/time_series` +
        `?key=${encodeURIComponent(key)}` +
        `&precision=${encodeURIComponent(precision)}` +
        `&after=${after}` +
        `&before=${before}`;

    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return [];
        const json = await res.json();
        return (json?.data ?? []).map((p) => ({
            date: new Date(p.date * 1000),
            value: p.value,
        }));
    } catch {
        return [];
    }
}

function formatChartTick(date, precision, spanHours = 24) {
    if (spanHours >= 24 * 3) {
        return date.toLocaleDateString([], { weekday: "short" });
    }
    if (precision === "minute" || precision === "hour") {
        return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function buildLinePath(points, width, height, padding) {
    if (!points.length) return "";

    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const minX = points[0].date.getTime();
    const maxX = points[points.length - 1].date.getTime();
    const maxY = Math.max(...points.map((p) => p.value), 1);

    return points.map((p, i) => {
        const x =
            padding.left +
            ((p.date.getTime() - minX) / Math.max(maxX - minX, 1)) * innerWidth;
        const y =
            height -
            padding.bottom -
            (p.value / maxY) * innerHeight;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    }).join(" ");
}

function mergeSeries(leftSeries, rightSeries, leftKey = "left", rightKey = "right") {
    const byTs = new Map();

    for (const point of leftSeries) {
        const ts = point.date.getTime();
        byTs.set(ts, { date: point.date, [leftKey]: point.value, [rightKey]: 0 });
    }

    for (const point of rightSeries) {
        const ts = point.date.getTime();
        const existing = byTs.get(ts);
        if (existing) {
            existing[rightKey] = point.value;
        } else {
            byTs.set(ts, { date: point.date, [leftKey]: 0, [rightKey]: point.value });
        }
    }

    return Array.from(byTs.values()).sort((a, b) => a.date - b.date);
}

function ratioSeries(numeratorSeries, denominatorSeries) {
    const denominatorMap = new Map(
        denominatorSeries.map((point) => [point.date.getTime(), point.value])
    );

    return numeratorSeries
        .map((point) => {
            const denominator = denominatorMap.get(point.date.getTime());
            if (!denominator) return null;
            return { date: point.date, value: point.value / denominator };
        })
        .filter(Boolean);
}

async function fetchBoth(username, type, pagination = {}, dateFilters = {}, { bypassCache = false } = {}) {
    const { arctic, pullpush } = buildUrls(username, type, pagination, dateFilters);
    const [arcticRes, pullpushRes] = await Promise.all([
        safeFetch(arctic, { bypassCache }),
        safeFetch(pullpush, { bypassCache }),
    ]);

    const seen = new Set();
    const merged = [];
    const sources = [];

    if (arcticRes.ok && arcticRes.data.length > 0) sources.push("Arctic Shift");
    if (pullpushRes.ok && pullpushRes.data.length > 0) sources.push("PullPush");

    [...arcticRes.data, ...pullpushRes.data].forEach((item) => {
        if (item.id && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
        }
    });

    // PullPush ignores the over_18 param, so filter NSFW client-side (posts only;
    // comments have no over_18 field). Arctic results already match — harmless here.
    let result = merged;
    if (type === "posts" && dateFilters.over18 === false) {
        result = result.filter((p) => !p.over_18);
    }

    result.sort((a, b) => b.created_utc - a.created_utc);
    return { items: result, sources, arcticDown: !arcticRes.ok, pullpushDown: !pullpushRes.ok };
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconSearch = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
    </svg>
);

const IconArrowUp = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
    </svg>
);

const IconComment = () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
    </svg>
);

const IconExternal = () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
);

const IconSpinner = () => (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
);

const IconChevronLeft = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
);

const IconChevronRight = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
);

// ─── Anime Face SVG ───────────────────────────────────────────────────────────



// ─── Error Boundary ───────────────────────────────────────────────────────────
// Wraps each result card so one malformed archive record (e.g. a comment with a
// numeric parent_id) can't crash the whole page — it renders a fallback instead.

class CardBoundary extends Component {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch() { /* swallow — bad record, nothing to recover */ }
    render() {
        if (this.state.failed) {
            return (
                <div className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-3 py-2.5 text-[12px] text-[color:var(--text-muted)] italic">
                    This item couldn't be displayed.
                </div>
            );
        }
        return this.props.children;
    }
}

// ─── Status badges ────────────────────────────────────────────────────────────
// The reason people use an archive: seeing at a glance whether content was
// removed by a moderator vs deleted by its author, plus NSFW / distinguished
// (admin, mod) markers. Drives both the badge row and the card's border tint.

function getStatus(item, type) {
    const text = type === "posts" ? item.selftext : item.body;
    return {
        removed: text === "[removed]" || (type === "posts" && !!item.removed_by_category),
        deleted: text === "[deleted]" || item.author === "[deleted]",
    };
}

// Border color for a card, tinted red when mod-removed and amber when
// author-deleted so scanning a long list surfaces the interesting rows.
function statusBorderBase({ removed, deleted }) {
    if (removed) return "border-[color:var(--status-removed)]";
    if (deleted) return "border-[color:var(--status-deleted)]";
    return "border-[color:var(--border-hover)]";
}
function statusBorderHover({ removed, deleted }) {
    if (removed) return "hover:border-[color:var(--status-removed)]/50";
    if (deleted) return "hover:border-[color:var(--status-deleted)]/50";
    return "hover:border-[color:var(--text-muted)]";
}
function statusBorder(status) {
    return `${statusBorderBase(status)} ${statusBorderHover(status)}`;
}

const BADGE = "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide leading-none";

function StatusBadges({ item, type }) {
    const { removed, deleted } = getStatus(item, type);
    const dist = item.distinguished;
    if (!removed && !deleted && !item.over_18 && !item.spoiler && dist !== "admin" && dist !== "moderator") {
        return null;
    }
    return (
        <>
            {removed && <span className={`${BADGE} text-[color:var(--status-removed)] bg-[color:var(--status-removed)]/10 border border-[color:var(--status-removed)]/20`}>Removed</span>}
            {deleted && <span className={`${BADGE} text-[color:var(--status-deleted)] bg-[color:var(--status-deleted)]/10 border border-[color:var(--status-deleted)]/20`}>Deleted</span>}
            {item.over_18 && <span className={`${BADGE} text-[color:var(--status-admin)] bg-[color:var(--status-admin)]/10 border border-[color:var(--status-admin)]/20`}>NSFW</span>}
            {item.spoiler && <span className={`${BADGE} bg-[color:var(--border)] text-[color:var(--text)] border border-[color:var(--border)]`}>Spoiler</span>}
            {dist === "admin" && <span className={`${BADGE} text-[color:var(--status-mod)] bg-[color:var(--status-mod)]/10 border border-[color:var(--status-mod)]/20`}>Admin</span>}
            {dist === "moderator" && <span className={`${BADGE} text-[color:var(--accent)] bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/20`}>Mod</span>}
        </>
    );
}

// ─── Post Card ────────────────────────────────────────────────────────────────

const PostCard = memo(function PostCard({ post, embedded = false }) {
    const [bodyOpen, setBodyOpen]               = useState(false);
    const [comments, setComments]               = useState(null); // null = not fetched
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [moreCommentsCount, setMoreComments]  = useState(null);

    const thumb   = getPostThumbnail(post);
    const postUrl = `${REDDIT_BASE}${post.permalink}`;
    const hasBody = post.selftext && post.selftext !== "[deleted]" && post.selftext !== "[removed]";
    const status  = getStatus(post, "posts");

    async function handleLoadComments() {
        if (commentsLoading) return;
        setCommentsLoading(true);
        try {
            const res  = await fetch(`${ARCTIC}/api/comments/tree?link_id=t3_${post.id}&limit=25`);
            const json = await res.json();
            const data = json.data || [];
            const list = [];
            let more = null;
            for (const item of data) {
                if (item.kind === "t1")        list.push(item.data);
                else if (item.kind === "more") more = item.data?.count ?? null;
            }
            setComments(list);
            setMoreComments(more);
        } catch {
            setComments([]);
        }
        setCommentsLoading(false);
    }

    return (
        <>
            <div className={`bg-[color:var(--bg-elevated)] border ${statusBorder(status)} rounded overflow-hidden transition-all duration-150 hover:shadow-lg group`}>
                <a href={postUrl} target="_blank" rel="noopener noreferrer" className="block">
                    <div className="flex">
                        <div className="flex flex-col items-center justify-start gap-1 px-2.5 py-3 bg-[color:var(--bg)] min-w-[44px]">
                            <IconArrowUp />
                            <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(post.score)}</span>
                        </div>
                        <div className="flex-1 p-3 min-w-0">
                            <div className="flex gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mb-1.5 flex-wrap">
                                        <span className="font-medium text-[color:var(--text)]">{post.subreddit_name_prefixed}</span>
                                        <span>·</span>
                                        <HoverTime utc={post.created_utc} />
                                        <StatusBadges item={post} type="posts" />
                                        {post.link_flair_text && (
                                            <>
                                                <span>·</span>
                                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[color:var(--border)] text-[color:var(--text)] border border-[color:var(--border-hover)]">
                                                {post.link_flair_text}
                                            </span>
                                            </>
                                        )}
                                    </div>
                                    <p className="text-sm font-medium text-[color:var(--text)] leading-snug mb-1.5 transition-colors break-words">
                                        {post.title}
                                    </p>
                                    <div className="flex items-center gap-3 text-[11px] text-[color:var(--text-muted)]">
                                        <button
                                            onClick={(e) => { e.preventDefault(); if (!comments) handleLoadComments(); }}
                                            disabled={commentsLoading}
                                            className="flex items-center gap-1 hover:text-[color:var(--accent)] transition-colors disabled:opacity-50 cursor-pointer"
                                        >
                                            <IconComment />{embedded ? "" : "show "}{fmtNum(post.num_comments)} comments
                                        </button>
                                        {post.domain && !post.is_self && (
                                            <span className="flex items-center gap-1 text-[color:var(--accent)] truncate max-w-[200px]">
                                            <IconExternal /><span className="truncate">{post.domain}</span>
                                        </span>
                                        )}
                                        {hasBody && !thumb && (
                                            <button
                                                aria-label={bodyOpen ? "Hide post body" : "Show post body"}
                                                onClick={(e) => { e.preventDefault(); setBodyOpen(o => !o); }}
                                                className="flex items-center gap-1 ml-auto text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors"
                                            >
                                                <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${bodyOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                                {bodyOpen ? "hide body" : "show body"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {thumb && (
                                    <HoverImageHint hint="Open image in new tab" className="flex-shrink-0 self-start">
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(thumb, "_blank", "noopener,noreferrer"); }}
                                            className="w-[70px] h-[52px] rounded overflow-hidden bg-[color:var(--border)] cursor-zoom-in">
                                            <img src={thumb} alt="" width="70" height="52" className="w-full h-full object-cover" loading="lazy"
                                                 onError={(e) => { e.target.style.display = "none"; }} />
                                        </div>
                                    </HoverImageHint>
                                )}
                            </div>
                            {hasBody && thumb && (
                                <div className="flex items-center mt-2 text-[11px] text-[color:var(--text-muted)]">
                                    <button
                                        aria-label={bodyOpen ? "Hide post body" : "Show post body"}
                                        onClick={(e) => { e.preventDefault(); setBodyOpen(o => !o); }}
                                        className="flex items-center gap-1 ml-auto hover:text-[color:var(--accent)] transition-colors"
                                    >
                                        <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${bodyOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                        {bodyOpen ? "hide body" : "show body"}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </a>

                {hasBody && bodyOpen && (
                    <div className="border-t border-[color:var(--border)] px-4 pt-3 pb-3 ml-[44px]">
                        <p className="text-[12px] text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words">
                            {post.selftext}
                        </p>
                    </div>
                )}

                {/* ── Loaded comments — merged inside the post card ── */}
                {!embedded && (commentsLoading || comments !== null) && (
                    <div className="border-t border-[color:var(--border)]">
                        {commentsLoading ? (
                            <div className="flex items-center gap-2 px-3 py-3 text-[color:var(--text-muted)]">
                                <IconSpinner />
                                <span className="text-[11px]">Loading comments…</span>
                            </div>
                        ) : comments.length === 0 ? (
                            <p className="text-[11px] text-[color:var(--text-muted)] italic px-3 py-2">No archived comments found.</p>
                        ) : (
                            <div className="flex flex-col gap-0">
                                <div className="px-3 py-1.5 text-[11px] text-[color:var(--text-muted)]">
                                    {comments.length} comment{comments.length !== 1 ? "s" : ""} loaded
                                    {moreCommentsCount > 0 ? ` · +${moreCommentsCount} more not shown` : ""}
                                </div>
                                <div className="flex flex-col gap-2 px-3 pb-3">
                                    {comments.map(c => (
                                        <CommentCard key={c.id} comment={c} skipPostLoad={true} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
});


// ─── Parent Chain ─────────────────────────────────────────────────────────────
// Recursively loads and displays parent comments above the main comment.
// Each level shows a "load parent comment" button; once fetched, that parent's
// own parent chain is rendered above it (same pattern as the reference site).

function ParentChain({ parentId }) {
    const [comment, setComment] = useState(null);
    const [loading, setLoading] = useState(false);

    if (typeof parentId !== "string" || !parentId.startsWith("t1_")) return null;

    async function handleLoad() {
        if (loading || comment) return;
        setLoading(true);
        try {
            const res  = await fetch(`${ARCTIC}/api/comments/ids?ids=${parentId}`);
            const json = await res.json();
            if (json.data?.[0]) setComment(json.data[0]);
        } catch { /* ignore */ }
        setLoading(false);
    }

    return (
        <div className="border-b border-[color:var(--border)]">
            {/* Recurse: if this parent also has a parent comment, show its chain above */}
            {comment && <ParentChain parentId={comment.parent_id} />}

            {comment ? (
                /* Loaded parent — rendered as a dimmed summary row */
                <div className="flex opacity-80">
                    <div className="w-5 bg-[color:var(--bg)] flex-shrink-0" />
                    <div className="flex flex-col items-center justify-start gap-1 px-2.5 py-2.5 bg-[color:var(--bg)] min-w-[44px]">
                        <IconArrowUp />
                        <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(comment.score)}</span>
                    </div>
                    <div className="flex-1 px-3 py-2.5 min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mb-1 flex-wrap">
                            <a href={`${REDDIT_BASE}/r/${comment.subreddit}`} target="_blank" rel="noopener noreferrer"
                               className="font-medium text-[color:var(--text)] hover:underline">
                                {comment.subreddit_name_prefixed || `r/${comment.subreddit}`}
                            </a>
                            <span>by</span>
                            <a href={`${REDDIT_BASE}/u/${comment.author}`} target="_blank" rel="noopener noreferrer"
                               className="text-[color:var(--text)] hover:underline">
                                u/{comment.author}
                            </a>
                            <span>·</span>
                            <HoverTime utc={comment.created_utc} />
                        </div>
                        <p className="text-sm text-[color:var(--text-muted)] leading-relaxed line-clamp-3 whitespace-pre-wrap break-words">
                            {comment.body || "(no content)"}
                        </p>
                    </div>
                </div>
            ) : (
                /* Not yet loaded — show button */
                <div className="px-3 py-1.5">
                    <button
                        onClick={handleLoad}
                        disabled={loading}
                        className="flex items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--border)] rounded px-2 py-0.5 transition-all disabled:opacity-50"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                        {loading ? "loading…" : "load parent comment"}
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Comment Card ─────────────────────────────────────────────────────────────

const CommentCard = memo(function CommentCard({ comment, isNested = false, skipPostLoad = false }) {
    const [collapsed, setCollapsed]           = useState(false);
    const [lineHovered, setLineHovered]       = useState(false);
    const [post, setPost]                     = useState(null);
    const [replies, setReplies]               = useState(null); // null = not yet fetched
    const [repliesLoading, setRepliesLoading] = useState(false);
    const [moreCount, setMoreCount]           = useState(null);

    const threadId  = comment.link_id?.replace(/^t3_/, "");
    const url       = `${REDDIT_BASE}${comment.permalink}`;
    const threadUrl = threadId ? `${REDDIT_BASE}/comments/${threadId}` : url;
    const img       = getCommentImage(comment);
    const status    = getStatus(comment, "comments");

    useEffect(() => {
        if (!threadId || isNested || skipPostLoad) return;
        fetch(`${ARCTIC}/api/posts/ids?ids=${threadId}`)
            .then(r => r.json())
            .then(json => { if (json.data?.[0]) setPost(json.data[0]); })
            .catch(() => {});
    }, [threadId, isNested, skipPostLoad]);

    async function handleLoadReplies() {
        if (!comment.link_id || repliesLoading) return;
        setRepliesLoading(true);
        try {
            const res  = await fetch(
                `${ARCTIC}/api/comments/tree?link_id=${comment.link_id}&parent_id=t1_${comment.id}&limit=25`
            );
            const json = await res.json();
            const data = json.data || [];
            // The response contains the parent comment at the top level;
            // its direct children are nested in replies.data.children
            const parentItem = data.find(item => item.kind === "t1" && item.data?.id === comment.id);
            const childObjs  = parentItem?.data?.replies?.data?.children || [];
            const children   = [];
            let more = null;
            for (const c of childObjs) {
                if (c.kind === "t1")        children.push(c.data);
                else if (c.kind === "more") more = c.data?.count ?? null;
            }
            setReplies(children);
            setMoreCount(more);
        } catch {
            setReplies([]);
        }
        setRepliesLoading(false);
    }

    return (
        <div className={`bg-[color:var(--bg)] border ${statusBorderBase(status)} rounded overflow-hidden transition-all duration-150 ${!isNested ? `${statusBorderHover(status)} hover:shadow-lg` : ""}`}>

            {/* ── Parent post shown after auto-loading ── */}
            {post && (
                <div className="border-b border-[color:var(--border-hover)]">
                    <PostCard post={post} embedded={true} />
                </div>
            )}

            {/* ── Parent comment chain (top-level cards only) ── */}
            {!isNested && (
                <ParentChain parentId={comment.parent_id} />
            )}

            {/* ── Comment row ── */}
            <div className="flex">
                {/* Collapse line */}
                <button
                    aria-label={collapsed ? "Expand comment" : "Collapse comment"}
                    onClick={() => setCollapsed(o => !o)}
                    onMouseEnter={() => setLineHovered(true)}
                    onMouseLeave={() => setLineHovered(false)}
                    className="relative flex-shrink-0 w-5 bg-[color:var(--bg)] transition-colors"
                >
                    <span
                        className="absolute left-1/2 top-2 w-0.5 -translate-x-1/2 rounded-full transition-all duration-150"
                        style={{ background: collapsed ? "var(--accent)" : lineHovered ? "var(--text-muted)" : "var(--border-hover)", bottom: collapsed ? 8 : 0 }}
                    />
                </button>

                {/* Score */}
                <div className="flex flex-col items-center justify-start gap-1 px-2.5 py-3 bg-[color:var(--bg)] min-w-[44px]">
                    <IconArrowUp />
                    <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(comment.score)}</span>
                </div>

                {/* Content */}
                <div className="flex-1 p-3 min-w-0">
                    {/* Header — always visible */}
                    <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mb-1.5 flex-wrap">
                        <a href={`${REDDIT_BASE}/r/${comment.subreddit}`} target="_blank" rel="noopener noreferrer"
                           className="font-medium text-[color:var(--text)] hover:underline">
                            {comment.subreddit_name_prefixed || `r/${comment.subreddit}`}
                        </a>
                        <span>by</span>
                        <a href={`${REDDIT_BASE}/u/${comment.author}`} target="_blank" rel="noopener noreferrer"
                           className="text-[color:var(--text)] hover:underline">
                            u/{comment.author}
                        </a>
                        <span>·</span>
                        <HoverTime utc={comment.created_utc} />
                        <StatusBadges item={comment} type="comments" />
                        <span>·</span>
                        <a href={threadUrl} target="_blank" rel="noopener noreferrer"
                           className="text-[color:var(--accent)] hover:underline flex items-center gap-0.5">
                            view thread <IconExternal />
                        </a>
                        <span>·</span>
                        <a href={url} target="_blank" rel="noopener noreferrer"
                           className="text-[color:var(--accent)] hover:underline flex items-center gap-0.5">
                            view comment <IconExternal />
                        </a>
                    </div>

                    {/* Body — hidden when collapsed */}
                    {!collapsed && (
                        <>
                            {status.removed || status.deleted ? (
                                <p className="text-sm text-[color:var(--text-muted)] italic leading-relaxed">
                                    {status.removed
                                        ? "This comment was removed by a moderator — the archive captured no text."
                                        : "This comment was deleted by its author — the archive captured no text."}
                                </p>
                            ) : (
                                <p className="text-sm text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words">
                                    {comment.body || "(no content)"}
                                </p>
                            )}
                            {img && (
                                <HoverImageHint hint="Open image in new tab" className="inline-block mt-2">
                                    <a href={img} target="_blank" rel="noopener noreferrer"
                                       className="block w-24 h-16 rounded overflow-hidden bg-[color:var(--border)] cursor-zoom-in">
                                        <img src={img} alt="" width="96" height="64" className="w-full h-full object-cover" loading="lazy"
                                             onError={(e) => { e.target.style.display = "none"; }} />
                                    </a>
                                </HoverImageHint>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* ── Replies section ── */}
            {!collapsed && (
                <>
                    {/* + / - button with curved connector — shown before replies load */}
                    {!replies && (
                        <div className="flex items-center py-1.5" style={{ paddingLeft: 9 }}>
                            {/* SVG curve — clickable, glows on hover, collapses comment */}
                            <button
                                aria-label="Collapse comment"
                                onClick={() => setCollapsed(true)}
                                onMouseEnter={() => setLineHovered(true)}
                                onMouseLeave={() => setLineHovered(false)}
                                className="flex-shrink-0 -mt-[14px] bg-transparent border-0 p-0 cursor-pointer"
                            >
                                <svg width="20" height="32" viewBox="0 0 20 32" fill="none">
                                    <path d="M 1 0 L 1 17 Q 1 24 8 24 L 20 24"
                                          stroke={lineHovered ? "var(--text-muted)" : "var(--border-hover)"} strokeWidth="1.5" strokeLinecap="round" fill="none"
                                          style={{ transition: "stroke 150ms" }} />
                                </svg>
                            </button>
                            {/* ⊕ circle button */}
                            <button
                                onClick={handleLoadReplies}
                                disabled={repliesLoading}
                                aria-label="Load replies"
                                className="w-[18px] h-[18px] rounded-full border-2 border-[color:var(--border)] bg-[color:var(--bg)] flex items-center justify-center text-[color:var(--text-muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-all disabled:opacity-40 flex-shrink-0 -ml-[1px]"
                            >
                                {repliesLoading
                                    ? <span className="text-[9px] leading-none">…</span>
                                    : <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                                        <rect x="3.25" y="0" width="1.5" height="8" rx="0.75"/>
                                        <rect x="0" y="3.25" width="8" height="1.5" rx="0.75"/>
                                    </svg>
                                }
                            </button>
                        </div>
                    )}

                    {/* Loaded replies — SVG curve connector into each reply */}
                    {replies && (
                        <div className="flex" style={{ paddingLeft: 9 }}>
                            {/* Single vertical line connecting down from parent collapse line */}
                            <div className="flex-shrink-0 w-5 relative" style={{ marginTop: -14 }}>
                                <div className="absolute" style={{ left: 0, top: 0, bottom: 0, width: "1.5px", background: "var(--border-hover)" }} />
                            </div>
                            {/* Replies column */}
                            <div className="flex-1 min-w-0">
                                {replies.length > 0 ? (
                                    <div className="flex flex-col gap-1.5 py-1.5 pr-2">
                                        {replies.map(reply => (
                                            <div key={reply.id} className="flex items-start">
                                                {/* Short horizontal branch off the vertical line */}
                                                <svg width="12" height="44" viewBox="0 0 12 44" fill="none"
                                                     className="flex-shrink-0 self-start" style={{ marginTop: 19, marginLeft: -20, color: "var(--border-hover)" }}>
                                                    <path d="M 1 0 Q 1 7 8 7 L 12 7"
                                                          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                                                </svg>
                                                <div className="flex-1 min-w-0">
                                                    <CommentCard comment={reply} isNested={true} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex items-center py-2">
                                        <svg width="12" height="14" viewBox="0 0 12 14" fill="none"
                                             className="flex-shrink-0" style={{ marginLeft: -20, color: "var(--border-hover)" }}>
                                            <path d="M 1 0 Q 1 7 8 7 L 12 7"
                                                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                                        </svg>
                                        <p className="text-[11px] text-[color:var(--text-muted)] italic">No archived replies found.</p>
                                    </div>
                                )}
                                {moreCount > 0 && (
                                    <p className="text-[11px] text-[color:var(--text-muted)] pl-1 pb-2">+{moreCount} more {moreCount === 1 ? "reply" : "replies"} not shown</p>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
});


// ─── User Summary ─────────────────────────────────────────────────────────────
// Archive-wide stats for the searched account (totals, karma, first activity)
// from Arctic Shift. Renders nothing until data arrives and hides entirely on
// error/rate-limit — the search results never depend on it.

function UserSummary({ query }) {
    const [meta, setMeta] = useState(null);

    useEffect(() => {
        if (!query) return;
        let cancelled = false;

        safeFetch(`${ARCTIC}/api/users/search?author=${encodeURIComponent(query)}&limit=1`)
            .then((userRes) => {
                if (cancelled) return;
                const m = userRes.data?.[0]?._meta;
                if (m) setMeta(m);
            });

        return () => { cancelled = true; };
    }, [query]);

    if (!meta) return null;

    const firstSeenTs = Math.min(...[meta.earliest_post_at, meta.earliest_comment_at].filter(Boolean));
    const firstSeen = Number.isFinite(firstSeenTs)
        ? new Date(firstSeenTs * 1000).toLocaleDateString([], { month: "short", year: "numeric" })
        : null;

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 px-3 py-2 bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded text-[11px] text-[color:var(--text-muted)]">
            <span><span className="text-[color:var(--text)] font-medium">{fmtBig(meta.num_posts)}</span> archived posts</span>
            <span><span className="text-[color:var(--text)] font-medium">{fmtBig(meta.num_comments)}</span> comments</span>
            {meta.total_karma != null && (
                <span><span className="text-[color:var(--text)] font-medium">{fmtBig(meta.total_karma)}</span> karma</span>
            )}
            {firstSeen && (
                <span>active since <span className="text-[color:var(--text)] font-medium">{firstSeen}</span></span>
            )}
        </div>
    );
}

// ─── Empty / Error ────────────────────────────────────────────────────────────

function EmptyState({ tab, hasFilters, query, onSwitchTab, onClearFilters, deletedOnly }) {
    const otherTab = tab === "posts" ? "comments" : "posts";
    return (
        <div className="text-center py-16 text-[color:var(--text-muted)]">
            <p className="text-sm mb-2">{deletedOnly ? `No deleted ${tab} found on this page.` : `No ${tab} found for this user.`}</p>
            <p className="text-[12px] text-[color:var(--text-muted)] mb-4">Their history may not be fully indexed yet.</p>
            <div className="flex flex-col items-center gap-2 text-[12px]">
                <button type="button" onClick={onSwitchTab} className="text-[color:var(--accent)] hover:underline">
                    Switch to {otherTab} →
                </button>
                {hasFilters && (
                    <button type="button" onClick={onClearFilters} className="text-[color:var(--accent)] hover:underline">
                        Clear date filters and retry →
                    </button>
                )}
                <a href={`https://www.reddit.com/search/?q=author%3A%22${query}%22&type=${tab}`}
                   target="_blank" rel="noopener noreferrer"
                   className="text-[color:var(--accent)] hover:underline">
                    Search Reddit directly →
                </a>
            </div>
        </div>
    );
}

function ErrorState({ message, onRetry }) {
    return (
        <div className="text-center py-16">
            <p className="text-sm text-red-400 mb-1">{message}</p>
            <p className="text-[11px] text-[color:var(--text-muted)] mb-3">The archive may be temporarily unavailable.</p>
            {onRetry && (
                <button type="button" onClick={onRetry} className="text-[12px] text-[color:var(--accent)] hover:underline">
                    Try again →
                </button>
            )}
        </div>
    );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

function TabBtn({ label, count, countIsPlus, active, onClick }) {
    return (
        <button onClick={onClick}
                className={`relative px-2.5 py-2 text-[13px] sm:px-4 sm:py-2.5 sm:text-sm font-medium transition-colors ${active ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"}`}>
            {label}
            {count > 0 && (
                <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full ${active ? "bg-[color:var(--accent)] text-[color:var(--bg)] font-bold" : "bg-[color:var(--border)] text-[color:var(--text-muted)]"}`}>
                    {countIsPlus ? `${count}+` : count}
                </span>
            )}
            {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[color:var(--accent)] rounded-t" />}
        </button>
    );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ page, hasPrev, hasNext, onPrev, onNext, loading }) {
    return (
        <div className="flex items-center justify-center gap-3 mt-6">
            <button onClick={onPrev} disabled={!hasPrev || loading} aria-label="Previous page"
                    className="flex items-center justify-center w-10 h-10 rounded border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] text-[color:var(--text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <IconChevronLeft />
            </button>
            <span className="text-[12px] text-[color:var(--text-muted)] min-w-[60px] text-center">
                {loading ? <span className="flex justify-center"><IconSpinner /></span> : `Page ${page}`}
            </span>
            <button onClick={onNext} disabled={!hasNext || loading} aria-label="Next page"
                    className="flex items-center justify-center w-10 h-10 rounded border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] text-[color:var(--text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <IconChevronRight />
            </button>
        </div>
    );
}

// ─── Global Chart ─────────────────────────────────────────────────────────────

function TotalActivityChart() {
    const [postsSeries, setPostsSeries] = useState([]);
    const [commentsSeries, setCommentsSeries] = useState([]);
    const [loading, setLoading] = useState(true);

    const precision = "hour";
    const hours = 24 * 7;

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            const [posts, comments] = await Promise.all([
                fetchTimeSeries("global/posts/count", { precision, hours }),
                fetchTimeSeries("global/comments/count", { precision, hours }),
            ]);

            if (!cancelled) {
                setPostsSeries(posts);
                setCommentsSeries(comments);
                setLoading(false);
            }
        }

        load();
        const id = setInterval(load, 60 * 1000);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    const width = 900;
    const height = 391;
    const padding = { top: 12, right: 42, bottom: 42, left: 72 };

    const merged = useMemo(() => {
        const byTs = new Map();

        for (const p of postsSeries) {
            const ts = p.date.getTime();
            byTs.set(ts, { date: p.date, posts: p.value, comments: 0 });
        }

        for (const c of commentsSeries) {
            const ts = c.date.getTime();
            const existing = byTs.get(ts);
            if (existing) {
                existing.comments = c.value;
            } else {
                byTs.set(ts, { date: c.date, posts: 0, comments: c.value });
            }
        }

        return Array.from(byTs.values()).sort((a, b) => a.date - b.date);
    }, [postsSeries, commentsSeries]);

    const maxY = Math.max(
        1,
        ...merged.map((p) => Math.max(p.posts ?? 0, p.comments ?? 0))
    );

    const yTicks = 3;
    const xTicks = merged.filter((_, i) => {
        if (merged.length <= 4) return true;
        const step = Math.max(1, Math.floor(merged.length / 4));
        return i % step === 0 || i === merged.length - 1;
    });

    const postsPath = buildLinePath(
        merged.map((p) => ({ date: p.date, value: p.posts })),
        width,
        height,
        padding
    );

    const commentsPath = buildLinePath(
        merged.map((p) => ({ date: p.date, value: p.comments })),
        width,
        height,
        padding
    );

    return (
        <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-[color:var(--border)]">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-sm font-semibold text-[color:var(--text)]">Total Reddit posts and comments</h2>
                        <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                            Global Reddit activity over the past week.
                        </p>
                    </div>
                    <div className="flex items-center gap-4 text-[12px]">
                        <div className="flex items-center gap-2 text-[color:var(--text)]">
                            <span className="w-3 h-3 rounded-full bg-[color:var(--accent)] inline-block"></span>
                            Posts
                        </div>
                        <div className="flex items-center gap-2 text-[color:var(--text)]">
                            <span className="w-3 h-3 rounded-full bg-[color:var(--accent-2)] inline-block"></span>
                            Comments
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-3">
                {loading ? (
                    <div className="flex items-center justify-center py-16 gap-3 text-[color:var(--text-muted)]">
                        <IconSpinner />
                        <span className="text-sm">Loading chart…</span>
                    </div>
                ) : merged.length === 0 ? (
                    <div className="text-center py-16 text-[color:var(--text-muted)] text-sm">
                        No chart data available right now.
                    </div>
                ) : (
                    <div className="w-full overflow-hidden">
                        <svg
                            viewBox={`0 0 ${width} ${height}`}
                            className="w-full h-auto"
                            role="img"
                            aria-label="Line chart of total Reddit posts and comments"
                        >
                            {Array.from({ length: yTicks + 1 }).map((_, i) => {
                                const value = (maxY / yTicks) * i;
                                const y =
                                    height -
                                    padding.bottom -
                                    (value / maxY) * (height - padding.top - padding.bottom);

                                return (
                                    <g key={i}>
                                        <line
                                            x1={padding.left}
                                            x2={width - padding.right}
                                            y1={y}
                                            y2={y}
                                            stroke="var(--border)"
                                            strokeWidth="1"
                                        />
                                        <text
                                            x={padding.left - 12}
                                            y={y + 4}
                                            textAnchor="end"
                                            fontSize="23"
                                            fill="var(--text-muted)"
                                        >
                                            {fmtNum(Math.round(value))}
                                        </text>
                                    </g>
                                );
                            })}

                            {xTicks.map((p, i) => {
                                const minX = merged[0].date.getTime();
                                const maxX = merged[merged.length - 1].date.getTime();
                                const x =
                                    padding.left +
                                    ((p.date.getTime() - minX) / Math.max(maxX - minX, 1)) *
                                    (width - padding.left - padding.right);

                                return (
                                    <g key={i}>
                                        <line
                                            x1={x}
                                            x2={x}
                                            y1={padding.top}
                                            y2={height - padding.bottom}
                                            stroke="var(--border)"
                                            strokeWidth="1"
                                        />
                                        <text
                                            x={x}
                                            y={height - 12}
                                            textAnchor="middle"
                                            fontSize="23"
                                            fill="var(--text-muted)"
                                        >
                                            {formatChartTick(p.date, precision, hours)}
                                        </text>
                                    </g>
                                );
                            })}

                            <path
                                d={postsPath}
                                fill="none"
                                stroke="var(--accent)"
                                strokeWidth="3"
                                strokeLinecap="square"
                                strokeLinejoin="bevel"
                            />
                            <path
                                d={commentsPath}
                                fill="none"
                                stroke="var(--accent-2)"
                                strokeWidth="3"
                                strokeLinecap="square"
                                strokeLinejoin="bevel"
                            />
                        </svg>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── usePaginatedFetch ────────────────────────────────────────────────────────

function SecondaryGlobalChart({
                                  title,
                                  subtitle,
                                  ariaLabel,
                                  leftLabel,
                                  rightLabel,
                                  leftKey,
                                  rightKey,
                                  numberFormatter,
                              }) {
    const [leftSeries, setLeftSeries] = useState([]);
    const [rightSeries, setRightSeries] = useState([]);
    const [loading, setLoading] = useState(true);
    const precision = "hour";
    const hours = 24 * 7;
    const width = 900;
    const height = 391;
    const padding = { top: 12, right: 42, bottom: 42, left: 72 };

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            const [leftBase, rightBase, leftCount, rightCount] = await Promise.all([
                fetchTimeSeries(leftKey, { precision, hours }),
                fetchTimeSeries(rightKey, { precision, hours }),
                fetchTimeSeries("global/posts/count", { precision, hours }),
                fetchTimeSeries("global/comments/count", { precision, hours }),
            ]);

            if (cancelled) return;

            setLeftSeries(ratioSeries(leftBase, leftCount));
            setRightSeries(ratioSeries(rightBase, rightCount));
            setLoading(false);
        }

        load();
        const id = setInterval(load, 60 * 1000);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [hours, leftKey, precision, rightKey]);

    const merged = useMemo(
        () => mergeSeries(leftSeries, rightSeries, "left", "right"),
        [leftSeries, rightSeries]
    );

    const maxY = Math.max(1, ...merged.map((p) => Math.max(p.left ?? 0, p.right ?? 0)));
    const yTicks = 3;
    const xTicks = merged.filter((_, i) => {
        if (merged.length <= 4) return true;
        const step = Math.max(1, Math.floor(merged.length / 4));
        return i % step === 0 || i === merged.length - 1;
    });

    const leftPath = buildLinePath(
        merged.map((p) => ({ date: p.date, value: p.left })),
        width,
        height,
        padding
    );
    const rightPath = buildLinePath(
        merged.map((p) => ({ date: p.date, value: p.right })),
        width,
        height,
        padding
    );

    return (
        <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-[color:var(--border)]">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-sm font-semibold text-[color:var(--text)]">{title}</h2>
                        <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">{subtitle}</p>
                    </div>
                    <div className="flex items-center gap-4 text-[12px]">
                        <div className="flex items-center gap-2 text-[color:var(--text)]">
                            <span className="w-3 h-3 rounded-full bg-[color:var(--accent)] inline-block"></span>
                            {leftLabel}
                        </div>
                        <div className="flex items-center gap-2 text-[color:var(--text)]">
                            <span className="w-3 h-3 rounded-full bg-[color:var(--accent-2)] inline-block"></span>
                            {rightLabel}
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-3">
                {loading ? (
                    <div className="flex items-center justify-center py-16 gap-3 text-[color:var(--text-muted)]">
                        <IconSpinner />
                        <span className="text-sm">Loading chart...</span>
                    </div>
                ) : merged.length === 0 ? (
                    <div className="text-center py-16 text-[color:var(--text-muted)] text-sm">
                        No chart data available right now.
                    </div>
                ) : (
                    <div className="w-full overflow-hidden">
                        <svg
                            viewBox={`0 0 ${width} ${height}`}
                            className="w-full h-auto"
                            role="img"
                            aria-label={ariaLabel}
                        >
                            {Array.from({ length: yTicks + 1 }).map((_, i) => {
                                const value = (maxY / yTicks) * i;
                                const y =
                                    height -
                                    padding.bottom -
                                    (value / maxY) * (height - padding.top - padding.bottom);

                                return (
                                    <g key={i}>
                                        <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
                                        <text x={padding.left - 12} y={y + 4} textAnchor="end" fontSize="23" fill="var(--text-muted)">
                                            {numberFormatter(value)}
                                        </text>
                                    </g>
                                );
                            })}

                            {xTicks.map((p, i) => {
                                const minX = merged[0].date.getTime();
                                const maxX = merged[merged.length - 1].date.getTime();
                                const x =
                                    padding.left +
                                    ((p.date.getTime() - minX) / Math.max(maxX - minX, 1)) *
                                    (width - padding.left - padding.right);

                                return (
                                    <g key={i}>
                                        <line x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} stroke="var(--border)" strokeWidth="1" />
                                        <text x={x} y={height - 12} textAnchor="middle" fontSize="23" fill="var(--text-muted)">
                                            {formatChartTick(p.date, precision, hours)}
                                        </text>
                                    </g>
                                );
                            })}

                            <path d={leftPath} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="square" strokeLinejoin="bevel" />
                            <path d={rightPath} fill="none" stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="square" strokeLinejoin="bevel" />
                        </svg>
                    </div>
                )}
            </div>
        </div>
    );
}

const GlobalChartsPanel = memo(function GlobalChartsPanel({ compact }) {
    return (
        <section className={`mx-auto px-4 mb-32 ${compact ? "mt-3" : "mt-6"}`} style={{ maxWidth: '730px' }}>
            <div className="grid gap-4 md:grid-cols-2">
                <TotalActivityChart />
                <SecondaryGlobalChart
                    title="Average upvotes"
                    subtitle="Average post/comment score over the past week."
                    ariaLabel="Line chart of average post and comment upvotes"
                    leftLabel="Posts"
                    rightLabel="Comments"
                    leftKey="global/posts/sum_score"
                    rightKey="global/comments/sum_score"
                    numberFormatter={(value) => fmtNum(Math.round(value))}
                />
            </div>
        </section>
    );
});


function usePaginatedFetch(type) {
    const [items, setItems] = useState([]);
    const [sources, setSources] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(1);
    const [pageStack, setPageStack] = useState([]);
    const [storedFilters, setStoredFilters] = useState({});
    const [arcticDown, setArcticDown] = useState(false);
    const [pullpushDown, setPullpushDown] = useState(false);
    const fetchIdRef = useRef(0);

    const _fetch = useCallback(async (username, pagination, filters, { bypassCache = false } = {}) => {
        const fetchId = ++fetchIdRef.current;
        setLoading(true);
        setError(null);
        try {
            const { items: data, sources: srcs, arcticDown: down, pullpushDown: ppDown } = await fetchBoth(username, type, pagination, filters, { bypassCache });
            if (fetchId !== fetchIdRef.current) return data;
            setItems(data);
            setSources(srcs);
            setArcticDown(down);
            setPullpushDown(ppDown);
            return data;
        } catch (err) {
            if (fetchId !== fetchIdRef.current) return [];
            setError(err.message);
            setItems([]);
            return [];
        } finally {
            if (fetchId === fetchIdRef.current) setLoading(false);
        }
    }, [type]);

    const reset = useCallback(async (username, filters, { bypassCache = false } = {}) => {
        setPage(1);
        setPageStack([]);
        setStoredFilters(filters);
        const data = await _fetch(username, {}, filters, { bypassCache });
        if (data.length > 0) {
            setPageStack([{ firstUtc: data[0].created_utc, lastUtc: data[data.length - 1].created_utc }]);
        }
        return data;
    }, [_fetch]);

    const goNext = useCallback(async (username) => {
        const current = pageStack[pageStack.length - 1];
        if (!current) return;
        const data = await _fetch(username, { before: current.lastUtc }, storedFilters);
        if (data.length > 0) {
            setPageStack((prev) => [...prev, { firstUtc: data[0].created_utc, lastUtc: data[data.length - 1].created_utc }]);
            setPage((p) => p + 1);
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [_fetch, pageStack, storedFilters]);

    const goPrev = useCallback(async (username) => {
        if (pageStack.length <= 1) return;
        const newStack = pageStack.slice(0, -1);
        const prevEntry = newStack[newStack.length - 2];
        const data = await _fetch(username, prevEntry ? { before: prevEntry.lastUtc } : {}, storedFilters);
        if (data.length > 0) {
            newStack[newStack.length - 1] = { firstUtc: data[0].created_utc, lastUtc: data[data.length - 1].created_utc };
        }
        setPageStack(newStack);
        setPage((p) => p - 1);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [_fetch, pageStack, storedFilters]);

    return { items, sources, loading, error, page, arcticDown, pullpushDown, reset, goNext, goPrev };
}

// ─── Themes ───

const THEMES = {
  default: { bg: "#0d0d0d", accent: "#e6e4e1" },
  matrix: { bg: "#000000", accent: "#00ff41" },
  catppuccin: { bg: "#1e1e2e", accent: "#cba6f7" },
  cyber: { bg: "#100a20", accent: "#fcee0a" },
  mono: { bg: "#000000", accent: "#ffffff" },
  gruvbox: { bg: "#282828", accent: "#ebdbb2" },
  dracula: { bg: "#282a36", accent: "#ff79c6" },
  nord: { bg: "#2e3440", accent: "#88c0d0" },
  solarized: { bg: "#002b36", accent: "#859900" },
  synthwave: { bg: "#2b213a", accent: "#f92aad" }
};

const ThemeSwitcher = () => {
    const [theme, setTheme] = useState(() => localStorage.getItem("rosint-theme") || "default");

    useEffect(() => {
        const t = THEMES[theme] || THEMES.default;
        document.documentElement.style.setProperty("--bg", t.bg);
        // document.body.style.backgroundColor = t.bg;
        document.documentElement.style.setProperty("--accent", t.accent);
        localStorage.setItem("rosint-theme", theme);
    }, [theme]);

    return (
        <div className="fixed top-4 right-4 z-50">
            <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="bg-[color:var(--bg)] text-[color:var(--accent)] border border-[color:var(--border)] rounded px-2 py-1 text-xs focus:outline-none focus:border-[color:var(--accent)] transition-colors cursor-pointer"
            >
                {Object.keys(THEMES).map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
            </select>
        </div>
    );
};


const SearchBar = memo(function SearchBar({ defaultQuery, onSearch, initialLoading }) {
    const [username, setUsername] = useState(defaultQuery);

    const handleSubmit = (e) => {
        e.preventDefault();
        const user = username.trim();
        if (!user) return;
        onSearch(user);
    };

    return (
        <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative" style={{ flex: "1 1 0" }}>
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] text-sm font-medium select-none">u/</span>
                <input aria-label="Search user" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                         placeholder="search for a user..."
                         name="search_query_osint" id="search_query_osint" autoComplete="off" data-bwignore="true" data-lpignore="true" data-1p-ignore="true" spellCheck="false"
                       className="w-full bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded pl-8 pr-3 py-2.5 text-sm text-[color:var(--text)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--accent)] transition-colors"
                       autoFocus />
            </div>
            <button type="submit" disabled={!username.trim() || initialLoading}
                    className="flex items-center gap-2 bg-[color:var(--accent)] text-[color:var(--bg)] border border-[color:var(--accent)] [&:not(:disabled)]:hover:bg-[color:var(--bg)] [&:not(:disabled)]:hover:!text-[color:var(--accent)] [&:not(:disabled)]:hover:stroke-[color:var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm px-5 py-2.5 rounded transition-all flex-shrink-0">
                {initialLoading ? <IconSpinner /> : <IconSearch />}
                {initialLoading && "Searching…"}
            </button>
        </form>
    );
});

const TABS = ["posts", "comments"];


const AccountProfile = memo(function AccountProfile({ posts, comments }) {
    const allItems = useMemo(() => [...posts, ...comments], [posts, comments]);

    const topSubreddits = useMemo(() => {
        const counts = {};
        for (const item of allItems) {
            const sub = item.subreddit || item.subreddit_name_prefixed?.replace(/^r\//, "") || "unknown";
            counts[sub] = (counts[sub] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const max = sorted.length > 0 ? sorted[0][1] : 1;
        return { list: sorted, max };
    }, [allItems]);

    const { heatmap, maxCount, tzHint } = useMemo(() => {
        if (allItems.length === 0) return { heatmap: [], maxCount: 1, tzHint: null };
        const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
        const hourTotals = Array(24).fill(0);
        
        for (const item of allItems) {
            if (!item.created_utc) continue;
            const d = new Date(item.created_utc * 1000);
            const day = d.getUTCDay();
            const hr = d.getUTCHours();
            matrix[day][hr]++;
            hourTotals[hr]++;
        }
        
        let max = 0;
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 24; c++) {
                if (matrix[r][c] > max) max = matrix[r][c];
            }
        }

        // Find quietest 8-hour window
        let minSum = Infinity;
        let quietestStart = 0;
        for (let start = 0; start < 24; start++) {
            let sum = 0;
            for (let i = 0; i < 8; i++) {
                sum += hourTotals[(start + i) % 24];
            }
            if (sum < minSum) {
                minSum = sum;
                quietestStart = start;
            }
        }
        
        let offset = -0.5 - quietestStart;
        if (offset < -12) offset += 24;
        if (offset > 14) offset -= 24;
        const estOffset = Math.round(offset);
        
        const activeStart = (quietestStart + 8) % 24;
        const activeEnd = quietestStart;
        
        const tzHint = `Most active ${activeStart}:00–${activeEnd}:00 UTC · likely UTC${estOffset >= 0 ? '+' : ''}${estOffset}`;

        return { heatmap: matrix, maxCount: max || 1, tzHint };
    }, [allItems]);

    if (allItems.length === 0) return null;

    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
        <div className="flex flex-col md:flex-row gap-4 mb-4 mt-4">
            <div className="flex-1 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded px-4 py-3 shadow-sm">
                <h3 className="text-sm font-semibold text-[color:var(--text)] mb-3">Top Subreddits</h3>
                <div className="flex flex-col gap-1.5">
                    {topSubreddits.list.map(([sub, count]) => (
                        <div key={sub} className="relative flex items-center justify-between text-[12px] h-6 z-0">
                            <div className="absolute left-0 top-0 bottom-0 bg-[color:var(--accent)] opacity-20 rounded-sm -z-10" style={{ width: `${(count / topSubreddits.max) * 100}%` }}></div>
                            <a href={`${REDDIT_BASE}/r/${sub}`} target="_blank" rel="noopener noreferrer" className="font-medium text-[color:var(--text)] hover:underline pl-1.5 truncate">
                                r/{sub}
                            </a>
                            <span className="text-[color:var(--text-muted)] font-medium pr-1.5">{count}</span>
                        </div>
                    ))}
                </div>
            </div>
            
            <div className="flex-[2] bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded px-4 py-3 shadow-sm overflow-x-auto">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-[color:var(--text)]">Activity Fingerprint (UTC)</h3>
                    {tzHint && <span className="text-[10px] text-[color:var(--text-muted)] italic">{tzHint} (est.)</span>}
                </div>
                <div className="min-w-[400px]">
                    <div className="grid grid-cols-[30px_repeat(24,_1fr)] gap-0.5 mb-1 text-[9px] text-[color:var(--text-muted)] text-center">
                        <div></div>
                        {[...Array(24)].map((_, i) => (
                            <div key={i}>{i % 4 === 0 ? i : ''}</div>
                        ))}
                    </div>
                    {heatmap.map((row, r) => (
                        <div key={r} className="grid grid-cols-[30px_repeat(24,_1fr)] gap-0.5 mb-0.5">
                            <div className="text-[10px] text-[color:var(--text-muted)] pr-2 text-right leading-relaxed">{days[r]}</div>
                            {row.map((count, c) => {
                                const intensity = count === 0 ? 0 : Math.max(0.15, count / maxCount);
                                return (
                                    <div key={c} className="rounded-sm" style={{ 
                                        backgroundColor: count === 0 ? 'var(--border)' : 'var(--accent)', 
                                        opacity: count === 0 ? 0.2 : intensity 
                                    }} title={`${days[r]} ${c}:00 UTC - ${count} items`}>
                                        &nbsp;
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default function App() {
        const [query, setQuery] = useState("");
    const [activeTab, setActiveTab] = useState("posts");
    const [searched, setSearched] = useState(false);
    const [initialLoading, setInitialLoading] = useState(false);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [subreddit, setSubreddit] = useState("");
    const [showNsfw, setShowNsfw] = useState(true); // checked = show NSFW (no filter); unchecked = exclude NSFW
    const [appliedSubreddit, setAppliedSubreddit] = useState("");
    const [sortOrder, setSortOrder] = useState("desc");
    const [showGraphs, setShowGraphs] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [deletedOnly, setDeletedOnly] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
        
    // ?dino in the URL forces the maintenance screen (which hosts the dino game)
    // so it can be tested without waiting for a real Arctic Shift outage.
    const [arcticHealthDown, setArcticHealthDown] = useState(false);
    const [bannerDismissed, setBannerDismissed] = useState(false);
    const [searchBlocked, setSearchBlocked] = useState(false);

    const posts = usePaginatedFetch("posts");
    const comments = usePaginatedFetch("comments");

    const arcticIsDown = arcticHealthDown || posts.arcticDown || comments.arcticDown;
    const bothSourcesFailed = arcticHealthDown || ((posts.arcticDown && posts.pullpushDown) || (comments.arcticDown && comments.pullpushDown));
    const isOutageTakeover = bothSourcesFailed && posts.items.length === 0 && comments.items.length === 0;

    useEffect(() => {
        safeFetch(`${ARCTIC}/api/posts/search?author=spez&limit=1`, { bypassCache: true })
            .then(({ ok }) => { if (!ok) setArcticHealthDown(true); });
    }, []);

    useEffect(() => {
        document.title = searched && query
            ? `u/${query} – Rosint`
            : "Rosint – Search Deleted Reddit Posts";
    }, [searched, query]);



    useEffect(() => {
        if (searched && query && !initialLoading) {
            searchUser(query, { push: false });
        }
    }, [dateFrom, dateTo, showNsfw]);

    const buildFilters = useCallback(() => {
        const f = {};
        if (dateFrom) f.dateFrom = Math.floor(new Date(dateFrom).getTime() / 1000);
        if (dateTo) f.dateTo = Math.floor(new Date(dateTo).getTime() / 1000) + 86399;
        if (subreddit.trim()) f.subreddit = subreddit.trim();
        if (!showNsfw) f.over18 = false;
        return f;
    }, [dateFrom, dateTo, subreddit, showNsfw]);

    const hasFilters = dateFrom || dateTo || subreddit.trim() || !showNsfw;

    

    const { reset: resetPosts } = posts;
    const { reset: resetComments } = comments;
    const searchUser = useCallback(async (rawUser, { push = true } = {}) => {
        const user = normalizeUsername(rawUser);
        if (!user) return;
        if (push) {
            const url = new URL(window.location.href);
            url.searchParams.set("u", user);
            window.history.pushState({}, "", url);
        }
                setQuery(user);
        setSearched(true);
        if (await isBlockedUser(user)) { setSearchBlocked(true); return; }
        setSearchBlocked(false);
        setInitialLoading(true);
        const filters = buildFilters();
        await Promise.all([resetPosts(user, filters), resetComments(user, filters)]);
        setAppliedSubreddit(subreddit.trim());
        setInitialLoading(false);
    }, [buildFilters, resetPosts, resetComments, subreddit]);

    const searchUserRef2 = useRef(searchUser);
    useEffect(() => { searchUserRef2.current = searchUser; });
    useEffect(() => {
        const u = normalizeUsername(new URLSearchParams(window.location.search).get("u"));
        if (u) searchUserRef2.current(u, { push: false });
    }, []);

    // Browser back/forward: re-run the search in the URL, or return to the landing page
    useEffect(() => {
        const onPop = () => {
            const u = normalizeUsername(new URLSearchParams(window.location.search).get("u"));
            if (u) {
                searchUserRef2.current(u, { push: false });
            } else {
                setSearched(false);
                setQuery("");
            }
        };
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    
    const handleRetry = useCallback(async () => {
        if (!query) return;
        setInitialLoading(true);
        const filters = buildFilters();
        await Promise.all([resetPosts(query, filters, { bypassCache: true }), resetComments(query, filters, { bypassCache: true })]);
        setInitialLoading(false);
    }, [query, buildFilters, resetPosts, resetComments]);

    const clearFilters = useCallback(async () => {
        setDateFrom("");
        setDateTo("");
        setSubreddit("");
        setShowNsfw(true);
        setAppliedSubreddit("");
        if (!query) return;
        setInitialLoading(true);
        await Promise.all([resetPosts(query, {}), resetComments(query, {})]);
        setInitialLoading(false);
    }, [query, resetPosts, resetComments]);

    const active = activeTab === "posts" ? posts : comments;
    const allSources = [...new Set([...posts.sources, ...comments.sources])];

    return (
        <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--text)]">
            <ThemeSwitcher />
            

            <main>
                {arcticIsDown && !bannerDismissed && !searched && (
                    <div className="bg-[color:var(--border)] border-b border-[color:var(--border-hover)] px-4 py-2 flex items-center justify-between gap-3">
                        <p className="text-[12px] text-[color:var(--accent)]">
                            <span className="font-semibold">Search is briefly unavailable.</span>
                            {" "}This is often just a short hiccup, so retrying in a few seconds usually works. If it keeps failing it may be down for a couple of hours.
                        </p>
                        <button onClick={() => setBannerDismissed(true)}
                                aria-label="Dismiss"
                                className="text-[color:var(--text-muted)] hover:text-[color:var(--accent)] flex-shrink-0 transition-colors text-lg leading-none">
                            ×
                        </button>
                    </div>
                )}
                <div className={`max-w-3xl mx-auto px-4 transition-all duration-300 ${searched ? "pt-6" : "pt-20"}`}>
                    

                    <div className="relative mx-auto" style={{ maxWidth: searched ? '100%' : '690px' }}>
                        
                        <SearchBar key={query} defaultQuery={query} onSearch={searchUser} initialLoading={initialLoading} />
                    </div>

                    {!searched && (
                        <div className="flex flex-wrap items-center gap-2 mt-3 mx-auto" style={{ maxWidth: '690px' }}>
                            <button
                                type="button"
                                onClick={() => setShowAdvancedFilters(f => !f)}
                                className="flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors"
                            >
                                Advanced filters
                                <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${showAdvancedFilters ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowGraphs(g => !g)}
                                className="flex items-center gap-1.5 ml-auto text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors"
                            >
                                {showGraphs ? "Hide graphs" : "Show graphs"}
                                <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${showGraphs ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showAdvancedFilters && (
                                <div className="w-full flex flex-col gap-2 mt-1 items-start">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[11px] text-[color:var(--text-muted)]">From</span>
                                        <input
                                            aria-label="Date from"
                                            type="date"
                                            value={dateFrom}
                                            onChange={(e) => setDateFrom(e.target.value)}
                                            className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7 py-0 leading-[26px] text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors [color-scheme:dark] block"
                                        />
                                        <span className="text-[11px] text-[color:var(--text-muted)]">To</span>
                                        <input
                                            aria-label="Date to"
                                            type="date"
                                            value={dateTo}
                                            onChange={(e) => setDateTo(e.target.value)}
                                            className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7 py-0 leading-[26px] text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors [color-scheme:dark] block"
                                        />
                                        <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <span className="text-[11px] text-[color:var(--text-muted)]">in</span>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] text-sm font-medium select-none">r/</span>
                                            <input
                                                aria-label="Filter by subreddit"
                                                type="text"
                                                value={subreddit}
                                                onChange={(e) => setSubreddit(e.target.value.replace(/^r\//, ""))}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && searched && query && !initialLoading) {
                                                        searchUser(query, { push: false });
                                                    }
                                                }}
                                                onBlur={() => {
                                                    if (searched && query && !initialLoading) {
                                                        searchUser(query, { push: false });
                                                    }
                                                }}
                                                placeholder="subreddit"
                                                className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded pl-8 pr-3 py-1 text-[12px] text-[color:var(--text)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--accent)] transition-colors"
                                            />
                                        </div>
                                        </div>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={showNsfw}
                                                onChange={(e) => setShowNsfw(e.target.checked)}
                                                className="w-3.5 h-3.5 accent-[color:var(--accent)] cursor-pointer"
                                            />
                                            <span className="text-[11px] text-[color:var(--text-muted)]">Show NSFW</span>
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {!searched && showGraphs && <GlobalChartsPanel compact={showAdvancedFilters} />}

                {searched && searchBlocked && (
                    <div className="max-w-3xl mx-auto px-4 mt-10 pb-16">
                        <div className="border border-[color:var(--border-hover)] bg-[color:var(--bg)] rounded-md px-6 py-8 text-center">
                            <p className="text-[color:var(--text)] text-base font-medium mb-2">
                                Results unavailable for u/{query}
                            </p>
                            <p className="text-[color:var(--text-muted)] text-sm leading-relaxed">
                                This username has been removed from search at the account holder's request.
                            </p>
                        </div>
                    </div>
                )}

                {searched && !searchBlocked && isOutageTakeover && (
                    <div className="max-w-md mx-auto px-4 mt-12 pb-16">
                        <div className="border border-[color:var(--border-hover)] bg-[color:var(--bg)] rounded-xl px-7 pt-10 pb-5 text-center shadow-lg shadow-black/30">
                            <p className="text-[color:var(--text)] text-lg font-semibold mb-2">
                                Give it another try in a moment
                            </p>
                            <p className="text-[color:var(--text)] text-sm leading-relaxed">
                                Search is briefly unavailable. This is often just a short hiccup that clears in a few seconds, so try again shortly. If it keeps failing, it may be down for a couple of hours, so check back later.
                            </p>
                                                    </div>
                    </div>
                )}

                {searched && !searchBlocked && !isOutageTakeover && (
                    <div className="max-w-3xl mx-auto px-4 mt-6 pb-16">
                        {!initialLoading && (
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                                <div className="text-[12px] text-[color:var(--text-muted)] pt-1">
                                    <p>
                                        Results for <span className="text-[color:var(--accent)] font-medium">u/{query}</span>
                                        {allSources.length > 0 && (
                                            <> · {allSources.map((src, i) => {
                                                const url = src === "Arctic Shift"
                                                    ? "https://github.com/ArthurHeitmann/arctic_shift"
                                                    : "https://pullpush.io/";
                                                return (
                                                    <span key={src}>
                                                        {i > 0 && <span className="text-[color:var(--text-muted)]"> + </span>}
                                                        <a href={url} target="_blank" rel="noopener noreferrer"
                                                           className="text-[color:var(--text)] hover:underline transition-colors">
                                                            {src}
                                                        </a>
                                                    </span>
                                                );
                                            })}</>
                                        )}
                                    </p>
                                    {appliedSubreddit && (
                                        <p className="text-[color:var(--text-muted)] mt-0.5">in <span className="text-[color:var(--accent)] font-medium">r/{appliedSubreddit}</span></p>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 ml-auto">
                                    <span className="text-[11px] text-[color:var(--text-muted)]">From</span>
                                    <input aria-label="Date from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                                           className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7 py-0 leading-[26px] text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors [color-scheme:dark] block" />
                                    <span className="text-[11px] text-[color:var(--text-muted)]">To</span>
                                    <input aria-label="Date to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                                           className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7 py-0 leading-[26px] text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors [color-scheme:dark] block" />
                                    <button onClick={clearFilters} disabled={initialLoading}
                                            className="px-3 h-7 text-[11px] font-medium text-[color:var(--text-muted)] hover:text-[color:var(--accent)] border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] disabled:opacity-50 rounded transition-colors">
                                        Clear
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* key remounts the card per user so stale stats never flash */}
                        {!initialLoading && <UserSummary key={query} query={query} />}
                        {!initialLoading && showProfile && <AccountProfile posts={posts.items} comments={comments.items} />}

                        <div className="flex items-center border-b border-[color:var(--border)] mb-4">
                            <div className="flex flex-1">
                                {TABS.map((tab) => (
                                    <TabBtn key={tab}
                                            label={tab.charAt(0).toUpperCase() + tab.slice(1)}
                                            count={tab === "posts" ? posts.items.length : comments.items.length}
                                            countIsPlus={tab === "posts" ? posts.items.length >= LIMIT : comments.items.length >= LIMIT}
                                            active={activeTab === tab}
                                            onClick={() => setActiveTab(tab)} />
                                ))}
                            </div>
                            <div className="flex items-center gap-2 pb-2">
                                {!initialLoading && !active.loading && active.items.length > 0 && (
                                    <>
                                        <button onClick={() => active.goPrev(query)} disabled={active.page <= 1 || active.loading} aria-label="Previous page"
                                                className="flex items-center justify-center w-7 h-7 rounded-sm border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] text-[color:var(--text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                            <IconChevronLeft />
                                        </button>
                                        <span className="text-[11px] text-[color:var(--text-muted)]">
                                            {active.loading ? <IconSpinner /> : `Page ${active.page}`}
                                        </span>
                                        <button onClick={() => active.goNext(query)} disabled={active.items.length < LIMIT || active.loading} aria-label="Next page"
                                                className="flex items-center justify-center w-7 h-7 rounded-sm border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] text-[color:var(--text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                            <IconChevronRight />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {!initialLoading && (
                            <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="text-[11px] text-[color:var(--text-muted)] leading-relaxed">
                                    <a href={`https://www.reddit.com/search/?q=author%3A%22${query}%22&type=${activeTab}`}
                                       target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] hover:underline">
                                        Click here
                                    </a>{" "}
                                    to search Reddit directly for the most recent activity.
                                    <br />
                                    <span className="text-[color:var(--text-faint)]">Note: Doing so will not show deleted posts or comments.</span>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none border border-[color:var(--border-hover)] rounded px-2 h-7 bg-[color:var(--bg)] transition-colors hover:border-[color:var(--text-muted)] flex-shrink-0">
                                        <input
                                            type="checkbox"
                                            checked={deletedOnly}
                                            onChange={(e) => setDeletedOnly(e.target.checked)}
                                            className="w-3 h-3 accent-[color:var(--accent)] cursor-pointer"
                                        />
                                        <span className="text-[11px] text-[color:var(--text-muted)] whitespace-nowrap">Deleted-only</span>
                                    </label>
                                    <div className="flex bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded overflow-hidden h-7">
                                        <button
                                            onClick={() => downloadFile(`rosint_${query}_${activeTab}.json`, JSON.stringify(active.items, null, 2), "application/json")}
                                            className="px-2 h-full text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--border-hover)] transition-colors border-r border-[color:var(--border-hover)]"
                                            title="Export the currently loaded page as JSON"
                                        >
                                            JSON
                                        </button>
                                        <button
                                            onClick={() => {
                                                const cols = ["id", "created_utc", "subreddit", "author", "score", "permalink", "text", "removed", "deleted"];
                                                const csv = [cols.join(",")].concat(
                                                    active.items.map(item => {
                                                        const status = getStatus(item, activeTab);
                                                        const text = activeTab === "posts" ? item.title : item.body;
                                                        const vals = [
                                                            item.id,
                                                            item.created_utc,
                                                            item.subreddit,
                                                            item.author,
                                                            item.score || 0,
                                                            item.permalink,
                                                            text ? `"${text.replace(/"/g, '""').replace(/\n/g, " ")}"` : "",
                                                            status.removed,
                                                            status.deleted
                                                        ];
                                                        return vals.join(",");
                                                    })
                                                ).join("\n");
                                                downloadFile(`rosint_${query}_${activeTab}.csv`, csv, "text/csv");
                                            }}
                                            className="px-2 h-full text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--border-hover)] transition-colors"
                                            title="Export the currently loaded page as CSV"
                                        >
                                            CSV
                                        </button>
                                    </div>
                                    <select
                                    aria-label="Sort order"
                                    value={sortOrder}
                                    onChange={(e) => setSortOrder(e.target.value)}
                                    className="flex-shrink-0 text-[11px] text-[color:var(--text-muted)] bg-[color:var(--bg)] border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded px-2 h-7 py-0 leading-[26px] transition-colors focus:outline-none focus:border-[color:var(--accent)] cursor-pointer block"
                                >
                                    <option value="desc">Newest</option>
                                    <option value="asc">Oldest</option>
                                    
                                </select>
                                </div>
                            </div>
                        )}

                        {initialLoading || active.loading ? (
                            <div className="flex items-center justify-center py-20 gap-3 text-[color:var(--text-muted)]">
                                <IconSpinner />
                                <span className="text-sm">Fetching from Arctic Shift + PullPush…</span>
                            </div>
                        ) : active.error ? (
                            <ErrorState message={active.error} onRetry={handleRetry} />
                        ) : active.items.length === 0 ? (
                            <EmptyState
                                tab={activeTab}
                                hasFilters={!!hasFilters}
                                query={query}
                                onSwitchTab={() => setActiveTab(activeTab === "posts" ? "comments" : "posts")}
                                onClearFilters={clearFilters}
                                deletedOnly={deletedOnly}
                            />
                        ) : (
                            <>
                                <div className="flex flex-col gap-2">
                                    {activeTab === "posts" && [...posts.items]
                                        .filter(post => {
                                            if (!deletedOnly) return true;
                                            const s = getStatus(post, "posts");
                                            return s.removed || s.deleted;
                                        })
                                        .sort((a, b) =>
                                            sortOrder === "desc" ? b.created_utc - a.created_utc :
                                                sortOrder === "asc" ? a.created_utc - b.created_utc :
                                                    (b.score ?? 0) - (a.score ?? 0)
                                        )
                                        .map((post) => (
                                            <CardBoundary key={post.id}>
                                                <PostCard post={post} />
                                            </CardBoundary>
                                        ))}
                                    {activeTab === "comments" && [...comments.items]
                                        .filter(comment => {
                                            if (!deletedOnly) return true;
                                            const s = getStatus(comment, "comments");
                                            return s.removed || s.deleted;
                                        })
                                        .sort((a, b) =>
                                            sortOrder === "desc" ? b.created_utc - a.created_utc :
                                                sortOrder === "asc" ? a.created_utc - b.created_utc :
                                                    (b.score ?? 0) - (a.score ?? 0)
                                        )
                                        .map((comment) => (
                                            <CardBoundary key={comment.id}>
                                                <CommentCard comment={comment} />
                                            </CardBoundary>
                                        ))}
                                </div>
                                <Pagination
                                    page={active.page}
                                    hasPrev={active.page > 1}
                                    hasNext={active.items.length >= LIMIT}
                                    onPrev={() => active.goPrev(query)}
                                    onNext={() => active.goNext(query)}
                                    loading={active.loading}
                                />
                            </>
                        )}
                    </div>
                )}
            </main>

            {!searched && (
                <footer className="fixed bottom-0 left-0 right-0 z-10 py-2 bg-[color:var(--bg)] border-t border-[color:var(--border)]" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
                    <p className="text-[11px] text-[color:var(--text-faint)] leading-relaxed text-center">
                        RedditOSINT is a free tool to search deleted Reddit posts, removed comments, and private Reddit accounts using open-source archives including{" "}
                        <a href="https://github.com/ArthurHeitmann/arctic_shift" target="_blank" rel="noopener noreferrer" className="text-[color:var(--text-faint)] hover:underline transition-colors">Arctic Shift</a>
                        {" "}and{" "}
                        <a href="https://pullpush.io/" target="_blank" rel="noopener noreferrer" className="text-[color:var(--text-faint)] hover:underline transition-colors">PullPush</a>.
                    </p>
                </footer>
            )}
        </div>
    );
}