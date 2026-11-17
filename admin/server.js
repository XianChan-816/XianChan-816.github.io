#!/usr/bin/env node
/**
 * 个人站本地后台
 *   npm run admin  →  http://127.0.0.1:8787/admin
 *
 * 零依赖，只用 Node 内置模块。
 * 职责：编辑 data/site.json → 生成 assets/data.js → 一键 git 提交并推送到 GitHub
 *       → GitHub Actions 自动部署到 Pages
 */

const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const run = promisify(execFile)

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const SITE_JSON = path.join(DATA_DIR, 'site.json')
const DATA_JS = path.join(ROOT, 'assets', 'data.js')
const CONFIG_FILE = path.join(DATA_DIR, '.deploy.json')
const PORT = Number(process.env.ADMIN_PORT || 8787)
const HOST = '127.0.0.1'

/* ---------------- 工具 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 5 * 1024 * 1024) throw new Error('请求体过大')
    chunks.push(c)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

/* ---------------- 内容读写 ---------------- */

async function loadContent() {
  return readJSON(SITE_JSON, { site: {}, profile: {}, facts: [], apps: [] })
}

function normalize(data) {
  const out = {
    site: {
      title: String(data.site?.title || '').slice(0, 120),
      description: String(data.site?.description || '').slice(0, 300),
      baseUrl: String(data.site?.baseUrl || '').slice(0, 200),
    },
    profile: {
      name: String(data.profile?.name || '').slice(0, 60),
      handle: String(data.profile?.handle || '').slice(0, 60),
      headline: String(data.profile?.headline || '').slice(0, 160),
      bio: String(data.profile?.bio || '').slice(0, 1200),
      email: String(data.profile?.email || '').slice(0, 120),
      links: (Array.isArray(data.profile?.links) ? data.profile.links : [])
        .slice(0, 12)
        .map((l) => ({ label: String(l.label || '').slice(0, 40), url: String(l.url || '').slice(0, 400) }))
        .filter((l) => l.label || l.url),
    },
    facts: (Array.isArray(data.facts) ? data.facts : [])
      .slice(0, 8)
      .map((f) => ({ term: String(f.term || '').slice(0, 40), desc: String(f.desc || '').slice(0, 200) }))
      .filter((f) => f.term || f.desc),
    apps: (Array.isArray(data.apps) ? data.apps : [])
      .slice(0, 200)
      .map((a, i) => ({
        id: String(a.id || `app-${i + 1}-${Date.now().toString(36)}`).slice(0, 60),
        name: String(a.name || '').slice(0, 80),
        desc: String(a.desc || '').slice(0, 400),
        version: String(a.version || '').slice(0, 40),
        platform: String(a.platform || '').slice(0, 40),
        tags: (Array.isArray(a.tags) ? a.tags : String(a.tags || '').split(/[,，\s]+/))
          .map((t) => String(t).trim().slice(0, 24))
          .filter(Boolean)
          .slice(0, 8),
        updated: String(a.updated || '').slice(0, 20),
        url: String(a.url || '').slice(0, 600),
        featured: Boolean(a.featured),
      }))
      .filter((a) => a.name),
  }
  return out
}

