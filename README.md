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

Profitability values the Pearl Fortune PPS estimates for the last hour and 24 hours at the latest CoinGecko quote, converted into RON using the daily Frankfurter rate. The 7- and 30-day rows project the last 24 hours. Electricity uses the current NVIDIA GPU power readings across configured rigs, plus a 15% allowance for other system components and power supply losses, at 1.10 RON/kWh. A missing rig or GPU power reading leaves electricity cost and profit unavailable. Historical electricity bills and other expenses are outside this estimate.

### Financial ledger

The optional Finance page mounts GPU Control Center’s financial editor and works against its existing SQLite ledger, preserving transaction allocations, audit and reconciliation. Build the page with `finance/build.sh /path/to/gpu-control-center /path/to/app/public/finance` using the GPU Control Center frontend dependencies. Run `finance/backend.py` as a separate loopback service with GPU Control Center and its Python dependencies on `PYTHONPATH`. Configure `PEARL_FINANCE_DATABASE` in the backend and matching `PEARL_FINANCE_PORT` and `PEARL_FINANCE_TOKEN` in both services. Set `PEARL_FINANCE_ORIGIN` in Pearl Monitor to the private browser origin. Keep the database and credentials outside the public document root.

Set the optional `financialRigId` on each monitored rig to link it to the ledger independently of name changes. Pearl’s daily effective production is allocated by the observed local hashrate if all mining rigs report it, or by the number of GPUs observed running the miner otherwise. The recovery estimate uses remaining ledger capital divided by estimated positive net daily Pearl income at the current price and measured GPU power.
