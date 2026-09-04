import { RemoteVideoProvider, Stroke, StrokePoint } from "./types";

export function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

export function hexToRgba(hex: string, alpha: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return hex;
	const n = parseInt(m[1], 16);
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Sets the alpha channel of any hex/rgb/rgba color string. */
export function setColorAlpha(color: string, alpha: number): string {
	if (color.startsWith("#")) return hexToRgba(color, alpha);
	const m = /rgba?\(([^)]+)\)/.exec(color);
	if (!m) return color;
	const parts = m[1].split(",").map(s => s.trim());
	return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
}

/** Relative luminance check: is this hex color "light"? */
export function isLightColor(hex: string): boolean {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return false;
	const n = parseInt(m[1], 16);
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
}

export function distPointToSegment(
	px: number, py: number,
	ax: number, ay: number,
	bx: number, by: number
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.hypot(px - ax, py - ay);
	let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
	t = clamp(t, 0, 1);
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function strokeHit(stroke: Stroke, x: number, y: number, slop: number): boolean {
	const threshold = stroke.width / 2 + slop;
	const pts: StrokePoint[] = stroke.points;
	if (pts.length === 1) {
		return Math.hypot(pts[0].x - x, pts[0].y - y) <= threshold;
	}
	for (let i = 0; i < pts.length - 1; i++) {
		if (distPointToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= threshold) {
			return true;
		}
	}
	return false;
}

/**
 * Returns the index of the topmost stroke under the point, or -1.
 * Slop is expressed in scene units.
 */
/**
 * Cuts the part of a polyline that lies inside a circle, the way a real
 * eraser rubs out only what it touches. Segments are split where they cross
 * the circle, so a two-point straight line loses a gap instead of its whole
 * self. Returns the surviving pieces, or null when nothing was touched.
 */
export function cutStrokeAround(points: StrokePoint[], cx: number, cy: number, r: number): StrokePoint[][] | null {
	if (points.length === 0) return null;
	if (points.length === 1) return Math.hypot(points[0].x - cx, points[0].y - cy) <= r ? [] : null;
	const pieces: StrokePoint[][] = [];
	let run: StrokePoint[] = [];
	let touched = false;
	const flush = () => { if (run.length >= 2) pieces.push(run); run = []; };
	const lerp = (a: StrokePoint, b: StrokePoint, t: number): StrokePoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const span = circleSegmentSpan(a, b, cx, cy, r);
		if (!span) {
			if (run.length === 0) run.push(a);
			run.push(b);
			continue;
		}
		touched = true;
		const [t0, t1] = span;
		if (t0 > 0) {
			if (run.length === 0) run.push(a);
			run.push(lerp(a, b, t0));
		}
		flush();
		if (t1 < 1) run.push(lerp(a, b, t1), b);
	}
	flush();
	return touched ? pieces : null;
}

/** Parameter range [t0, t1] of segment a→b inside the circle, or null when it misses. */
function circleSegmentSpan(a: StrokePoint, b: StrokePoint, cx: number, cy: number, r: number): [number, number] | null {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const fx = a.x - cx;
	const fy = a.y - cy;
	const quad = dx * dx + dy * dy;
	if (quad === 0) return Math.hypot(fx, fy) <= r ? [0, 1] : null;
	const lin = 2 * (fx * dx + fy * dy);
	const cons = fx * fx + fy * fy - r * r;
	const disc = lin * lin - 4 * quad * cons;
	if (disc < 0) return null;
	const root = Math.sqrt(disc);
	const t0 = (-lin - root) / (2 * quad);
	const t1 = (-lin + root) / (2 * quad);
	if (t1 < 0 || t0 > 1) return null;
	return [Math.max(0, t0), Math.min(1, t1)];
}

export function hitTestStrokes(strokes: Stroke[], x: number, y: number, slop = 8): number {
	for (let i = strokes.length - 1; i >= 0; i--) {
		if (strokeHit(strokes[i], x, y, slop)) return i;
	}
	return -1;
}

export interface RemoteVideoEmbed {
	provider: RemoteVideoProvider;
	embedUrl: string;
	originalUrl: string;
	width: number;
	height: number;
}