async function saveContent(raw) {
  const data = normalize(raw)

  // 备份旧版本，最多留 30 份
  try {
    const old = await fsp.readFile(SITE_JSON, 'utf8')
    await fsp.mkdir(BACKUP_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fsp.writeFile(path.join(BACKUP_DIR, `${stamp}.json`), old, 'utf8')
    const files = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).sort()
    for (const f of files.slice(0, Math.max(0, files.length - 30))) {
      await fsp.rm(path.join(BACKUP_DIR, f), { force: true })
    }
  } catch {
    /* 首次保存没有旧文件 */
  }

  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(SITE_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8')

  // 生成前端读取的数据文件
  const banner = '/* 此文件由本地后台自动生成，请勿手改。源文件：data/site.json */\n'
  await fsp.writeFile(DATA_JS, `${banner}window.SITE_DATA = ${JSON.stringify(data, null, 2)}\n`, 'utf8')

  return data
}

/* ---------------- 部署配置 ---------------- */

async function loadConfig() {
  return readJSON(CONFIG_FILE, { user: '', repo: '', branch: 'main', token: '' })
}

async function saveConfig(cfg) {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
}

/* ---------------- git 操作 ---------------- */

const git = async (args, opts = {}) =>
  run('git', args, { cwd: ROOT, maxBuffer: 10 * 1024 * 1024, ...opts })

async function isRepo() {
  try {
    await fsp.access(path.join(ROOT, '.git'))
    return true
  } catch {
    return false
  }
}

async function hasChanges() {
  const { stdout } = await git(['status', '--porcelain'])
  return stdout.trim().length > 0
}

async function ensureRemote(user, repo) {
  const url = `https://github.com/${user}/${repo}.git`
  let current = ''
  try {
    const { stdout } = await git(['remote', 'get-url', 'origin'])
    current = stdout.trim()
  } catch {
    /* 无 remote */
  }
  if (current === url) return false
  if (current) await git(['remote', 'set-url', 'origin', url])
  else await git(['remote', 'add', 'origin', url])
  return true
}

async function githubRepoExists(user, repo, token) {
  const r = await fetch(`https://api.github.com/repos/${user}/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'personal-site-admin' },
  })
  return r.ok
}

async function createGithubRepo(user, repo, token) {
  const isUserSite = repo.toLowerCase() === `${user.toLowerCase()}.github.io`
  const r = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'personal-site-admin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: repo,
      private: false,
      description: isUserSite ? '个人主页' : '个人站点',
      has_issues: false,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
    }),
  })
  if (!r.ok) {
    const t = await r.text()
    if (r.status === 403 || r.status === 401) {
      throw new Error(
        '创建仓库失败：Token 权限不足。请给 Token 加上 Administration（Read and write），' +
          '或者手动去 GitHub 新建同名仓库后再点发布。'
      )
    }
    if (r.status === 422 && /already exists/i.test(t)) {
      return isUserSite
    }
    throw new Error(`创建仓库失败（${r.status}）：${t.slice(0, 200)}`)
  }
  return isUserSite
}

/** Pages 站点地址 */
function siteUrl(user, repo) {
  const isUserSite = repo.toLowerCase() === `${user.toLowerCase()}.github.io`
  return isUserSite ? `https://${user.toLowerCase()}.github.io/` : `https://${user.toLowerCase()}.github.io/${repo}/`
}

/* ---------------- 发布 ---------------- */

async function publish() {
  const cfg = await loadConfig()
  const log = []
  const push = (s) => log.push(s)

  if (!cfg.user || !cfg.repo) throw new Error('还没配置 GitHub 用户名和仓库名，先去「设置」里填。')
  if (!cfg.token) throw new Error('还没填 GitHub Token，先去「设置」里填（只需一次）。')

  const branch = cfg.branch || 'main'

  push('检查 GitHub 仓库…')
  const exists = await githubRepoExists(cfg.user, cfg.repo, cfg.token)
  if (!exists) {
    push('仓库不存在，正在创建…')
    await createGithubRepo(cfg.user, cfg.repo, cfg.token)
    push(`仓库 ${cfg.user}/${cfg.repo} 已创建`)
    await new Promise((r) => setTimeout(r, 1200))
  } else {
    push('仓库已存在，直接推送')
  }

  if (!(await isRepo())) {
    push('初始化本地仓库…')
    await git(['init'])
    await git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  }

  await ensureRemote(cfg.user, cfg.repo)

  push('暂存改动…')
  await git(['add', '-A'])

  if (await hasChanges()) {
    const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
    await git(['commit', '-m', `更新站点内容 ${stamp}`])
    push('已提交本地改动')
  } else {
    push('没有新改动，只做同步')
  }

  push('推送到 GitHub…')
  const pushUrl = `https://x-access-token:${cfg.token}@github.com/${cfg.user}/${cfg.repo}.git`
  try {
    await git(['push', pushUrl, `HEAD:${branch}`, '--force'])
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString()
    if (/does not appear to be a git repository|not found/i.test(msg)) {
      throw new Error('推送失败：仓库地址不存在或 Token 没有写权限（需 repo 权限）。')
    }
    if (/Authentication failed|Invalid username or password|403/i.test(msg)) {
      throw new Error('推送失败：Token 无效或已过期，请重新生成一个有 repo 权限的 Token。')
    }
    throw new Error(`推送失败：${msg.split('\n').filter(Boolean).slice(-3).join(' ')}`)
  }
  push('推送完成')

  push('GitHub Actions 正在构建，通常 30–60 秒后生效')
  return {
    log,
    url: siteUrl(cfg.user, cfg.repo),
    actionsUrl: `https://github.com/${cfg.user}/${cfg.repo}/actions`,
  }
}

/* ---------------- 静态文件 ---------------- */

async function serveFile(res, filePath) {
  try {
    const buf = await fsp.readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(buf)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404')
  }
}

/* ---------------- 路由 ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = decodeURIComponent(url.pathname)

  try {
    /* --- API --- */
    if (pathname === '/api/content') {
      if (req.method === 'GET') return sendJSON(res, 200, await loadContent())
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readBody(req)
        return sendJSON(res, 200, { ok: true, content: await saveContent(body) })
      }
      return sendJSON(res, 405, { ok: false, error: '不支持的请求方法' })
    }

    if (pathname === '/api/publish' && req.method === 'POST') {
      try {
        const result = await publish()
        return sendJSON(res, 200, { ok: true, ...result })
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message })
      }
    }

    if (pathname === '/api/config') {
      if (req.method === 'GET') {
        const cfg = await loadConfig()
        return sendJSON(res, 200, {
          user: cfg.user,
          repo: cfg.repo,
          branch: cfg.branch || 'main',
          hasToken: Boolean(cfg.token),
          url: cfg.user && cfg.repo ? siteUrl(cfg.user, cfg.repo) : '',
        })
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        const prev = await loadConfig()
        const next = {
          user: String(body.user || '').trim(),
          repo: String(body.repo || '').trim(),
          branch: String(body.branch || 'main').trim() || 'main',
          token: String(body.token || '').trim() || prev.token,
        }
        if (!/^[\w.-]+$/.test(next.user)) return sendJSON(res, 400, { ok: false, error: '用户名格式不对' })
        if (!/^[\w.-]+$/.test(next.repo)) return sendJSON(res, 400, { ok: false, error: '仓库名格式不对' })
        await saveConfig(next)
        return sendJSON(res, 200, { ok: true, url: siteUrl(next.user, next.repo) })
      }
      return sendJSON(res, 405, { ok: false, error: '不支持的请求方法' })
    }

    if (pathname === '/api/status') {
      const cfg = await loadConfig()
      let changed = false
      try {
        changed = await hasChanges()
      } catch {
        changed = false
      }
      return sendJSON(res, 200, {
        hasRepo: await isRepo(),
        changed,
        configured: Boolean(cfg.user && cfg.repo && cfg.token),
        url: cfg.user && cfg.repo ? siteUrl(cfg.user, cfg.repo) : '',
      })
    }

    /* --- 页面 --- */
    if (pathname === '/' || pathname === '/admin' || pathname === '/admin/') {
      return serveFile(res, path.join(ROOT, 'admin', 'ui.html'))
    }
    if (pathname === '/preview' || pathname === '/preview/') {
      return serveFile(res, path.join(ROOT, 'index.html'))
    }

    // 其余按站点根目录静态文件处理；禁止越界
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '')
    const filePath = path.join(ROOT, safe)
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403)
      return res.end('403')
    }
    return serveFile(res, filePath)
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log('')
  console.log('  个人站后台已启动')
  console.log(`  管理界面  http://${HOST}:${PORT}/admin`)
  console.log(`  预览站点  http://${HOST}:${PORT}/preview`)
  console.log('')
  console.log('  Ctrl+C 退出')
  console.log('')
})
