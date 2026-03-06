import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";

export class AppDetailPanel {
  public static openPanels: Map<string, AppDetailPanel> = new Map();

  private readonly panel: vscode.WebviewPanel;
  private readonly serverManager: ServerManager;
  private readonly applicationId: string;
  private disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  public static show(
    context: vscode.ExtensionContext,
    serverManager: ServerManager,
    applicationId: string,
    appName: string
  ) {
    const existing = AppDetailPanel.openPanels.get(applicationId);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      existing.loadAndRender();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "dokploy.appDetail",
      `App: ${appName}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    new AppDetailPanel(panel, serverManager, applicationId, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    serverManager: ServerManager,
    applicationId: string,
    _context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.serverManager = serverManager;
    this.applicationId = applicationId;

    AppDetailPanel.openPanels.set(applicationId, this);

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
      const [app, domains, deployments] = await Promise.all([
        client.getApplication(this.applicationId),
        client.getDomains(this.applicationId).catch(() => []),
        client.getDeployments(this.applicationId).catch(() => []),
      ]);

      this.panel.title = `App: ${app.name}`;
      this.panel.webview.html = this.getHtml(app, domains, deployments);
    } catch (err: any) {
      this.panel.webview.html = this.errorHtml(err.message);
    }
  }

  private async handleMessage(msg: any) {
    const client = this.serverManager.getActiveClient();
    if (!client) return;

    switch (msg.command) {
      // ── General ────────────────────────────────────────────────────
      case "saveGeneral": {
        try {
          await client.updateApplication(this.applicationId, {
            name: msg.name,
            description: msg.description,
          });
          this.post("toast", { type: "success", text: "Saved!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "saveBuildConfig": {
        try {
          await client.updateApplication(this.applicationId, {
            buildType: msg.buildType,
            dockerfile: msg.dockerfile,
            dockerContextPath: msg.dockerContextPath,
            publishDirectory: msg.publishDirectory,
            command: msg.command,
          });
          this.post("toast", { type: "success", text: "Build config saved!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "deploy": {
        try {
          await client.deploy(this.applicationId);
          this.post("toast", { type: "success", text: "Deployment triggered!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "redeploy": {
        try {
          await client.redeploy(this.applicationId);
          this.post("toast", { type: "success", text: "Redeploy triggered!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "start": {
        try {
          await client.startApplication(this.applicationId);
          this.post("toast", { type: "success", text: "Application started!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "stop": {
        try {
          await client.stopApplication(this.applicationId);
          this.post("toast", { type: "success", text: "Application stopped!" });
          this.loadAndRender();
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Environment ────────────────────────────────────────────────
      case "saveEnv": {
        try {
          await client.saveEnvironment(this.applicationId, msg.env);
          this.post("toast", { type: "success", text: "Environment variables saved!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Domains ────────────────────────────────────────────────────
      case "addDomain": {
        try {
          await client.createDomain(this.applicationId, msg.host, msg.port, msg.https);
          this.post("toast", { type: "success", text: `Domain ${msg.host} added!` });
          const domains = await client.getDomains(this.applicationId).catch(() => []);
          this.post("domainsUpdate", { domains });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "deleteDomain": {
        const confirmDomain = await vscode.window.showWarningMessage(
          "Delete this domain?", { modal: true }, "Delete");
        if (confirmDomain !== "Delete") break;
        try {
          await client.deleteDomain(msg.domainId);
          this.post("toast", { type: "success", text: "Domain deleted!" });
          const domains = await client.getDomains(this.applicationId).catch(() => []);
          this.post("domainsUpdate", { domains });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "generateDomain": {
        try {
          const appData = await client.getApplication(this.applicationId);
          const result = await client.generateDomain(appData.appName);
          // generateDomain only suggests a hostname — we must create it separately
          const host = typeof result === "string"
            ? result
            : (result?.domain || result?.host || result?.subdomain || "");
          if (!host) { throw new Error("Could not determine generated domain"); }
          // traefik.me domains don't use HTTPS/letsencrypt
          await client.createDomain(this.applicationId, host, 3000, false);
          this.post("toast", { type: "success", text: `Domain added: ${host}` });
          const domains = await client.getDomains(this.applicationId).catch(() => []);
          this.post("domainsUpdate", { domains });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Deployments ────────────────────────────────────────────────
      case "cancelDeployment": {
        try {
          await client.cancelDeployment(this.applicationId);
          this.post("toast", { type: "success", text: "Deployment cancelled!" });
          const deps = await client.getDeployments(this.applicationId).catch(() => []);
          this.post("deploymentsUpdate", { deployments: deps });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
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
        const deps = await client.getDeployments(this.applicationId).catch(() => []);
        this.post("deploymentsUpdate", { deployments: deps });
        break;
      }

      // ── Preview Deployments ────────────────────────────────────────
      case "savePreviewConfig": {
        try {
          await client.updateApplication(this.applicationId, {
            isPreviewDeploymentsActive: msg.enabled,
            previewWildcard: msg.wildcard,
            previewPort: msg.port ? Number(msg.port) : undefined,
            previewHttps: msg.https,
            previewCertificateType: msg.certificateType,
            previewLimit: msg.limit ? Number(msg.limit) : undefined,
          });
          this.post("toast", { type: "success", text: "Preview deployments config saved!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "deletePreview": {
        const confirmPreview = await vscode.window.showWarningMessage(
          "Delete this preview deployment?", { modal: true }, "Delete");
        if (confirmPreview !== "Delete") break;
        try {
          await client.deletePreviewDeployment(msg.previewDeploymentId);
          this.post("toast", { type: "success", text: "Preview deployment deleted!" });
          const previews = await client.getPreviewDeployments(this.applicationId).catch(() => []);
          this.post("previewsUpdate", { previews });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "redeployPreview": {
        try {
          await client.redeployPreviewDeployment(msg.previewDeploymentId);
          this.post("toast", { type: "success", text: "Preview redeploy triggered!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "loadPreviews": {
        const previews = await client.getPreviewDeployments(this.applicationId).catch(() => []);
        this.post("previewsUpdate", { previews });
        break;
      }

      // ── Schedules ──────────────────────────────────────────────────
      case "loadSchedules": {
        const schedules = await client.getSchedules(this.applicationId).catch(() => []);
        this.post("schedulesUpdate", { schedules });
        break;
      }
      case "addSchedule": {
        try {
          await client.createSchedule({
            applicationId: this.applicationId,
            cronExpression: msg.cronExpression,
            scheduleName: msg.scheduleName,
            command: msg.command,
            timezone: msg.timezone,
            enabled: true,
          });
          this.post("toast", { type: "success", text: "Schedule created!" });
          const schedules = await client.getSchedules(this.applicationId).catch(() => []);
          this.post("schedulesUpdate", { schedules });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "deleteSchedule": {
        const confirmSchedule = await vscode.window.showWarningMessage(
          "Delete this schedule?", { modal: true }, "Delete");
        if (confirmSchedule !== "Delete") break;
        try {
          await client.deleteSchedule(msg.scheduleId);
          this.post("toast", { type: "success", text: "Schedule deleted!" });
          const schedules = await client.getSchedules(this.applicationId).catch(() => []);
          this.post("schedulesUpdate", { schedules });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "runSchedule": {
        try {
          await client.runSchedule(msg.scheduleId);
          this.post("toast", { type: "success", text: "Schedule triggered!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Backups ────────────────────────────────────────────────────
      case "loadBackups": {
        const backups = await client.getBackups("application", this.applicationId).catch(() => []);
        const destinations = await client.getBackupDestinations().catch(() => []);
        this.post("backupsUpdate", { backups, destinations });
        break;
      }
      case "runBackup": {
        try {
          await client.runBackup(msg.backupId);
          this.post("toast", { type: "success", text: "Backup triggered!" });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }
      case "deleteBackup": {
        const confirmBackup = await vscode.window.showWarningMessage(
          "Delete this backup configuration?", { modal: true }, "Delete");
        if (confirmBackup !== "Delete") break;
        try {
          await client.deleteBackup(msg.backupId);
          this.post("toast", { type: "success", text: "Backup deleted!" });
          const backups = await client.getBackups("application", this.applicationId).catch(() => []);
          const destinations = await client.getBackupDestinations().catch(() => []);
          this.post("backupsUpdate", { backups, destinations });
        } catch (e: any) { this.post("toast", { type: "error", text: e.message }); }
        break;
      }

      // ── Monitoring ─────────────────────────────────────────────────
      case "loadMonitoring": {
        try {
          const app = await client.getApplication(this.applicationId);
          const data = await client.getMonitoring(app.appName);
          this.post("monitoringUpdate", { data });
        } catch (e: any) { this.post("monitoringUpdate", { data: null }); }
        break;
      }

      // ── Advanced ───────────────────────────────────────────────────
      case "saveAdvanced": {
        try {
          await client.updateApplication(this.applicationId, {
            memoryLimit: msg.memoryLimit || undefined,
            memoryReservation: msg.memoryReservation || undefined,
            cpuLimit: msg.cpuLimit || undefined,
            cpuReservation: msg.cpuReservation || undefined,
            replicas: msg.replicas ? Number(msg.replicas) : undefined,
            command: msg.command || undefined,
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

  private post(command: string, payload: any = {}) {
    this.panel.webview.postMessage({ command, ...payload });
  }

  private getHtml(app: any, domains: any[], deployments: any[]): string {
    const status = app.applicationStatus || "idle";
    const statusColor = status === "running" || status === "done" ? "#22c55e"
      : status === "error" ? "#ef4444" : "#6b7280";

    const domainsJson = JSON.stringify(domains);
    const deploymentsJson = JSON.stringify(deployments);
    const appJson = JSON.stringify(app);

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

  /* Header */
  .app-header {
    padding: 16px 20px 0;
    background: var(--card);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .app-header-top {
    display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
  }
  .app-title { font-size: 18px; font-weight: 600; }
  .status-badge {
    padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;
    background: ${statusColor}22; color: ${statusColor}; border: 1px solid ${statusColor}44;
  }
  .header-actions { margin-left: auto; display: flex; gap: 8px; }

  /* Tabs */
  .tabs { display: flex; gap: 0; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    padding: 8px 16px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent;
    white-space: nowrap; color: var(--muted); background: none; border-top: none; border-left: none; border-right: none;
    transition: color 0.15s, border-color 0.15s;
  }
  .tab:hover { color: var(--fg); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  /* Content */
  .content { flex: 1; overflow-y: auto; padding: 20px; }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }

  /* Cards */
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 16px; margin-bottom: 16px;
  }
  .card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--fg); }

  /* Form */
  .form-row { margin-bottom: 12px; }
  .form-row label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .form-row input, .form-row select, .form-row textarea {
    width: 100%; background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 4px;
    padding: 6px 10px; font-size: 13px; font-family: inherit;
    outline: none;
  }
  .form-row input:focus, .form-row select:focus, .form-row textarea:focus {
    border-color: var(--accent);
  }
  .form-row textarea { resize: vertical; min-height: 120px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

  /* Buttons */
  button {
    background: var(--btn-bg); color: var(--btn-fg); border: none;
    padding: 6px 14px; border-radius: 4px; cursor: pointer;
    font-size: 13px; font-family: inherit; transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary {
    background: var(--btn-secondary); color: var(--btn-secondary-fg);
  }
  button.danger { background: var(--danger); color: #fff; }
  button.success { background: var(--success); color: #fff; }
  button.small { padding: 5px 12px; font-size: 13px; }
  .btn-row { display: flex; gap: 8px; margin-top: 12px; align-items: center; }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.03); }
  .td-actions { display: flex; gap: 6px; }

  /* Status dots */
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot-green { background: #22c55e; }
  .dot-red { background: #ef4444; }
  .dot-gray { background: #6b7280; }
  .dot-yellow { background: #f59e0b; }

  /* Info items */
  .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .info-item { }
  .info-item .info-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .info-item .info-val { font-size: 13px; margin-top: 2px; }
  code { background: var(--input-bg); padding: 2px 6px; border-radius: 3px; font-size: 12px; font-family: monospace; }

  /* Toast */
  #toast {
    position: fixed; bottom: 20px; right: 20px; padding: 10px 16px;
    border-radius: 6px; font-size: 13px; z-index: 9999;
    opacity: 0; transition: opacity 0.3s; pointer-events: none;
    max-width: 320px;
  }
  #toast.show { opacity: 1; }
  #toast.success { background: #166534; color: #86efac; border: 1px solid #22c55e44; }
  #toast.error { background: #7f1d1d; color: #fca5a5; border: 1px solid #ef444444; }
  #toast.info { background: #1e3a5f; color: #93c5fd; border: 1px solid #3b82f644; }

  /* Monitoring chart */
  .chart-container { position: relative; height: 120px; }
  canvas { width: 100% !important; height: 120px !important; }

  /* Empty state */
  .empty { text-align: center; padding: 32px; color: var(--muted); }
  .empty-icon { font-size: 32px; margin-bottom: 8px; }

  /* Toggle */
  .toggle-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .toggle { position: relative; width: 40px; height: 22px; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
    background: #555; transition: 0.3s; border-radius: 22px;
  }
  .toggle-slider:before {
    position: absolute; content: ""; height: 16px; width: 16px;
    left: 3px; bottom: 3px; background: white; transition: 0.3s; border-radius: 50%;
  }
  .toggle input:checked + .toggle-slider { background: var(--accent); }
  .toggle input:checked + .toggle-slider:before { transform: translateX(18px); }
  .toggle-label { font-size: 13px; }

  /* Section heading */
  .section-heading {
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--muted); margin-bottom: 10px; margin-top: 4px;
  }
</style>
</head>
<body>

<div class="app-header">
  <div class="app-header-top">
    <div class="app-title">${esc(app.name)}</div>
    <span class="status-badge">${esc(status)}</span>
    <span style="color:var(--muted);font-size:12px;margin-left:4px;">${esc(app.appName || "")}</span>
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
    <button class="tab" onclick="switchTab('environment')">Environment</button>
    <button class="tab" onclick="switchTab('domains')">Domains</button>
    <button class="tab" onclick="switchTab('deployments')">Deployments</button>
    <button class="tab" onclick="switchTab('preview')">Preview Deployments</button>
    <button class="tab" onclick="switchTab('schedules')">Schedules</button>
    <button class="tab" onclick="switchTab('backups')">Volume Backups</button>
    <button class="tab" onclick="switchTab('logs')">Logs</button>
    <button class="tab" onclick="switchTab('monitoring')">Monitoring</button>
    <button class="tab" onclick="switchTab('advanced')">Advanced</button>
  </div>
</div>

<div class="content">

  <!-- ── General ──────────────────────────────────────────────── -->
  <div id="tab-general" class="tab-pane active">
    <div class="card">
      <div class="card-title">Application Info</div>
      <div class="info-grid" style="margin-bottom:16px;">
        <div class="info-item">
          <div class="info-label">App ID</div>
          <div class="info-val"><code>${esc(app.applicationId)}</code></div>
        </div>
        <div class="info-item">
          <div class="info-label">Source Type</div>
          <div class="info-val"><code>${esc(app.sourceType || "—")}</code></div>
        </div>
        <div class="info-item">
          <div class="info-label">Build Type</div>
          <div class="info-val"><code>${esc(app.buildType || "nixpacks")}</code></div>
        </div>
        <div class="info-item">
          <div class="info-label">Status</div>
          <div class="info-val">
            <span class="dot ${statusClass(status)}"></span>${esc(status)}
          </div>
        </div>
        ${app.repository ? `<div class="info-item">
          <div class="info-label">Repository</div>
          <div class="info-val" style="word-break:break-all;">${esc(app.repository)}</div>
        </div>` : ""}
        ${app.branch ? `<div class="info-item">
          <div class="info-label">Branch</div>
          <div class="info-val"><code>${esc(app.branch)}</code></div>
        </div>` : ""}
        ${app.dockerImage ? `<div class="info-item">
          <div class="info-label">Docker Image</div>
          <div class="info-val"><code>${esc(app.dockerImage)}</code></div>
        </div>` : ""}
        <div class="info-item">
          <div class="info-label">Created</div>
          <div class="info-val">${app.createdAt ? new Date(app.createdAt).toLocaleString() : "—"}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Edit Details</div>
      <div class="form-row">
        <label>Name</label>
        <input id="g-name" value="${esc(app.name)}">
      </div>
      <div class="form-row">
        <label>Description</label>
        <input id="g-desc" value="${esc(app.description || "")}">
      </div>
      <div class="btn-row">
        <button onclick="saveGeneral()">Save</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Build Configuration</div>
      <div class="form-grid">
        <div class="form-row">
          <label>Build Type</label>
          <select id="g-buildType">
            ${["nixpacks","dockerfile","heroku_buildpacks","paketo_buildpacks","static","railpack"].map(
              b => `<option value="${b}" ${app.buildType === b ? "selected" : ""}>${b}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-row">
          <label>Start Command (optional)</label>
          <input id="g-command" value="${esc(app.command || "")}">
        </div>
        <div class="form-row">
          <label>Dockerfile path (if dockerfile build)</label>
          <input id="g-dockerfile" value="${esc(app.dockerfile || "")}">
        </div>
        <div class="form-row">
          <label>Docker context path</label>
          <input id="g-dockerContextPath" value="${esc(app.dockerContextPath || "")}">
        </div>
        <div class="form-row">
          <label>Publish directory (static builds)</label>
          <input id="g-publishDirectory" value="${esc(app.publishDirectory || "")}">
        </div>
      </div>
      <div class="btn-row">
        <button onclick="saveBuildConfig()">Save Build Config</button>
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
        <textarea id="env-content" style="min-height:300px;">${esc(app.env || "")}</textarea>
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
      <div class="card-title">Domains</div>
      <div id="domains-list">${renderDomains(JSON.parse(domainsJson))}</div>
      <div style="margin-top:12px;">
        <button onclick="generateDomain()" class="secondary">⚡ Generate Auto Domain</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Add Domain</div>
      <div class="form-grid">
        <div class="form-row">
          <label>Host</label>
          <input id="d-host" placeholder="app.example.com">
        </div>
        <div class="form-row">
          <label>Port</label>
          <input id="d-port" type="number" value="3000">
        </div>
        <div class="form-row">
          <label>Path (optional)</label>
          <input id="d-path" placeholder="/" value="/">
        </div>
        <div class="form-row">
          <label>Certificate</label>
          <select id="d-cert">
            <option value="letsencrypt">Let's Encrypt (HTTPS)</option>
            <option value="none">None (HTTP)</option>
            <option value="custom">Custom</option>
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
        <div style="display:flex;gap:8px;">
          <button class="secondary" onclick="send('refreshDeployments')"><span style="font-size:11px">↻</span> Refresh</button>
          <button class="danger" onclick="send('cancelDeployment')">✕ Cancel Running</button>
        </div>
      </div>
      <div id="deployments-list">${renderDeployments(JSON.parse(deploymentsJson))}</div>
    </div>
  </div>

  <!-- ── Preview Deployments ──────────────────────────────────── -->
  <div id="tab-preview" class="tab-pane">
    <div class="card">
      <div class="card-title">Preview Deployment Settings</div>
      <div class="toggle-row">
        <label class="toggle">
          <input type="checkbox" id="prev-enabled" ${app.isPreviewDeploymentsActive ? "checked" : ""}>
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-label">Enable Preview Deployments</span>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label>Wildcard domain</label>
          <input id="prev-wildcard" value="${esc(app.previewWildcard || "")}" placeholder="*.preview.example.com">
        </div>
        <div class="form-row">
          <label>Port</label>
          <input id="prev-port" type="number" value="${app.previewPort || 3000}">
        </div>
        <div class="form-row">
          <label>Limit (max deployments)</label>
          <input id="prev-limit" type="number" value="${app.previewLimit || 3}">
        </div>
        <div class="form-row">
          <label>Certificate</label>
          <select id="prev-cert">
            <option value="letsencrypt" ${app.previewCertificateType === "letsencrypt" ? "selected" : ""}>Let's Encrypt</option>
            <option value="none" ${app.previewCertificateType === "none" ? "selected" : ""}>None</option>
            <option value="custom" ${app.previewCertificateType === "custom" ? "selected" : ""}>Custom</option>
          </select>
        </div>
        <div class="form-row">
          <label>HTTPS</label>
          <select id="prev-https">
            <option value="true" ${app.previewHttps ? "selected" : ""}>Yes</option>
            <option value="false" ${!app.previewHttps ? "selected" : ""}>No</option>
          </select>
        </div>
      </div>
      <div class="btn-row">
        <button onclick="savePreviewConfig()">Save Preview Config</button>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="card-title" style="margin:0">Active Previews</div>
        <button class="secondary" onclick="send('loadPreviews')"><span style="font-size:11px">↻</span> Load</button>
      </div>
      <div id="previews-list">
        <div class="empty"><div class="empty-icon">🔍</div>Click "Load" to fetch preview deployments</div>
      </div>
    </div>
  </div>

  <!-- ── Schedules ────────────────────────────────────────────── -->
  <div id="tab-schedules" class="tab-pane">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="card-title" style="margin:0">Scheduled Jobs</div>
        <button class="secondary" onclick="send('loadSchedules')"><span style="font-size:11px">↻</span> Load</button>
      </div>
      <div id="schedules-list">
        <div class="empty"><div class="empty-icon">🕐</div>Click "Load" to fetch schedules</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Add Schedule</div>
      <div class="form-grid">
        <div class="form-row">
          <label>Name</label>
          <input id="sch-name" placeholder="nightly-backup">
        </div>
        <div class="form-row">
          <label>Cron Expression</label>
          <input id="sch-cron" placeholder="0 2 * * *" value="0 2 * * *">
        </div>
        <div class="form-row">
          <label>Command (optional)</label>
          <input id="sch-command" placeholder="npm run backup">
        </div>
        <div class="form-row">
          <label>Timezone</label>
          <input id="sch-timezone" placeholder="UTC" value="UTC">
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-bottom:10px;">
        Common schedules: <code>0 * * * *</code> (hourly), <code>0 0 * * *</code> (daily), <code>0 0 * * 0</code> (weekly)
      </p>
      <div class="btn-row">
        <button onclick="addSchedule()">Add Schedule</button>
      </div>
    </div>
  </div>

  <!-- ── Volume Backups ────────────────────────────────────────── -->
  <div id="tab-backups" class="tab-pane">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="card-title" style="margin:0">Backup Configurations</div>
        <button class="secondary" onclick="send('loadBackups')"><span style="font-size:11px">↻</span> Load</button>
      </div>
      <div id="backups-list">
        <div class="empty"><div class="empty-icon">💾</div>Click "Load" to fetch backup configurations</div>
      </div>
    </div>
    <div class="card" style="background: rgba(59,130,246,0.05); border-color: rgba(59,130,246,0.2);">
      <div class="card-title">ℹ About Volume Backups</div>
      <p style="font-size:13px;color:var(--muted);line-height:1.6;">
        Volume backups allow you to automatically back up application data to S3-compatible storage.
        Configure backup destinations in the MassiveGRID web dashboard under Settings → Destinations,
        then set up backup schedules here.
      </p>
    </div>
  </div>

  <!-- ── Logs ──────────────────────────────────────────────────── -->
  <div id="tab-logs" class="tab-pane">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="card-title" style="margin:0">Container Logs</div>
        <div style="display:flex;gap:8px;">
          <button class="secondary" onclick="loadLogs()"><span style="font-size:11px">↻</span> Load Logs</button>
          <button class="secondary" onclick="clearLogs()">✕ Clear</button>
        </div>
      </div>
      <div id="logs-output" style="
        background: #000; color: #d4d4d4; border-radius: 6px; padding: 12px;
        min-height: 200px; max-height: 400px; overflow-y: auto;
        font-family: monospace; font-size: 12px; line-height: 1.5;
        white-space: pre-wrap; word-break: break-all;
      ">Click "Load Logs" to fetch the latest deployment logs.</div>
    </div>

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
      <div class="card-title">Resource Limits</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">
        Leave blank to use defaults. Use Docker format: <code>512m</code>, <code>1g</code> for memory; <code>0.5</code>, <code>1</code> for CPU.
      </p>
      <div class="form-grid">
        <div class="form-row">
          <label>Memory Limit</label>
          <input id="adv-memLimit" value="${esc(String(app.memoryLimit || ""))}" placeholder="e.g. 512m">
        </div>
        <div class="form-row">
          <label>Memory Reservation</label>
          <input id="adv-memRes" value="${esc(String(app.memoryReservation || ""))}" placeholder="e.g. 256m">
        </div>
        <div class="form-row">
          <label>CPU Limit</label>
          <input id="adv-cpuLimit" value="${esc(String(app.cpuLimit || ""))}" placeholder="e.g. 1">
        </div>
        <div class="form-row">
          <label>CPU Reservation</label>
          <input id="adv-cpuRes" value="${esc(String(app.cpuReservation || ""))}" placeholder="e.g. 0.25">
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Scaling & Runtime</div>
      <div class="form-grid">
        <div class="form-row">
          <label>Replicas</label>
          <input id="adv-replicas" type="number" value="${app.replicas || 1}" min="0">
        </div>
        <div class="form-row">
          <label>Start Command (overrides Dockerfile CMD)</label>
          <input id="adv-command" value="${esc(app.command || "")}" placeholder="node server.js">
        </div>
      </div>
      <div class="btn-row">
        <button onclick="saveAdvanced()">Save Advanced Settings</button>
      </div>
    </div>
  </div>

</div><!-- /content -->

<div id="toast"></div>

<script>
const vscode = acquireVsCodeApi();
const app = ${appJson};

// ── Utilities ──────────────────────────────────────────────────────
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
  const labels = { general:0,environment:1,domains:2,deployments:3,preview:4,schedules:5,backups:6,logs:7,monitoring:8,advanced:9 };
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
function saveBuildConfig() {
  send('saveBuildConfig', {
    buildType: document.getElementById('g-buildType').value,
    dockerfile: document.getElementById('g-dockerfile').value,
    dockerContextPath: document.getElementById('g-dockerContextPath').value,
    publishDirectory: document.getElementById('g-publishDirectory').value,
    command: document.getElementById('g-command').value,
  });
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
  if (!host) { showToast('Enter a host', 'error'); return; }
  const cert = document.getElementById('d-cert').value;
  send('addDomain', {
    host,
    port: parseInt(document.getElementById('d-port').value) || 3000,
    https: cert !== 'none',
    certificateType: cert,
  });
}
function deleteDomain(domainId) {
  send('deleteDomain', { domainId });
}
function generateDomain() { send('generateDomain'); }

// ── Preview ───────────────────────────────────────────────────────
function savePreviewConfig() {
  send('savePreviewConfig', {
    enabled: document.getElementById('prev-enabled').checked,
    wildcard: document.getElementById('prev-wildcard').value,
    port: document.getElementById('prev-port').value,
    limit: document.getElementById('prev-limit').value,
    certificateType: document.getElementById('prev-cert').value,
    https: document.getElementById('prev-https').value === 'true',
  });
}
function deletePreview(id) {
  send('deletePreview', { previewDeploymentId: id });
}
function redeployPreview(id) { send('redeployPreview', { previewDeploymentId: id }); }

// ── Schedules ─────────────────────────────────────────────────────
function addSchedule() {
  const cron = document.getElementById('sch-cron').value.trim();
  if (!cron) { showToast('Enter a cron expression', 'error'); return; }
  send('addSchedule', {
    scheduleName: document.getElementById('sch-name').value.trim(),
    cronExpression: cron,
    command: document.getElementById('sch-command').value.trim(),
    timezone: document.getElementById('sch-timezone').value.trim() || 'UTC',
  });
}
function deleteSchedule(id) {
  send('deleteSchedule', { scheduleId: id });
}
function runSchedule(id) { send('runSchedule', { scheduleId: id }); }

// ── Backups ───────────────────────────────────────────────────────
function runBackup(id) { send('runBackup', { backupId: id }); }
function deleteBackup(id) {
  send('deleteBackup', { backupId: id });
}

// ── Logs ──────────────────────────────────────────────────────────
function loadLogs() { send('viewLog', { deploymentId: '_latest' }); }
function clearLogs() { document.getElementById('logs-output').textContent = ''; }

// ── Monitoring ────────────────────────────────────────────────────
function loadMonitoring() { send('loadMonitoring'); }
// CPU items from API: {value: "0.00%", time: "ISO"} or plain number
function parseCpuValue(item) {
  if (item == null) return null;
  if (typeof item === 'number') return item;
  if (typeof item === 'object' && item.value != null) {
    return parseFloat(String(item.value).replace('%', ''));
  }
  return parseFloat(String(item));
}
// Memory items from API: {value: {used: "112.4MiB", total: "15.62GiB"}, time: "ISO"}
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
// Convert memory string like "112.4MiB", "1.5GiB" to a comparable number
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
    el.innerHTML = '<div class="empty"><div class="empty-icon">📊</div>No monitoring data available. Ensure the app is running.</div>';
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
    memoryLimit: document.getElementById('adv-memLimit').value,
    memoryReservation: document.getElementById('adv-memRes').value,
    cpuLimit: document.getElementById('adv-cpuLimit').value,
    cpuReservation: document.getElementById('adv-cpuRes').value,
    replicas: document.getElementById('adv-replicas').value,
    command: document.getElementById('adv-command').value,
  });
}

