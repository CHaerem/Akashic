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
//   node scripts/workplan.mjs done <id> --evidence "what proves it"
//   node scripts/workplan.mjs block <id> --reason "why"
//
// Exit codes: 0 ok, 1 validation or sync failure, 2 usage error.

import { readFileSync, writeFileSync } from 'node:fs';
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
  L.push(`> Measured so far: **${doneAgent.length} agent tasks estimated at ${sum(doneAgent)} dev-days**,`);
  L.push('> closed in roughly one working afternoon across up to three parallel tracks.');
  L.push('>');
  L.push(`> But that compression is **unmeasured for the large items**: of the tasks closed so far,`);
  L.push(`> ${big(doneAgent).length} were 2 dev-days or more. ${sum(big(agentOpen))} of the`);
  L.push(`> ${sum(agentOpen)} remaining dev-days sit in ${big(agentOpen).length} such tasks —`);
  L.push('> localisation, Swift 6 strict concurrency, a UI test target, the PDF book. Those involve');
  L.push('> design judgement and broad-blast-radius refactors rather than localised edits, so do not');
  L.push('> assume the same ratio holds. The cheap band is nearly exhausted:');
  L.push(`> ${agentOpen.filter((t) => t.effort <= 0.5).length} tasks at 0.5 dev-days or less remain.`);
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
      L.push(`| \`${t.id}\` ${t.title} | ${t.claim.agent} | \`${t.claim.branch}\` | ${t.resume || '—'} |`);
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
    if (render(d) !== readFileSync(RENDERED, 'utf8')) {
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

  case 'done': {
    const d = read();
    const t = d.tasks.find((x) => x.id === positional[0]);
    if (!t) die(`no such task: ${positional[0]}`);
    const evidence = flag('evidence');
    if (!evidence) die('done needs --evidence "what proves it" — a command that passed, a URL, a commit');
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
