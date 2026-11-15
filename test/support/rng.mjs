// mulberry32: a small seeded generator, so random tests and the benchmark repeat exactly.
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (low, high) => low + (high - low) * next(),
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
    pick: list => list[Math.floor(next() * list.length)],
    chance: p => next() < p
  };
}
