import * as vscode from "vscode";
import * as https from "https";
import { ServerManager } from "../api/serverManager";
import { TemplateMetadata } from "../api/client";

const TEMPLATES_BASE_URL = "https://templates.dokploy.com";

function fetchTemplatesCatalog(): Promise<TemplateMetadata[]> {
  return new Promise((resolve, reject) => {
    https
      .get(`${TEMPLATES_BASE_URL}/meta.json`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
              return;
            }
            resolve(JSON.parse(data) as TemplateMetadata[]);
          } catch {
            reject(new Error("Failed to parse templates catalog"));
          }
        });
      })
      .on("error", reject);
  });
}

export class TemplatesPanel {
  public static currentPanel: TemplatesPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly serverManager: ServerManager;
  private readonly refreshTree: () => void;
  private disposables: vscode.Disposable[] = [];
  private templates: TemplateMetadata[] = [];

  public static show(
    context: vscode.ExtensionContext,
    serverManager: ServerManager,
    refreshTree: () => void
  ) {
    if (TemplatesPanel.currentPanel) {
      TemplatesPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "dokploy.templates",
      "Dokploy Templates",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    TemplatesPanel.currentPanel = new TemplatesPanel(
      panel,
      serverManager,
      refreshTree,
      context
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    serverManager: ServerManager,
    refreshTree: () => void,
    context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.serverManager = serverManager;
    this.refreshTree = refreshTree;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.command) {
          case "deploy":
            await this.handleDeploy(msg.templateId, msg.templateName);
            break;
          case "openLink":
            vscode.env.openExternal(vscode.Uri.parse(msg.url));
            break;
          case "refresh":
            await this.loadTemplates();
            break;
        }
      },
      null,
      this.disposables
    );

