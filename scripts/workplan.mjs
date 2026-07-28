#!/usr/bin/env node
// Akashic work ledger — the single source of truth for what is done and what is not.
//
// docs/workplan/tasks.json is authoritative. WORKPLAN.md is generated from it and must
// never be hand-edited: `check` fails if the two disagree, which is what stops the plan
// from drifting away from reality the way six markdown files already did.
//
//   node scripts/workplan.mjs check              validate + confirm WORKPLAN.md is in sync
//   node scripts/workplan.mjs render             regenerate WORKPLAN.md
//   node scripts/workplan.mjs status             counts by track and status
//   node scripts/workplan.mjs next [--track T]   tasks that are claimable right now
//   node scripts/workplan.mjs show <id>          everything about one task
//   node scripts/workplan.mjs claim <id> --agent NAME --branch BRANCH
//   node scripts/workplan.mjs note <id> "where I stopped"
//   node scripts/workplan.mjs verify <id>         RUN the task's verify list and record the result
//   node scripts/workplan.mjs done <id> --evidence "what proves it"
//   node scripts/workplan.mjs block <id> --reason "why"
//
// Exit codes: 0 ok, 1 validation, sync or verification failure, 2 usage error,
//             3 every runnable check passed but something still needs a human (see `verify`).
//
// ------------------------------------------------------------------ on `verify`
//
// For most of this ledger's life `verify` was a list of strings that nothing ever executed. It was
// printed by `show`, quoted in commit messages, and trusted. That is the project's documented
// failure class — a claim decoupled from the mechanism that would make it true — sitting in the
// tool built to prevent it: `done` accepted any free-text `--evidence`, so "804 tests pass" was
// as acceptable as running them, and the ledger could not tell the difference.
//
// The one design decision worth explaining. About four fifths of the 259 entries are shell
// commands and the rest are instructions to a person ("Run in the simulator with the system
// language set to Norwegian"). I tried to tell them apart by inspection twice and got a different
// answer each time — a command-word allowlist called `test -f CLAUDE.md` prose, and resolving the
// first token against PATH called `for d in ...; do` and `! grep` prose, because those are shell
// keywords rather than executables. Every heuristic I could write was wrong somewhere, and a
// misclassification is not a harmless one: prose executed as shell fails and reads as a broken
// task, while a real command classified as prose is silently never run, which is the exact hole
// this closes.
//
// So the classification lives in the DATA, where it is a deliberate act. An entry prefixed
// `MANUAL:` needs a person; `OWNER:` needs the owner specifically — a device, an Apple ID, a paid
// agreement. Everything else is executed. An author who writes prose and forgets the prefix gets
// a loud FAIL on the first run, which is the right direction to fail in: it asks them to declare
// what they meant instead of quietly deciding for them.

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'docs/workplan/tasks.json');
const RENDERED = join(ROOT, 'WORKPLAN.md');

const TRACKS = ['LEGACY', 'DOCS', 'SHIP', 'DIFF', 'QUALITY'];
const STATUSES = ['TODO', 'WIP', 'BLOCKED', 'DONE', 'DROPPED'];
const OPEN = ['TODO', 'WIP', 'BLOCKED'];

const read = () => JSON.parse(readFileSync(LEDGER, 'utf8'));
const write = (d) => writeFileSync(LEDGER, JSON.stringify(d, null, 2) + '\n');

// ------------------------------------------------------------------ verify

// See the header note: the runnable/attestable split is declared in the ledger, never guessed.
// Case-insensitive on purpose: one entry already said `Manual:` in prose before this existed, and
// no shell command begins with either word followed by a colon, so there is nothing to collide with.
const ATTEST_PREFIX = /^(MANUAL|OWNER):\s*/i;
const classify = (entry) => {
  const m = entry.match(ATTEST_PREFIX);
  return m
    ? { kind: m[1].toLowerCase(), text: entry.slice(m[0].length) }
    : { kind: 'run', text: entry };
};

// The native suite is ~190 s and a clean build with tests is longer, so the ceiling has to be
// generous or the tool fails the very checks that matter most. 25 minutes is above the slowest
// measured entry (`xcodegen generate && xcodebuild ... test`, ~4 min from cold) with room for a
// cold Swift module cache, and still low enough that a hung command does not strand an agent.
const ENTRY_TIMEOUT_MS = 25 * 60 * 1000;

