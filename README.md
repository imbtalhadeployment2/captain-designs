# ⚓ CAPTAIN DESIGNS — Graphics Marketplace

A Fiverr-style marketplace **only for graphic design services**: logos, YouTube thumbnails,
Facebook page thumbnails, banners/posters, social media designs, business cards and more.

Buyers browse gigs, chat with sellers through a built-in **inbox**, place orders, and confirm
delivery. Sellers publish gigs with portfolio images, accept orders and upload finished designs.
**The platform keeps a 10% commission on every completed order** — tracked in a transactions
ledger visible on the admin dashboard.

**Theme:** deep navy blue + gold/amber on clean cream — nautical-premium look with a
captain's shield "C" emblem logo (pure inline SVG, no image files needed).

## Tech stack

- **Node.js + Express** — server-side rendered with **EJS** (no build step, no frontend framework)
- **SQLite** via Node's built-in `node:sqlite` (no native compilation needed)
- `bcryptjs` (password hashing) · `express-session` (login sessions) · `multer` (uploads, 5 MB limit, image-only filter for gigs)
- All SQL is parameterized — no SQL injection. All template output is escaped.

## Quick start

```bash
cd design-marketplace
npm install
npm run seed     # creates DB + demo users/gigs + generates placeholder artwork locally
npm start        # serves on http://localhost:3000
```

Environment variables (optional):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port (Railway sets this automatically) |
| `SESSION_SECRET` | dev default | Session cookie secret — **set a strong one in production** |
| `DB_PATH` | `./data/market.db` | SQLite file location (point at a Railway volume for persistence) |

## Demo accounts (created by `npm run seed`)

| Role | Email | Password |
|---|---|---|
| 👑 **Admin (Talha)** | `talha@riomarket.com` | `rioadmin123` |
| Seller | `ayesha.designs@gmail.com` | `seller123` |
| Seller | `bilal.thumbs@gmail.com` | `seller123` |
| Seller | `sana.creatives@gmail.com` | `seller123` |
| Seller | `usman.prints@gmail.com` | `seller123` |
| Buyer | `buyer@demo.com` | `buyer123` |

Seed data includes 8 gigs across all categories (each with 3 locally-generated SVG portfolio
samples), one completed order (with 5★ review + recorded commission), one in-progress order,
and a sample inbox conversation.

## Features

**Accounts** — signup/login with email + password (bcrypt-hashed, session-based).
Choose Buyer, Seller, or Both at signup.

**Seller side** (`/seller`)
- Dashboard: total/active/pending orders, lifetime earnings (90% share), active gigs
- Create gigs: title, category, description, price in PKR, delivery days, up to 3 portfolio images
- Edit gigs, add/remove images, pause/resume, delete (blocked while orders exist)
- Orders list; accept → upload deliverable (image/PDF/ZIP) → get paid

**Buyer side** (`/`, `/browse`, `/gig/:id`)
- Home: hero search, category chips with counts, featured gigs, how-it-works
- Browse/search by keyword + category; gig page with gallery, seller card, reviews
- "Order Now" (one click) and "Message Seller" (opens inbox thread)
- Orders page: track status, download delivered file, mark payment sent
  (JazzCash/Easypaisa/bank — manual demo flow), confirm completion, request revisions, leave reviews

**Inbox engine** (`/inbox`) — message any seller from a gig page; conversation list with
unread badges; threaded chat with timestamps; read receipts on open.

**Order lifecycle** — `pending` → (accept) `in_progress` → (upload) `delivered` →
(buyer confirms) `completed`, or buyer requests a revision → back to `in_progress`.
Cancel anytime before completion. Every transition is logged in an order timeline.

**Commission** — on completion the platform takes **10%** (`commission_pkr`), seller gets 90%
(`seller_amount_pkr`), recorded in the `transactions` table.

**Admin dashboard** (`/admin`, admin login only) — total GMV, total commission earned,
seller payouts, order/user/gig counts, commission ledger per order, and full tables of
all orders, users and gigs.

## Project structure

```
design-marketplace/
├── server.js            # all routes (public, auth, seller, orders, inbox, admin)
├── db.js                # SQLite schema (node:sqlite)
├── scripts/seed.js      # demo data + local SVG artwork generator
├── views/               # EJS templates (partials/, pages)
├── public/css/style.css # navy + gold theme, fully responsive
├── public/js/main.js
├── uploads/             # gig images & deliverables (git-ignored)
├── data/                # market.db lives here (git-ignored)
├── Procfile             # web: node server.js
└── package.json
```

## Deploy to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**.
3. Add a **Volume** mounted at `/app/uploads` (keeps gig images & deliverables across deploys),
   and set `DB_PATH=/app/uploads/market.db` so the database persists on the volume too.
   (Or add Railway's Postgres later — the schema ports easily.)
4. Set variables: `SESSION_SECRET` (long random string), `NODE_ENV=production`.
5. Railway sets `PORT` automatically — the app already reads it. No build step needed.
6. After first deploy, run the seed once: `railway run npm run seed`
   (or add a one-off: connect via Railway shell and run `npm run seed`).

Then open the Railway URL and log in as `talha@riomarket.com` / `rioadmin123`.

> ⚠️ Change the admin password after first login, and use a strong `SESSION_SECRET`.
> Uploaded files and the SQLite DB live on the Railway volume — back it up periodically.
