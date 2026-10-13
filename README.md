# ⚓ CAPTAIN DESIGNS — Graphics Marketplace

A Fiverr-style marketplace **only for graphic design services**: logos, YouTube thumbnails,
Facebook page thumbnails, banners/posters, social media designs, business cards and more.

Buyers browse gigs, chat with sellers through a built-in **inbox** (with file attachments),
place orders, pay via JazzCash, and confirm delivery. Sellers publish gigs with portfolio images,
accept orders and upload finished designs.
**The platform keeps a 10% commission on every completed order** — tracked in a transactions
ledger visible on the admin dashboard, collectable on the platform JazzCash number
`03032279864`.

**Theme:** deep navy blue + gold/amber on clean cream — nautical-premium look with a
captain's shield "C" emblem logo (pure inline SVG, no image files needed).

## Tech stack

- **Node.js + Express** — server-side rendered with **EJS** (no build step, no frontend framework)
- **SQLite** via Node's built-in `node:sqlite` (no native compilation needed)
- `bcryptjs` (password hashing) · `express-session` (login sessions) · `multer` (uploads:
  gig images 5 MB, deliverables 5 MB, inbox attachments 10 MB)
- All SQL is parameterized — no SQL injection. All template output is escaped.

## Quick start

```bash
cd design-marketplace
npm install
npm run seed     # creates the admin account (idempotent)
npm start        # serves on http://localhost:3000
```

> The app also auto-seeds the admin account on first boot when the database is empty,
> so a fresh Railway deploy works with no manual steps.

Environment variables (optional):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port (Railway sets this automatically) |
| `SESSION_SECRET` | dev default | Session cookie secret — **set a strong one in production** |
| `DB_PATH` | `./data/market.db` | SQLite file location (point at a Railway volume for persistence) |

## Accounts

| Role | Email | Password |
|---|---|---|
| 👑 **Admin (Talha)** | `talha@riomarket.com` | `rioadmin123` |

The marketplace starts **completely clean** — no demo users, gigs, orders or messages.
Real sellers sign up and publish gigs; only then does the marketplace have listings.

## Features

**Accounts** — signup/login with email + password (bcrypt-hashed, session-based).
Choose Buyer, Seller, or Both at signup. `/settings` page: edit name, bio,
JazzCash/Easypaisa payment number, and change password. Logged-in users visiting
`/login` or `/signup` are redirected home.

**Seller side** (`/seller`)
- Dashboard: total/active/pending orders, lifetime earnings (90% share), active gigs
- Create gigs: title, category, description, price in PKR, delivery days —
  **at least one portfolio image is required** (up to 3, enforced client- and server-side)
- Edit gigs, add/remove images (can't drop below one), pause/resume, delete (blocked while orders exist)
- Orders list; accept → upload deliverable (image/PDF/ZIP) → get paid

**Buyer side** (`/`, `/browse`, `/gig/:id`)
- Home: hero search, category chips with counts, featured gigs, how-it-works
- Browse/search by keyword + category; gig page with gallery, seller card, reviews
- "Order Now" (one click) and "Message Seller" (opens inbox thread)
- Orders page: track status, download delivered file, pay via **JazzCash** —
  the order page shows the seller's JazzCash number and the 10% platform fee payable to
  `03032279864` (Captain Designs); buyer enters the JazzCash transaction ID (TID) and
  clicks "Mark as Paid", seller confirms receipt — confirm completion, request revisions,
  leave reviews

**Inbox engine** (`/inbox`) — message any seller from a gig page; conversation list with
unread badges; threaded chat with timestamps; read receipts on open.
**File attachments**: either side can attach an image, PDF or ZIP (max 10 MB) to any message;
attachments show filename + size with a download button, and downloads are restricted to the
two conversation participants (direct URLs are blocked for everyone else).

**Order lifecycle** — `pending` → (accept) `in_progress` → (upload) `delivered` →
(buyer confirms) `completed`, or buyer requests a revision → back to `in_progress`.
Cancel anytime before completion. Every transition is logged in an order timeline.

**Commission** — on completion the platform takes **10%** (`commission_pkr`), seller gets 90%
(`seller_amount_pkr`), recorded in the `transactions` table.

**Admin dashboard** (`/admin`, admin login only) — commission collection card (total
commission receivable + platform JazzCash `03032279864`), total GMV, seller payouts,
order/user/gig counts, commission ledger per order, and full tables of
all orders, users and gigs.

## Project structure

```
design-marketplace/
├── server.js            # all routes (public, auth, seller, orders, inbox, admin)
├── db.js                # SQLite schema (node:sqlite)
├── scripts/seed.js      # creates the admin account only (marketplace starts clean)
├── views/               # EJS templates (partials/, pages incl. settings.ejs)
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
6. On first boot the app auto-creates the admin account (`talha@riomarket.com` /
   `rioadmin123`) when the database is empty — no manual seeding needed.

Then open the Railway URL and log in as `talha@riomarket.com` / `rioadmin123`.

> ⚠️ Change the admin password after first login, and use a strong `SESSION_SECRET`.
> Uploaded files and the SQLite DB live on the Railway volume — back it up periodically.
