// server.js — CAPTAIN DESIGNS: Fiverr-style marketplace for graphics services.
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// Auto-seed on first boot (fresh Railway volume): creates admin + demo data once.
try {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row && row.c === 0) {
    console.log('Empty database — seeding CAPTAIN DESIGNS demo data...');
    require('./scripts/seed').main();
  }
} catch (e) {
  console.error('Auto-seed check failed:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// Inbox attachments live here; NEVER served statically — only via the secure download route.
const ATTACH_DIR = path.join(UPLOADS_DIR, 'attachments');
fs.mkdirSync(ATTACH_DIR, { recursive: true });

const CATEGORIES = [
  'Logo Design',
  'YouTube Thumbnail',
  'Facebook Page Thumbnail',
  'Banner / Poster',
  'Social Media Design',
  'Business Card',
  'Other',
];

const COMMISSION_RATE = 0.10;
// Platform JazzCash number — Talha's 10% commission goes here.
const PLATFORM_JAZZCASH = '03032279864';

// ---------- view setup ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploaded gig images / deliverables, but NEVER anything under attachments/
// (those go through the secure /attachments/:filename route with a membership check).
app.get('/uploads/:file', (req, res, next) => {
  const f = path.basename(String(req.params.file || ''));
  if (!f || f.startsWith('.')) return res.status(404).end();
  res.sendFile(path.join(UPLOADS_DIR, f), (err) => { if (err) next(); });
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'captain-designs-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true },
}));

// ---------- helpers ----------
const clean = (s, max = 500) => String(s == null ? '' : s).trim().slice(0, max);
const money = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-PK');
const fmtDate = (s) => String(s || '').slice(0, 16).replace('T', ' ');
const fmtSize = (b) => {
  b = Number(b || 0);
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
};
const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : (many || one + 's')}`;

function setFlash(req, type, msg) { req.session.flash = { type, msg }; }

function getUser(id) {
  return db.prepare('SELECT id, name, email, role, bio, payment_number, is_admin, created_at FROM users WHERE id = ?').get(id);
}
function unreadCount(userId) {
  const r = db.prepare(
    'SELECT COUNT(*) AS c FROM messages m JOIN conversations c ON c.id = m.conversation_id ' +
    'WHERE m.sender_id != ? AND m.is_read = 0 AND (c.buyer_id = ? OR c.seller_id = ?)'
  ).get(userId, userId, userId);
  return r ? r.c : 0;
}
function isSeller(u) { return u && (u.role === 'seller' || u.role === 'both' || u.is_admin); }

app.use((req, res, next) => {
  res.locals.user = req.session.userId ? getUser(req.session.userId) : null;
  if (res.locals.user && !req.session.userId) { req.session.destroy(() => {}); res.locals.user = null; }
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.unread = res.locals.user ? unreadCount(res.locals.user.id) : 0;
  res.locals.money = money;
  res.locals.fmtDate = fmtDate;
  res.locals.fmtSize = fmtSize;
  res.locals.plural = plural;
  res.locals.platformJazzcash = PLATFORM_JAZZCASH;
  res.locals.categories = CATEGORIES;
  res.locals.path = req.path;
  next();
});

function requireLogin(req, res, next) {
  if (!res.locals.user) { setFlash(req, 'error', 'Please log in first.'); return res.redirect('/login'); }
  next();
}
function requireSeller(req, res, next) {
  if (!isSeller(res.locals.user)) { setFlash(req, 'error', 'A seller account is required for that page.'); return res.redirect('/'); }
  next();
}
function requireAdmin(req, res, next) {
  if (!res.locals.user || !res.locals.user.is_admin) { setFlash(req, 'error', 'Admin access only.'); return res.redirect('/'); }
  next();
}

// ---------- uploads ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + '-' + safe);
  },
});
const imageOnly = (req, file, cb) =>
  file.mimetype && file.mimetype.startsWith('image/')
    ? cb(null, true)
    : cb(new Error('Only image files are allowed (JPG, PNG, SVG, WEBP).'));
const deliverableFilter = (req, file, cb) => {
  const ok = /^(image\/|application\/(pdf|zip|x-zip-compressed|x-rar-compressed))/.test(file.mimetype || '');
  ok ? cb(null, true) : cb(new Error('Deliverable must be an image, PDF or ZIP file.'));
};
const gigUpload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageOnly });
const deliverUpload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: deliverableFilter });

// Inbox attachments: images, PDF, ZIP — up to 10MB, stored under uploads/attachments/
const attachStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ATTACH_DIR),
  filename: (req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + '-' + safe);
  },
});
const attachFilter = (req, file, cb) => {
  const ok = /^(image\/|application\/(pdf|zip|x-zip-compressed|x-rar-compressed|x-7z-compressed))/.test(file.mimetype || '');
  ok ? cb(null, true) : cb(new Error('Attachment must be an image, PDF or ZIP file (max 10MB).'));
};
const attachUpload = multer({ storage: attachStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: attachFilter });

function multerErr(res, req, next) {
  return (err) => {
    if (err) { setFlash(req, 'error', err.message || 'Upload failed.'); return res.redirect('back'); }
    next();
  };
}

function addEvent(orderId, event, note) {
  db.prepare('INSERT INTO order_events (order_id, event, note) VALUES (?, ?, ?)').run(orderId, event, note || '');
  db.prepare("UPDATE orders SET updated_at = datetime('now') WHERE id = ?").run(orderId);
}

// ---------- public pages ----------
app.get('/', (req, res) => {
  const featured = db.prepare(
    `SELECT g.*, u.name AS seller_name,
       (SELECT filename FROM gig_images WHERE gig_id = g.id ORDER BY id LIMIT 1) AS cover,
       (SELECT COUNT(*) FROM reviews r WHERE r.gig_id = g.id) AS review_count,
       (SELECT ROUND(AVG(rating),1) FROM reviews r WHERE r.gig_id = g.id) AS avg_rating
     FROM gigs g JOIN users u ON u.id = g.seller_id
     WHERE g.status = 'active' ORDER BY g.created_at DESC LIMIT 8`
  ).all();
  const counts = db.prepare(
    "SELECT category, COUNT(*) AS c FROM gigs WHERE status='active' GROUP BY category"
  ).all();
  const stats = db.prepare(
    `SELECT (SELECT COUNT(*) FROM gigs WHERE status='active') AS gigs,
            (SELECT COUNT(*) FROM users WHERE role IN ('seller','both')) AS sellers,
            (SELECT COUNT(*) FROM orders WHERE status='completed') AS done`
  ).get();
  res.render('home', { featured, counts, stats });
});

app.get('/browse', (req, res) => {
  const q = clean(req.query.q, 100);
  const category = clean(req.query.category, 50);
  let sql = `SELECT g.*, u.name AS seller_name,
      (SELECT filename FROM gig_images WHERE gig_id = g.id ORDER BY id LIMIT 1) AS cover,
      (SELECT COUNT(*) FROM reviews r WHERE r.gig_id = g.id) AS review_count,
      (SELECT ROUND(AVG(rating),1) FROM reviews r WHERE r.gig_id = g.id) AS avg_rating
    FROM gigs g JOIN users u ON u.id = g.seller_id WHERE g.status = 'active'`;
  const params = [];
  if (category && CATEGORIES.includes(category)) { sql += ' AND g.category = ?'; params.push(category); }
  if (q) { sql += ' AND (g.title LIKE ? OR g.description LIKE ? OR g.category LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY g.created_at DESC';
  res.render('browse', { gigs: db.prepare(sql).all(...params), q, category });
});

app.get('/gig/:id', (req, res) => {
  const gig = db.prepare(
    `SELECT g.*, u.name AS seller_name, u.bio AS seller_bio, u.created_at AS seller_since
     FROM gigs g JOIN users u ON u.id = g.seller_id WHERE g.id = ?`
  ).get(req.params.id);
  if (!gig) return res.status(404).render('error', { code: 404, message: 'Gig not found.' });
  const images = db.prepare('SELECT * FROM gig_images WHERE gig_id = ? ORDER BY id').all(gig.id);
  const reviews = db.prepare(
    `SELECT r.*, u.name AS buyer_name FROM reviews r JOIN users u ON u.id = r.buyer_id
     WHERE r.gig_id = ? ORDER BY r.created_at DESC`
  ).all(gig.id);
  const rating = db.prepare('SELECT COUNT(*) AS n, ROUND(AVG(rating),1) AS avg FROM reviews WHERE gig_id = ?').get(gig.id);
  const me = res.locals.user;
  let conversationId = null;
  if (me && me.id !== gig.seller_id) {
    const c = db.prepare('SELECT id FROM conversations WHERE buyer_id = ? AND seller_id = ? AND gig_id = ?')
      .get(me.id, gig.seller_id, gig.id);
    if (c) conversationId = c.id;
  }
  res.render('gig', { gig, images, reviews, rating, conversationId });
});

// ---------- auth ----------
app.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect('/');
  res.render('login');
});
app.get('/signup', (req, res) => {
  if (res.locals.user) return res.redirect('/');
  res.render('signup');
});

app.post('/signup', (req, res) => {
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 120).toLowerCase();
  let role = clean(req.body.role, 10);
  if (!['buyer', 'seller', 'both'].includes(role)) role = 'buyer';
  const password = String(req.body.password || '');
  if (!name || !email || password.length < 6)
    { setFlash(req, 'error', 'Please fill all fields (password min 6 characters).'); return res.redirect('/signup'); }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    { setFlash(req, 'error', 'Please enter a valid email address.'); return res.redirect('/signup'); }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
    { setFlash(req, 'error', 'That email is already registered. Try logging in.'); return res.redirect('/signup'); }
  const id = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 10), role).lastInsertRowid;
  req.session.userId = id;
  setFlash(req, 'success', `Welcome to CAPTAIN DESIGNS, ${name}!`);
  res.redirect(role === 'buyer' ? '/' : '/seller');
});

app.post('/login', (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    setFlash(req, 'error', 'Invalid email or password.');
    return res.redirect('/login');
  }
  req.session.userId = u.id;
  setFlash(req, 'success', `Welcome back, ${u.name}!`);
  if (u.is_admin) return res.redirect('/admin');
  res.redirect(u.role === 'buyer' ? '/' : '/seller');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- settings ----------
app.get('/settings', requireLogin, (req, res) => {
  const profile = db.prepare('SELECT id, name, email, role, bio, payment_number, created_at FROM users WHERE id = ?')
    .get(res.locals.user.id);
  res.render('settings', { profile });
});

app.post('/settings', requireLogin, (req, res) => {
  const me = res.locals.user;
  const name = clean(req.body.name, 80);
  const bio = clean(req.body.bio, 500);
  const payment_number = clean(req.body.payment_number, 30).replace(/[^\d+\- ]/g, '');
  const newPw = String(req.body.new_password || '');
  if (!name) { setFlash(req, 'error', 'Name is required.'); return res.redirect('/settings'); }
  db.prepare('UPDATE users SET name = ?, bio = ?, payment_number = ? WHERE id = ?')
    .run(name, bio, payment_number, me.id);
  if (newPw) {
    if (newPw.length < 6) { setFlash(req, 'error', 'New password must be at least 6 characters.'); return res.redirect('/settings'); }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPw, 10), me.id);
  }
  setFlash(req, 'success', 'Settings saved.');
  res.redirect('/settings');
});

// ---------- seller ----------
app.get('/seller', requireLogin, requireSeller, (req, res) => {
  const me = res.locals.user;
  const stats = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM orders WHERE seller_id = ?) AS total_orders,
       (SELECT COUNT(*) FROM orders WHERE seller_id = ? AND status IN ('pending','in_progress')) AS active_orders,
       (SELECT COUNT(*) FROM orders WHERE seller_id = ? AND status = 'pending') AS pending_orders,
       (SELECT COALESCE(SUM(seller_amount_pkr),0) FROM orders WHERE seller_id = ? AND status = 'completed') AS earnings,
       (SELECT COUNT(*) FROM gigs WHERE seller_id = ? AND status = 'active') AS active_gigs`
  ).get(me.id, me.id, me.id, me.id, me.id);
  const gigs = db.prepare(
    `SELECT g.*, (SELECT filename FROM gig_images WHERE gig_id = g.id ORDER BY id LIMIT 1) AS cover,
       (SELECT COUNT(*) FROM orders WHERE gig_id = g.id AND status NOT IN ('cancelled')) AS order_count
     FROM gigs g WHERE g.seller_id = ? ORDER BY g.created_at DESC`
  ).all(me.id);
  const orders = db.prepare(
    `SELECT o.*, u.name AS buyer_name FROM orders o JOIN users u ON u.id = o.buyer_id
     WHERE o.seller_id = ? ORDER BY o.updated_at DESC LIMIT 10`
  ).all(me.id);
  res.render('seller_dashboard', { stats, gigs, orders });
});

