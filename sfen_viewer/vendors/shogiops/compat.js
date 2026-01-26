import { defined, isDrop, makeSquareName, parseSquareName, parseUsi, squareFile, squareRank, } from './util.js';
import { secondLionStepDests } from './variant/chushogi.js';
import { dimensions, fullSquareSet } from './variant/util.js';
export function squareSetToSquareNames(sqs) {
    return Array.from(sqs, (s) => makeSquareName(s));
}
export function shogigroundMoveDests(pos) {
    const result = new Map();
    const ctx = pos.ctx();
    for (const [from, squares] of pos.allMoveDests(ctx)) {
        if (squares.nonEmpty()) {
            const d = squareSetToSquareNames(squares);
            result.set(makeSquareName(from), d);
        }
    }
    return result;
}
export function shogigroundDropDests(pos) {
    const result = new Map();
    const ctx = pos.ctx();
    for (const [pieceName, squares] of pos.allDropDests(ctx)) {
        if (squares.nonEmpty()) {
            const d = squareSetToSquareNames(squares);
            result.set(pieceName, d);
        }
    }
    return result;
}
export function shogigroundSecondLionStep(before, initialSq, midSq) {
    const result = new Map();
    const squares = secondLionStepDests(before, parseSquareName(initialSq), parseSquareName(midSq));
    if (squares.nonEmpty()) {
        const d = squareSetToSquareNames(squares);
        result.set(makeSquareName(parseSquareName(midSq)), d);
    }
    return result;
}
export function usiToSquareNames(usi) {
    if (!defined(usi))
        return [];
    const md = parseUsi(usi);
    return defined(md) ? moveToSquareNames(md) : [];
}
export function moveToSquareNames(md) {
    return isDrop(md)
        ? [makeSquareName(md.to)]
        : defined(md.midStep)
            ? [makeSquareName(md.from), makeSquareName(md.midStep), makeSquareName(md.to)]
            : [makeSquareName(md.from), makeSquareName(md.to)];
}
export function checksSquareNames(pos) {
    return squareSetToSquareNames(pos.checks());
}
// https://github.com/WandererXII/scalashogi/blob/main/src/main/scala/format/usi/UsiCharPair.scala
export function scalashogiCharPair(md, rules) {
    const charOffset = 35;
    function squareToCharCode(sq) {
        return charOffset + squareRank(sq) * dimensions(rules).files + squareFile(sq);
    }
    function lionMoveToChar(orig, dest, ms, rules) {
        const toMidStep = (squareFile(orig) - squareFile(ms) + 1 + 3 * (squareRank(orig) - squareRank(ms) + 1) + 4) % 9;
        const toDest = (squareFile(ms) - squareFile(dest) + 1 + 3 * (squareRank(ms) - squareRank(dest) + 1) + 4) % 9;
        return charOffset + fullSquareSet(rules).size() + toMidStep + 8 * toDest;
    }
    if (isDrop(md))
        return String.fromCharCode(squareToCharCode(md.to), charOffset +
            81 +
            ['rook', 'bishop', 'gold', 'silver', 'knight', 'lance', 'pawn'].indexOf(md.role));
    else {
        const from = squareToCharCode(md.from);
        const to = defined(md.midStep)
            ? lionMoveToChar(md.from, md.to, md.midStep, rules)
            : squareToCharCode(md.to);
        if (md.promotion)
            return String.fromCharCode(to, from);
        else
            return String.fromCharCode(from, to);
    }
}
//# sourceMappingURL=compat.js.map