// Zero-dependency statistics helpers for the evidence-surface study.

function logChoose(n, k) {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  k = Math.min(k, n - k);
  let out = 0;
  for (let i = 1; i <= k; i++) {
    out += Math.log(n - k + i) - Math.log(i);
  }
  return out;
}

function binomProbHalf(n, k) {
  return Math.exp(logChoose(n, k) - n * Math.log(2));
}

/**
 * Exact two-sided McNemar test.
 *
 * b = FULL safe, HIDDEN unsupported
 * c = FULL unsupported, HIDDEN safe
 *
 * Under H0, b ~ Binomial(b+c, 0.5).
 */
export function exactMcNemarTwoSided(b, c) {
  if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) {
    throw new Error('b and c must be non-negative integers');
  }
  const n = b + c;
  if (n === 0) return 1;
  const tailTo = Math.min(b, c);
  let tail = 0;
  for (let k = 0; k <= tailTo; k++) tail += binomProbHalf(n, k);
  return Math.min(1, 2 * tail);
}

export function pairedBinarySummary(pairs, fullKey = 'full', hiddenKey = 'hidden') {
  let n00 = 0, n01 = 0, n10 = 0, n11 = 0;
  for (const pair of pairs) {
    const f = Number(pair[fullKey] === true);
    const h = Number(pair[hiddenKey] === true);
    if (f === 0 && h === 0) n00++;
    else if (f === 0 && h === 1) n01++;
    else if (f === 1 && h === 0) n10++;
    else n11++;
  }
  const n = pairs.length;
  const fullRate = n ? (n10 + n11) / n : 0;
  const hiddenRate = n ? (n01 + n11) / n : 0;
  return {
    n,
    n00,
    n01,
    n10,
    n11,
    full_rate: fullRate,
    hidden_rate: hiddenRate,
    risk_difference_hidden_minus_full: hiddenRate - fullRate,
    exact_mcnemar_two_sided_p: exactMcNemarTwoSided(n01, n10),
  };
}