app.get('/seller/orders', requireLogin, requireSeller, (req, res) => {
  const orders = db.prepare(
    `SELECT o.*, u.name AS buyer_name FROM orders o JOIN users u ON u.id = o.buyer_id
     WHERE o.seller_id = ? ORDER BY o.updated_at DESC`
  ).all(res.locals.user.id);
  res.render('seller_orders', { orders });
});

app.get('/seller/gigs/new', requireLogin, requireSeller, (req, res) =>
  res.render('gig_form', { gig: null, images: [] }));

app.post('/seller/gigs', requireLogin, requireSeller,
  (req, res, next) => gigUpload.array('images', 3)(req, res, multerErr(res, req, next)),
  (req, res) => {
    const me = res.locals.user;
    const title = clean(req.body.title, 120);
    const category = clean(req.body.category, 50);
    const description = clean(req.body.description, 3000);
    const price = Math.max(1, Math.min(10000000, parseInt(req.body.price_pkr, 10) || 0));
    const days = Math.max(1, Math.min(90, parseInt(req.body.delivery_days, 10) || 3));
    if (!title || !CATEGORIES.includes(category) || !price) {
      setFlash(req, 'error', 'Title, valid category and price are required.');
      return res.redirect('/seller/gigs/new');
    }
    if (!req.files || !req.files.length) {
      setFlash(req, 'error', 'Please upload at least one portfolio image — buyers need to see your work.');
      return res.redirect('/seller/gigs/new');
    }
    const gigId = db.prepare(
      'INSERT INTO gigs (seller_id, title, category, description, price_pkr, delivery_days) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(me.id, title, category, description, price, days).lastInsertRowid;
    const ins = db.prepare('INSERT INTO gig_images (gig_id, filename) VALUES (?, ?)');
    for (const f of (req.files || [])) ins.run(gigId, f.filename);
    setFlash(req, 'success', 'Gig published successfully!');
    res.redirect('/gig/' + gigId);
  });

app.get('/seller/gigs/:id/edit', requireLogin, requireSeller, (req, res) => {
  const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND seller_id = ?').get(req.params.id, res.locals.user.id);
  if (!gig) return res.status(404).render('error', { code: 404, message: 'Gig not found.' });
  const images = db.prepare('SELECT * FROM gig_images WHERE gig_id = ? ORDER BY id').all(gig.id);
  res.render('gig_form', { gig, images });
});

app.post('/seller/gigs/:id', requireLogin, requireSeller,
  (req, res, next) => gigUpload.array('images', 3)(req, res, multerErr(res, req, next)),
  (req, res) => {
    const me = res.locals.user;
    const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND seller_id = ?').get(req.params.id, me.id);
    if (!gig) return res.status(404).render('error', { code: 404, message: 'Gig not found.' });
    const title = clean(req.body.title, 120);
    const category = clean(req.body.category, 50);
    const description = clean(req.body.description, 3000);
    const price = Math.max(1, Math.min(10000000, parseInt(req.body.price_pkr, 10) || 0));
    const days = Math.max(1, Math.min(90, parseInt(req.body.delivery_days, 10) || 3));
    if (!title || !CATEGORIES.includes(category) || !price) {
      setFlash(req, 'error', 'Title, valid category and price are required.');
      return res.redirect('/seller/gigs/' + gig.id + '/edit');
    }
    db.prepare('UPDATE gigs SET title=?, category=?, description=?, price_pkr=?, delivery_days=? WHERE id=?')
      .run(title, category, description, price, days, gig.id);
    // optionally remove images
    const remove = [].concat(req.body.remove_image || []);
    const del = db.prepare('SELECT filename FROM gig_images WHERE id = ? AND gig_id = ?');
    for (const imgId of remove) {
      const row = del.get(imgId, gig.id);
      if (row) {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, row.filename)); } catch (e) {}
        db.prepare('DELETE FROM gig_images WHERE id = ?').run(imgId);
      }
    }
    const count = db.prepare('SELECT COUNT(*) AS c FROM gig_images WHERE gig_id = ?').get(gig.id).c;
    const newFiles = (req.files || []).slice(0, Math.max(0, 3 - count));
    if (count + newFiles.length < 1) {
      setFlash(req, 'error', 'A gig must keep at least one portfolio image.');
      return res.redirect('/seller/gigs/' + gig.id + '/edit');
    }
    const ins = db.prepare('INSERT INTO gig_images (gig_id, filename) VALUES (?, ?)');
    for (const f of newFiles) ins.run(gig.id, f.filename);
    setFlash(req, 'success', 'Gig updated.');
    res.redirect('/gig/' + gig.id);
  });