    this.loadTemplates();
  }

  private async handleDeploy(templateId: string, templateName: string) {
    const client = this.serverManager.getActiveClient();
    if (!client) {
      vscode.window.showErrorMessage("No Dokploy server configured.");
      return;
    }

    try {
      // Pick a project
      const projects = await client.getProjects();
      if (projects.length === 0) {
        vscode.window.showErrorMessage(
          "No projects found. Create a project first."
        );
        return;
      }

      const selected = await vscode.window.showQuickPick(
        projects.map((p) => ({ label: p.name, projectId: p.projectId })),
        { placeHolder: `Select project to deploy "${templateName}" into` }
      );
      if (!selected) return;

      // Resolve the default environment
      const project = await client.getProject(selected.projectId);
      const environments = (project as any).environments || [];
      const defaultEnv =
        environments.find((e: any) => e.isDefault) || environments[0];

      if (!defaultEnv) {
        vscode.window.showErrorMessage(
          "No environment found for this project."
        );
        return;
      }

      // Deploy
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Deploying ${templateName}...`,
          cancellable: false,
        },
        async () => {
          await client.deployTemplate(templateId, defaultEnv.environmentId);
        }
      );

      vscode.window.showInformationMessage(
        `Template "${templateName}" deployed to project "${selected.label}"!`
      );
      this.refreshTree();
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to deploy template: ${err.message}`
      );
    }
  }

  private async loadTemplates() {
    // Show loading state
    this.panel.webview.html = this.getLoadingHtml();

    try {
      // Fetch directly from the templates CDN (no server needed for browsing)
      this.templates = await fetchTemplatesCatalog();
      this.panel.webview.html = this.getTemplatesHtml(this.templates);
    } catch (err: any) {
      this.panel.webview.html = this.getErrorHtml(err.message);
    }
  }

  private getTemplatesHtml(templates: TemplateMetadata[]): string {
    // Collect all unique tags
    const allTags = new Set<string>();
    for (const t of templates) {
      for (const tag of t.tags || []) {
        allTags.add(tag);
      }
    }
    const sortedTags = [...allTags].sort();

    const templateCards = templates
      .map(
        (t) => `
      <div class="card" data-name="${this.escapeAttr(t.name.toLowerCase())}" data-desc="${this.escapeAttr((t.description || "").toLowerCase())}" data-tags="${this.escapeAttr((t.tags || []).join(",").toLowerCase())}">
        <div class="card-header">
          <img class="logo" src="${TEMPLATES_BASE_URL}/blueprints/${t.id}/${t.logo}" alt="${this.escapeHtml(t.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
          <div class="logo-fallback">${this.escapeHtml(t.name.charAt(0).toUpperCase())}</div>
          <div class="card-title-row">
            <span class="card-name">${this.escapeHtml(t.name)}</span>
            <span class="version-badge">${this.escapeHtml(t.version || "latest")}</span>
          </div>
        </div>
        <p class="card-desc">${this.escapeHtml(t.description || "")}</p>
        <div class="card-tags">
          ${(t.tags || []).map((tag) => `<span class="tag">${this.escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="card-footer">
          <div class="card-links">
            ${t.links?.github ? `<a class="link-btn" onclick="sendMsg('openLink','','${this.escapeAttr(t.links.github)}')" title="GitHub">GitHub</a>` : ""}
            ${t.links?.website ? `<a class="link-btn" onclick="sendMsg('openLink','','${this.escapeAttr(t.links.website)}')" title="Website">Website</a>` : ""}
            ${t.links?.docs ? `<a class="link-btn" onclick="sendMsg('openLink','','${this.escapeAttr(t.links.docs)}')" title="Docs">Docs</a>` : ""}
          </div>
          <button class="deploy-btn" onclick="sendMsg('deploy','${this.escapeAttr(t.id)}','${this.escapeAttr(t.name)}')">Deploy</button>
        </div>
      </div>`
      )
      .join("");

    const tagButtons = sortedTags
      .map(
        (tag) =>
          `<button class="tag-filter" data-tag="${this.escapeAttr(tag.toLowerCase())}" onclick="toggleTag(this)">${this.escapeHtml(tag)}</button>`
      )
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
    --input-bg: var(--vscode-input-background);
    --input-border: var(--vscode-input-border);
    --input-fg: var(--vscode-input-foreground);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); }

  .sticky-header {
    position: sticky; top: 0; z-index: 10;
    background: var(--bg); padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
  }
  .header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .header-top h1 { font-size: 18px; font-weight: 600; }
  .header-top .count { color: var(--muted); font-size: 13px; margin-left: 8px; font-weight: 400; }
  .header-top button { background: var(--card-bg); border: 1px solid var(--border); color: var(--fg); padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .header-top button:hover { background: var(--accent); color: white; }

  .search-row { margin-bottom: 10px; }
  .search-row input {
    width: 100%; padding: 7px 12px; border-radius: 4px; font-size: 13px;
    background: var(--input-bg); border: 1px solid var(--input-border); color: var(--input-fg);
    outline: none;
  }
  .search-row input:focus { border-color: var(--accent); }

  .tags-row { display: flex; flex-wrap: wrap; gap: 4px; max-height: 60px; overflow-y: auto; }
  .tag-filter {
    padding: 2px 8px; border-radius: 10px; font-size: 11px; cursor: pointer;
    background: var(--card-bg); border: 1px solid var(--border); color: var(--muted);
    white-space: nowrap;
  }
  .tag-filter:hover { border-color: var(--accent); color: var(--fg); }
  .tag-filter.active { background: var(--accent); color: white; border-color: var(--accent); }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px; padding: 16px 20px;
  }

  .card {
    background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px;
    padding: 14px; display: flex; flex-direction: column; gap: 8px;
    transition: border-color 0.15s;
  }
  .card:hover { border-color: var(--accent); }
  .card.hidden { display: none; }

  .card-header { display: flex; align-items: center; gap: 10px; }
  .logo { width: 36px; height: 36px; border-radius: 6px; object-fit: contain; flex-shrink: 0; }
  .logo-fallback {
    width: 36px; height: 36px; border-radius: 6px; flex-shrink: 0;
    background: var(--accent); color: white; font-weight: 700; font-size: 16px;
    display: none; align-items: center; justify-content: center;
  }
  .card-title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .card-name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .version-badge {
    font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 500;
    background: var(--badge-bg); color: var(--badge-fg); white-space: nowrap;
  }

  .card-desc { font-size: 12px; color: var(--muted); line-height: 1.4; flex: 1;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }

  .card-tags { display: flex; flex-wrap: wrap; gap: 3px; }
  .tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: rgba(127,127,127,0.12); color: var(--muted); }

  .card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
  .card-links { display: flex; gap: 6px; }
  .link-btn { font-size: 11px; color: var(--accent); cursor: pointer; text-decoration: none; }
  .link-btn:hover { text-decoration: underline; }

  .deploy-btn {
    padding: 4px 14px; border-radius: 4px; font-size: 12px; font-weight: 500;
    background: var(--accent); color: white; border: none; cursor: pointer;
    white-space: nowrap;
  }
  .deploy-btn:hover { opacity: 0.85; }

  .empty { text-align: center; padding: 60px 20px; color: var(--muted); }
  .empty h2 { font-size: 16px; margin-bottom: 8px; }
</style>
</head>
<body>
  <div class="sticky-header">
    <div class="header-top">
      <h1>Templates<span class="count" id="count">${templates.length} templates</span></h1>
      <button onclick="sendMsg('refresh')">Refresh</button>
    </div>
    <div class="search-row">
      <input type="text" id="search" placeholder="Search templates..." oninput="filterCards()">
    </div>
    <div class="tags-row" id="tags">${tagButtons}</div>
  </div>

  <div class="grid" id="grid">
    ${templateCards}
  </div>

  <div class="empty" id="empty" style="display:none;">
    <h2>No templates match your search</h2>
    <p>Try a different search term or clear your filters.</p>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function sendMsg(command, templateId, extra) {
      vscode.postMessage({ command, templateId, templateName: extra, url: extra });
    }

    const activeTags = new Set();

    function toggleTag(btn) {
      const tag = btn.dataset.tag;
      if (activeTags.has(tag)) {
        activeTags.delete(tag);
        btn.classList.remove('active');
      } else {
        activeTags.add(tag);
        btn.classList.add('active');
      }
      filterCards();
    }

    function filterCards() {
      const query = document.getElementById('search').value.toLowerCase().trim();
      const cards = document.querySelectorAll('.card');
      let visible = 0;

      cards.forEach(card => {
        const name = card.dataset.name || '';
        const desc = card.dataset.desc || '';
        const tags = card.dataset.tags || '';

        const matchesSearch = !query || name.includes(query) || desc.includes(query);
        const matchesTags = activeTags.size === 0 || [...activeTags].every(t => tags.includes(t));

        if (matchesSearch && matchesTags) {
          card.classList.remove('hidden');
          visible++;
        } else {
          card.classList.add('hidden');
        }
      });

      document.getElementById('count').textContent = visible + ' template' + (visible !== 1 ? 's' : '');
      document.getElementById('empty').style.display = visible === 0 ? '' : 'none';
      document.getElementById('grid').style.display = visible === 0 ? 'none' : '';
    }
  </script>
</body>
</html>`;
  }

  private getLoadingHtml(): string {
    return `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:var(--vscode-font-family);color:var(--vscode-descriptionForeground);">
      <div style="text-align:center">
        <p style="font-size:16px;">Loading templates...</p>
      </div>
    </body></html>`;
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
        <h2>Error Loading Templates</h2>
        <p>${this.escapeHtml(message)}</p>
        <button onclick="acquireVsCodeApi().postMessage({command:'refresh'})" style="margin-top:12px;padding:6px 14px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editorWidget-background);color:var(--vscode-editor-foreground);cursor:pointer;">Retry</button>
      </div>
    </body></html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private escapeAttr(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/'/g, "&#39;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  dispose() {
    TemplatesPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
