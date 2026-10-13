// scripts/seed.js — creates ONLY the admin account. The marketplace starts
// completely clean: no demo sellers, buyers, gigs, orders or messages.
const bcrypt = require('bcryptjs');
const db = require('../db');

function main() {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get('talha@riomarket.com');
  if (exists) {
    console.log('Admin already exists — nothing seeded.');
    return;
  }
  db.prepare("INSERT INTO users (name, email, password_hash, role, bio, is_admin) VALUES (?, ?, ?, 'both', ?, 1)")
    .run(
      'Talha (Admin)',
      'talha@riomarket.com',
      bcrypt.hashSync('rioadmin123', 10),
      'Platform owner — CAPTAIN DESIGNS.'
    );
  console.log('Seeded admin: talha@riomarket.com / rioadmin123');
  console.log('Marketplace is clean: no demo users, gigs or orders.');
}

module.exports = { main };
if (require.main === module) main();
