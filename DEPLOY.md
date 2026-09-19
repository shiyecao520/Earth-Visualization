# 服务器部署说明

## 推荐方式：下载完整 Release

GitHub 的 [Latest Release](https://github.com/shiyecao520/Earth-Visualization/releases/latest) 提供完整 Linux x86_64 单文件部署包，包含 Python 运行时、前端、Cesium、行政边界和 SQLite 运行索引。下载后无需安装 Python 或前端依赖，可直接按包内《部署说明》启动并预览完整效果。

以下内容适用于从源码目录部署。

本目录是可直接部署的运行包，包含前端静态资源、Cesium 本地资源、行政边界和已生成的 SQLite 运行索引。

## 重要：不要用纯静态服务器

页面依赖同源 `/api/*` 接口，不能只部署 HTML/CSS/JS 到 Nginx 静态目录后删除 Python 服务。也不要使用：

```bash
python3 -m http.server 8001
```

它无法提供 `/api/*`，会导致数据和热力图加载失败。

## 启动

```bash
cd dist
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt

# 按服务器实际情况替换 MCP_URL
MCP_URL=http://your-mcp-host:8001/mcp HOST=0.0.0.0 PORT=8001 python3 server.py
```

启动后访问：`http://server-ip:8001/`

首次打开时，全球热力图冷启动可能需要约 30–60 秒；后续相同条件会命中内存缓存，速度会明显变快。

## Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 注意

- `js/config.local.js` 中包含天地图 Token，请确认该 Token 已做域名/IP 白名单限制。
- 本包不包含 `data/source/` 原始 CSV/XLSX，运行时只读取 `data/generated/` 索引。