/**
 * Execute one verify entry through `sh -c` from the repo root.
 *
 * `sh -c` rather than parsing the string ourselves, because the entries legitimately use shell
 * grammar the ledger should not have to give up: `&&` chains, `!` negation, `for` loops, pipes
 * into `wc -l`, and `$(...)` substitution that finds the current simulator UDID. Anything that
 * runs when pasted into a terminal runs here identically, which is the property that makes the
 * ledger's entries worth trusting as documentation.
 */
const runEntry = (text) => {
  const started = Date.now();
  const r = spawnSync('sh', ['-c', text], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: ENTRY_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024, // a full xcodebuild log is tens of MB and truncating it hides the failure
  });
  const ms = Date.now() - started;
  // A timeout kills the child and reports signal SIGTERM with status null; treat it as its own
  // outcome rather than a plain failure, because "took longer than 25 minutes" and "exited 1" call
  // for completely different responses from whoever reads the report.
  if (r.error?.code === 'ETIMEDOUT' || (r.status === null && r.signal)) {
    return { ok: false, ms, status: null, signal: r.signal || 'ETIMEDOUT', out: r.stdout || '', err: r.stderr || '' };
  }
  return { ok: r.status === 0, ms, status: r.status, signal: null, out: r.stdout || '', err: r.stderr || '' };
};

const tail = (s, n = 12) => s.trimEnd().split('\n').slice(-n).join('\n');
const secs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- validation

// Two tasks collide when their file lists overlap. Globs are compared on their
// non-wildcard prefix, so "apple/Akashic/Views/**" and "apple/Akashic/Views/Story/X.swift"
// are correctly treated as the same territory.
const prefixOf = (glob) => {
  const star = glob.indexOf('*');
  return star === -1 ? glob : glob.slice(0, star);
};
const overlaps = (a, b) => {
  const pa = prefixOf(a), pb = prefixOf(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
};
const filesCollide = (t1, t2) =>
  (t1.files || []).some((f1) => (t2.files || []).some((f2) => overlaps(f1, f2)));

function validate(d) {
  const errs = [];
  const byId = new Map();
  const tasks = d.tasks || [];

  for (const t of tasks) {
    if (!t.id) { errs.push('a task has no id'); continue; }
    if (byId.has(t.id)) errs.push(`${t.id}: duplicate id`);
    byId.set(t.id, t);

    if (!TRACKS.includes(t.track)) errs.push(`${t.id}: unknown track "${t.track}"`);
    if (!STATUSES.includes(t.status)) errs.push(`${t.id}: unknown status "${t.status}"`);
    if (!t.title) errs.push(`${t.id}: no title`);
    if (typeof t.effort !== 'number') errs.push(`${t.id}: effort must be a number`);
    if (!t.done_when) errs.push(`${t.id}: no done_when — a task without a finish line cannot be verified`);

    // An agent-doable task must say how it will be proven. Owner tasks are exempt:
    // their proof is the owner's word (a dashboard, a device, a legal register).
    if (!t.owner && !(t.verify || []).length && t.status !== 'DROPPED') {
      errs.push(`${t.id}: agent task with no verify command`);
    }
    // `OWNER:` means "only the owner can make this check" — a device, an Apple ID, a paid
    // agreement. On a task an agent is expected to close, that is a contradiction rather than a
    // detail: it makes the task unclosable by whoever picks it up, and the honest fix is to either
    // mark the task `owner: true` or split the owner-only part into its own task.
    for (const v of t.verify || []) {
      const c = classify(v);
      if (c.kind === 'owner' && !t.owner) {
        errs.push(`${t.id}: an OWNER: verify entry on an agent task — mark the task owner:true or split it out`);
      }
      if (c.kind !== 'run' && !c.text.trim()) errs.push(`${t.id}: a ${c.kind.toUpperCase()}: verify entry says nothing`);
    }
    if (t.status === 'WIP' && !(t.claim && t.claim.agent && t.claim.branch)) {
      errs.push(`${t.id}: WIP requires claim.agent and claim.branch so it can be picked up`);
    }
    if (t.status === 'DONE' && !t.evidence) errs.push(`${t.id}: DONE requires evidence`);
    if (t.status === 'BLOCKED' && !t.blocked_reason) errs.push(`${t.id}: BLOCKED requires blocked_reason`);
    if (t.status === 'DROPPED' && !t.dropped_reason) errs.push(`${t.id}: DROPPED requires dropped_reason`);
  }

  for (const t of tasks) {
    for (const dep of t.deps || []) {
      if (!byId.has(dep)) errs.push(`${t.id}: dependency "${dep}" does not exist`);
    }
  }

  // Cycles: a cyclic ledger silently makes every task unclaimable.
  const state = new Map();
  const walk = (id, path) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      errs.push(`dependency cycle: ${path.slice(path.indexOf(id)).concat(id).join(' -> ')}`);
      return;
    }
    state.set(id, 'open');
    for (const dep of byId.get(id)?.deps || []) if (byId.has(dep)) walk(dep, [...path, id]);
    state.set(id, 'done');
  };
  for (const t of tasks) walk(t.id, []);

  // The parallel-safety guarantee: no two in-flight tasks may own the same files — unless the
  // same agent holds both, in which case they are worked in sequence by construction and cannot
  // race. Without that exemption a single agent could not legitimately take two related tasks
  // that share a file (e.g. three package.json items), which would push real work out of the
  // ledger and defeat the point of recording it.
  const wip = tasks.filter((t) => t.status === 'WIP');
  for (let i = 0; i < wip.length; i++) {
    for (let j = i + 1; j < wip.length; j++) {
      if (wip[i].claim?.agent && wip[i].claim.agent === wip[j].claim?.agent) continue;
      if (filesCollide(wip[i], wip[j])) {
        errs.push(`${wip[i].id} (${wip[i].claim?.agent ?? '?'}) and ${wip[j].id} ` +
          `(${wip[j].claim?.agent ?? '?'}) are both WIP and own overlapping files — serialise them ` +
          `or give them to one agent`);
      }
    }
  }
  return errs;
}

