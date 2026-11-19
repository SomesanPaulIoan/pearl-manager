# pearl-manager
Centralized Pearl mining dashboard for GPU monitoring, hashrate optimization, wallet tracking, and profitability analytics.

## Pearl Monitor v11

This version tracks a public PRL wallet through PearlChain Live, PPS balances and personal hashrate through Pearl Fortune, and PRL pricing through CoinGecko. The dashboard includes 24-hour price and hashrate charts, a sales log, and CSV export.

### Run locally

Install Node.js 24 LTS, then start the application with your public PRL address.

```sh
PEARL_WALLET_ADDRESS='<your public PRL address>' npm start
```

Open http://127.0.0.1:3000/. The app uses built-in Node.js modules and has no packages to install. Set `PORT` to use a different port. For direct access within a Tailscale network, set `PEARL_MONITOR_HOST` to your machine’s Tailscale IP. The dashboard has no login and anyone who can reach it can edit the sales log.

Sales are saved in `data/sales.json`. Copy that file when migrating an existing deployment and keep a separate backup.

### GPU fleet monitoring

Set `PEARL_RIGS_CONFIG` to the absolute path of a local JSON configuration file to enable the rig dashboard.

```json
{
  "identityFile": "/home/operator/.ssh/rig_monitor",
  "rigs": [
    { "name": "Local rig" },
    { "name": "Remote rig", "ssh": "operator@rig-hostname" }
  ]
}
```

Remote hosts need NVIDIA CLI access and must already be in the service user’s SSH known hosts. The dashboard reads GPU sensors and compute processes. Where Docker read access is already available, it also checks for processes belonging to the `pearl-miner` container. Network or sensor failures are indicated in the dashboard. Keep real host configuration and SSH keys outside the repository.

When the service account can read recent `pearl-miner` container logs, the rig dashboard shows the miner-reported proof rate. The Pearl Fortune chart shows the pool’s effective rate at wallet level.

For a rig where the monitoring account lacks Docker socket access, an administrator can grant only the fixed log command with a sudoers entry installed using `visudo`. Replace `rigmonitor` with the SSH account on that rig.

```sudoers
rigmonitor ALL=(root) NOPASSWD: /usr/bin/docker logs --since 90s --tail 300 pearl-miner
```

Pearl Monitor tries that exact command with non-interactive sudo when direct log access fails.

### Mining economics

Profitability values Pearl Fortune production at the latest CoinGecko quote and Frankfurter USD/RON rate. Until an interval has complete hourly records, it projects the latest rolling hour for 24 hours, 7 days or 30 days, at current GPU power. Complete intervals use stored pool earnings and sampled GPU power from closed hours. Missing power samples leave historical cost and profit unavailable. The same 15% allowance and 1.10 RON/kWh tariff apply to both. Store `data/mining-history.json` with the existing application data to preserve coverage across restarts.

### Financial ledger

The optional Finance page mounts GPU Control Center’s financial editor and works against its existing SQLite ledger, preserving transaction allocations, audit and reconciliation. Build the page with `finance/build.sh /path/to/gpu-control-center /path/to/app/public/finance` using the GPU Control Center frontend dependencies. Run `finance/backend.py` as a separate loopback service with GPU Control Center and its Python dependencies on `PYTHONPATH`. Configure `PEARL_FINANCE_DATABASE` in the backend and matching `PEARL_FINANCE_PORT` and `PEARL_FINANCE_TOKEN` in both services. Set `PEARL_FINANCE_ORIGIN` in Pearl Monitor to the private browser origin. Keep the database and credentials outside the public document root.

Set the optional `financialRigId` on each monitored rig to link it to the ledger independently of name changes. Pearl’s daily effective production is allocated by the observed local hashrate when all mining rigs report it. Per-rig production stays unavailable if hashrate coverage is incomplete. The recovery estimate uses remaining ledger capital divided by estimated positive net daily Pearl income at the current price and measured GPU power.

### Operations and reporting

- The integrated deployment uses the SQLite register as the source for Pearl sales. Portofoliu creates or edits the dated revenues and optional commission entries together, with historical exchange rates, audit and reversible archiving. Run `ops/migrate-sales.py` once after taking a verified backup to reconcile a legacy JSON list against a matching USD aggregate. Migration preserves historical rig allocations. The standalone deployment can still use a local JSON sales list.
- Mining history records minute samples for GPU power, hashrate and activity per rig. Historical allocation uses the hashrate weights of each completed hour. Missing data stays unavailable. The calendar report separates dated Pearl and Vast receipts, paid bills, estimated sensor costs and the activity minutes observed. It marks ambiguous activity and excludes undated transactions from monthly receipt totals.
- The rig page shows incidents after three consecutive samples and recovery after two. Alerts cover telemetry, heat, detected miners and a drop against recent hashrate. No outbound notification is enabled.
- `ops/backup.py` takes a consistent SQLite snapshot and verifies the extracted database and file hashes. Run it via a persistent daily systemd timer. The optional `--remote`, `--identity` and `--passphrase` flags copy an encrypted, checksum-verified backup to a trusted SSH host. Keep a recovery key separately. Restore into a private staging directory and run `PRAGMA quick_check` before replacing anything.
- CI builds the finance page against GPU Control Manager commit `b86ddd991ba73d01a56e4be9a9b3cb8abdce788e` and runs the allocation, alerts and reconciliation tests. Use the same revision for reproducible builds.

### Daily Pearl earnings

The rewards chart groups Pearl Fortune PPS hourly rewards into UTC dates and shows actual observations and their cumulative sum. A scheduled 360-hour backfill recovers the window the public endpoint supports. The application retains verified hours locally and distinguishes partial observations, confirmed zeroes and unknown gaps. Historical chart backfill is separate from the current-run profitability coverage.
