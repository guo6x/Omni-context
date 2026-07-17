function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const approximation = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * approximation;
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

export function bootstrapMeanDifference(values, { iterations = 10_000, seed = 20260717 } = {}) {
  if (!values.length) return { iterations, seed, lower: null, upper: null };
  const random = mulberry32(seed);
  const samples = new Array(iterations);
  for (let iteration = 0; iteration < iterations; iteration++) {
    let total = 0;
    for (let index = 0; index < values.length; index++) total += values[Math.floor(random() * values.length)];
    samples[iteration] = total / values.length;
  }
  samples.sort((left, right) => left - right);
  const lower = samples[Math.floor(iterations * 0.025)];
  const upper = samples[Math.min(iterations - 1, Math.ceil(iterations * 0.975) - 1)];
  return { iterations, seed, lower, upper };
}

export function wilcoxonSignedRank(values) {
  const nonzero = values.map((value, index) => ({ value, absolute: Math.abs(value), index }))
    .filter((item) => item.absolute > 1e-12)
    .sort((left, right) => left.absolute - right.absolute || left.index - right.index);
  if (!nonzero.length) return { n: 0, w_plus: 0, w_minus: 0, z: 0, p_two_sided: 1, rank_biserial: 0 };

  const tieSizes = [];
  let cursor = 0;
  while (cursor < nonzero.length) {
    let end = cursor + 1;
    while (end < nonzero.length && Math.abs(nonzero[end].absolute - nonzero[cursor].absolute) <= 1e-12) end++;
    const averageRank = ((cursor + 1) + end) / 2;
    for (let index = cursor; index < end; index++) nonzero[index].rank = averageRank;
    tieSizes.push(end - cursor);
    cursor = end;
  }
  const wPlus = nonzero.filter((item) => item.value > 0).reduce((sum, item) => sum + item.rank, 0);
  const wMinus = nonzero.filter((item) => item.value < 0).reduce((sum, item) => sum + item.rank, 0);
  const n = nonzero.length;
  const expected = n * (n + 1) / 4;
  const tieCorrection = tieSizes.reduce((sum, size) => sum + (size ** 3 - size), 0) / 48;
  const variance = n * (n + 1) * (2 * n + 1) / 24 - tieCorrection;
  const centered = wPlus - expected;
  const corrected = centered === 0 ? 0 : centered - Math.sign(centered) * 0.5;
  const z = variance > 0 ? corrected / Math.sqrt(variance) : 0;
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  return {
    n,
    w_plus: wPlus,
    w_minus: wMinus,
    z,
    p_two_sided: p,
    rank_biserial: (wPlus - wMinus) / (wPlus + wMinus),
  };
}

export function pairedSummary(fullById, ablatedById, options = {}) {
  const scenarioIds = [...fullById.keys()].filter((id) => ablatedById.has(id)).sort();
  const differences = scenarioIds.map((id) => Number(fullById.get(id)) - Number(ablatedById.get(id)));
  const standardDeviation = sampleStandardDeviation(differences);
  return {
    paired_n: differences.length,
    mean_difference: mean(differences),
    median_difference: median(differences),
    full_higher: differences.filter((value) => value > 1e-12).length,
    ablation_higher: differences.filter((value) => value < -1e-12).length,
    ties: differences.filter((value) => Math.abs(value) <= 1e-12).length,
    bootstrap_95_ci: bootstrapMeanDifference(differences, options),
    wilcoxon: wilcoxonSignedRank(differences),
    effect_size: {
      paired_cohens_dz: standardDeviation > 0 ? mean(differences) / standardDeviation : 0,
    },
    scenario_ids: scenarioIds,
    differences,
  };
}
