'use strict';
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { ApiError } = require('./externalApiConnectors');
const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const publicUser = user => ({ id: user.id, name: user.name, email: user.email, created_at: user.created_at });

function createAccounts(file = process.env.ACCOUNTS_DB || path.join(__dirname, '../../.runtime/accounts.sqlite')) {
  let database;
  function db() {
    if (database) return database;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    database = new DatabaseSync(file);
    database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL, kakao_id TEXT);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS searches (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);`);
    const cols = database.prepare('PRAGMA table_info(users)').all();
    if (!cols.some(c => c.name === 'kakao_id')) database.exec('ALTER TABLE users ADD COLUMN kakao_id TEXT');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_kakao_id ON users(kakao_id) WHERE kakao_id IS NOT NULL');
    return database;
  }
  function addCookie(res, value) {
    const prev = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', prev ? [...(Array.isArray(prev) ? prev : [prev]), value] : value);
  }
  function session(req, res, user) {
    const token = randomBytes(32).toString('hex');
    db().prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db().prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), user.id, Date.now() + 7 * 86400000);
    addCookie(res, `location_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV === 'production' || req.socket.encrypted ? '; Secure' : ''}`);
    return { user: publicUser(user) };
  }
  function cookie(req) { return /(?:^|;\s*)location_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1] || ''; }
  function current(req, required = true) {
    const token = cookie(req);
    const user = token && db().prepare('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>?').get(digest(token), Date.now());
    if (!user && required) throw new ApiError('LOGIN_REQUIRED', '로그인 후 이용해 주세요.', 401);
    return user ? publicUser(user) : null;
  }
  async function register(p, req, res) {
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
    if (name.length < 2 || name.length > 40 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ApiError('INVALID_INPUT', '이름(2~40자)과 이메일을 확인하세요.');
    if (typeof p.password !== 'string' || p.password.length < 12 || p.password.length > 128) throw new ApiError('INVALID_INPUT', '비밀번호는 12~128자로 입력하세요.');
    if (p.consent !== true) throw new ApiError('CONSENT_REQUIRED', '계정 정보 저장 안내에 동의해 주세요.');
    const salt = randomBytes(16).toString('hex'), hash = (await derive(p.password, salt, 64)).toString('hex');
    const user = { id: randomBytes(16).toString('hex'), name, email, created_at: new Date().toISOString() };
    try { db().prepare('INSERT INTO users (id, name, email, hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, name, email, hash, salt, user.created_at); }
    catch (err) { if (err.code === 'ERR_SQLITE_ERROR' && /UNIQUE/.test(err.message)) throw new ApiError('ACCOUNT_EXISTS', '이미 사용 중인 이메일입니다. 로그인해 주세요.', 409); throw err; }
    return session(req, res, user);
  }
  async function login(p, req, res) {
    if (typeof p.email !== 'string' || typeof p.password !== 'string' || p.email.length > 254 || p.password.length > 128) throw new ApiError('INVALID_INPUT', '이메일과 비밀번호를 확인하세요.');
    const user = db().prepare('SELECT * FROM users WHERE email=?').get(p.email.trim().toLowerCase());
    const hash = await derive(p.password, user?.salt || 'constant-time-missing-account', 64);
    if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) throw new ApiError('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.', 401);
    return session(req, res, user);
  }
  function logout(req, res) {
    const token = cookie(req);
    if (token) db().prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
    res.setHeader('Set-Cookie', `location_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' || req.socket.encrypted ? '; Secure' : ''}`);
    return { success: true };
  }
  function searches(req) { return db().prepare('SELECT id,title,data,created_at FROM searches WHERE user_id=? ORDER BY created_at DESC').all(current(req).id).map(r => ({ ...r, data: JSON.parse(r.data) })); }
  function save(req, p) {
    const user = current(req);
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 100 || !p.data || typeof p.data !== 'object' || Array.isArray(p.data)) throw new ApiError('INVALID_INPUT', '저장할 분석 조건을 확인하세요.');
    const allowed = ['industry', 'sido', 'sigungu', 'emd', 'radius', 'budget', 'rent', 'storeType', 'wSurvival', 'wCompetition', 'wDemand', 'wCost', 'lat', 'lng', 'officialIndustry'];
    const data = Object.fromEntries(allowed.filter(k => ['string', 'number'].includes(typeof p.data[k])).map(k => [k, p.data[k]]));
    if (JSON.stringify(data).length > 4000) throw new ApiError('INVALID_INPUT', '저장할 조건이 너무 큽니다.');
    if (db().prepare('SELECT count(*) AS n FROM searches WHERE user_id=?').get(user.id).n >= 30) throw new ApiError('LIMIT_REACHED', '최대 30개까지 저장할 수 있습니다. 이전 조건을 삭제해 주세요.');
    db().prepare('INSERT INTO searches VALUES (?, ?, ?, ?, ?)').run(randomBytes(16).toString('hex'), user.id, p.title.trim(), JSON.stringify(data), new Date().toISOString());
    return { searches: searches(req) };
  }
  async function loginWithKakao({ kakaoId, name, email }, req, res) {
    const kid = String(kakaoId || '').trim();
    if (!/^\d{4,30}$/.test(kid)) throw new ApiError('INVALID_INPUT', '카카오 계정 식별자를 확인할 수 없습니다.');
    let user = db().prepare('SELECT * FROM users WHERE kakao_id=?').get(kid);
    const safeEmail = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim().toLowerCase() : `kakao_${kid}@kakao.user`;
    const safeName = (typeof name === 'string' && name.trim() ? name.trim() : `카카오회원_${kid.slice(-4)}`).slice(0, 40);
    if (!user) {
      const byEmail = db().prepare('SELECT * FROM users WHERE email=?').get(safeEmail);
      if (byEmail) {
        db().prepare('UPDATE users SET kakao_id=? WHERE id=?').run(kid, byEmail.id);
        user = { ...byEmail, kakao_id: kid };
      } else {
        const salt = randomBytes(16).toString('hex');
        const hash = (await derive(randomBytes(32).toString('hex'), salt, 64)).toString('hex');
        user = { id: randomBytes(16).toString('hex'), name: safeName, email: safeEmail, created_at: new Date().toISOString(), kakao_id: kid };
        db().prepare('INSERT INTO users (id, name, email, hash, salt, created_at, kakao_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, user.name, user.email, hash, salt, user.created_at, kid);
      }
    }
    return session(req, res, user);
  }
  return { register, login, loginWithKakao, logout, current, searches, save,
    remove(req, p) { db().prepare('DELETE FROM searches WHERE id=? AND user_id=?').run(String(p.id || ''), current(req).id); return { searches: searches(req) }; },
    summary() { return { count: db().prepare('SELECT count(*) AS n FROM users').get().n, users: db().prepare('SELECT id,name,email,created_at FROM users ORDER BY created_at DESC LIMIT 50').all() }; },
    close() { database?.close(); database = null; }
  };
}
module.exports = { createAccounts };
