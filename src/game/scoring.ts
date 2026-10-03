/**
 * The only scoring formula in the game. Tweak this function to retune feel.
 *
 * deviation = sum over pieces of |actualShare - targetShare|
 * linear    = max(0, 1 - deviation / 0.5)
 * eased     = 1 - (1 - linear)^2   // ease-out quad, so close splits feel rewarding
 * score     = round(100 * eased)
 *
 * A perfect split (deviation 0) scores 100. Deviation of 0.5 or more scores 0.
 */
export function scoreSplit(actualShares: number[], targetShares: number[]): number {
  const n = Math.min(actualShares.length, targetShares.length);
  let deviation = 0;
  for (let i = 0; i < n; i++) {
    deviation += Math.abs((actualShares[i] ?? 0) - (targetShares[i] ?? 0));
  }
  const linear = Math.max(0, 1 - deviation / 0.5);
  const eased = 1 - (1 - linear) ** 2;
  return Math.round(100 * eased);
}

export function targetShares(pieces: number): number[] {
  return Array.from({ length: pieces }, () => 1 / pieces);
}
