import { InkMathPoint, InkMathStroke } from "./ink-math";

/** Distance to the drawn segments, even when the device sampled few points. */
export function inkHitsPoint(stroke: InkMathStroke, point: InkMathPoint, radius: number): boolean {
    const points = stroke.points;
    if (points.some(p => Math.hypot(p.x - point.x, p.y - point.y) <= radius)) return true;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) continue;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
        if (Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y) <= radius) return true;
    }
    return false;
}

/** Clip segments, including lines whose endpoints both lie outside the region. */
export function clipInkToRect<T extends InkMathStroke>(stroke: T, rect: { x: number; y: number; w: number; h: number }): T[] {
    const inside = (p: InkMathPoint) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
    if (stroke.points.length === 1) return inside(stroke.points[0]) ? [stroke] : [];
    const parts: T[] = [];
    let current: InkMathPoint[] | null = null;
    for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i - 1], b = stroke.points[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        let lo = 0, hi = 1, accepted = true;
        for (const [d, q] of [[-dx, a.x - rect.x], [dx, rect.x + rect.w - a.x], [-dy, a.y - rect.y], [dy, rect.y + rect.h - a.y]]) {
            if (d === 0) { if (q < 0) accepted = false; continue; }
            const t = q / d;
            if (d < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
        }
        if (!accepted || lo > hi) { current = null; continue; }
        const start = { ...a, x: a.x + lo * dx, y: a.y + lo * dy };
        const end = { ...b, x: a.x + hi * dx, y: a.y + hi * dy };
        if (!current || lo > 0) { current = [start]; parts.push({ ...stroke, points: current }); }
        current.push(end);
        if (hi < 1) current = null;
    }
    return parts;
}