// ── Message handler ────────────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  switch (msg.command) {
    case 'toast':
      showToast(msg.text, msg.type);
      break;
    case 'domainsUpdate':
      document.getElementById('domains-list').innerHTML = renderDomainsJS(msg.domains);
      break;
    case 'deploymentsUpdate':
      document.getElementById('deployments-list').innerHTML = renderDeploymentsJS(msg.deployments);
      document.getElementById('dep-log-list').innerHTML = renderDepLogListJS(msg.deployments);
      break;
    case 'previewsUpdate':
      document.getElementById('previews-list').innerHTML = renderPreviewsJS(msg.previews);
      break;
    case 'schedulesUpdate':
      document.getElementById('schedules-list').innerHTML = renderSchedulesJS(msg.schedules);
      break;
    case 'backupsUpdate':
      document.getElementById('backups-list').innerHTML = renderBackupsJS(msg.backups, msg.destinations);
      break;
    case 'monitoringUpdate':
      renderMonitoring(msg.data);
      break;
  }
});

// ── Render helpers (JS-side, for dynamic updates) ─────────────────

function statusDot(s) {
  const c = (s === 'running' || s === 'done') ? 'dot-green' : s === 'error' ? 'dot-red' : s === 'queued' ? 'dot-yellow' : 'dot-gray';
  return \`<span class="dot \${c}"></span>\`;
}

function renderDomainsJS(domains) {
  if (!domains || !domains.length) return '<div class="empty"><div class="empty-icon">🌐</div>No domains configured</div>';
  return \`<table>
    <thead><tr><th>Host</th><th>Port</th><th>SSL</th><th>Cert</th><th>Actions</th></tr></thead>
    <tbody>\${domains.map(d => \`<tr>
      <td>\${esc(d.host)}</td>
      <td>\${d.port || '—'}</td>
      <td>\${d.https ? '🔒 HTTPS' : '🔓 HTTP'}</td>
      <td><code>\${esc(d.certificateType || 'none')}</code></td>
      <td class="td-actions">
        <button class="secondary small" onclick="send('openExternal',{url:'\${d.https ? 'https' : 'http'}://\${esc(d.host)}'})">↗ Open</button>
        <button class="danger small" onclick="deleteDomain('\${esc(d.domainId || d.id)}')">Delete</button>
      </td>
    </tr>\`).join('')}</tbody>
  </table>\`;
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

function renderPreviewsJS(previews) {
  if (!previews || !previews.length) return '<div class="empty"><div class="empty-icon">🔍</div>No active preview deployments</div>';
  return \`<table>
    <thead><tr><th>Branch</th><th>Status</th><th>URL</th><th>Actions</th></tr></thead>
    <tbody>\${previews.map(p => \`<tr>
      <td><code>\${esc(p.pullRequestTitle || p.branch || p.previewDeploymentId)}</code></td>
      <td>\${statusDot(p.previewStatus || p.applicationStatus)}\${esc(p.previewStatus || p.applicationStatus || 'unknown')}</td>
      <td>\${p.domain ? \`<a href="#" onclick="send('openExternal',{url:'\${esc(p.domain)}'})">\${esc(p.domain)}</a>\` : '—'}</td>
      <td class="td-actions">
        <button class="secondary small" title="Redeploy" onclick="redeployPreview('\${esc(p.previewDeploymentId)}')"><span style="font-size:11px">↻</span> Redeploy</button>
        <button class="danger small" onclick="deletePreview('\${esc(p.previewDeploymentId)}')">Delete</button>
      </td>
    </tr>\`).join('')}</tbody>
  </table>\`;
}

function renderSchedulesJS(schedules) {
  if (!schedules || !schedules.length) return '<div class="empty"><div class="empty-icon">🕐</div>No schedules configured</div>';
  return \`<table>
    <thead><tr><th>Name</th><th>Cron</th><th>Next Run</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>\${schedules.map(s => \`<tr>
      <td>\${esc(s.scheduleName || s.name || 'Schedule')}</td>
      <td><code>\${esc(s.cronExpression || s.cron || '—')}</code></td>
      <td style="color:var(--muted);font-size:12px;">\${s.nextRun ? new Date(s.nextRun).toLocaleString() : '—'}</td>
      <td>\${s.enabled !== false ? '<span style="color:#22c55e">●</span> Enabled' : '<span style="color:#6b7280">●</span> Disabled'}</td>
      <td class="td-actions">
        <button class="success small" onclick="runSchedule('\${esc(s.scheduleId)}')">▶ Run</button>
        <button class="danger small" onclick="deleteSchedule('\${esc(s.scheduleId)}')">Delete</button>
      </td>
    </tr>\`).join('')}</tbody>
  </table>\`;
}

function renderBackupsJS(backups, destinations) {
  if (!backups || !backups.length) return \`<div class="empty"><div class="empty-icon">💾</div>No backup configurations.<br><small style="color:var(--muted)">Destinations available: \${destinations?.length || 0}</small></div>\`;
  return \`<table>
    <thead><tr><th>Destination</th><th>Schedule</th><th>Last Run</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>\${backups.map(b => \`<tr>
      <td>\${esc(b.destinationId || '—')}</td>
      <td><code>\${esc(b.cronExpression || '—')}</code></td>
      <td style="color:var(--muted);font-size:12px;">\${b.updatedAt ? new Date(b.updatedAt).toLocaleString() : '—'}</td>
      <td>\${b.enabled !== false ? '<span style="color:#22c55e">●</span> Enabled' : '<span style="color:#6b7280">●</span> Disabled'}</td>
      <td class="td-actions">
        <button class="success small" onclick="runBackup('\${esc(b.backupId)}')">▶ Run</button>
        <button class="danger small" onclick="deleteBackup('\${esc(b.backupId)}')">Delete</button>
      </td>
    </tr>\`).join('')}</tbody>
  </table>\`;
}

</script>
</body>
</html>`;

    // ── Server-side render helpers (used inline in template literals) ──

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

    function renderDomains(domains: any[]): string {
      if (!domains.length) return `<div class="empty"><div class="empty-icon">🌐</div>No domains configured</div>`;
      return `<table>
        <thead><tr><th>Host</th><th>Port</th><th>SSL</th><th>Cert</th><th>Actions</th></tr></thead>
        <tbody>${domains.map(d => `<tr>
          <td>${esc(d.host)}</td>
          <td>${d.port || "—"}</td>
          <td>${d.https ? "🔒 HTTPS" : "🔓 HTTP"}</td>
          <td><code>${esc(d.certificateType || "none")}</code></td>
          <td class="td-actions">
            <button class="secondary small" onclick="send('openExternal',{url:'${d.https ? "https" : "http"}://${esc(d.host)}'})">↗ Open</button>
            <button class="danger small" onclick="deleteDomain('${esc(d.domainId || d.id)}')">Delete</button>
          </td>
        </tr>`).join("")}</tbody>
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
        <div>Loading application details…</div>
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
    AppDetailPanel.openPanels.delete(this.applicationId);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
