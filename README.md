# 🌟 Thrivepoint

A family task and reward tracking PWA for kids. Earn points, build habits, unlock rewards. Built with vanilla HTML/CSS/JS — no frameworks, no dependencies.

## Features

Thrivepoint is a PIN-protected, per-kid family app with five task categories (Daily Core Habits, Daily Knowledge, Creative, By Parent Request, and Islam/Salah), a tiered reward system with daily and weekly rewards, a full points ledger, a Parent View with per-kid stats, confetti animations on task completion, and offline PWA support installable on iPhone.

## Default PIN

`1234` — change this in `index.html` under `DEFAULT_CONFIG.pin`

## Tech Stack

Vanilla HTML / CSS / JavaScript (single file), Service Worker for offline caching, and `localStorage` for data persistence. Cloudflare Worker + KV backend integration is coming next for cross-device sync.

## Roadmap

- [ ] Cloudflare Worker + KV backend for cross-device sync
- [ ] Parent PIN (separate from family PIN)
- [ ] Task approval flow (parent must approve before points are awarded)
- [ ] Weekly summary view
- [ ] Push notifications
- [ ] Capacitor wrapper for App Store submission
- [ ] Supabase backend + multi-family support
- [ ] RevenueCat for in-app subscriptions

## Deployment

Hosted on GitHub Pages at `https://zgauba.github.io/Thrivepoint/`
