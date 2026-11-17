# 个人站点

纯静态个人主页 + 本地内容管理后台。改内容不用写代码。

## 启动后台

```bash
npm run admin
```

浏览器打开 **http://127.0.0.1:8787/admin**

- `/admin` 管理界面
- `/preview` 预览站点

## 日常使用

1. 打开后台，在「基本资料」「应用管理」里改内容
2. 点 **保存** → 本地立即生效，可以点「预览站点」看效果
3. 点 **发布上线** → 自动提交并推送到 GitHub，Actions 构建后网站更新

## 首次配置（只做一次）

1. 去 https://github.com/settings/tokens 生成一个 **classic token**，勾选 `repo` + `workflow`
2. 后台「发布设置」里填 GitHub 用户名、仓库名、Token
3. 仓库名建议填 `用户名.github.io`，链接最干净；仓库不存在会自动创建
4. 首次发布后去仓库 **Settings → Pages**，确认 Source 选的是 **GitHub Actions**

## 目录说明

```
index.html              站点页面
assets/
  data.js               自动生成，别手改
  main.js               渲染逻辑
  style.css             样式
data/
  site.json             内容源文件（后台写入）
  backups/              每次保存自动备份，保留 30 份
  .deploy.json          GitHub Token，不进仓库
admin/
  server.js             本地后台服务（零依赖）
  ui.html               管理界面
.github/workflows/      自动部署配置
```

## 手动改内容

不想开后台时，直接编辑 `data/site.json`，然后运行：

```bash
node -e "const f=require('fs');const d=JSON.parse(f.readFileSync('data/site.json','utf8'));f.writeFileSync('assets/data.js','window.SITE_DATA = '+JSON.stringify(d,null,2))"
```

## 数据备份恢复

`data/backups/` 里按时间存了历史版本，复制任意一个覆盖 `data/site.json` 即可回滚。

## 注意

- 后台只监听 `127.0.0.1`，外网访问不到，Token 不会外泄
- `data/.deploy.json` 已在 `.gitignore` 中，不会被提交
