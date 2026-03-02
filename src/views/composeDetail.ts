import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";

export class ComposeDetailPanel {
  public static openPanels: Map<string, ComposeDetailPanel> = new Map();

  private readonly panel: vscode.WebviewPanel;
  private readonly serverManager: ServerManager;
  private readonly composeId: string;
  private disposables: vscode.Disposable[] = [];

  public static show(
    context: vscode.ExtensionContext,
    serverManager: ServerManager,
    composeId: string,
    composeName: string
  ) {
    const existing = ComposeDetailPanel.openPanels.get(composeId);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      existing.loadAndRender();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "dokploy.composeDetail",
      `Compose: ${composeName}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    new ComposeDetailPanel(panel, serverManager, composeId, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    serverManager: ServerManager,
    composeId: string,
    _context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.serverManager = serverManager;
    this.composeId = composeId;

    ComposeDetailPanel.openPanels.set(composeId, this);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.loadAndRender();
  }

  async loadAndRender() {
    const client = this.serverManager.getActiveClient();
    if (!client) {
      this.panel.webview.html = this.errorHtml("No Dokploy server connected.");
      return;
    }

    this.panel.webview.html = this.loadingHtml();

    try {
      const [compose, deployments] = await Promise.all([
        client.getCompose(this.composeId),
        client.getDeploymentsByCompose(this.composeId).catch(() => []),
      ]);

      this.panel.title = `Compose: ${compose.name}`;
      this.panel.webview.html = this.getHtml(compose, deployments);
    } catch (err: any) {
      this.panel.webview.html = this.errorHtml(err.message);
    }
  }

  private post(command: string, data: object = {}) {
    this.panel.webview.postMessage({ command, ...data });
  }

  private async handleMessage(msg: any) {
    const client = this.serverManager.getActiveClient();
    if (!client) return;

    switch (msg.command) {
      case "deploy": {
        try {
          await client.deployCompose(this.composeId);
          this.post("toast", { type: "success", text: "Deployment triggered!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "redeploy": {
        try {
          await client.redeployCompose(this.composeId);
          this.post("toast", { type: "success", text: "Redeploy triggered!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "start": {
        try {
          await client.startCompose(this.composeId);
          this.post("toast", { type: "success", text: "Compose started!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "stop": {
        try {
          await client.stopCompose(this.composeId);
          this.post("toast", { type: "success", text: "Compose stopped!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "saveEnv": {
        try {
          await client.saveComposeEnvironment(this.composeId, msg.env);
          this.post("toast", { type: "success", text: "Environment variables saved!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "saveComposeFile": {
        try {
          await client.saveComposeFile(this.composeId, msg.composeFile);
          this.post("toast", { type: "success", text: "Compose file saved!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "viewDeploymentLog": {
        const log = await client.getDeploymentLog(msg.deploymentId).catch(() => "Could not load log.");
        this.post("deploymentLog", { log, title: msg.title });
        break;
      }
    }
  }

  private dispose() {
    ComposeDetailPanel.openPanels.delete(this.composeId);
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private loadingHtml(): string {
    return `<!DOCTYPE html><html><body style="background:#1e1e1e;color:#ccc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center"><div style="font-size:32px;margin-bottom:12px">⚙️</div><div>Loading compose details…</div></div>
    </body></html>`;
  }

  private errorHtml(msg: string): string {
    return `<!DOCTYPE html><html><body style="background:#1e1e1e;color:#f48771;font-family:sans-serif;padding:32px">
      <h2>Error</h2><p>${this.esc(msg)}</p>
    </body></html>`;
  }

  private esc(s: string): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private statusBadge(status: string): string {
    const colors: Record<string, string> = {
      running: "#23d18b", done: "#23d18b", error: "#f48771", idle: "#858585", stopped: "#858585",
    };
    const color = colors[status?.toLowerCase()] || "#858585";
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;background:${color}22;color:${color};border:1px solid ${color}55;font-size:12px;font-weight:600">${this.esc(status || "unknown")}</span>`;
  }

