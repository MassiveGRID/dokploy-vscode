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
      this.panel.webview.html = this.errorHtml("No MassiveGRID server connected.");
      return;
    }

    this.panel.webview.html = this.loadingHtml();

    try {
      const compose = await client.getCompose(this.composeId);
      const [deployments, domains] = await Promise.all([
        client.getDeploymentsByCompose(this.composeId).catch(() => []),
        client.getComposeDomains(this.composeId).catch(() => []),
      ]);

      this.panel.title = `Compose: ${compose.name}`;
      this.panel.webview.html = this.getHtml(compose, deployments, domains);
    } catch (err: any) {
      this.panel.webview.html = this.errorHtml(err.message);
    }
  }

  private post(command: string, payload: any = {}) {
    this.panel.webview.postMessage({ command, ...payload });
  }

  private async handleMessage(msg: any) {
    const client = this.serverManager.getActiveClient();
    if (!client) return;

    switch (msg.command) {
      // ── General ────────────────────────────────────────────────────
      case "saveGeneral": {
        try {
          await client.updateCompose(this.composeId, {
            name: msg.name,
            description: msg.description,
          });
          this.post("toast", { type: "success", text: "Saved!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
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

      // ── Compose File ───────────────────────────────────────────────
      case "saveComposeFile": {
        try {
          await client.saveComposeFile(this.composeId, msg.composeFile);
          this.post("toast", { type: "success", text: "Compose file saved!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Environment ────────────────────────────────────────────────
      case "saveEnv": {
        try {
          await client.saveComposeEnvironment(this.composeId, msg.env);
          this.post("toast", { type: "success", text: "Environment variables saved!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Deployments ────────────────────────────────────────────────
      case "viewLog": {
        try {
          const log = await client.getDeploymentLog(msg.deploymentId);
          if (!log) { this.post("toast", { type: "info", text: "No log content available." }); return; }
          const doc = await vscode.workspace.openTextDocument({ content: log, language: "log" });
          vscode.window.showTextDocument(doc, { preview: true });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "refreshDeployments": {
        const deps = await client.getDeploymentsByCompose(this.composeId).catch(() => []);
        this.post("deploymentsUpdate", { deployments: deps });
        break;
      }

      // ── Monitoring ─────────────────────────────────────────────────
      case "loadMonitoring": {
        try {
          const compose = await client.getCompose(this.composeId);
          const data = await client.getMonitoring(compose.appName);
          this.post("monitoringUpdate", { data });
        } catch (e: any) { this.post("monitoringUpdate", { data: null }); }
        break;
      }

      // ── Domains ────────────────────────────────────────────────────
      case "loadDomains": {
        try {
          const domains = await client.getComposeDomains(this.composeId);
          this.post("domainsUpdate", { domains });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "addDomain": {
        try {
          await client.createComposeDomain(
            this.composeId,
            msg.host,
            msg.port || 3000,
            msg.https === true,
            msg.serviceName || ""
          );
          this.post("toast", { type: "success", text: `Domain added: ${msg.host}` });
          const domains = await client.getComposeDomains(this.composeId).catch(() => []);
          this.post("domainsUpdate", { domains });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "generateDomain": {
        try {
          const composeData = await client.getCompose(this.composeId);
          const result = await client.generateDomain(composeData.appName);
          const host = typeof result === "string"
            ? result
            : (result?.domain || result?.host || result?.subdomain || "");
          if (!host) { throw new Error("Could not determine generated domain"); }
          await client.createComposeDomain(this.composeId, host, 3000, false, "");
          this.post("toast", { type: "success", text: `Domain added: ${host}` });
          const domains = await client.getComposeDomains(this.composeId).catch(() => []);
          this.post("domainsUpdate", { domains });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "deleteDomain": {
        const confirmDel = await vscode.window.showWarningMessage(
          "Delete this domain?", { modal: true }, "Delete");
        if (confirmDel !== "Delete") break;
        try {
          await client.deleteDomain(msg.domainId);
          this.post("toast", { type: "success", text: "Domain deleted." });
          const domains = await client.getComposeDomains(this.composeId).catch(() => []);
          this.post("domainsUpdate", { domains });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Advanced ───────────────────────────────────────────────────
      case "saveAdvanced": {
        try {
          await client.updateCompose(this.composeId, {
            composeType: msg.composeType || undefined,
          });
          this.post("toast", { type: "success", text: "Advanced settings saved!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Misc ───────────────────────────────────────────────────────
      case "openExternal":
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      case "refresh":
        this.loadAndRender();
        break;
    }
  }

  private getHtml(compose: any, deployments: any[], domains: any[]): string {
    const status = compose.composeStatus || compose.applicationStatus || "idle";
    const statusColor = status === "running" || status === "done" ? "#22c55e"
      : status === "error" ? "#ef4444" : "#6b7280";

    const deploymentsJson = JSON.stringify(deployments);
    const composeJson = JSON.stringify(compose);
    const domainsJson = JSON.stringify(domains);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #333);
    --accent: var(--vscode-textLink-foreground, #3b82f6);
    --card: var(--vscode-editorWidget-background, #1e1e1e);
    --muted: var(--vscode-descriptionForeground, #888);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #ccc);
    --input-border: var(--vscode-input-border, #555);
    --btn-bg: var(--vscode-button-background, #3b82f6);
    --btn-fg: var(--vscode-button-foreground, #fff);
    --btn-secondary: var(--vscode-button-secondaryBackground, #444);
    --btn-secondary-fg: var(--vscode-button-secondaryForeground, #ccc);
    --danger: #ef4444;
    --success: #22c55e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, system-ui); background: var(--bg); color: var(--fg); height: 100vh; display: flex; flex-direction: column; }

  .app-header { padding: 16px 20px 0; background: var(--card); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .app-header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .app-title { font-size: 18px; font-weight: 600; }
  .status-badge { padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; background: ${statusColor}22; color: ${statusColor}; border: 1px solid ${statusColor}44; }
  .header-actions { margin-left: auto; display: flex; gap: 8px; }

  .tabs { display: flex; gap: 0; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { padding: 8px 16px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; color: var(--muted); background: none; border-top: none; border-left: none; border-right: none; transition: color 0.15s, border-color 0.15s; }
  .tab:hover { color: var(--fg); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  .content { flex: 1; overflow-y: auto; padding: 20px; }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }

  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--fg); }

  .form-row { margin-bottom: 12px; }
  .form-row label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .form-row input, .form-row select, .form-row textarea { width: 100%; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; padding: 6px 10px; font-size: 13px; font-family: inherit; outline: none; }
  .form-row input:focus, .form-row select:focus, .form-row textarea:focus { border-color: var(--accent); }
  .form-row textarea { resize: vertical; min-height: 120px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  button { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; font-family: inherit; transition: opacity 0.15s; }
  button:hover { opacity: 0.85; }
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary { background: var(--btn-secondary); color: var(--btn-secondary-fg); }
  button.danger { background: var(--danger); color: #fff; }
  button.success { background: var(--success); color: #fff; }
  button.small { padding: 5px 12px; font-size: 13px; }
  .btn-row { display: flex; gap: 8px; margin-top: 12px; align-items: center; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.03); }
  .td-actions { display: flex; gap: 6px; }

  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot-green { background: #22c55e; }
  .dot-red { background: #ef4444; }
  .dot-gray { background: #6b7280; }
  .dot-yellow { background: #f59e0b; }

  .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .info-item .info-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .info-item .info-val { font-size: 13px; margin-top: 2px; }
  code { background: var(--input-bg); padding: 2px 6px; border-radius: 3px; font-size: 12px; font-family: monospace; }

  #toast { position: fixed; bottom: 20px; right: 20px; padding: 10px 16px; border-radius: 6px; font-size: 13px; z-index: 9999; opacity: 0; transition: opacity 0.3s; pointer-events: none; max-width: 320px; }
  #toast.show { opacity: 1; }
  #toast.success { background: #166534; color: #86efac; border: 1px solid #22c55e44; }
  #toast.error { background: #7f1d1d; color: #fca5a5; border: 1px solid #ef444444; }
  #toast.info { background: #1e3a5f; color: #93c5fd; border: 1px solid #3b82f644; }

  .empty { text-align: center; padding: 32px; color: var(--muted); }
  .empty-icon { font-size: 32px; margin-bottom: 8px; }
</style>
</head>
<body>

<div class="app-header">
  <div class="app-header-top">
    <div class="app-title">${esc(compose.name)}</div>
    <span class="status-badge">${esc(status)}</span>
    <span style="color:var(--muted);font-size:12px;margin-left:4px;">${esc(compose.appName || "")}</span>
    <div class="header-actions">
      <button onclick="send('deploy')" class="success">▶ Deploy</button>
      <button onclick="send('redeploy')" class="secondary"><span style="font-size:11px">↻</span> Redeploy</button>
      ${status === "running" || status === "done"
        ? `<button onclick="send('stop')" class="danger">⏹ Stop</button>`
        : `<button onclick="send('start')">▶ Start</button>`}
      <button onclick="send('refresh')" class="secondary"><span style="font-size:11px">↻</span> Refresh</button>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="switchTab('general')">General</button>
    <button class="tab" onclick="switchTab('compose-file')">Compose File</button>
    <button class="tab" onclick="switchTab('environment')">Environment</button>
    <button class="tab" onclick="switchTab('domains')">Domains</button>
    <button class="tab" onclick="switchTab('deployments')">Deployments</button>
    <button class="tab" onclick="switchTab('logs')">Logs</button>
    <button class="tab" onclick="switchTab('monitoring')">Monitoring</button>
    <button class="tab" onclick="switchTab('advanced')">Advanced</button>
  </div>
</div>

<div class="content">

  <!-- ── General ──────────────────────────────────────────────── -->
  <div id="tab-general" class="tab-pane active">
    <div class="card">
      <div class="card-title">Compose Info</div>
      <div class="info-grid" style="margin-bottom:16px;">
        <div class="info-item">
          <div class="info-label">Compose ID</div>
          <div class="info-val"><code>${esc(compose.composeId)}</code></div>
        </div>
        <div class="info-item">
          <div class="info-label">App Name</div>
          <div class="info-val"><code>${esc(compose.appName || "—")}</code></div>
        </div>
        <div class="info-item">
          <div class="info-label">Source Type</div>
          <div class="info-val"><code>${esc(compose.sourceType || "—")}</code></div>
        </div>
        <div class="info-item">
          <div class="info-label">Compose Type</div>
          <div class="info-val"><code>${esc(compose.composeType || "docker-compose")}</code></div>
        </div>
        <div class="info-item">
          <div class="info-label">Status</div>
          <div class="info-val">
            <span class="dot ${statusClass(status)}"></span>${esc(status)}
          </div>
        </div>
        ${compose.repository ? `<div class="info-item">
          <div class="info-label">Repository</div>
          <div class="info-val" style="word-break:break-all;">${esc(compose.repository)}</div>
        </div>` : ""}
        ${compose.branch ? `<div class="info-item">
          <div class="info-label">Branch</div>
          <div class="info-val"><code>${esc(compose.branch)}</code></div>
        </div>` : ""}
        <div class="info-item">
          <div class="info-label">Created</div>
          <div class="info-val">${compose.createdAt ? new Date(compose.createdAt).toLocaleString() : "—"}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Edit Details</div>
      <div class="form-row">
        <label>Name</label>
        <input id="g-name" value="${esc(compose.name)}">
      </div>
      <div class="form-row">
        <label>Description</label>
        <input id="g-desc" value="${esc(compose.description || "")}">
      </div>
      <div class="btn-row">
        <button onclick="saveGeneral()">Save</button>
      </div>
    </div>
  </div>

  <!-- ── Compose File ──────────────────────────────────────────── -->
  <div id="tab-compose-file" class="tab-pane">
    <div class="card">
      <div class="card-title">docker-compose.yml</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">
        Edit your compose file directly. Changes are applied on next deploy.
      </p>
      <div class="form-row">
        <textarea id="compose-file-content" style="min-height:420px;">${esc(compose.composeFile || "")}</textarea>
      </div>
      <div class="btn-row">
        <button onclick="saveComposeFile()">Save Compose File</button>
      </div>
    </div>
  </div>

  <!-- ── Environment ──────────────────────────────────────────── -->
  <div id="tab-environment" class="tab-pane">
    <div class="card">
      <div class="card-title">Environment Variables</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">
        One variable per line in <code>KEY=VALUE</code> format.
        Lines starting with <code>#</code> are comments.
      </p>
      <div class="form-row">
        <textarea id="env-content" style="min-height:300px;">${esc(compose.env || "")}</textarea>
      </div>
      <div class="btn-row">
        <button onclick="saveEnv()">Save Environment</button>
        <button class="secondary" onclick="formatEnv()">Format</button>
      </div>
    </div>
  </div>

  <!-- ── Domains ──────────────────────────────────────────────── -->
  <div id="tab-domains" class="tab-pane">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="card-title" style="margin:0">Domains</div>
        <div style="display:flex;gap:8px;">
          <button class="secondary" onclick="send('generateDomain')">⚡ Generate Auto Domain</button>
          <button class="secondary" onclick="send('loadDomains')"><span style="font-size:11px">↻</span> Refresh</button>
        </div>
      </div>
      <div id="domains-list">${renderDomains(JSON.parse(domainsJson))}</div>
    </div>

    <div class="card">
      <div class="card-title">Add Domain</div>
      <div class="form-grid">
        <div class="form-row">
          <label>Host</label>
          <input id="d-host" placeholder="example.com">
        </div>
        <div class="form-row">
          <label>Service Name</label>
          <input id="d-service" placeholder="web (service in compose file)">
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label>Port</label>
          <input id="d-port" type="number" value="3000" min="1" max="65535">
        </div>
        <div class="form-row">
          <label>HTTPS</label>
          <select id="d-https">
            <option value="false">No</option>
            <option value="true">Yes (Let's Encrypt)</option>
          </select>
        </div>
      </div>
      <div class="btn-row">
        <button onclick="addDomain()">Add Domain</button>
      </div>
    </div>
  </div>

  <!-- ── Deployments ──────────────────────────────────────────── -->
  <div id="tab-deployments" class="tab-pane">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="card-title" style="margin:0">Deployment History</div>
        <button class="secondary" onclick="send('refreshDeployments')"><span style="font-size:11px">↻</span> Refresh</button>
      </div>
      <div id="deployments-list">${renderDeployments(JSON.parse(deploymentsJson))}</div>
    </div>
  </div>

  <!-- ── Logs ──────────────────────────────────────────────────── -->
  <div id="tab-logs" class="tab-pane">
    <div class="card">
      <div class="card-title">Deployment Logs</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">Select a deployment to view its full build/run log.</p>
      <div id="dep-log-list">${renderDeploymentLogList(JSON.parse(deploymentsJson))}</div>
    </div>
  </div>

  <!-- ── Monitoring ────────────────────────────────────────────── -->
  <div id="tab-monitoring" class="tab-pane">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="font-size:15px;">Resource Monitoring</h3>
      <button class="secondary" onclick="loadMonitoring()"><span style="font-size:11px">↻</span> Refresh</button>
    </div>
    <div id="monitoring-content">
      <div class="empty"><div class="empty-icon">📊</div>Click "Refresh" to load monitoring data</div>
    </div>
  </div>

  <!-- ── Advanced ──────────────────────────────────────────────── -->
  <div id="tab-advanced" class="tab-pane">
    <div class="card">
      <div class="card-title">Compose Settings</div>
      <div class="form-row">
        <label>Compose Type</label>
        <select id="adv-composeType">
          <option value="docker-compose" ${compose.composeType === "docker-compose" ? "selected" : ""}>docker-compose</option>
          <option value="stack" ${compose.composeType === "stack" ? "selected" : ""}>stack (Docker Swarm)</option>
        </select>
      </div>
      <div class="btn-row">
        <button onclick="saveAdvanced()">Save Advanced Settings</button>
      </div>
    </div>

    <div class="card" style="background: rgba(59,130,246,0.05); border-color: rgba(59,130,246,0.2);">
      <div class="card-title">ℹ Compose ID</div>
      <p style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:8px;">
        Use this ID when referencing this service via the MassiveGRID API.
      </p>
      <code style="display:block;padding:8px;border-radius:4px;">${esc(compose.composeId)}</code>
    </div>
  </div>

</div><!-- /content -->

<div id="toast"></div>

<script>
const vscode = acquireVsCodeApi();
const compose = ${composeJson};

function send(command, extra = {}) {
  vscode.postMessage({ command, ...extra });
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(text, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.className = 'show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 3500);
}

// ── Tab switching ─────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const pane = document.getElementById('tab-' + name);
  if (pane) pane.classList.add('active');
  const tabs = document.querySelectorAll('.tab');
  const labels = { 'general':0,'compose-file':1,'environment':2,'domains':3,'deployments':4,'logs':5,'monitoring':6,'advanced':7 };
  const idx = labels[name];
  if (idx !== undefined && tabs[idx]) tabs[idx].classList.add('active');
}

// ── General ───────────────────────────────────────────────────────
function saveGeneral() {
  send('saveGeneral', {
    name: document.getElementById('g-name').value,
    description: document.getElementById('g-desc').value
  });
}

// ── Compose File ──────────────────────────────────────────────────
function saveComposeFile() {
  send('saveComposeFile', { composeFile: document.getElementById('compose-file-content').value });
}

// ── Environment ───────────────────────────────────────────────────
function saveEnv() {
  send('saveEnv', { env: document.getElementById('env-content').value });
}
function formatEnv() {
  const ta = document.getElementById('env-content');
  const lines = ta.value.split('\\n').map(l => l.trim()).filter(l => l);
  ta.value = lines.join('\\n');
}

// ── Domains ───────────────────────────────────────────────────────
function addDomain() {
  const host = document.getElementById('d-host').value.trim();
  if (!host) { showToast('Host is required', 'error'); return; }
  send('addDomain', {
    host,
    serviceName: document.getElementById('d-service').value.trim(),
    port: parseInt(document.getElementById('d-port').value) || 3000,
    https: document.getElementById('d-https').value === 'true',
  });
  document.getElementById('d-host').value = '';
  document.getElementById('d-service').value = '';
}

function renderDomainsJS(doms) {
  if (!doms || !doms.length) return '<div class="empty"><div class="empty-icon">🌐</div>No domains configured yet</div>';
  return \`<table>
    <thead><tr><th>Host</th><th>Service</th><th>Port</th><th>HTTPS</th><th>Actions</th></tr></thead>
    <tbody>\${doms.map(d => {
      const id = d.domainId || d.id || '';
      return \`<tr>
        <td style="word-break:break-all;">\${esc(d.host)}</td>
        <td><code>\${esc(d.serviceName || '—')}</code></td>
        <td>\${esc(String(d.port || '—'))}</td>
        <td>\${d.https ? '<span style="color:#22c55e;">✓ Yes</span>' : '<span style="color:var(--muted);">No</span>'}</td>
        <td class="td-actions">
          \${d.host ? \`<button class="secondary small" onclick="send('openExternal',{url:'\${d.https?'https':'http'}://\${esc(d.host)}'})">🔗 Open</button>\` : ''}
          <button class="danger small" onclick="send('deleteDomain',{domainId:'\${esc(id)}'})">Delete</button>
        </td>
      </tr>\`;
    }).join('')}</tbody>
  </table>\`;
}

// ── Monitoring ────────────────────────────────────────────────────
function loadMonitoring() { send('loadMonitoring'); }

function parseCpuValue(item) {
  if (item == null) return null;
  if (typeof item === 'number') return item;
  if (typeof item === 'object' && item.value != null) {
    return parseFloat(String(item.value).replace('%', ''));
  }
  return parseFloat(String(item));
}
function parseMemValue(item) {
  if (item == null) return null;
  if (typeof item === 'object' && item.value != null) {
    const v = item.value;
    if (typeof v === 'object') return { used: v.used || '?', total: v.total || null };
    return { used: String(v), total: null };
  }
  if (typeof item === 'number') return { used: item.toFixed(1) + ' MB', total: null };
  return { used: String(item), total: null };
}
function memToNum(s) {
  if (!s) return 0;
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  const u = s.replace(/[0-9. ]/g, '').toLowerCase();
  if (u.startsWith('g')) return n * 1024;
  if (u.startsWith('t')) return n * 1024 * 1024;
  return n;
}
function renderMonitoring(data) {
  const el = document.getElementById('monitoring-content');
  if (!data) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📊</div>No monitoring data available. Ensure the compose service is running.</div>';
    return;
  }
  const cpu = Array.isArray(data.cpu) ? data.cpu : (data.cpuUsage || []);
  const mem = Array.isArray(data.memory) ? data.memory : (data.memoryUsage || []);
  const latestCpuItem = cpu.length ? cpu[cpu.length - 1] : null;
  const latestMemItem = mem.length ? mem[mem.length - 1] : null;
  const cpuVal = parseCpuValue(latestCpuItem);
  const memVal = parseMemValue(latestMemItem);
  const cpuDisplay = (cpuVal != null && !isNaN(cpuVal)) ? cpuVal.toFixed(2) + '%' : (latestCpuItem ? String(latestCpuItem.value || latestCpuItem) : 'No data');
  const memDisplay = memVal ? (memVal.total ? (memVal.used + ' / ' + memVal.total) : memVal.used) : 'No data';
  const lastTime = (latestCpuItem && latestCpuItem.time) ? latestCpuItem.time : (latestMemItem && latestMemItem.time ? latestMemItem.time : null);
  el.innerHTML = \`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
      <div class="card" style="margin:0;">
        <div class="card-title">CPU Usage</div>
        <div style="font-size:32px;font-weight:700;color:#3b82f6;margin-bottom:4px;">\${esc(cpuDisplay)}</div>
        <div style="font-size:12px;color:var(--muted);">\${cpu.length} samples</div>
        \${renderMiniChart(cpu, '#3b82f6', 'cpu')}
      </div>
      <div class="card" style="margin:0;">
        <div class="card-title">Memory Usage</div>
        <div style="font-size:26px;font-weight:700;color:#8b5cf6;margin-bottom:4px;">\${esc(memDisplay)}</div>
        <div style="font-size:12px;color:var(--muted);">\${mem.length} samples</div>
        \${renderMiniChart(mem, '#8b5cf6', 'mem')}
      </div>
    </div>
    \${lastTime ? '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Last updated: ' + new Date(lastTime).toLocaleString() + '</div>' : ''}
  \`;
}
function renderMiniChart(values, color, type) {
  if (!values || !values.length) return '';
  let nums;
  if (type === 'cpu') {
    nums = values.map(function(v) { const n = parseCpuValue(v); return (n != null && !isNaN(n)) ? n : 0; });
  } else {
    nums = values.map(function(v) { const m = parseMemValue(v); return m ? memToNum(m.used) : 0; });
  }
  const max = Math.max.apply(null, nums.concat([0.001]));
  const bars = nums.slice(-24).map(function(v) {
    const h = Math.max(2, Math.round((v / max) * 44));
    return \`<div style="flex:1;height:\${h}px;background:\${color};border-radius:2px 2px 0 0;opacity:0.75;min-width:4px;max-width:10px;"></div>\`;
  }).join('');
  return \`<div style="display:flex;align-items:flex-end;gap:2px;height:48px;margin-top:10px;">\${bars}</div>\`;
}

// ── Advanced ──────────────────────────────────────────────────────
function saveAdvanced() {
  send('saveAdvanced', {
    composeType: document.getElementById('adv-composeType').value,
  });
}

// ── Message handler ────────────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  switch (msg.command) {
    case 'toast':
      showToast(msg.text, msg.type);
      break;
    case 'deploymentsUpdate':
      document.getElementById('deployments-list').innerHTML = renderDeploymentsJS(msg.deployments);
      document.getElementById('dep-log-list').innerHTML = renderDepLogListJS(msg.deployments);
      break;
    case 'domainsUpdate':
      document.getElementById('domains-list').innerHTML = renderDomainsJS(msg.domains);
      break;
    case 'monitoringUpdate':
      renderMonitoring(msg.data);
      break;
  }
});

// ── Render helpers ────────────────────────────────────────────────

function statusDot(s) {
  const c = (s === 'running' || s === 'done') ? 'dot-green' : s === 'error' ? 'dot-red' : s === 'queued' ? 'dot-yellow' : 'dot-gray';
  return \`<span class="dot \${c}"></span>\`;
}

function renderDeploymentsJS(deps) {
  if (!deps || !deps.length) return '<div class="empty"><div class="empty-icon">🚀</div>No deployments yet</div>';
  return \`<table>
    <thead><tr><th>Status</th><th>Title</th><th>Date</th><th>Actions</th></tr></thead>
    <tbody>\${deps.slice(0,30).map(d => \`<tr>
      <td>\${statusDot(d.status)}\${esc(d.status)}</td>
      <td>\${esc(d.title || 'Deployment')}</td>
      <td style="color:var(--muted);font-size:12px;">\${new Date(d.createdAt).toLocaleString()}</td>
      <td><button class="secondary small" onclick="send('viewLog',{deploymentId:'\${esc(d.deploymentId)}'})">📋 Log</button></td>
    </tr>\`).join('')}</tbody>
  </table>\`;
}

function renderDepLogListJS(deps) {
  if (!deps || !deps.length) return '<div style="color:var(--muted);font-size:13px;">No deployments yet.</div>';
  return deps.slice(0,10).map(d => \`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
      <span>\${statusDot(d.status)}\${esc(d.title||'Deployment')} <span style="color:var(--muted);font-size:12px;">\${new Date(d.createdAt).toLocaleString()}</span></span>
      <button class="secondary small" onclick="send('viewLog',{deploymentId:'\${esc(d.deploymentId)}'})">View Log</button>
    </div>\`).join('');
}
</script>
</body>
</html>`;

    // ── Server-side render helpers ─────────────────────────────────

    function esc(s: any): string {
      if (s == null) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function statusClass(s: string): string {
      if (s === "running" || s === "done") return "dot-green";
      if (s === "error") return "dot-red";
      if (s === "queued") return "dot-yellow";
      return "dot-gray";
    }

    function renderDomains(doms: any[]): string {
      if (!doms.length) return `<div class="empty"><div class="empty-icon">🌐</div>No domains configured yet</div>`;
      return `<table>
        <thead><tr><th>Host</th><th>Service</th><th>Port</th><th>HTTPS</th><th>Actions</th></tr></thead>
        <tbody>${doms.map(d => {
          const id = d.domainId || d.id || "";
          return `<tr>
            <td style="word-break:break-all;">${esc(d.host)}</td>
            <td><code>${esc(d.serviceName || "—")}</code></td>
            <td>${esc(String(d.port || "—"))}</td>
            <td>${d.https ? '<span style="color:#22c55e;">✓ Yes</span>' : '<span style="color:var(--muted);">No</span>'}</td>
            <td class="td-actions">
              ${d.host ? `<button class="secondary small" onclick="send('openExternal',{url:'${d.https ? "https" : "http"}://${esc(d.host)}'})">🔗 Open</button>` : ""}
              <button class="danger small" onclick="send('deleteDomain',{domainId:'${esc(id)}'})">Delete</button>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    }

    function renderDeployments(deps: any[]): string {
      if (!deps.length) return `<div class="empty"><div class="empty-icon">🚀</div>No deployments yet</div>`;
      return `<table>
        <thead><tr><th>Status</th><th>Title</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${deps.slice(0, 30).map(d => {
          const dot = `<span class="dot ${statusClass(d.status)}"></span>`;
          return `<tr>
            <td>${dot}${esc(d.status)}</td>
            <td>${esc(d.title || "Deployment")}</td>
            <td style="color:var(--muted);font-size:12px;">${new Date(d.createdAt).toLocaleString()}</td>
            <td><button class="secondary small" onclick="send('viewLog',{deploymentId:'${esc(d.deploymentId)}'})">📋 Log</button></td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    }

    function renderDeploymentLogList(deps: any[]): string {
      if (!deps.length) return `<div style="color:var(--muted);font-size:13px;">No deployments yet.</div>`;
      return deps.slice(0, 10).map(d => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span><span class="dot ${statusClass(d.status)}"></span>${esc(d.title || "Deployment")} <span style="color:var(--muted);font-size:12px;">${new Date(d.createdAt).toLocaleString()}</span></span>
          <button class="secondary small" onclick="send('viewLog',{deploymentId:'${esc(d.deploymentId)}'})">View Log</button>
        </div>`).join("");
    }
  }

  private loadingHtml(): string {
    return `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);">
      <div style="text-align:center;">
        <div style="font-size:24px;margin-bottom:8px;">⟳</div>
        <div>Loading compose details…</div>
      </div>
    </body></html>`;
  }

  private errorHtml(message: string): string {
    return `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);">
      <div style="text-align:center;">
        <div style="font-size:24px;margin-bottom:8px;">⚠</div>
        <div style="color:#ef4444;">${message}</div>
        <button onclick="acquireVsCodeApi().postMessage({command:'refresh'})" style="margin-top:12px;padding:6px 14px;cursor:pointer;">Retry</button>
      </div>
    </body></html>`;
  }

  dispose() {
    ComposeDetailPanel.openPanels.delete(this.composeId);
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