app.post('/seller/gigs/:id/toggle', requireLogin, requireSeller, (req, res) => {
  const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND seller_id = ?').get(req.params.id, res.locals.user.id);
  if (!gig) return res.status(404).render('error', { code: 404, message: 'Gig not found.' });
  const next = gig.status === 'active' ? 'paused' : 'active';
  db.prepare('UPDATE gigs SET status = ? WHERE id = ?').run(next, gig.id);
  setFlash(req, 'success', next === 'active' ? 'Gig resumed.' : 'Gig paused.');
  res.redirect('/seller');
});

app.post('/seller/gigs/:id/delete', requireLogin, requireSeller, (req, res) => {
  const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND seller_id = ?').get(req.params.id, res.locals.user.id);
  if (!gig) return res.status(404).render('error', { code: 404, message: 'Gig not found.' });
  const hasOrders = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE gig_id = ? AND status NOT IN ('cancelled')").get(gig.id).c;
  if (hasOrders) { setFlash(req, 'error', 'Cannot delete a gig that has orders. Pause it instead.'); return res.redirect('/seller'); }
  for (const img of db.prepare('SELECT filename FROM gig_images WHERE gig_id = ?').all(gig.id)) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, img.filename)); } catch (e) {}
  }
  db.prepare('DELETE FROM gigs WHERE id = ?').run(gig.id);
  setFlash(req, 'success', 'Gig deleted.');
  res.redirect('/seller');
});

