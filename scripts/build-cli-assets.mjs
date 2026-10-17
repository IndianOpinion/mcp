// Build the CLI files the Worker serves under /agents/cli/ and /agents/skill/
// from a checkout of https://github.com/IndianOpinion/cli (IO_CLI_DIR, default ../cli): npm pack (deterministic: npm fixes file times), latest.tgz
// (same bytes), latest.json, SHA256SUMS, io.sh and SKILL.md.
//   node scripts/build-cli-assets.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(process.env.IO_CLI_DIR || path.join(HERE, '..', '..', 'cli'));
const OUT = path.resolve(HERE, '..', 'public', 'agents', 'cli');
const SKILL = path.resolve(HERE, '..', 'public', 'agents', 'skill');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SKILL, { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(CLI, 'package.json'), 'utf8'));
const src = fs.readFileSync(path.join(CLI, 'bin', 'indianopinion.mjs'), 'utf8');
if (!src.includes(`const VERSION = '${pkg.version}'`)) throw new Error('VERSION in bin/indianopinion.mjs does not match package.json');
if (!fs.readFileSync(path.join(CLI, 'io.sh'), 'utf8').includes(`IO_SH_VERSION=${pkg.version}`)) throw new Error('IO_SH_VERSION in io.sh does not match package.json');

const name = execFileSync('npm', ['pack', '--pack-destination', OUT, '--silent'], { cwd: CLI, encoding: 'utf8' }).trim().split('\n').pop();
const tgz = path.join(OUT, name);
fs.copyFileSync(tgz, path.join(OUT, 'latest.tgz'));
fs.copyFileSync(path.join(CLI, 'io.sh'), path.join(OUT, 'io.sh'));
fs.copyFileSync(path.join(CLI, 'skill', 'SKILL.md'), path.join(OUT, 'SKILL.md'));
fs.copyFileSync(path.join(CLI, 'skill', 'SKILL.md'), path.join(SKILL, 'SKILL.md'));

const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = fs.readdirSync(OUT).filter((f) => /\.(tgz|sh|md)$/.test(f)).sort();
fs.writeFileSync(path.join(OUT, 'SHA256SUMS'), files.map((f) => `${sha(path.join(OUT, f))}  ${f}`).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify({
  version: pkg.version,
  url: `https://indianopinion.org/agents/cli/${name}`,
  latest: 'https://indianopinion.org/agents/cli/latest.tgz',
  sha256: sha(tgz),
  io_sh: 'https://indianopinion.org/agents/cli/io.sh',
  io_sh_sha256: sha(path.join(OUT, 'io.sh')),
  node: pkg.engines.node,
}, null, 2) + '\n');
console.log(`built ${name} sha256 ${sha(tgz)}`);
