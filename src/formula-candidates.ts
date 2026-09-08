/** Match glyphs only in formula content, never in LaTeX command names. */
export function formulaTokenPositions(source: string, values: string[]): number[] {
    const commands = [...source.matchAll(/\\[A-Za-z]+/g)].map(m => [m.index, m.index + m[0].length]);
    let cursor = 0;
    return values.map(value => {
        let position = source.indexOf(value, cursor);
        while (position >= 0 && commands.some(([a, b]) => position < b && position + value.length > a)) {
            position = source.indexOf(value, position + 1);
        }
        if (position >= 0) cursor = position + value.length;
        return position;
    });
}
