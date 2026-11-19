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
