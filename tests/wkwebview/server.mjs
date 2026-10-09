import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
  configFile: false,
  plugins: [svelte(), { name: 'ime-check', configureServer(server) {
    server.middlewares.use('/tests/wkwebview/ime-check', (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta charset="utf-8"><style>html,body,#host{height:100%;margin:0}#host{height:650px}</style></head><body><div id="host"></div><script type="module" src="/tests/wkwebview/fixture.js"></script></body></html>');
    });
  } }],
  server: { host: '127.0.0.1', port: 1438, strictPort: true },
});
await server.listen();
console.log('WKWebView確認ページ http://127.0.0.1:1438/tests/wkwebview/ime-check');