// ---------- orders ----------
function getOrderFor(user, orderId) {
  const o = db.prepare(
    `SELECT o.*, b.name AS buyer_name, s.name AS seller_name
     FROM orders o JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
     WHERE o.id = ?`
  ).get(orderId);
  if (!o) return null;
  if (user.is_admin) return o;
  if (o.buyer_id !== user.id && o.seller_id !== user.id) return null;
  return o;
}

app.post('/gigs/:id/order', requireLogin, (req, res) => {
  const me = res.locals.user;
  const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND status = ?').get(req.params.id, 'active');
  if (!gig) { setFlash(req, 'error', 'This gig is not available.'); return res.redirect('back'); }
  if (gig.seller_id === me.id) { setFlash(req, 'error', 'You cannot order your own gig.'); return res.redirect('/gig/' + gig.id); }
  const orderId = db.prepare(
    `INSERT INTO orders (gig_id, buyer_id, seller_id, title_snapshot, price_pkr)
     VALUES (?, ?, ?, ?, ?)`
  ).run(gig.id, me.id, gig.seller_id, gig.title, gig.price_pkr).lastInsertRowid;
  addEvent(orderId, 'created', `${me.name} placed the order (${money(gig.price_pkr)}).`);
  setFlash(req, 'success', 'Order placed! The seller has been notified.');
  res.redirect('/orders/' + orderId);
});

