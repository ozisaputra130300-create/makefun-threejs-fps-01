// Seeded randomness for Duskline Depot: a small mulberry32 generator so the
// screenshot staging (?seed=N) and bot patrol picks are reproducible, while
// live play just seeds from the clock. One function, no state shared.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick one item from an array with the given generator.
export function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}
