# 🌟 Earn & Enjoy: Summer Challenge

A family task and reward tracking PWA for kids. Built with vanilla HTML/CSS/JS — no frameworks, no dependencies.

## Features

- **PIN-protected** family access
- **Per-kid profiles** (Noor & Shaan)
- **5 task categories:** Daily Core Habits, Daily Knowledge, Creative, By Parent Request, Islam (Salah)
- **Tiered reward system:** Daily rewards (iPad time, Skip Pass) and weekly rewards (Movie, Escape Room, etc.)
- **Points ledger** — full history of every task completed and reward redeemed
- **Parent View** — stats and activity log for each child
- **Offline-capable PWA** — installable on iPhone home screen
- **Confetti** on task completion 🎉

## Default PIN

`1234` — change this in `index.html` under `DEFAULT_CONFIG.pin`

## Tech Stack

- Vanilla HTML / CSS / JavaScript (single file)
- Service Worker for offline caching
- `localStorage` for data persistence (Cloudflare Worker + KV integration coming next)

## Roadmap

- [ ] Cloudflare Worker + KV backend for cross-device sync
- [ ] Parent PIN (separate from family PIN)
- [ ] Task approval flow (parent must approve before points are awarded)
- [ ] Weekly summary view
- [ ] Push notifications ("Don't forget your tasks!")
- [ ] Capacitor wrapper for App Store submission
- [ ] Supabase backend + multi-family support
- [ ] RevenueCat for in-app subscriptions

## Deployment

This app is hosted on GitHub Pages at:
`https://zgauba.github.io/EarnAndEnjoy/`

To deploy updates, push to the `main` branch and GitHub Pages will auto-deploy.
