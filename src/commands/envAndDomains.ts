import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ServerManager } from "../api/serverManager";
import { ApplicationTreeItem } from "../views/projectsTree";

export function registerEnvAndDomainCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  refreshTree: () => void
) {
  // ── Manage Environment Variables ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.manageEnvVars",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ApplicationTreeItem)) return;

        const app = item.application;

        // Get current env vars
        let currentApp;
        try {
          currentApp = await client.getApplication(app.applicationId);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to fetch app: ${err.message}`);
          return;
        }

        const currentEnv = currentApp.env || "";

        // Detect local .env file in workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let localEnvFile: string | undefined;
        if (workspaceFolders?.length) {
          for (const name of [".env", ".env.local", ".env.development", ".env.production"]) {
            const candidate = path.join(workspaceFolders[0].uri.fsPath, name);
            if (fs.existsSync(candidate)) {
              localEnvFile = candidate;
              break;
            }
          }
        }

        let action = "server";
        if (localEnvFile) {
          const picked = await vscode.window.showQuickPick(
            [
              {
                label: "$(edit) Edit server env vars",
                description: "Open and edit env vars on the server",
                value: "server",
              },
              {
                label: `$(cloud-upload) Import from ${path.basename(localEnvFile)}`,
                description: "Replace server env vars with local file content",
                value: "import",
              },
              {
                label: `$(sync) Merge local → server`,
                description: "Add missing local vars to server, keep existing ones",
                value: "merge",
              },
            ],
            { placeHolder: `Environment variables for ${app.name}` }
          );
          if (!picked) return;
          action = picked.value;
        }

        if (action === "import") {
          const localContent = fs.readFileSync(localEnvFile!, "utf-8");
          const confirm = await vscode.window.showWarningMessage(
            `Replace ALL server env vars for "${app.name}" with ${path.basename(localEnvFile!)}?`,
            { modal: true },
            "Replace"
          );
          if (confirm !== "Replace") return;
          try {
            await client.saveEnvironment(app.applicationId, localContent);
            vscode.window.showInformationMessage(`Environment variables imported from ${path.basename(localEnvFile!)}.`);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to import env vars: ${err.message}`);
          }
          return;
        }

        if (action === "merge") {
          const localContent = fs.readFileSync(localEnvFile!, "utf-8");
          const merged = mergeEnvVars(currentEnv, localContent);
          const confirm = await vscode.window.showWarningMessage(
            `Merge local env vars into server env for "${app.name}"? Existing server vars will be preserved.`,
            { modal: true },
            "Merge"
          );
          if (confirm !== "Merge") return;
          try {
            await client.saveEnvironment(app.applicationId, merged);
            vscode.window.showInformationMessage(`Environment variables merged from ${path.basename(localEnvFile!)}.`);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to merge env vars: ${err.message}`);
          }
          return;
        }

        // "server" — open temp document for editing
        const doc = await vscode.workspace.openTextDocument({
          content: currentEnv || "# Environment variables for " + app.name + "\n# Format: KEY=VALUE (one per line)\n\n",
          language: "shellscript",
        });

        await vscode.window.showTextDocument(doc);

        // Register a save handler
        const saveDisposable = vscode.workspace.onWillSaveTextDocument(
          async (e) => {
            if (e.document === doc) {
              const newEnv = doc.getText();
              try {
                await client.saveEnvironment(app.applicationId, newEnv);
                vscode.window.showInformationMessage(
                  `Environment variables saved for ${app.name}`
                );
              } catch (err: any) {
                vscode.window.showErrorMessage(
                  `Failed to save env vars: ${err.message}`
                );
              }
            }
          }
        );

        // Clean up when document is closed
        const closeDisposable = vscode.workspace.onDidCloseTextDocument(
          (closedDoc) => {
            if (closedDoc === doc) {
              saveDisposable.dispose();
              closeDisposable.dispose();
            }
          }
        );

        context.subscriptions.push(saveDisposable, closeDisposable);
      }
    )
  );

  // ── Manage Domains ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.manageDomains",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ApplicationTreeItem)) return;

        const app = item.application;

        try {
          const domains = await client.getDomains(app.applicationId);

          const options: vscode.QuickPickItem[] = [
            {
              label: "$(add) Add Domain",
              description: "Add a new custom domain",
            },
            {
              label: "$(zap) Generate Auto Domain",
              description: "Let MassiveGRID generate a domain",
            },
            ...domains.map((d) => ({
              label: `${d.https ? "$(lock)" : "$(unlock)"} ${d.host}`,
              description: `Port ${d.port} · ${d.certificateType}`,
              detail: d.domainId,
            })),
          ];

          const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `Domains for ${app.name}`,
          });

          if (!selected) return;

          if (selected.label.includes("Add Domain")) {
            const host = await vscode.window.showInputBox({
              prompt: "Enter domain",
              placeHolder: "app.example.com",
              ignoreFocusOut: true,
            });
            if (!host) return;

            const portStr = await vscode.window.showInputBox({
              prompt: "Application port",
              value: "3000",
              ignoreFocusOut: true,
            });
            const port = parseInt(portStr || "3000", 10);

            const useHttps = await vscode.window.showQuickPick(
              [
                { label: "$(lock) HTTPS (Let's Encrypt)", value: true },
                { label: "$(unlock) HTTP only", value: false },
              ],
              { placeHolder: "SSL?" }
            );

            await client.createDomain(
              app.applicationId,
              host,
              port,
              useHttps?.value ?? true
            );
            vscode.window.showInformationMessage(`Domain ${host} added!`);
          } else if (selected.label.includes("Generate Auto Domain")) {
            try {
              const result = await client.generateDomain(app.applicationId);
              vscode.window.showInformationMessage(
                `Auto domain: ${result.domain}`
              );
            } catch (err: any) {
              vscode.window.showErrorMessage(
                `Failed to generate domain: ${err.message}`
              );
            }
          } else if (selected.detail) {
            // Existing domain — offer delete
            const action = await vscode.window.showQuickPick(
              [
                { label: "$(link-external) Open in Browser", value: "open" },
                { label: "$(trash) Delete Domain", value: "delete" },
              ],
              { placeHolder: selected.label }
            );

            if (action?.value === "open") {
              const domain = domains.find(
                (d) => d.domainId === selected.detail
              );
              if (domain) {
                const protocol = domain.https ? "https" : "http";
                vscode.env.openExternal(
                  vscode.Uri.parse(`${protocol}://${domain.host}`)
                );
              }
            } else if (action?.value === "delete") {
              const confirm = await vscode.window.showWarningMessage(
                `Delete this domain?`,
                { modal: true },
                "Delete"
              );
              if (confirm === "Delete") {
                await client.deleteDomain(selected.detail);
                vscode.window.showInformationMessage("Domain deleted.");
              }
            }
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to load domains: ${err.message}`
          );
        }
      }
    )
  );

  // ── Sync Server Env → Local .env ─────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.syncEnvToLocal",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ApplicationTreeItem)) return;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
          vscode.window.showErrorMessage("No workspace folder open.");
          return;
        }

        let currentApp;
        try {
          currentApp = await client.getApplication(item.application.applicationId);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to fetch app: ${err.message}`);
          return;
        }

        const serverEnv = currentApp.env || "";
        if (!serverEnv.trim()) {
          vscode.window.showInformationMessage("No environment variables set on the server.");
          return;
        }

        const targetFile = path.join(workspaceFolders[0].uri.fsPath, ".env");
        const exists = fs.existsSync(targetFile);

        const confirm = await vscode.window.showWarningMessage(
          exists
            ? `Overwrite .env with server env vars for "${item.application.name}"?`
            : `Create .env with server env vars for "${item.application.name}"?`,
          { modal: true },
          exists ? "Overwrite" : "Create"
        );
        if (!confirm) return;

        fs.writeFileSync(targetFile, serverEnv, "utf-8");
        const doc = await vscode.workspace.openTextDocument(targetFile);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(".env file updated from server.");
      }
    )
  );

  // ── Open in Browser ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.openInBrowser",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ApplicationTreeItem)) return;

        try {
          const domains = await client.getDomains(
            item.application.applicationId
          );
          if (domains.length === 0) {
            vscode.window.showInformationMessage(
              "No domains configured for this application."
            );
            return;
          }

          if (domains.length === 1) {
            const d = domains[0];
            const protocol = d.https ? "https" : "http";
            vscode.env.openExternal(
              vscode.Uri.parse(`${protocol}://${d.host}`)
            );
            return;
          }

          const selected = await vscode.window.showQuickPick(
            domains.map((d) => ({
              label: d.host,
              description: d.https ? "HTTPS" : "HTTP",
              domain: d,
            })),
            { placeHolder: "Select domain to open" }
          );

          if (selected) {
            const protocol = selected.domain.https ? "https" : "http";
            vscode.env.openExternal(
              vscode.Uri.parse(`${protocol}://${selected.domain.host}`)
            );
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to get domains: ${err.message}`
          );
        }
      }
    )
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function parseEnvContent(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1);
    if (key) map.set(key, val);
  }
  return map;
}

/**
 * Merges `local` env vars into `server` env vars.
 * Server values take precedence — local vars are only added if missing on server.
 */
function mergeEnvVars(server: string, local: string): string {
  const serverMap = parseEnvContent(server);
  const localMap = parseEnvContent(local);

  // Add local vars that are missing on the server
  for (const [key, val] of localMap) {
    if (!serverMap.has(key)) {
      serverMap.set(key, val);
    }
  }

  return Array.from(serverMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}