  private getHtml(compose: any, deployments: any[]): string {
    const env = this.esc(compose.env || "");
    const composeFile = this.esc(compose.composeFile || "");

    const deploymentRows = deployments.map(d => `
      <tr>
        <td style="padding:8px 12px;color:#ccc">${this.esc(d.title || d.deploymentId)}</td>
        <td style="padding:8px 12px">${this.statusBadge(d.status)}</td>
        <td style="padding:8px 12px;color:#858585;font-size:12px">${this.esc(d.createdAt ? new Date(d.createdAt).toLocaleString() : "")}</td>
        <td style="padding:8px 12px">
          ${d.deploymentId ? `<button onclick="viewLog('${this.esc(d.deploymentId)}','${this.esc(d.title || d.deploymentId)}')" style="background:#2d2d30;border:1px solid #444;color:#ccc;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:12px">View Log</button>` : ""}
        </td>
      </tr>`).join("") || `<tr><td colspan="4" style="padding:16px;color:#666;text-align:center">No deployments yet</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Compose: ${this.esc(compose.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1e1e1e; color: #cccccc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; }
  .header { background: #252526; border-bottom: 1px solid #3e3e42; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 18px; font-weight: 600; color: #e8e8e8; }
  .tabs { display: flex; background: #252526; border-bottom: 1px solid #3e3e42; padding: 0 24px; }
  .tab { padding: 10px 16px; cursor: pointer; color: #858585; font-size: 13px; border-bottom: 2px solid transparent; transition: all .15s; user-select: none; }
  .tab:hover { color: #cccccc; }
  .tab.active { color: #ffffff; border-bottom-color: #007acc; }
  .tab-content { display: none; padding: 24px; }
  .tab-content.active { display: block; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
  button { padding: 7px 16px; border-radius: 4px; border: 1px solid #555; background: #2d2d30; color: #cccccc; cursor: pointer; font-size: 13px; transition: background .15s; }
  button:hover { background: #3e3e42; }
  button.primary { background: #0e639c; border-color: #1177bb; color: #fff; }
  button.primary:hover { background: #1177bb; }
  button.danger { background: #5a1d1d; border-color: #8c1b1b; color: #f48771; }
  button.danger:hover { background: #6e2020; }
  .field { margin-bottom: 16px; }
  .field label { display: block; margin-bottom: 6px; color: #9cdcfe; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
  .field .value { color: #e8e8e8; }
  .field .muted { color: #858585; font-style: italic; }
  textarea { width: 100%; background: #1a1a1a; border: 1px solid #3e3e42; color: #e8e8e8; padding: 10px; border-radius: 4px; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 13px; resize: vertical; outline: none; }
  textarea:focus { border-color: #007acc; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; color: #858585; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #3e3e42; }
  tr:hover td { background: #2a2a2a; }
  .section-title { font-size: 15px; font-weight: 600; color: #e8e8e8; margin-bottom: 16px; }
  .toast { position: fixed; bottom: 20px; right: 20px; padding: 10px 20px; border-radius: 6px; font-size: 13px; z-index: 9999; opacity: 0; transition: opacity .3s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.success { background: #1b4332; color: #23d18b; border: 1px solid #23d18b55; }
  .toast.error { background: #3b1515; color: #f48771; border: 1px solid #f4877155; }
  .log-overlay { display: none; position: fixed; inset: 0; background: #000a; z-index: 100; align-items: center; justify-content: center; }
  .log-overlay.open { display: flex; }
  .log-box { background: #1a1a1a; border: 1px solid #3e3e42; border-radius: 8px; width: 80vw; max-width: 900px; max-height: 80vh; display: flex; flex-direction: column; }
  .log-header { padding: 12px 16px; border-bottom: 1px solid #3e3e42; display: flex; justify-content: space-between; align-items: center; color: #e8e8e8; font-weight: 600; }
  .log-body { padding: 16px; overflow: auto; flex: 1; font-family: monospace; font-size: 12px; color: #ccc; white-space: pre-wrap; }
</style>
</head>
<body>

<div class="header">
  <span style="font-size:22px">⚙️</span>
  <div>
    <h1>${this.esc(compose.name)}</h1>
    <div style="margin-top:4px;display:flex;align-items:center;gap:8px">
      ${this.statusBadge(compose.composeStatus || compose.applicationStatus)}
      <span style="color:#858585;font-size:12px">${this.esc(compose.appName || "")}</span>
    </div>
  </div>
</div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('general')">General</div>
  <div class="tab" onclick="switchTab('compose-file')">Compose File</div>
  <div class="tab" onclick="switchTab('environment')">Environment</div>
  <div class="tab" onclick="switchTab('deployments')">Deployments</div>
</div>

<!-- General -->
<div id="tab-general" class="tab-content active">
  <div class="actions">
    <button class="primary" onclick="vscode('deploy')">Deploy</button>
    <button onclick="vscode('redeploy')">Redeploy</button>
    <button onclick="vscode('start')">Start</button>
    <button class="danger" onclick="vscode('stop')">Stop</button>
  </div>
  <div class="field"><label>Name</label><div class="value">${this.esc(compose.name)}</div></div>
  <div class="field"><label>App Name</label><div class="value">${this.esc(compose.appName || "—")}</div></div>
  <div class="field"><label>Description</label><div class="${compose.description ? "value" : "value muted"}">${this.esc(compose.description || "No description")}</div></div>
  <div class="field"><label>Status</label><div>${this.statusBadge(compose.composeStatus || compose.applicationStatus)}</div></div>
  <div class="field"><label>Source Type</label><div class="value">${this.esc(compose.sourceType || "—")}</div></div>
  <div class="field"><label>Compose ID</label><div class="value" style="color:#858585;font-size:12px;font-family:monospace">${this.esc(compose.composeId)}</div></div>
  <div class="field"><label>Created</label><div class="value">${compose.createdAt ? new Date(compose.createdAt).toLocaleString() : "—"}</div></div>
</div>

<!-- Compose File -->
<div id="tab-compose-file" class="tab-content">
  <div class="section-title">docker-compose.yml</div>
  <textarea id="compose-file-editor" rows="28" placeholder="# Compose file content will appear here">${composeFile}</textarea>
  <div style="margin-top:12px">
    <button class="primary" onclick="saveComposeFile()">Save Compose File</button>
  </div>
</div>

<!-- Environment -->
<div id="tab-environment" class="tab-content">
  <div class="section-title">Environment Variables</div>
  <textarea id="env-editor" rows="16" placeholder="KEY=value&#10;ANOTHER_KEY=another_value">${env}</textarea>
  <div style="margin-top:12px">
    <button class="primary" onclick="saveEnv()">Save Environment</button>
  </div>
</div>

<!-- Deployments -->
<div id="tab-deployments" class="tab-content">
  <div class="section-title">Deployment History</div>
  <table>
    <thead><tr>
      <th>Title</th>
      <th>Status</th>
      <th>Date</th>
      <th></th>
    </tr></thead>
    <tbody>${deploymentRows}</tbody>
  </table>
</div>

<!-- Log Overlay -->
<div id="log-overlay" class="log-overlay">
  <div class="log-box">
    <div class="log-header">
      <span id="log-title">Deployment Log</span>
      <button onclick="closeLog()" style="background:none;border:none;color:#858585;font-size:18px;cursor:pointer;padding:0 4px">✕</button>
    </div>
    <div id="log-body" class="log-body"></div>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
  const vscodeApi = acquireVsCodeApi();

  function vscode(command, extra) {
    vscodeApi.postMessage(Object.assign({ command }, extra || {}));
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t, i) => {
      const tabs = ['general', 'compose-file', 'environment', 'deployments'];
      t.classList.toggle('active', tabs[i] === name);
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
  }

  function saveEnv() {
    vscode('saveEnv', { env: document.getElementById('env-editor').value });
  }

  function saveComposeFile() {
    vscode('saveComposeFile', { composeFile: document.getElementById('compose-file-editor').value });
  }

  function viewLog(deploymentId, title) {
    document.getElementById('log-title').textContent = title || 'Deployment Log';
    document.getElementById('log-body').textContent = 'Loading…';
    document.getElementById('log-overlay').classList.add('open');
    vscode('viewDeploymentLog', { deploymentId, title });
  }

  function closeLog() {
    document.getElementById('log-overlay').classList.remove('open');
  }

  function showToast(type, text) {
    const el = document.getElementById('toast');
    el.className = 'toast ' + type;
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'toast') { showToast(msg.type, msg.text); }
    if (msg.command === 'deploymentLog') {
      document.getElementById('log-body').textContent = msg.log || '(empty log)';
    }
  });
</script>
</body>
</html>`;
  }
}
