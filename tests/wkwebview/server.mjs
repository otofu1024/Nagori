import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

await promisify(execFile)('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--examples']);
const extract = (documents) =>
  new Promise((resolve, reject) => {
    const child = execFile('src-tauri/target/debug/examples/graph-extract', { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(documents));
  });
const fixtureRoot = await mkdtemp('/private/tmp/nagori-editor-graph-');
const fixtureDocuments = [
  { path: 'notes/first.md', text: '---\ntitle: 最初のノート\ntags: [共通, 考え]\n---\n# 最初\n[次](second.md) [[散歩]]\n' },
  { path: 'notes/second.md', text: '---\ntitle: 次のノート\ntags: 共通\n---\n# 次\n[最初](first.md#section)\n' },
  { path: '日記/散歩.md', text: '# 散歩\n[[first]]\n' },
  { path: 'README.md', text: '# ワークスペース\n[最初](notes/first.md)\n' },
];
for (const doc of fixtureDocuments) {
  await mkdir(join(fixtureRoot, doc.path, '..'), { recursive: true });
  await writeFile(join(fixtureRoot, doc.path), doc.text);
}
const memoryCount = 300;
function memoryDocument(i) {
  const next = (i + 1) % memoryCount;
  const header = `---\ntitle: 記事${i}\ntags: [タグ${i % 12}, 共通]\n---\n[次の記事](article-${next}.md)\n`;
  const block = '画像の参照を含む長い本文です。'.repeat(100) + `\n![画像](./images/picture-${i}.jpg)\n\n`;
  return { path: `notes/article-${i}.md`, text: header + block.repeat(80) };
}
const server = await createServer({
  configFile: false,
  plugins: [
    svelte(),
    {
      name: 'ime-check',
      configureServer(server) {
        server.middlewares.use('/tests/wkwebview/blog-theme', async (request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            if (request.method === 'POST') {
              let input = '';
              for await (const chunk of request) input += chunk;
              const { path, text } = JSON.parse(input);
              if (!['src/theme/theme.css', 'src/styles/template.css'].includes(path) || typeof text !== 'string')
                throw Error('Invalid theme file');
              await writeFile(join('/private/tmp/nagori-stage2-blog', path), text);
            }
            const { stdout } = await promisify(execFile)('src-tauri/target/debug/examples/blog-workspace', [
              '/private/tmp/nagori-stage2-blog',
              '--theme',
            ]);
            response.end(stdout);
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/blog-data', async (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            const { stdout } = await promisify(execFile)(
              'src-tauri/target/debug/examples/blog-workspace',
              ['/private/tmp/nagori-stage2-blog'],
              { maxBuffer: 8 * 1024 * 1024 },
            );
            response.end(stdout);
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/graph-extract', async (request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            let input = '';
            for await (const chunk of request) input += chunk;
            response.end(JSON.stringify(await extract(JSON.parse(input))));
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/graph-memory-data', async (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            const documents = Array.from({ length: memoryCount }, (_, i) => memoryDocument(i));
            const sourceBytes = documents.reduce((sum, doc) => sum + Buffer.byteLength(doc.text), 0);
            response.end(JSON.stringify({ articles: await extract(documents), sourceBytes }));
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/graph-memory-document', (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(memoryDocument(0)));
        });
        server.middlewares.use('/tests/wkwebview/graph-data', async (_request, response) => {
          const root = fixtureRoot;
          const documents = [];
          async function walk(path = '') {
            for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
              if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.nagori-save-')) continue;
              const child = path ? path + '/' + entry.name : entry.name;
              if (entry.isDirectory()) await walk(child);
              else if (entry.isFile() && /\.md$/i.test(entry.name))
                documents.push({ path: child, text: await readFile(join(root, child), 'utf8') });
            }
          }
          response.setHeader('Content-Type', 'application/json');
          try {
            await walk();
            response.end(JSON.stringify({ root, documents }));
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/ime-check', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#host{height:100%;margin:0}#host{height:650px}</style></head><body><div id="host"></div><script type="module" src="/tests/wkwebview/fixture.js"></script></body></html>',
          );
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 1438, strictPort: true },
});
await server.listen();
console.log('WKWebView確認ページ http://127.0.0.1:1438/tests/wkwebview/ime-check');
