// Deterministic RNG for Goal 18 generator (zero deps, reproducible byte-for-byte).
import crypto from 'node:crypto';

export function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

export function createRng(seedStr) {
  let counter = 0;
  function nextBytes(n) {
    const out = Buffer.alloc(n);
    let filled = 0;
    while (filled < n) {
      const h = crypto.createHash('sha256').update(`${seedStr}#${counter++}`, 'utf8').digest();
      const take = Math.min(h.length, n - filled);
      h.copy(out, filled, 0, take);
      filled += take;
    }
    return out;
  }
  function nextFloat() {
    const b = nextBytes(8);
    return b.readUInt32BE(0) / 2 ** 32;
  }
  return {
    nextFloat,
    int(n) { return Math.floor(nextFloat() * n); },
    pick(arr) { return arr[Math.floor(nextFloat() * arr.length)]; },
    pickWeighted(entries) {
      // entries: [{v, w}]
      const total = entries.reduce((a, e) => a + e.w, 0);
      let r = nextFloat() * total;
      for (const e of entries) { r -= e.w; if (r <= 0) return e.v; }
      return entries[entries.length - 1].v;
    },
    pickMany(arr, k) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(nextFloat() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, Math.min(k, a.length));
    },
    shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(nextFloat() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    intBetween(min, max) { return min + Math.floor(nextFloat() * (max - min + 1)); }
  };
}

