/* 个人站渲染脚本 —— 数据来自 assets/data.js（由本地后台生成） */

const $ = (sel) => document.querySelector(sel)
const DATA = window.SITE_DATA || { profile: {}, apps: [], facts: [] }
const { profile = {}, apps = [], facts = [], site = {} } = DATA

/* ---------- 主题 ---------- */
const themeBtn = $('#themeBtn')
const savedTheme = localStorage.getItem('theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
  document.documentElement.dataset.theme = 'dark'
}

themeBtn?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  localStorage.setItem('theme', next)
})

/* ---------- 导航滚动边框 ---------- */
const nav = $('#nav')
const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8)
window.addEventListener('scroll', onScroll, { passive: true })
onScroll()

/* ---------- 基础信息 ---------- */
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

if (site.title) document.title = site.title
if (site.description) {
  document.querySelector('meta[name="description"]')?.setAttribute('content', site.description)
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', site.title || '')
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', site.description)
}

$('#brandName').textContent = profile.name || ''
$('#heroName').textContent = profile.name || ''
$('#footerName').textContent = profile.name || ''
$('#heroHeadline').textContent = profile.headline || ''
$('#heroBio').textContent = profile.bio || ''

$('#aboutText').innerHTML = (profile.bio || '')
  .split('。')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => `<p>${esc(s)}。</p>`)
  .join('')

$('#facts').innerHTML = facts
  .map((f) => `<div><dt>${esc(f.term)}</dt><dd>${esc(f.desc)}</dd></div>`)
  .join('')

$('#links').innerHTML = (profile.links || [])
  .map(
    (l) => `<a class="link-card" href="${esc(l.url)}" target="_blank" rel="noopener">
      <span>${esc(l.label)}</span>↗
    </a>`
  )
  .join('')

/* ---------- 应用列表 ---------- */
const grid = $('#appGrid')
const filters = $('#filters')
const empty = $('#empty')
const fmtDate = (d) => (d ? String(d).replaceAll('-', '.') : '')

const sorted = [...apps].sort(
  (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.updated || '').localeCompare(String(a.updated || ''))
)

function cardHTML(app, i) {
  const dlIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none"
      stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 1.6v8.6M4.6 7l3.4 3.4L11.4 7M2.4 13.4h11.2"/></svg>`

  const meta = [app.platform, app.version, fmtDate(app.updated)].filter(Boolean).map(esc).join(' · ')

  return `<article class="card reveal" style="animation-delay:${Math.min(i * 45, 300)}ms">
    <div class="card-top">
      <h3>${esc(app.name)}</h3>
      ${app.featured ? '<span class="badge">精选</span>' : ''}
    </div>
    <p>${esc(app.desc)}</p>
    <div class="tags">
      ${(app.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
    </div>
    <div class="card-foot">
      <span class="meta">${meta}</span>
      <a class="dl" href="${esc(app.url)}" target="_blank" rel="noopener">下载 ${dlIcon}</a>
    </div>
  </article>`
}

const allTags = ['全部', ...new Set(apps.flatMap((a) => a.tags || []))]

filters.innerHTML = allTags
  .map((t, i) => `<button class="chip${i === 0 ? ' active' : ''}" data-filter="${esc(t)}">${esc(t)}</button>`)
  .join('')

function render(filter = '全部') {
  const list = filter === '全部' ? sorted : sorted.filter((a) => (a.tags || []).includes(filter))
  grid.innerHTML = list.map(cardHTML).join('')
  grid.hidden = list.length === 0
  empty.hidden = list.length > 0
}

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip')
  if (!btn) return
  filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn))
  render(btn.dataset.filter)
})

render()

/* ---------- 年份 ---------- */
$('#year').textContent = new Date().getFullYear()