app.get('/buyer/orders', requireLogin, (req, res) => {
  const orders = db.prepare(
    `SELECT o.*, u.name AS seller_name FROM orders o JOIN users u ON u.id = o.seller_id
     WHERE o.buyer_id = ? ORDER BY o.updated_at DESC`
  ).all(res.locals.user.id);
  res.render('buyer_orders', { orders });
});

app.get('/orders/:id', requireLogin, (req, res) => {
  const order = getOrderFor(res.locals.user, req.params.id);
  if (!order) return res.status(404).render('error', { code: 404, message: 'Order not found.' });
  const events = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at').all(order.id);
  const cover = db.prepare('SELECT filename FROM gig_images WHERE gig_id = ? ORDER BY id LIMIT 1').get(order.gig_id);
  const review = db.prepare('SELECT * FROM reviews WHERE order_id = ?').get(order.id);
  const seller = db.prepare('SELECT payment_number FROM users WHERE id = ?').get(order.seller_id);
  res.render('order', { order, events, cover: cover && cover.filename, review, sellerPayment: seller ? seller.payment_number : '' });
});

app.post('/orders/:id/accept', requireLogin, (req, res) => {
  const me = res.locals.user;
  const o = getOrderFor(me, req.params.id);
  if (!o || o.seller_id !== me.id || o.status !== 'pending') return res.redirect('back');
  db.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").run(o.id);
  addEvent(o.id, 'accepted', `${me.name} accepted the order and started working.`);
  setFlash(req, 'success', 'Order accepted — time to create something great!');
  res.redirect('/orders/' + o.id);
});