// ------------------------------------------------------------------ claimable

function claimable(d, track, agent) {
  const byId = new Map(d.tasks.map((t) => [t.id, t]));
  // Work already held by this agent is not an obstacle to it: sequential by construction.
  const wip = d.tasks.filter((t) => t.status === 'WIP' && !(agent && t.claim?.agent === agent));
  return d.tasks.filter((t) => {
    if (t.status !== 'TODO') return false;
    if (track && t.track !== track) return false;
    const depsMet = (t.deps || []).every((id) => byId.get(id)?.status === 'DONE');
    if (!depsMet) return false;
    return !wip.some((w) => filesCollide(w, t));
  });
}

// -------------------------------------------------------------------- render

const MARK = { TODO: ' ', WIP: '~', BLOCKED: '!', DONE: 'x', DROPPED: '-' };

function render(d) {
  const L = [];
  const tasks = d.tasks;
  const open = tasks.filter((t) => OPEN.includes(t.status));
  const agentOpen = open.filter((t) => !t.owner);
  const ownerOpen = open.filter((t) => t.owner);
  const sum = (xs) => Math.round(xs.reduce((n, t) => n + t.effort, 0) * 10) / 10;

  L.push('<!-- GENERATED FILE — do not edit.');
  L.push('     Source of truth: docs/workplan/tasks.json');
  L.push('     Regenerate:      npm run workplan:render');
  L.push('     CI fails if this file and the ledger disagree. -->');
  L.push('');
  L.push('# Akashic — work ledger');
  L.push('');
  const doneAgent = tasks.filter((t) => t.status === 'DONE' && !t.owner);
  const big = (xs) => xs.filter((t) => t.effort >= 2);
  L.push(`${tasks.length} tasks · **${open.length} open** (${agentOpen.length} agent-doable, ` +
    `${sum(agentOpen)} dev-days · ${ownerOpen.length} owner-only, ${sum(ownerOpen)} dev-days) · ` +
    `${tasks.filter((t) => t.status === 'DONE').length} done · ` +
    `${tasks.filter((t) => t.status === 'DROPPED').length} dropped`);
  L.push('');
  L.push('> **`dev-days` are a human-developer estimate, not agent time.** They came from the review');
  L.push('> that produced these tasks and they are the right unit for deciding whether something is');
  L.push('> worth doing — they are the wrong unit for predicting how long an agent will take, and');
  L.push('> summing them as "work remaining" overstates it substantially.');
  L.push('>');
    L.push(`> Measured so far: **${doneAgent.length} agent tasks estimated at ${sum(doneAgent)} dev-days**.`);
    // NO DURATION CLAIM, deliberately, and the reason is worth keeping. This line read "closed in roughly
    // one working afternoon" — true at 44 tasks / 17.7 dev-days, fiction by 99. The obvious fix, deriving
    // the span from dates in the ledger, produced "2 calendar days", also wrong, because only recently
    // annotated tasks carry ISO dates at all. A computed wrong number is worse than a stale sentence: it
    // looks measured. The ledger cannot support a duration, so it states none.
    L.push('> Elapsed time is deliberately absent: nothing here can support it. Use `git log` for that.');
    L.push('>');
    // The example list here used to name localisation, Swift 6 concurrency, the UI test target and the PDF
    // book as the large unmeasured items. All four are DONE, so it was warning the reader about work that no
    // longer exists. Derived from the ledger now, and it says the opposite.
    if (big(agentOpen).length) {
      L.push(`> ${big(doneAgent).length} of the closed tasks were 2 dev-days or more, and ` +
        `${sum(big(agentOpen))} of the ${sum(agentOpen)} remaining dev-days still sit in ` +
        `${big(agentOpen).length} such task(s): ${big(agentOpen).map((t) => t.id).join(', ')}. Those turn ` +
        `on design judgement rather than localised edits, so do not assume the compression above holds.`);
    } else {
      L.push(`> **Every large agent item is closed.** ${big(doneAgent).length} of the tasks closed so far ` +
        `were 2 dev-days or more; nothing 2 dev-days or larger remains agent-doable, and the ` +
        `${sum(agentOpen)} remaining dev-days are all small tasks ` +
        `(${agentOpen.filter((t) => t.effort <= 0.5).length} at 0.5 or less). What is still genuinely ` +
        `large is OWNER work, which no amount of agent compression touches.`);
    }
  L.push('');
  L.push('Read [CLAUDE.md](CLAUDE.md) before touching anything. To find work:');
  L.push('');
  L.push('```bash');
  L.push('node scripts/workplan.mjs next');
  L.push('```');
  L.push('');

  const wip = tasks.filter((t) => t.status === 'WIP');
  if (wip.length) {
    L.push('## In flight');
    L.push('');
    L.push('| Task | Agent | Branch | Stopped at |');
    L.push('|---|---|---|---|');
    for (const t of wip) {
      // Tolerant on purpose. `validate` already rejects a WIP task with no claim, in those words —
      // but this line used to crash with a bare `Cannot read properties of undefined (reading
      // 'agent')` BEFORE `check` got to print it, so the clear message was replaced by a stack
      // trace. Rendering a placeholder lets the real diagnostic through.
      const claim = t.claim || {};
      L.push(`| \`${t.id}\` ${t.title} | ${claim.agent || '—'} | \`${claim.branch || '—'}\` | ${t.resume || '—'} |`);
    }
    L.push('');
  }

  const blocked = tasks.filter((t) => t.status === 'BLOCKED');
  if (blocked.length) {
    L.push('## Blocked');
    L.push('');
    for (const t of blocked) L.push(`- \`${t.id}\` **${t.title}** — ${t.blocked_reason}`);
    L.push('');
  }

  for (const track of TRACKS) {
    const inTrack = tasks.filter((t) => t.track === track);
    if (!inTrack.length) continue;
    const o = inTrack.filter((t) => OPEN.includes(t.status));
    L.push(`## ${track}`);
    L.push('');
    if (d.track_notes?.[track]) { L.push(`> ${d.track_notes[track]}`); L.push(''); }
    L.push(`${o.length} open of ${inTrack.length} · ${sum(o)} d remaining`);
    L.push('');
    L.push('| | Task | Days | Who | Deps | Finish line |');
    L.push('|---|---|---|---|---|---|');
    for (const t of inTrack) {
      const deps = (t.deps || []).map((x) => `\`${x}\``).join(' ') || '—';
      L.push(`| \`${MARK[t.status]}\` | \`${t.id}\` **${t.title}** | ${t.effort} | ` +
        `${t.owner ? 'owner' : 'agent'} | ${deps} | ${t.done_when} |`);
    }
    L.push('');
  }

  if (d.decisions?.length) {
    L.push('## Decisions on record');
    L.push('');
    for (const dec of d.decisions) L.push(`- **${dec.what}** — ${dec.why}`);
    L.push('');
  }

  if (d.gates?.length) {
    L.push('## Gates that no amount of work shortens');
    L.push('');
    for (const g of d.gates) L.push(`- **${g.name}** — ${g.detail}`);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('Legend: `x` done · `~` in flight · `!` blocked · ` ` open · `-` dropped.');
  L.push('Days are focused build-days, not calendar time.');
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------- CLI

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? null : rest[i + 1];
};
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));

