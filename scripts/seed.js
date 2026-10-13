// scripts/seed.js — seeds admin, demo sellers/buyers, gigs, orders, messages.
// Generates all placeholder artwork locally as SVG files (no web downloads).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');

const UPLOADS = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const PALETTES = [
  ['#E63946', '#7a1019'], ['#1D3557', '#457B9D'], ['#2A9D8F', '#114b46'],
  ['#E9C46A', '#9a6b12'], ['#6D28D9', '#2e1065'], ['#0EA5E9', '#0c4a6e'],
  ['#F43F5E', '#7f1d2e'], ['#10B981', '#064e3b'], ['#F97316', '#7c2d12'],
  ['#8B5CF6', '#312e81'], ['#EC4899', '#831843'], ['#14B8A6', '#134e4a'],
];

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makeArt(filename, title, subtitle, i) {
  const [c1, c2] = PALETTES[i % PALETTES.length];
  const t = escXml(title.length > 26 ? title.slice(0, 26) + '…' : title);
  const st = escXml(subtitle);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="800" height="500" fill="url(#g)"/>
<circle cx="700" cy="80" r="140" fill="#ffffff" opacity="0.08"/>
<circle cx="90" cy="430" r="110" fill="#ffffff" opacity="0.08"/>
<rect x="60" y="60" width="120" height="120" rx="24" fill="#ffffff" opacity="0.15"/>
<text x="90" y="140" font-family="Arial,sans-serif" font-size="64" font-weight="bold" fill="#ffffff">R</text>
<text x="60" y="300" font-family="Arial,sans-serif" font-size="44" font-weight="bold" fill="#ffffff">${t}</text>
<text x="60" y="350" font-family="Arial,sans-serif" font-size="26" fill="#ffffff" opacity="0.85">${st}</text>
<text x="60" y="450" font-family="Arial,sans-serif" font-size="22" fill="#ffffff" opacity="0.7">CAPTAIN DESIGNS • Portfolio Sample</text>
</svg>`;
  fs.writeFileSync(path.join(UPLOADS, filename), svg);
  return filename;
}

function reset() {
  for (const t of ['transactions', 'reviews', 'messages', 'conversations', 'order_events', 'orders', 'gig_images', 'gigs', 'users']) {
    db.exec(`DELETE FROM ${t};`);
  }
  try { db.exec(`DELETE FROM sqlite_sequence;`); } catch (e) {}
}

function main() {
  reset();
  const hash = (pw) => bcrypt.hashSync(pw, 10);
  const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role, bio, is_admin) VALUES (?, ?, ?, ?, ?, ?)');
  const addGig = db.prepare('INSERT INTO gigs (seller_id, title, category, description, price_pkr, delivery_days) VALUES (?, ?, ?, ?, ?, ?)');
  const addImg = db.prepare('INSERT INTO gig_images (gig_id, filename) VALUES (?, ?)');

  // Admin (Talha)
  addUser.run('Talha (Admin)', 'talha@riomarket.com', hash('rioadmin123'), 'both', 'Platform owner — CAPTAIN DESIGNS.', 1);

  // Demo sellers
  const sellers = [
    ['Ayesha Khan', 'ayesha.designs@gmail.com', 'Modern logo & brand identity designer from Lahore. 3+ years experience.'],
    ['Bilal Ahmed', 'bilal.thumbs@gmail.com', 'Thumbnail specialist — high CTR YouTube & Facebook designs.'],
    ['Sana Malik', 'sana.creatives@gmail.com', 'Social media designer. Posters, banners, complete page branding.'],
    ['Usman Tariq', 'usman.prints@gmail.com', 'Print & business design — cards, flyers, letterheads.'],
  ];
  const sellerIds = sellers.map(([n, e, b]) => addUser.run(n, e, hash('seller123'), 'seller', b, 0).lastInsertRowid);

  // Demo buyer
  const buyerId = addUser.run('Demo Buyer', 'buyer@demo.com', hash('buyer123'), 'buyer', 'I buy design services.', 0).lastInsertRowid;

  const gigs = [
    [0, 'I will design a premium minimal logo for your brand', 'Logo Design',
     'Get a clean, memorable, memorable logo with 3 initial concepts, 2 revisions, source files (AI/EPS/PNG) and a brand color guide. Perfect for startups, shops and YouTubers.', 2500, 3],
    [0, 'I will create a complete brand identity kit', 'Logo Design',
     'Logo + business card + letterhead + social profile kit, all in matching style. Delivered in print-ready formats.', 6000, 5],
    [1, 'I will design a viral YouTube thumbnail that gets clicks', 'YouTube Thumbnail',
     'Bold, high-contrast thumbnails with expressive text and pro composition. 2 concepts included, 24-hour express option.', 1200, 2],
    [1, 'I will design your Facebook page cover + profile thumbnail set', 'Facebook Page Thumbnail',
     'Complete Facebook branding: cover photo, profile picture and 5 post templates sized perfectly for your page.', 2000, 3],
    [2, 'I will design stunning social media posts (pack of 10)', 'Social Media Design',
     '10 scroll-stopping posts for Instagram/Facebook in your brand colors. Includes captions suggestions and story sizes.', 3000, 4],
    [2, 'I will design an event banner / poster that stands out', 'Banner / Poster',
     'Eye-catching banners for sales, events, admissions or promotions — print and digital sizes included.', 1800, 2],
    [3, 'I will design a luxury business card (front + back)', 'Business Card',
     'Premium double-sided business card design with print-ready CMYK files and free mockup preview.', 1000, 2],
    [3, 'I will design a professional company profile / flyer', 'Other',
     'A4 flyers, brochures and company profiles with clean layout and sharp typography.', 2200, 4],
  ];

  let artIdx = 0;
  const gigIds = [];
  for (const [si, title, cat, desc, price, days] of gigs) {
    const gid = addGig.run(sellerIds[si], title, cat, desc, price, days).lastInsertRowid;
    gigIds.push(gid);
    for (let k = 0; k < 3; k++) {
      const fn = `art-${gid}-${k}.svg`;
      makeArt(fn, title, `${cat} • Sample ${k + 1}`, artIdx++);
      addImg.run(gid, fn);
    }
  }

  // Demo: one completed order (shows commission in admin), one in-progress order, some messages + a review
  const mkOrder = db.prepare(`INSERT INTO orders
    (gig_id, buyer_id, seller_id, title_snapshot, price_pkr, commission_pkr, seller_amount_pkr, status, payment_method, payment_status, deliverable_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const mkEvent = db.prepare('INSERT INTO order_events (order_id, event, note) VALUES (?, ?, ?)');
  const g0 = db.prepare('SELECT * FROM gigs WHERE id = ?').get(gigIds[0]);
  const g2 = db.prepare('SELECT * FROM gigs WHERE id = ?').get(gigIds[2]);

  // Completed order -> commission recorded
  const price1 = g0.price_pkr, comm1 = Math.round(price1 * 0.10);
  const o1 = mkOrder.run(g0.id, buyerId, g0.seller_id, g0.title, price1, comm1, price1 - comm1,
    'completed', 'JazzCash', 'confirmed', makeArt('deliver-o1.svg', g0.title, 'Final delivery', artIdx++)).lastInsertRowid;
  mkEvent.run(o1, 'created', 'Buyer placed the order.');
  mkEvent.run(o1, 'accepted', 'Seller accepted the order.');
  mkEvent.run(o1, 'paid_marked', 'Buyer marked paid via JazzCash.');
  mkEvent.run(o1, 'paid_confirmed', 'Seller confirmed payment received.');
  mkEvent.run(o1, 'delivered', 'Seller uploaded the final design.');
  mkEvent.run(o1, 'completed', 'Buyer confirmed completion. Commission recorded.');
  db.prepare("INSERT INTO transactions (order_id, type, amount_pkr) VALUES (?, 'commission', ?)").run(o1, comm1);
  db.prepare('INSERT INTO reviews (order_id, gig_id, buyer_id, rating, comment) VALUES (?, ?, ?, ?, ?)')
    .run(o1, g0.id, buyerId, 5, 'Amazing logo! Fast delivery and very professional. Highly recommended.');

  // In-progress order
  const o2 = mkOrder.run(g2.id, buyerId, g2.seller_id, g2.title, g2.price_pkr, 0, 0,
    'in_progress', '', 'unpaid', '').lastInsertRowid;
  mkEvent.run(o2, 'created', 'Buyer placed the order.');
  mkEvent.run(o2, 'accepted', 'Seller accepted the order.');

  // Demo conversation
  const conv = db.prepare('INSERT INTO conversations (buyer_id, seller_id, gig_id) VALUES (?, ?, ?)')
    .run(buyerId, g2.seller_id, g2.id).lastInsertRowid;
  const msg = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, is_read) VALUES (?, ?, ?, ?)');
  msg.run(conv, buyerId, 'Assalam-o-Alaikum! I need the thumbnail in red/black theme, channel name "RIO Gaming".', 1);
  msg.run(conv, g2.seller_id, 'Walaikum Assalam! Noted — red/black theme with bold text. I will share the first draft tomorrow.', 0);
  db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(conv);

  console.log('Seeded: admin talha@riomarket.com / rioadmin123');
  console.log('Sellers: seller123 | Buyer: buyer@demo.com / buyer123');
  console.log(`Gigs: ${gigIds.length}, artwork files generated: ${artIdx}`);
}

module.exports = { main };
if (require.main === module) main();
