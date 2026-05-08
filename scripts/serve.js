#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const rootDir = process.cwd();
const siteDir = path.join(rootDir, 'site');
const port = Number(process.env.PORT || 4173);

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

function cacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.svg':
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.ico':
      return 'public, max-age=31536000, immutable';
    case '.css':
    case '.js':
      return 'public, max-age=86400';
    case '.json':
    case '.html':
    default:
      return 'no-cache';
  }
}

function tryServeFile(filePath, response) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  response.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Cache-Control': cacheControl(filePath),
  });
  response.end(fs.readFileSync(filePath));
  return true;
}

const server = http.createServer((request, response) => {
  const requestUrl = url.parse(request.url || '/');
  const pathname = decodeURIComponent(requestUrl.pathname || '/');

  if (pathname === '/' || pathname === '') {
    tryServeFile(path.join(siteDir, 'index.html'), response);
    return;
  }

  const cleanPath = pathname.replace(/^\/+/, '');
  const directFile = path.join(rootDir, cleanPath);
  if (tryServeFile(directFile, response)) {
    return;
  }

  const siteFile = path.join(siteDir, cleanPath);
  if (tryServeFile(siteFile, response)) {
    return;
  }

  const fallback = path.join(siteDir, '404.html');
  if (fs.existsSync(fallback)) {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    response.end(fs.readFileSync(fallback));
    return;
  }

  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  response.end('Not found');
});

server.listen(port, () => {
  console.log(`[serve] http://localhost:${port}`);
  console.log('[serve] Open / for the item browser and /items/<slug> for a detail page');
});
