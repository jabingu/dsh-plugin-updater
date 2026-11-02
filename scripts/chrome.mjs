import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
export const delay = ms => new Promise(r => setTimeout(r, ms));
export async function startChrome(outputDirectory) {
  const executable = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  if (!executable) throw new Error('Set CHROME_PATH to an installed Chromium browser');
  const profile = resolve(outputDirectory, `chrome-profile-${Date.now()}`);
  const child = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port;
  for (let i = 0; i < 150; i++) {
    if (existsSync(profile + '/DevToolsActivePort')) { port = readFileSync(profile + '/DevToolsActivePort', 'utf8').split('\n')[0]; break; }
    await delay(100);
  }
  if (!port) { child.kill(); throw new Error('Browser debugging port unavailable'); }
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(); let id = 0;
  socket.onmessage = event => {
    const value = JSON.parse(event.data); const promise = pending.get(value.id);
    if (promise) { pending.delete(value.id); value.error ? promise.reject(value.error) : promise.resolve(value.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params }));
  });
  await send('Page.enable'); await send('Runtime.enable');
  return { send,
    async evaluate(expression) {
      const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
      return value.result.value;
    },
    async close() { try { await send('Browser.close'); } finally { socket.close(); child.kill(); } },
  };
}
