/* Tests Tonight's Three against the real index, through a running /api/tonight.
     node tools/vibe/tonight-bench.mjs [base-url]          (default http://localhost:8283)
   Every taste over 14 days: 4 sets, three different films per set, no film twice in a run,
   each role inside its widest rules. Prints the first set of each run to read by eye. */
const BASE = process.argv[2] || 'http://localhost:8283';
const TASTES = [[], [18], [35], [27], [878], [28, 53], [18, 53], [10749, 35], [16, 10751], [80, 9648]];
const days = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 10, 9 + i)).toISOString().slice(0, 10));
const failures = [], seen = new Map(), firsts = new Map();   // firsts: what one person sees first, day after day
const show = m => `${m.title} (${(m.release_date || '').slice(0, 4)}) ${m.vote_average.toFixed(1)}/${m.vote_count}${m.stream ? ' [' + m.stream.name + ']' : ''}`;

for (const genres of TASTES) {
  for (const day of days) {
    const r = await fetch(`${BASE}/api/tonight?debug=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genres, day }) });
    const d = await r.json();
    const label = `${genres.join('+') || 'anyone'} ${day}`;
    if (d.sets?.length !== 4) failures.push(`${label}: ${d.sets?.length ?? r.status} sets`);
    const ids = new Set();
    for (const set of d.sets || []) for (const role of ['safe', 'surprise', 'comfort']) {
      const m = set[role];
      if (!m) { failures.push(`${label}: no ${role}`); continue; }
      if (ids.has(m.id)) failures.push(`${label}: ${m.title} twice`);
      ids.add(m.id);
      seen.set(`${role}:${m.id}`, m.title);
      if (!m.poster_path) failures.push(`${label}: ${m.title} has no poster`);
      if (role === 'safe' && m.vote_average < 6.8) failures.push(`${label}: safe ${show(m)}`);
      if (role === 'surprise' && m.vote_average < 6) failures.push(`${label}: surprise ${show(m)}`);
    }
    for (const role of ['safe', 'surprise', 'comfort']) {
      const key = `${genres.join('+') || 'anyone'}:${role}`, m = d.sets?.[0]?.[role];
      if (m) firsts.set(key, [...(firsts.get(key) || []), m.title]);
    }
    if (day === days[0] || day === days[5]) {
      const s = d.sets?.[0];
      if (s) console.log(`\n${label}\n  safe     ${show(s.safe)}\n  surprise ${show(s.surprise)}\n  comfort  ${show(s.comfort)}\n  why      ${s.safe.why}`);
    }
  }
}
for (const role of ['safe', 'surprise', 'comfort']) {
  console.log(`\n${role}: ${[...seen.keys()].filter(k => k.startsWith(role)).length} different films across the runs`);
}
console.log('\nDifferent first picks in 14 days (a daily visitor):');
for (const [key, titles] of firsts) console.log(`  ${key.padEnd(22)} ${new Set(titles).size}/${titles.length}`);
console.log(failures.length ? `\nFAILED ${failures.length}:\n${failures.slice(0, 30).join('\n')}` : '\nAll runs passed.');
process.exit(failures.length ? 1 : 0);