app.post('/orders/:id/deliver', requireLogin,
  (req, res, next) => deliverUpload.single('deliverable')(req, res, multerErr(res, req, next)),
  (req, res) => {
    const me = res.locals.user;
    const o = getOrderFor(me, req.params.id);
    if (!o || o.seller_id !== me.id || o.status !== 'in_progress' || !req.file) return res.redirect('back');
    if (o.deliverable_file) { try { fs.unlinkSync(path.join(UPLOADS_DIR, o.deliverable_file)); } catch (e) {} }
    db.prepare("UPDATE orders SET status = 'delivered', deliverable_file = ? WHERE id = ?").run(req.file.filename, o.id);
    addEvent(o.id, 'delivered', `${me.name} uploaded the finished design.`);
    setFlash(req, 'success', 'Design delivered! Waiting for buyer confirmation.');
    res.redirect('/orders/' + o.id);
  });

app.post('/orders/:id/complete', requireLogin, (req, res) => {
  const me = res.locals.user;
  const o = getOrderFor(me, req.params.id);
  if (!o || o.buyer_id !== me.id || o.status !== 'delivered') return res.redirect('back');
  const commission = Math.round(o.price_pkr * COMMISSION_RATE);
  const sellerAmount = o.price_pkr - commission;
  db.prepare("UPDATE orders SET status = 'completed', commission_pkr = ?, seller_amount_pkr = ? WHERE id = ?")
    .run(commission, sellerAmount, o.id);
  db.prepare("INSERT INTO transactions (order_id, type, amount_pkr) VALUES (?, 'commission', ?)")
    .run(o.id, commission);
  addEvent(o.id, 'completed', `Buyer confirmed completion. Platform commission ${money(commission)} (10%) recorded.`);
  setFlash(req, 'success', 'Order completed! Please leave a review for the seller.');
  res.redirect('/orders/' + o.id);
});

app.post('/orders/:id/revision', requireLogin, (req, res) => {
  const me = res.locals.user;
  const o = getOrderFor(me, req.params.id);
  if (!o || o.buyer_id !== me.id || o.status !== 'delivered') return res.redirect('back');
  const note = clean(req.body.note, 500) || 'Buyer requested a revision.';
  db.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").run(o.id);
  addEvent(o.id, 'revision_requested', note);
  setFlash(req, 'success', 'Revision requested — the seller will rework the design.');
  res.redirect('/orders/' + o.id);
});

app.post('/orders/:id/cancel', requireLogin, (req, res) => {
  const me = res.locals.user;
  const o = getOrderFor(me, req.params.id);
  if (!o) return res.redirect('back');
  const canBuyer = o.buyer_id === me.id && o.status === 'pending';
  const canSeller = o.seller_id === me.id && ['pending', 'in_progress'].includes(o.status);
  if (!canBuyer && !canSeller && !me.is_admin) return res.redirect('back');
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(o.id);
  addEvent(o.id, 'cancelled', `${me.name} cancelled the order.`);
  setFlash(req, 'success', 'Order cancelled.');
  res.redirect('/orders/' + o.id);
});

app.post('/orders/:id/pay', requireLogin, (req, res) => {
  const me = res.locals.user;
  const o = getOrderFor(me, req.params.id);
  if (!o || o.buyer_id !== me.id || !['in_progress', 'delivered'].includes(o.status)) return res.redirect('back');
  const tid = clean(req.body.tid, 60);
  if (!tid) { setFlash(req, 'error', 'Please enter the JazzCash transaction ID (TID) from your payment SMS/receipt.'); return res.redirect('/orders/' + o.id); }
  db.prepare("UPDATE orders SET payment_method = 'JazzCash', payment_tid = ?, payment_status = 'marked_paid' WHERE id = ?")
    .run(tid, o.id);
  addEvent(o.id, 'paid_marked', `Buyer marked payment as sent via JazzCash (TID: ${tid}).`);
  setFlash(req, 'success', 'Payment marked as sent. The seller will confirm receipt.');
  res.redirect('/orders/' + o.id);
});