/** Converts public video links into the standard iframe endpoints of known providers. */
export function toRemoteVideoEmbed(rawUrl: string): RemoteVideoEmbed | null {
	const candidate = rawUrl.trim();
	// Share sheets often copy a title followed by one URL. Never guess between several links.
	const links = candidate.match(/https?:\/\/[^\s<>]+/gi);
	const originalUrl = links?.length === 1 ? links[0].replace(/[)\].,;!]+$/, "") : candidate;
	let url: URL;
	try {
		url = new URL(originalUrl);
	} catch {
		return null;
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	const domain = (name: string) => host === name || host.endsWith(`.${name}`);
	const parts = url.pathname.split("/").filter(Boolean);
	const make = (provider: RemoteVideoProvider, embedUrl: string, portrait = false): RemoteVideoEmbed => ({
		provider, embedUrl, originalUrl, width: portrait ? 390 : 560, height: portrait ? 640 : 315
	});

	if (host === "youtu.be" || domain("youtube.com") || domain("youtube-nocookie.com")) {
		const id = host === "youtu.be"
			? parts[0]
			: url.searchParams.get("v") || (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : undefined);
		if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
			const params = new URLSearchParams({ playsinline: "1" });
			const time = url.searchParams.get("start") ?? url.searchParams.get("t") ?? "";
			const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(time);
			const seconds = /^\d+$/.test(time) ? Number(time) : match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
			if (Number.isSafeInteger(seconds) && seconds > 0) params.set("start", String(seconds));
			const result = make("youtube", `https://www.youtube-nocookie.com/embed/${id}?${params}`);
			result.originalUrl = `https://www.youtube.com/watch?v=${id}${seconds > 0 ? "&t=" + seconds : ""}`;
			return result;
		}
	}

	if (domain("tiktok.com")) {
		// Short share links cannot be embedded without resolving their redirect. Keep a usable original card.
		if (["vm.tiktok.com", "vt.tiktok.com"].includes(host) && parts.length === 1) return make("tiktok", "", true);
		const videoIndex = parts.indexOf("video");
		const videoId = videoIndex >= 0 ? parts[videoIndex + 1] : undefined;
		if (videoId && /^\d{8,}$/.test(videoId)) return make("tiktok", `https://www.tiktok.com/player/v1/${videoId}?controls=1&description=1`, true);
	}

	if (domain("instagram.com")) {
		if (parts[0] === "share" && parts.length >= 2) return make("instagram", "", true);
		const type = parts[0] === "p" || parts[0] === "reel" || parts[0] === "reels" || parts[0] === "tv" ? parts[0] : undefined;
		const shortcode = type ? parts[1] : undefined;
		if (shortcode && /^[A-Za-z0-9_-]{5,}$/.test(shortcode)) return make("instagram", `https://www.instagram.com/${type}/${shortcode}/embed/captioned/`, type !== "p");
	}

	if (host === "x.com" || domain("twitter.com")) {
		const index = parts.indexOf("status");
		const postId = index >= 0 ? parts[index + 1] : undefined;
		if (postId && /^\d{8,}$/.test(postId)) return make("x", `https://platform.twitter.com/embed/Tweet.html?id=${postId}&dnt=true`, true);
	}

	if (host === "vimeo.com" || domain("vimeo.com")) {
		const id = [...parts].reverse().find(part => /^\d+$/.test(part));
		if (id) {
			const hash = url.searchParams.get("h") ?? parts[parts.indexOf(id) + 1];
			return make("vimeo", `https://player.vimeo.com/video/${id}${hash && /^[a-zA-Z0-9]+$/.test(hash) ? "?h=" + encodeURIComponent(hash) : ""}`);
		}
	}

	if (host === "dai.ly" || domain("dailymotion.com")) {
		const videoIndex = parts.indexOf("video");
		const id = host === "dai.ly" ? parts[0] : videoIndex >= 0 ? parts[videoIndex + 1] : undefined;
		if (id && /^[A-Za-z0-9]+$/.test(id)) return make("dailymotion", `https://www.dailymotion.com/embed/video/${id}`);
	}

	if (host === "streamable.com" || domain("streamable.com")) {
		const id = parts[0] === "e" ? parts[1] : parts[0];
		if (id && /^[A-Za-z0-9]+$/.test(id)) return make("streamable", `https://streamable.com/e/${id}`);
	}

	if (domain("loom.com")) {
		const id = ["share", "embed"].includes(parts[0]) ? parts[1] : undefined;
		if (id && /^[A-Za-z0-9]+$/.test(id)) return make("loom", `https://www.loom.com/embed/${id}`);
	}

	if (domain("facebook.com") && parts.length > 0) {
		return make("facebook", `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(originalUrl)}&show_text=false&width=560`);
	}

	return null;
}

/** Kept for compatibility with existing callers and legacy documents. */
export function toYouTubeEmbedUrl(url: string): string | null {
	const embed = toRemoteVideoEmbed(url);
	return embed?.provider === "youtube" ? embed.embedUrl : null;
}

export const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv", "m4v"];
