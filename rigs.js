import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const gpuFields = 'index,uuid,name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,power.limit,fan.speed,pcie.link.gen.current,pcie.link.width.current';
const probe = `LC_ALL=C nvidia-smi --query-gpu=${gpuFields} --format=csv,noheader,nounits || exit 1
printf '\\n--compute--\\n'
if LC_ALL=C nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name --format=csv,noheader,nounits; then
  printf '\\n--compute-ok--\\n'
fi
if pids=$(docker top pearl-miner -eo pid 2>/dev/null); then
  printf '\\n--container--\\n%s\\n' "$pids"
else
  printf '\\n--container--\\n'
fi
printf '\\n--hashrate--\\n'
(docker logs --since 90s --tail 300 pearl-miner 2>&1 ||
  sudo -n /usr/bin/docker logs --since 90s --tail 300 pearl-miner 2>&1) |
  grep ' event=large.progress ' | tail -n 1`;

const number = text => text && /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
const rows = text => text.trim().split(/\r?\n/).filter(Boolean).map(line => line.split(',').map(value => value.trim()));

function parseProbe(stdout) {
  const [inventory, rest = ''] = stdout.split('--compute--');
  const [processes, miner = ''] = rest.split('--container--');
  const [container, progress = ''] = miner.split('--hashrate--');
  const computeAvailable = processes.includes('--compute-ok--');
  const containerPids = new Set(container.trim().split(/\s+/).filter(pid => /^\d+$/.test(pid)));
  const computeRows = rows(processes.split('--compute-ok--')[0]);
  const gpus = rows(inventory).map(([index, uuid, name, temp, load, used, total, power, limit, fan, gen, lanes]) => {
    const gpuProcesses = computeRows.filter(([gpu]) => gpu === uuid);
    const confirmed = gpuProcesses.some(([, pid]) => containerPids.has(pid));
    const detected = gpuProcesses.some(([, , command]) => /^miner-cuda(?:\d+(?:\.\d+)*)?$/.test(command?.split('/').at(-1) ?? ''));
    const mining = confirmed ? 'container' : detected ? 'process' : computeAvailable ? 'not-detected' : 'unknown';
    return {
      index: number(index), name, temperatureC: number(temp), utilizationPct: number(load),
      memoryUsedMiB: number(used), memoryTotalMiB: number(total), powerW: number(power),
      powerLimitW: number(limit), fanPct: number(fan), pcieGeneration: number(gen),
      pcieLanes: number(lanes), mining,
    };
  }).filter(gpu => gpu.index !== null && gpu.name);
  const match = progress.match(/\bproof_per_sec="(\d+(?:\.\d+)?)\s*([kMGTPE]?)\/s"/);
  const multiplier = { '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };
  const minerHashrateHs = match && gpus.some(gpu => gpu.mining === 'container' || gpu.mining === 'process')
    ? Number(match[1]) * multiplier[match[2]]
    : null;
  return { gpus, minerHashrateHs };
}

async function readRig(rig, identityFile, previous) {
  try {
    const target = rig.ssh;
    const args = target
      ? ['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
         '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=4', '-o', 'ServerAliveCountMax=1',
         '-i', identityFile, '--', target, probe]
      : ['-c', probe];
    const { stdout } = await exec(target ? '/usr/bin/ssh' : '/bin/sh', args, {
      timeout: 12_000, maxBuffer: 128 * 1024,
    });
    const { gpus, minerHashrateHs } = parseProbe(stdout);
    if (!gpus.length) throw new Error('No GPU data');
    return { name: rig.name, financialRigId: rig.financialRigId, state: 'online', sampledAt: new Date().toISOString(), gpus, minerHashrateHs };
  } catch {
    return previous?.sampledAt
      ? { ...previous, state: 'stale' }
      : { name: rig.name, financialRigId: rig.financialRigId, state: 'unavailable', sampledAt: null, gpus: [] };
  }
}

const configFile = process.env.PEARL_RIGS_CONFIG;
let current = { enabled: Boolean(configFile), rigs: [] };
let nextSample = 0;
let sampling;

async function sample() {
  const { identityFile, rigs } = JSON.parse(await readFile(configFile, 'utf8'));
  if (!Array.isArray(rigs) || rigs.length > 32 || new Set(rigs.map(rig => rig.name)).size !== rigs.length ||
      rigs.some(rig => typeof rig.name !== 'string' || !rig.name.trim() ||
        (rig.ssh !== undefined && (!/^[a-zA-Z0-9_][\w.-]*@[a-zA-Z0-9][\w.-]*$/.test(rig.ssh) ||
          typeof identityFile !== 'string' || !identityFile.startsWith('/'))))) {
    throw new Error('Invalid rig configuration');
  }
  const previous = new Map(current.rigs.map(rig => [rig.name, rig]));
  current = { enabled: true, rigs: await Promise.all(rigs.map(rig => readRig(rig, identityFile, previous.get(rig.name)))) };
}

export async function fleetStatus() {
  if (!configFile || Date.now() < nextSample) return current;
  sampling ??= sample().catch(() => {
    current = { enabled: true, error: 'Configurația rigurilor este indisponibilă sau invalidă.',
      rigs: current.rigs.map(rig => ({ ...rig, state: rig.sampledAt ? 'stale' : 'unavailable' })) };
  }).finally(() => {
    nextSample = Date.now() + 25_000;
    sampling = undefined;
  });
  await sampling;
  return current;
}