app.post('/orders/:id/pay-confirm', requireLogin, (req, res) => {
  const me = res.locals.user;
  const o = getOrderFor(me, req.params.id);
  if (!o || o.seller_id !== me.id || o.payment_status !== 'marked_paid') return res.redirect('back');
  db.prepare("UPDATE orders SET payment_status = 'confirmed' WHERE id = ?").run(o.id);
  addEvent(o.id, 'paid_confirmed', `Seller confirmed payment received (${o.payment_method}).`);
  setFlash(req, 'success', 'Payment confirmed.');
  res.redirect('/orders/' + o.id);
});

app.post('/orders/:id/review', requireLogin, (req, res) => {
  const me = res.locals.user;
  const o = getOrderFor(me, req.params.id);
  if (!o || o.buyer_id !== me.id || o.status !== 'completed') return res.redirect('back');
  if (db.prepare('SELECT id FROM reviews WHERE order_id = ?').get(o.id)) return res.redirect('/orders/' + o.id);
  const rating = Math.max(1, Math.min(5, parseInt(req.body.rating, 10) || 5));
  const comment = clean(req.body.comment, 1000);
  db.prepare('INSERT INTO reviews (order_id, gig_id, buyer_id, rating, comment) VALUES (?, ?, ?, ?, ?)')
    .run(o.id, o.gig_id, me.id, rating, comment);
  addEvent(o.id, 'reviewed', `${me.name} left a ${rating}-star review.`);
  setFlash(req, 'success', 'Thanks for your review!');
  res.redirect('/orders/' + o.id);
});

// ---------- inbox ----------
app.get('/inbox', requireLogin, (req, res) => {
  const me = res.locals.user;
  const convs = db.prepare(
    `SELECT c.*,
        CASE WHEN c.buyer_id = ? THEN s.name ELSE b.name END AS other_name,
        CASE WHEN c.buyer_id = ? THEN c.seller_id ELSE c.buyer_id END AS other_id,
        g.title AS gig_title,
        (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_body,
        (SELECT attachment FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_attach,
        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_at,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND is_read = 0) AS unread_n
     FROM conversations c
     JOIN users b ON b.id = c.buyer_id
     JOIN users s ON s.id = c.seller_id
     LEFT JOIN gigs g ON g.id = c.gig_id
     WHERE c.buyer_id = ? OR c.seller_id = ?
     ORDER BY c.updated_at DESC`
  ).all(me.id, me.id, me.id, me.id, me.id);
  res.render('inbox', { convs });
});

app.post('/inbox/start', requireLogin, (req, res) => {
  const me = res.locals.user;
  const sellerId = parseInt(req.body.seller_id, 10);
  const gigId = req.body.gig_id ? parseInt(req.body.gig_id, 10) : null;
  if (!sellerId || sellerId === me.id) return res.redirect('back');
  const seller = db.prepare('SELECT id FROM users WHERE id = ?').get(sellerId);
  if (!seller) return res.redirect('back');
  let conv;
  if (gigId) {
    conv = db.prepare('SELECT id FROM conversations WHERE buyer_id = ? AND seller_id = ? AND gig_id = ?')
      .get(me.id, sellerId, gigId);
    if (!conv) conv = { id: db.prepare('INSERT INTO conversations (buyer_id, seller_id, gig_id) VALUES (?, ?, ?)')
      .run(me.id, sellerId, gigId).lastInsertRowid };
  } else {
    conv = db.prepare('SELECT id FROM conversations WHERE buyer_id = ? AND seller_id = ? AND gig_id IS NULL')
      .get(me.id, sellerId);
    if (!conv) conv = { id: db.prepare('INSERT INTO conversations (buyer_id, seller_id) VALUES (?, ?)')
      .run(me.id, sellerId).lastInsertRowid };
  }
  const hello = clean(req.body.hello, 500);
  if (hello) {
    db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)').run(conv.id, me.id, hello);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
  }
  res.redirect('/inbox/' + conv.id);
});

