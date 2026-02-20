import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import { DokployClient } from "../api/client";

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly serverManager: ServerManager;
  private disposables: vscode.Disposable[] = [];
  private refreshInterval: NodeJS.Timeout | undefined;

  public static show(
    context: vscode.ExtensionContext,
    serverManager: ServerManager
  ) {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      DashboardPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "dokploy.dashboard",
      "Dokploy Dashboard",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(
      panel,
      serverManager,
      context
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    serverManager: ServerManager,
    context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.serverManager = serverManager;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        const client = this.serverManager.getActiveClient();
        if (!client) return;

        switch (msg.command) {
          case "deploy":
            try {
              await client.deploy(msg.applicationId);
              vscode.window.showInformationMessage("Deployment triggered!");
              this.refresh();
            } catch (err: any) {
              vscode.window.showErrorMessage(`Deploy failed: ${err.message}`);
            }
            break;
          case "redeploy":
            try {
              await client.redeploy(msg.applicationId);
              this.refresh();
            } catch (err: any) {
              vscode.window.showErrorMessage(`Redeploy failed: ${err.message}`);
            }
            break;
          case "start":
            try {
              await client.startApplication(msg.applicationId);
              this.refresh();
            } catch (err: any) {
              vscode.window.showErrorMessage(`Start failed: ${err.message}`);
            }
            break;
          case "stop":
            try {
              await client.stopApplication(msg.applicationId);
              this.refresh();
            } catch (err: any) {
              vscode.window.showErrorMessage(`Stop failed: ${err.message}`);
            }
            break;
          case "openExternal":
            vscode.env.openExternal(vscode.Uri.parse(msg.url));
            break;
          case "refresh":
            this.refresh();
            break;
        }
      },
      null,
      this.disposables
    );

    // Auto-refresh every 15s
    this.refreshInterval = setInterval(() => this.refresh(), 15000);

    this.refresh();
  }

  async refresh() {
    const client = this.serverManager.getActiveClient();
    const server = this.serverManager.getActiveServer();
    if (!client || !server) {
      this.panel.webview.html = this.getNoServerHtml();
      return;
    }

    try {
      const projects = await client.getProjects();

      // Fetch full details for each project
      const fullProjects = [];
      for (const p of projects) {
        try {
          const full = await client.getProject(p.projectId);
          fullProjects.push(full);
        } catch {
          fullProjects.push(p);
        }
      }

      // Gather all services and recent deployments
      const allApps: any[] = [];
      const allCompose: any[] = [];

      for (const p of fullProjects) {
        const environments = (p as any).environments || [];
        for (const env of environments) {
          for (const app of env.applications || []) {
            allApps.push({ ...app, projectName: p.name });
          }
          for (const comp of env.compose || []) {
            allCompose.push({ ...comp, projectName: p.name });
          }
        }
      }

      // Fetch deployments for each app (last 3)
      const appDeployments: Record<string, any[]> = {};
      for (const app of allApps.slice(0, 20)) {
        try {
          const deps = await client.getDeployments(app.applicationId);
          appDeployments[app.applicationId] = (deps || []).slice(0, 3);
        } catch {
          appDeployments[app.applicationId] = [];
        }
      }

      this.panel.webview.html = this.getDashboardHtml(
        server.name,
        client.getBaseUrl(),
        fullProjects,
        allApps,
        allCompose,
        appDeployments
      );
    } catch (err: any) {
      this.panel.webview.html = this.getErrorHtml(err.message);
    }
  }

  private getDashboardHtml(
    serverName: string,
    serverUrl: string,
    projects: any[],
    apps: any[],
    compose: any[],
    deployments: Record<string, any[]>
  ): string {
    const totalServices = apps.length + compose.length;
    const runningApps = apps.filter(
      (a) => a.applicationStatus === "running" || a.applicationStatus === "done"
    ).length;
    const runningCompose = compose.filter(
      (c) =>
        c.composeStatus === "running" ||
        c.applicationStatus === "running" ||
        c.composeStatus === "done" ||
        c.applicationStatus === "done"
    ).length;
    const running = runningApps + runningCompose;

    const appRows = apps
      .map((app) => {
        const status = app.applicationStatus || "idle";
        const statusClass =
          status === "running" || status === "done"
            ? "status-running"
            : status === "error"
            ? "status-error"
            : "status-idle";
        const deps = deployments[app.applicationId] || [];
        const lastDeploy = deps[0];
        const lastDeployStr = lastDeploy
          ? `${lastDeploy.status} — ${new Date(lastDeploy.createdAt).toLocaleString()}`
          : "Never";

        return `
          <tr>
            <td><span class="status-dot ${statusClass}"></span> ${app.name}</td>
            <td class="muted">${app.projectName}</td>
            <td><code>${app.buildType || "nixpacks"}</code></td>
            <td><span class="badge ${statusClass}">${status}</span></td>
            <td class="muted">${lastDeployStr}</td>
            <td class="actions">
              <button onclick="sendMsg('deploy', '${app.applicationId}')" title="Deploy">▶ Deploy</button>
              <button onclick="sendMsg('redeploy', '${app.applicationId}')" title="Redeploy">↻</button>
              ${
                status === "running" || status === "done"
                  ? `<button onclick="sendMsg('stop', '${app.applicationId}')" title="Stop">⏹</button>`
                  : `<button onclick="sendMsg('start', '${app.applicationId}')" title="Start">▶</button>`
              }
            </td>
          </tr>
        `;
      })
      .join("");

    const composeRows = compose
      .map((c: any) => {
        const status =
          c.composeStatus || c.applicationStatus || "idle";
        const statusClass =
          status === "running" || status === "done"
            ? "status-running"
            : status === "error"
            ? "status-error"
            : "status-idle";
        return `
          <tr>
            <td><span class="status-dot ${statusClass}"></span> ${c.name}</td>
            <td class="muted">${c.projectName}</td>
            <td><code>compose</code></td>
            <td><span class="badge ${statusClass}">${status}</span></td>
            <td class="muted">—</td>
            <td></td>
          </tr>
        `;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border);
    --accent: var(--vscode-textLink-foreground);
    --card-bg: var(--vscode-editorWidget-background);
    --muted: var(--vscode-descriptionForeground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); padding: 20px; }

  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .header h1 { font-size: 20px; font-weight: 600; }
  .header .server-info { color: var(--muted); font-size: 13px; }
  .header button { background: var(--accent); color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .stat-card .value { font-size: 28px; font-weight: 700; }
  .stat-card .label { color: var(--muted); font-size: 12px; margin-top: 4px; }

  h2 { font-size: 16px; font-weight: 600; margin: 20px 0 12px; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
  tr:hover { background: var(--card-bg); }

  .muted { color: var(--muted); }
  code { background: var(--card-bg); padding: 2px 6px; border-radius: 3px; font-size: 12px; }

  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status-running .status-dot, .status-dot.status-running { background: #22c55e; }
  .status-error .status-dot, .status-dot.status-error { background: #ef4444; }
  .status-idle .status-dot, .status-dot.status-idle { background: #6b7280; }

  .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
  .badge.status-running { background: rgba(34,197,94,0.15); color: #22c55e; }
  .badge.status-error { background: rgba(239,68,68,0.15); color: #ef4444; }
  .badge.status-idle { background: rgba(107,114,128,0.15); color: #6b7280; }

  .actions button { background: var(--card-bg); border: 1px solid var(--border); color: var(--fg); padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 4px; }
  .actions button:hover { background: var(--accent); color: white; }

  .empty { text-align: center; padding: 40px; color: var(--muted); }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Dokploy Dashboard</h1>
      <div class="server-info">Connected to <strong>${serverName}</strong> — ${serverUrl}</div>
    </div>
    <div>
      <button onclick="sendMsg('openExternal', '', '${serverUrl}')">Open Web Dashboard</button>
      <button onclick="sendMsg('refresh')">↻ Refresh</button>
    </div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="value">${projects.length}</div>
      <div class="label">Projects</div>
    </div>
    <div class="stat-card">
      <div class="value">${totalServices}</div>
      <div class="label">Total Services</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color: #22c55e;">${running}</div>
      <div class="label">Running</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color: ${totalServices - running > 0 ? "#ef4444" : "#6b7280"};">${totalServices - running}</div>
      <div class="label">Stopped / Idle</div>
    </div>
  </div>

  ${
    apps.length > 0
      ? `
  <h2>Applications</h2>
  <table>
    <thead>
      <tr><th>Name</th><th>Project</th><th>Build</th><th>Status</th><th>Last Deploy</th><th>Actions</th></tr>
    </thead>
    <tbody>${appRows}</tbody>
  </table>`
      : ""
  }

  ${
    compose.length > 0
      ? `
  <h2>Compose Services</h2>
  <table>
    <thead>
      <tr><th>Name</th><th>Project</th><th>Type</th><th>Status</th><th>Last Deploy</th><th>Actions</th></tr>
    </thead>
    <tbody>${composeRows}</tbody>
  </table>`
      : ""
  }

  ${
    totalServices === 0
      ? '<div class="empty">No services yet. Create a project and application to get started.</div>'
      : ""
  }

  <script>
    const vscode = acquireVsCodeApi();
    function sendMsg(command, applicationId, url) {
      vscode.postMessage({ command, applicationId, url });
    }
  </script>
</body>
</html>`;
  }

  private getNoServerHtml(): string {
    return `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);">
      <div style="text-align:center">
        <h2>No Dokploy Server Connected</h2>
        <p>Add a server first using the Dokploy sidebar.</p>
      </div>
    </body></html>`;
  }

  private getErrorHtml(message: string): string {
    return `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);">
      <div style="text-align:center">
        <h2>Error</h2>
        <p>${message}</p>
        <button onclick="acquireVsCodeApi().postMessage({command:'refresh'})">Retry</button>
      </div>
    </body></html>`;
  }

  dispose() {
    DashboardPanel.currentPanel = undefined;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