const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

switch (cmd) {
  case 'check': {
    const d = read();
    const errs = validate(d);
    // Only compare the render once the ledger is known valid. Rendering an invalid ledger is at
    // best a second, vaguer complaint about the same defect and at worst a crash that hides the
    // first one — which is exactly what a WIP task with no claim used to do.
    if (!errs.length && render(d) !== readFileSync(RENDERED, 'utf8')) {
      errs.push('WORKPLAN.md is out of date — run `npm run workplan:render` and commit the result');
    }
    if (errs.length) {
      console.error(`workplan: ${errs.length} problem(s)\n`);
      for (const e of errs) console.error(`  ✗ ${e}`);
      process.exit(1);
    }
    console.log(`workplan: ok — ${d.tasks.length} tasks, ledger and WORKPLAN.md agree`);
    break;
  }

  case 'render': {
    const d = read();
    const errs = validate(d);
    if (errs.length) { for (const e of errs) console.error(`  ✗ ${e}`); die('refusing to render an invalid ledger', 1); }
    writeFileSync(RENDERED, render(d));
    console.log(`workplan: wrote WORKPLAN.md (${d.tasks.length} tasks)`);
    break;
  }

  case 'status': {
    const d = read();
    const open = d.tasks.filter((t) => OPEN.includes(t.status));
    const days = (xs) => Math.round(xs.reduce((n, t) => n + t.effort, 0) * 10) / 10;
    console.log(`${d.tasks.length} tasks · ${open.length} open · ` +
      `${days(open.filter((t) => !t.owner))} agent-days + ${days(open.filter((t) => t.owner))} owner-days\n`);
    for (const track of TRACKS) {
      const inT = d.tasks.filter((t) => t.track === track);
      if (!inT.length) continue;
      const counts = STATUSES.map((s) => {
        const n = inT.filter((t) => t.status === s).length;
        return n ? `${n} ${s.toLowerCase()}` : null;
      }).filter(Boolean).join(', ');
      console.log(`  ${track.padEnd(8)} ${counts}`);
    }
    break;
  }

  case 'next': {
    const d = read();
    const list = claimable(d, flag('track'), flag('agent'));
    if (!list.length) { console.log('workplan: nothing claimable — check `status` and the Blocked section'); break; }
    console.log(`${list.length} claimable task(s)${flag('track') ? ` in ${flag('track')}` : ''}:\n`);
    for (const t of list.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50) || a.effort - b.effort)) {
      console.log(`  ${t.id.padEnd(9)} ${t.effort}d  ${t.owner ? '[OWNER] ' : ''}${t.title}`);
    }
    console.log(`\nClaim one:  node scripts/workplan.mjs claim <id> --agent <name> --branch <branch>`);
    break;
  }

  case 'show': {
    const d = read();
    const t = d.tasks.find((x) => x.id === positional[0]);
    if (!t) die(`no such task: ${positional[0]}`);
    console.log(`${t.id}  [${t.track}]  ${t.status}${t.owner ? '  (OWNER-ONLY)' : ''}`);
    console.log(`\n  ${t.title}`);
    if (t.why) console.log(`\n  Why: ${t.why}`);
    console.log(`\n  Finish line: ${t.done_when}`);
    console.log(`  Effort: ${t.effort} d`);
    if (t.deps?.length) console.log(`  Depends on: ${t.deps.join(', ')}`);
    if (t.files?.length) console.log(`  Owns files: ${t.files.join(', ')}`);
    if (t.serialise_with) console.log(`  ⚠ Shared file territory with: ${t.serialise_with}`);
    if (t.prereqs?.length) console.log(`  Setup first: ${t.prereqs.join(', ')}`);
    if (t.verify?.length) { console.log('\n  Verify:'); for (const v of t.verify) console.log(`    $ ${v}`); }
    if (t.refs?.length) { console.log('\n  Evidence from the review:'); for (const r of t.refs) console.log(`    - ${r}`); }
    if (t.resume) console.log(`\n  Previous agent stopped at: ${t.resume}`);
    if (t.evidence) console.log(`\n  Done because: ${t.evidence}`);
    if (t.blocked_reason) console.log(`\n  Blocked: ${t.blocked_reason}`);
    break;
  }

  case 'claim': {
    const d = read();
    const t = d.tasks.find((x) => x.id === positional[0]);
    if (!t) die(`no such task: ${positional[0]}`);
    const agent = flag('agent'), branch = flag('branch');
    if (!agent || !branch) die('claim needs --agent and --branch');
    if (t.status !== 'TODO') die(`${t.id} is ${t.status}, not TODO`);
    if (!claimable(d, null, agent).some((c) => c.id === t.id)) {
      die(`${t.id} is not claimable yet — unmet deps, or its files are held by another agent`, 1);
    }
    t.status = 'WIP';
    t.claim = { agent, branch, at: flag('at') || new Date().toISOString().slice(0, 10) };
    write(d);
    writeFileSync(RENDERED, render(d));
    console.log(`workplan: ${t.id} claimed by ${agent} on ${branch}`);
    if (t.prereqs?.length) console.log(`  setup first: ${t.prereqs.join(', ')}`);
    if (t.verify?.length) console.log(`  prove it with: ${t.verify[0]}`);
    break;
  }

  case 'note': {
    const d = read();
    const t = d.tasks.find((x) => x.id === positional[0]);
    if (!t) die(`no such task: ${positional[0]}`);
    if (!positional[1]) die('note needs text: workplan.mjs note <id> "where I stopped"');
    t.resume = positional.slice(1).join(' ');
    write(d);
    writeFileSync(RENDERED, render(d));
    console.log(`workplan: noted on ${t.id}`);
    break;
  }

  case 'verify': {
    const d = read();
    const t = d.tasks.find((x) => x.id === positional[0]);
    if (!t) die(`no such task: ${positional[0]}`);
    const entries = t.verify || [];
    if (!entries.length) die(`${t.id} has no verify list — add one to the ledger before claiming it is done`, 2);

    const groups = entries.map(classify);
    const toRun = groups.filter((g) => g.kind === 'run');
    const toAttest = groups.filter((g) => g.kind !== 'run');
    console.log(`verify ${t.id} — ${toRun.length} to run, ${toAttest.length} needing a human\n`);

    const ran = [];
    for (const [i, g] of toRun.entries()) {
      process.stdout.write(`  [${i + 1}/${toRun.length}] ${g.text}\n`);
      const r = runEntry(g.text);
      ran.push({ command: g.text, ok: r.ok, ms: r.ms, status: r.status, signal: r.signal });
      if (r.ok) {
        console.log(`        PASS  ${secs(r.ms)}\n`);
      } else {
        const how = r.signal ? `killed by ${r.signal} after ${secs(r.ms)}` : `exit ${r.status} after ${secs(r.ms)}`;
        console.log(`        FAIL  ${how}`);
        const output = tail(r.err || r.out);
        if (output) console.log(output.split('\n').map((l) => `        │ ${l}`).join('\n'));
        console.log('');
      }
    }

    // Recorded on the task so `done` can tell a verified close from an asserted one, and so a
    // later reader can see WHEN it was verified — a record from before the last ten commits is a
    // weaker claim than a fresh one, and `done` says so rather than silently accepting it.
    const record = {
      at: new Date().toISOString(),
      head: (spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').trim() || null,
      ran,
      attested: toAttest.map((g) => ({ kind: g.kind, text: g.text })),
    };

    // Re-read before writing, and patch only this one task. Found by this command's own first run:
    // QUA-53's verify list contains `workplan verify LEG-16`, so the nested run wrote LEG-16's
    // record and the outer run then wrote the whole ledger from the copy it had read MINUTES
    // earlier — silently discarding it. Last-write-wins on a whole-file JSON ledger loses records
    // the same way whenever two agents verify different tasks at once, which is precisely the
    // situation `claim`'s file lock exists to make normal. A verification that vanishes is worse
    // than one that never ran: `done` then reports the task as never verified, and the next agent
    // re-runs a suite that already passed.
    const fresh = read();
    const target = fresh.tasks.find((x) => x.id === t.id);
    target.verification = record;
    write(fresh);

    const failed = ran.filter((r) => !r.ok);
    if (failed.length) {
      console.error(`verify: ${t.id} FAILED — ${failed.length} of ${ran.length} check(s) did not pass`);
      console.error('  the ledger records the failure; fix the work, not the record');
      process.exit(1);
    }
    if (toAttest.length) {
      console.log(`verify: ${t.id} — ${ran.length}/${ran.length} runnable check(s) PASS, but ${toAttest.length} still need a human:`);
      for (const g of toAttest) console.log(`  ${g.kind.toUpperCase()}  ${g.text}`);
      console.log('\n  These cannot be automated — a device, an Apple ID, a signed build, a pair of eyes.');
      console.log('  Close with:  workplan done ' + t.id + ' --evidence "..." --attest "who did what, and what they saw"');
      process.exit(3);
    }
    console.log(`verify: ${t.id} PASS — ${ran.length} check(s), all green`);
    break;
  }

  case 'done': {
    const d = read();
    const t = d.tasks.find((x) => x.id === positional[0]);
    if (!t) die(`no such task: ${positional[0]}`);
    const evidence = flag('evidence');
    if (!evidence) die('done needs --evidence "what proves it" — a command that passed, a URL, a commit');

    // The gate this whole file exists for. `--evidence` is free text and always was, so on its own
    // it cannot distinguish a command that ran from a sentence that sounds like one. If the task
    // has runnable checks, they must have actually run and passed.
    const groups = (t.verify || []).map(classify);
    const runnable = groups.filter((g) => g.kind === 'run');
    const attestable = groups.filter((g) => g.kind !== 'run');
    const v = t.verification;
    const force = rest.includes('--force');
    if (runnable.length && !force) {
      if (!v) {
        die(`${t.id} has ${runnable.length} runnable check(s) that have never been run.\n`
          + `  node scripts/workplan.mjs verify ${t.id}\n`
          + `  (--force overrides, and records that it was overridden)`, 1);
      }
      const failed = (v.ran || []).filter((r) => !r.ok);
      if (failed.length) die(`${t.id}'s last verification FAILED on: ${failed[0].command}`, 1);
      // Compare against the entries as they stand NOW: editing a verify entry after verifying it
      // is the cheapest possible way to launder an unverified claim through this gate.
      const verified = new Set((v.ran || []).map((r) => r.command));
      const missing = runnable.map((g) => g.text).filter((c) => !verified.has(c));
      if (missing.length) {
        die(`${t.id}'s verify list has changed since it was verified — never run:\n`
          + missing.map((c) => `    ${c}`).join('\n')
          + `\n  node scripts/workplan.mjs verify ${t.id}`, 1);
      }
    }
    // Attestations are the honest half: nothing here can check them, so the most a tool can do is
    // refuse to let them pass unmentioned. A named `--attest` is a person putting their account
    // behind an observation, which is a different kind of claim from a blank field.
    const attest = flag('attest');
    if (attestable.length && !attest && !force) {
      die(`${t.id} has ${attestable.length} check(s) only a human can make:\n`
        + attestable.map((g) => `    ${g.kind.toUpperCase()}  ${g.text}`).join('\n')
        + `\n  --attest "what you did and what you saw"  (or --force)`, 1);
    }
    if (attest) t.attestation = attest;
    if (force) t.verification = { ...(v || {}), forced_at: new Date().toISOString() };
    t.status = 'DONE';
    t.evidence = evidence;
    delete t.resume;
    write(d);
    writeFileSync(RENDERED, render(d));
    const unblocked = claimable(d).filter((c) => (c.deps || []).includes(t.id));
    console.log(`workplan: ${t.id} done`);
    if (unblocked.length) console.log(`  now claimable: ${unblocked.map((u) => u.id).join(', ')}`);
    break;
  }

  case 'block': {
    const d = read();
    const t = d.tasks.find((x) => x.id === positional[0]);
    if (!t) die(`no such task: ${positional[0]}`);
    const reason = flag('reason');
    if (!reason) die('block needs --reason');
    t.status = 'BLOCKED';
    t.blocked_reason = reason;
    write(d);
    writeFileSync(RENDERED, render(d));
    console.log(`workplan: ${t.id} blocked — ${reason}`);
    break;
  }

  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(cmd ? 2 : 0);
}
