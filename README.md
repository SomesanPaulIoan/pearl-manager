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
