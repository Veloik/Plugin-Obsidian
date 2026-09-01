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
	const originalUrl = rawUrl.trim();
	let url: URL;
	try {
		url = new URL(originalUrl);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	const parts = url.pathname.split("/").filter(Boolean);
	const make = (provider: RemoteVideoProvider, embedUrl: string, portrait = false): RemoteVideoEmbed => ({
		provider, embedUrl, originalUrl, width: portrait ? 390 : 560, height: portrait ? 640 : 315
	});

	if (host === "youtu.be" || host.endsWith("youtube.com")) {
		const id = host === "youtu.be"
			? parts[0]
			: url.searchParams.get("v") || (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : undefined);
		if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) return make("youtube", `https://www.youtube-nocookie.com/embed/${id}?playsinline=1`);
	}

	if (host.endsWith("tiktok.com")) {
		const videoIndex = parts.indexOf("video");
		const videoId = videoIndex >= 0 ? parts[videoIndex + 1] : undefined;
		if (videoId && /^\d{8,}$/.test(videoId)) return make("tiktok", `https://www.tiktok.com/player/v1/${videoId}?controls=1&description=1`, true);
	}

	if (host.endsWith("instagram.com")) {
		const type = parts[0] === "p" || parts[0] === "reel" || parts[0] === "reels" || parts[0] === "tv" ? parts[0] : undefined;
		const shortcode = type ? parts[1] : undefined;
		if (shortcode && /^[A-Za-z0-9_-]{5,}$/.test(shortcode)) return make("instagram", `https://www.instagram.com/${type}/${shortcode}/embed/captioned/`, type !== "p");
	}

	if (host === "x.com" || host.endsWith("twitter.com")) {
		const index = parts.indexOf("status");
		const postId = index >= 0 ? parts[index + 1] : undefined;
		if (postId && /^\d{8,}$/.test(postId)) return make("x", `https://platform.twitter.com/embed/Tweet.html?id=${postId}&dnt=true`, true);
	}

	if (host === "vimeo.com" || host.endsWith("vimeo.com")) {
		const id = [...parts].reverse().find(part => /^\d+$/.test(part));
		if (id) return make("vimeo", `https://player.vimeo.com/video/${id}`);
	}

	if (host === "dai.ly" || host.endsWith("dailymotion.com")) {
		const videoIndex = parts.indexOf("video");
		const id = host === "dai.ly" ? parts[0] : videoIndex >= 0 ? parts[videoIndex + 1] : undefined;
		if (id && /^[A-Za-z0-9]+$/.test(id)) return make("dailymotion", `https://www.dailymotion.com/embed/video/${id}`);
	}

	if (host === "streamable.com" || host.endsWith("streamable.com")) {
		const id = parts[0] === "e" ? parts[1] : parts[0];
		if (id && /^[A-Za-z0-9]+$/.test(id)) return make("streamable", `https://streamable.com/e/${id}`);
	}

	if (host.endsWith("loom.com")) {
		const id = parts[0] === "share" ? parts[1] : undefined;
		if (id && /^[A-Za-z0-9]+$/.test(id)) return make("loom", `https://www.loom.com/embed/${id}`);
	}

	if (host.endsWith("facebook.com") && parts.length > 0) {
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