app.get('/inbox/:id', requireLogin, (req, res) => {
  const me = res.locals.user;
  const conv = db.prepare(
    `SELECT c.*, b.name AS buyer_name, s.name AS seller_name, g.title AS gig_title, g.id AS gig_id
     FROM conversations c JOIN users b ON b.id = c.buyer_id JOIN users s ON s.id = c.seller_id
     LEFT JOIN gigs g ON g.id = c.gig_id WHERE c.id = ?`
  ).get(req.params.id);
  if (!conv || (conv.buyer_id !== me.id && conv.seller_id !== me.id))
    return res.status(404).render('error', { code: 404, message: 'Conversation not found.' });
  db.prepare('UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?').run(conv.id, me.id);
  const msgs = db.prepare(
    `SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = ? ORDER BY m.id`
  ).all(conv.id);
  res.render('conversation', { conv, msgs });
});

app.post('/inbox/:id/message', requireLogin,
  (req, res, next) => attachUpload.single('attachment')(req, res, multerErr(res, req, next)),
  (req, res) => {
    const me = res.locals.user;
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
    if (!conv || (conv.buyer_id !== me.id && conv.seller_id !== me.id)) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
      return res.redirect('/inbox');
    }
    const body = clean(req.body.body, 2000);
    if (!body && !req.file) return res.redirect('/inbox/' + conv.id);
    db.prepare(`INSERT INTO messages (conversation_id, sender_id, body, attachment, attachment_name, attachment_size)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(conv.id, me.id, body,
        req.file ? req.file.filename : '',
        req.file ? String(req.file.originalname).slice(0, 120) : '',
        req.file ? req.file.size : 0);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
    res.redirect('/inbox/' + conv.id);
  });

// Secure attachment download — only the two conversation participants may download.
app.get('/attachments/:filename', requireLogin, (req, res) => {
  const me = res.locals.user;
  const fn = path.basename(String(req.params.filename || ''));
  const msg = db.prepare(
    `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.attachment = ? AND (c.buyer_id = ? OR c.seller_id = ?)`
  ).get(fn, me.id, me.id);
  if (!msg) return res.status(404).render('error', { code: 404, message: 'File not found.' });
  const p = path.join(ATTACH_DIR, fn);
  if (!fs.existsSync(p)) return res.status(404).render('error', { code: 404, message: 'File not found.' });
  res.download(p, msg.attachment_name || fn);
});

// ---------- admin (Talha) ----------
app.get('/admin', requireLogin, requireAdmin, (req, res) => {
  const totals = db.prepare(
    `SELECT
       (SELECT COALESCE(SUM(price_pkr),0) FROM orders WHERE status='completed') AS gmv,
       (SELECT COALESCE(SUM(amount_pkr),0) FROM transactions WHERE type='commission') AS commission,
       (SELECT COALESCE(SUM(seller_amount_pkr),0) FROM orders WHERE status='completed') AS seller_payouts,
       (SELECT COUNT(*) FROM orders) AS orders,
       (SELECT COUNT(*) FROM orders WHERE status='completed') AS completed,
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM gigs) AS gigs`
  ).get();
  const orders = db.prepare(
    `SELECT o.*, b.name AS buyer_name, s.name AS seller_name
     FROM orders o JOIN users b ON b.id=o.buyer_id JOIN users s ON s.id=o.seller_id
     ORDER BY o.created_at DESC LIMIT 50`
  ).all();
  const users = db.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM gigs WHERE seller_id = u.id) AS gig_count,
       (SELECT COUNT(*) FROM orders WHERE buyer_id = u.id OR seller_id = u.id) AS order_count
     FROM users u ORDER BY u.created_at DESC`
  ).all();
  const gigs = db.prepare(
    `SELECT g.*, u.name AS seller_name FROM gigs g JOIN users u ON u.id = g.seller_id ORDER BY g.created_at DESC`
  ).all();
  const txns = db.prepare(
    `SELECT t.*, o.title_snapshot FROM transactions t JOIN orders o ON o.id = t.order_id ORDER BY t.created_at DESC LIMIT 50`
  ).all();
  res.render('admin', { totals, orders, users, gigs, txns });
});

// ---------- 404 / errors ----------
app.use((req, res) => res.status(404).render('error', { code: 404, message: 'Page not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { code: 500, message: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => console.log(`CAPTAIN DESIGNS running on port ${PORT}`));
