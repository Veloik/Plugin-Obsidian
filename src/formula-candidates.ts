/**
 * Where each recognised glyph sits in the formula text. A letter is never
 * found inside a command name (the "r" of \sqrt), but a command is found as
 * itself, so \alpha can be offered for correction too.
 */
export function formulaTokenPositions(source: string, values: string[]): number[] {
    const commands = [...source.matchAll(/\\[A-Za-z]+/g)].map(m => [m.index, m.index + m[0].length]);
    let cursor = 0;
    return values.map(value => {
        const clashes = (position: number) => commands.some(([a, b]) => {
            if (position + value.length <= a || position >= b) return false;
            // The value is exactly this command: that is the glyph itself.
            return !(value.startsWith("\\") && position === a && position + value.length === b);
        });
        let position = source.indexOf(value, cursor);
        while (position >= 0 && clashes(position)) position = source.indexOf(value, position + 1);
        if (position >= 0) cursor = position + value.length;
        return position;
    });
}
