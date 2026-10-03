// 自動の動作確認（e2e）で使う、ブラウザとテスト用のページの準備です（#21）。
//
// 拡張機能は、テストのたびに一時フォルダーへ複写し、写しの manifest.json にだけ、テスト用のページ
// （http://127.0.0.1）を操作する許可を加えます。自動テストでは、サイトの許可を求める Chrome の確認画面を
// 押せないためです。リポジトリの extension/ は変更しません。

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** @typedef {import('../extension/shared/flow.js').Flow} Flow */
/** @typedef {import('../extension/shared/history.js').HistoryEntry} HistoryEntry */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = path.join(root, 'e2e', 'pages');

/** 実行の結果を待つ上限です。手順の間隔は 1 秒以上のため、長めにします。 */
const RUN_TIMEOUT_MS = 90_000;

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

/**
 * テスト用のページ（e2e/pages/）を http://127.0.0.1 で配信します。ポートは空いているものを使います。
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startServer() {
  const server = http.createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://127.0.0.1');
    // ログインが必要なファイルの代わりです（#172）。Cookie の lm_auth=1 がある場合だけ PDF を返します。
    // ログインの Cookie を付けて保存できるかを確かめるために使います。
    // Amazon の明細書と同じ形のリンク先です（#185）。ID の部分がファイルごとに変わります。
    const documentId = /^\/documents\/download\/([\w-]+)\/invoice\.pdf$/.exec(pathname)?.[1];
    if (pathname === '/auth/invoice.pdf' || documentId !== undefined) {
      const cookies = request.headers.cookie ?? '';
      if (!/(^|;\s*)lm_auth=1(;|$)/.test(cookies)) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('forbidden');
        return;
      }
      response
        .writeHead(200, { 'content-type': 'application/pdf' })
        .end(minimalPdf(documentId ?? searchParams.get('n') ?? ''));
      return;
    }
    const file = path.join(pagesDir, decodeURIComponent(pathname));
    if (!file.startsWith(pagesDir + path.sep) || !fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': type }).end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve(undefined));
      }),
  };
}

/**
 * 1 ページの最小の PDF を作ります。本文に文字を 1 行書きます（英数字と記号だけ）。
 * @param {string} text
 * @returns {Buffer}
 */
function minimalPdf(text) {
  const safe = text.replace(/[^A-Za-z0-9 -]/g, '');
  const content = `BT /F1 24 Tf 72 720 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/**
 * 拡張機能を読み込んだ Chromium を起動し、拡張機能の画面（管理画面）を開きます。
 * chrome.* の呼び出しは、この画面の中で行います。
 *
 * - Chromium の場所は、環境変数 LIGHTOMATE_CHROMIUM で指定できます。省略した場合は Playwright が
 *   導入した Chromium を使います。
 * - ダウンロードは Chrome の既定の動作に戻します。Playwright の既定の扱いでは、ファイル名が置き換わり、
 *   拡張機能が指定した名前を確かめられないためです。
 * - LANG を C.UTF-8 にします。空の場合、保存先の日本語のフォルダー名が使えないためです。
 */
export async function launchBrowser() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lightomate-e2e-'));
  const extensionDir = path.join(work, 'extension');
  const userDataDir = path.join(work, 'profile');
  const downloadDir = path.join(work, 'downloads');

  fs.cpSync(path.join(root, 'extension'), extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), 'http://127.0.0.1/*'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
  fs.mkdirSync(downloadDir);
  fs.writeFileSync(
    path.join(userDataDir, 'Default', 'Preferences'),
    JSON.stringify({ download: { default_directory: downloadDir, prompt_for_download: false } }),
  );

  const executablePath = process.env.LIGHTOMATE_CHROMIUM || undefined;
  const context = await chromium.launchPersistentContext(userDataDir, {
    // 拡張機能は、新しい方式の headless でだけ読み込めます。channel: 'chromium' はその方式で起動します。
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: true,
    acceptDownloads: true,
    env: { ...process.env, LANG: 'C.UTF-8' },
    args: [
      ...(executablePath ? ['--headless=new'] : []),
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  const extensionPage = await context.newPage();
  const cdp = await context.newCDPSession(extensionPage);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  await extensionPage.goto(`chrome-extension://${extensionId}/options/options.html`);

  return {
    context,
    extensionPage,
    downloadDir,
    close: async () => {
      await context.close();
      fs.rmSync(work, { recursive: true, force: true });
    },
  };
}

/**
 * フローを保存して実行し、実行の履歴に結果が記録されるまで待ちます。
 * @param {import('playwright').Page} extensionPage
 * @param {Flow} flow
 * @returns {Promise<HistoryEntry>}
 */
export async function runFlow(extensionPage, flow) {
  const started = await extensionPage.evaluate(async (flow) => {
    await chrome.storage.local.remove('history');
    const stored = { id: 'e2e', createdAt: '', updatedAt: '', flow };
    await chrome.storage.local.set({ flows: { e2e: stored } });
    return chrome.runtime.sendMessage({
      kind: 'runner/start',
      flowId: 'e2e',
      params: {},
      secrets: {},
    });
  }, flow);
  if (!started?.ok) {
    throw new Error(`実行を開始できませんでした：${JSON.stringify(started)}`);
  }
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [entry] = await extensionPage.evaluate(async () => {
      const { history } = await chrome.storage.local.get('history');
      return Array.isArray(history) ? history : [];
    });
    if (entry) {
      return entry;
    }
    await extensionPage.waitForTimeout(500);
  }
  throw new Error('実行が時間内に終わりませんでした。');
}

/**
 * 条件を満たすまで繰り返し確かめます。
 * @template T
 * @param {() => Promise<T>} read 値を読み取る関数
 * @param {(value: T) => boolean} done 条件
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
export async function waitUntil(read, done, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value)) {
    if (Date.now() > deadline) {
      throw new Error(`時間内に条件を満たしませんでした：${JSON.stringify(value)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    value = await read();
  }
  return value;
}

/**
 * フォルダーの中のファイルを、そのフォルダーからの相対パス（区切りは /）で一覧にします。
 * @param {string} dir
 * @returns {string[]}
 */
export function listFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    )
    .sort();
}
