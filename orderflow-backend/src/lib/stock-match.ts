export interface StockProduct {
  description: string;
  in_stock: boolean;
}

export interface StockMatch {
  product: string;
  /** false = same name (ignoring case/punctuation/spacing); true = merely similar. */
  similar: boolean;
}

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    // Light plural folding so "widgets" lines up with "widget".
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));

const editDistance = (a: string, b: string): number => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
};

// A typo of one character is tolerated, but only on longer words — "red" vs
// "rod" are different things, "widget" vs "widgit" are not.
const sameToken = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1);

/** 0..1 — how much of the two descriptions' words line up, plus whether one is wholly contained in the other. */
const similarity = (a: string[], b: string[]) => {
  const unusedB = [...b];
  let common = 0;
  for (const t of a) {
    const idx = unusedB.findIndex((u) => sameToken(t, u));
    if (idx >= 0) {
      common++;
      unusedB.splice(idx, 1);
    }
  }
  const union = a.length + b.length - common;
  const jaccard = union ? common / union : 0;
  const contained = common === Math.min(a.length, b.length) && Math.min(a.length, b.length) >= 2;
  return { jaccard, contained };
};

const SIMILAR_THRESHOLD = 0.6;

/**
 * Finds the price-list product an order line most plausibly refers to and
 * returns it only if that product is out of stock. Order lines are free text,
 * so a hand-typed or reworded line is compared by its words rather than
 * character-for-character: same words in a different order, a plural, a
 * one-letter typo on a longer word, or an extra qualifier ("Blue Widget 10mm"
 * against "Blue Widget") all count as similar. When the best match is an
 * in-stock product — including an exact one — nothing is flagged, so a line
 * that is clearly a different, available item isn't caught by a near neighbour.
 */
export const findOutOfStockMatch = (description: string, products: StockProduct[]): StockMatch | null => {
  const line = tokenize(description);
  if (!line.length) return null;
  const lineKey = line.join(" ");

  let best: { product: StockProduct; score: number; exact: boolean } | null = null;
  for (const p of products) {
    const tokens = tokenize(p.description);
    if (!tokens.length) continue;

    let score: number;
    let exact = false;
    if (tokens.join(" ") === lineKey) {
      score = 2;
      exact = true;
    } else {
      const { jaccard, contained } = similarity(line, tokens);
      if (jaccard < SIMILAR_THRESHOLD && !contained) continue;
      // Containment alone ranks just under a strong word-for-word overlap.
      score = Math.max(jaccard, contained ? 0.9 : 0);
    }

    // On a tie, prefer the in-stock product (the safer, quieter outcome).
    if (!best || score > best.score || (score === best.score && p.in_stock && !best.product.in_stock))
      best = { product: p, score, exact };
  }

  if (!best || best.product.in_stock) return null;
  return { product: best.product.description, similar: !best.exact };
};
