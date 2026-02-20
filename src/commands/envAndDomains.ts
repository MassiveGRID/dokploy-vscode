import * as vscode from "vscode";
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

        // Open a temp document for editing
        const doc = await vscode.workspace.openTextDocument({
          content: currentEnv || "# Environment variables for " + app.name + "\n# Format: KEY=VALUE (one per line)\n\n",
          language: "shellscript",
        });

        const editor = await vscode.window.showTextDocument(doc);

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
              description: "Let Dokploy generate a domain",
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
            });
            if (!host) return;

            const portStr = await vscode.window.showInputBox({
              prompt: "Application port",
              value: "3000",
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
