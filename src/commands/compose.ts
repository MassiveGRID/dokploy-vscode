import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ServerManager } from "../api/serverManager";
import { ProjectTreeItem, ComposeTreeItem } from "../views/projectsTree";
import { watchDeployment } from "../utils/deployWatcher";

export function registerComposeCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  refreshTree: () => void
) {
  // ── Create Compose Service ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.createCompose",
      async (item?: ProjectTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client) {
          vscode.window.showErrorMessage("No Dokploy server configured.");
          return;
        }

        let projectId: string;

        if (item instanceof ProjectTreeItem) {
          projectId = item.project.projectId;
        } else {
          const projects = await client.getProjects();
          const selected = await vscode.window.showQuickPick(
            projects.map((p) => ({
              label: p.name,
              projectId: p.projectId,
            })),
            { placeHolder: "Select project" }
          );
          if (!selected) return;
          projectId = selected.projectId;
        }

        const name = await vscode.window.showInputBox({
          prompt: "Compose service name",
          placeHolder: "my-stack",
          ignoreFocusOut: true,
          validateInput: (v) => (v.trim() ? null : "Name is required"),
        });
        if (!name) return;

        const appName = await vscode.window.showInputBox({
          prompt: "App Name (internal identifier)",
          value: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          ignoreFocusOut: true,
          validateInput: (v) => {
            if (!v.trim()) return "App name is required";
            if (!/^[a-z0-9][a-z0-9-]*$/.test(v.trim()))
              return "Only lowercase letters, numbers, and dashes";
            return null;
          },
        });
        if (!appName) return;

        const description = await vscode.window.showInputBox({
          prompt: "Description (optional)",
          ignoreFocusOut: true,
        });

        try {
          const compose = await client.createCompose(
            projectId,
            name,
            appName,
            description || undefined
          );

          // Ask if they want to upload a docker-compose.yml from workspace
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders) {
            const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
            let foundFile: string | undefined;

            for (const f of composeFiles) {
              const filePath = path.join(workspaceFolders[0].uri.fsPath, f);
              if (fs.existsSync(filePath)) {
                foundFile = filePath;
                break;
              }
            }

            if (foundFile) {
              const upload = await vscode.window.showQuickPick(
                [
                  {
                    label: `$(file) Upload ${path.basename(foundFile)}`,
                    value: true,
                  },
                  { label: "$(x) Skip", value: false },
                ],
                {
                  placeHolder: `Found ${path.basename(foundFile)} in workspace`,
                }
              );

              if (upload?.value) {
                const content = fs.readFileSync(foundFile, "utf-8");
                await client.saveComposeFile(compose.composeId, content);
                vscode.window.showInformationMessage(
                  "Compose file uploaded!"
                );
              }
            }
          }

          vscode.window.showInformationMessage(
            `Compose "${name}" created!`
          );
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to create compose: ${err.message}`
          );
        }
      }
    )
  );

  // ── Edit Compose File ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.editComposeFile",
      async (item?: ComposeTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ComposeTreeItem)) return;

        const composeId = item.compose.composeId;

        try {
          const full = await client.getCompose(composeId);
          const content =
            full.composeFile ||
            "# docker-compose.yml\nversion: '3.8'\nservices:\n  app:\n    image: nginx\n    ports:\n      - '80:80'\n";

          const doc = await vscode.workspace.openTextDocument({
            content,
            language: "yaml",
          });

          await vscode.window.showTextDocument(doc);

          // Save handler
          const saveDisposable = vscode.workspace.onWillSaveTextDocument(
            async (e) => {
              if (e.document === doc) {
                const newContent = doc.getText();
                try {
                  await client.saveComposeFile(composeId, newContent);
                  vscode.window.showInformationMessage(
                    "Compose file saved to Dokploy!"
                  );
                } catch (err: any) {
                  vscode.window.showErrorMessage(
                    `Save failed: ${err.message}`
                  );
                }
              }
            }
          );

          const closeDisposable = vscode.workspace.onDidCloseTextDocument(
            (closedDoc) => {
              if (closedDoc === doc) {
                saveDisposable.dispose();
                closeDisposable.dispose();
              }
            }
          );

          context.subscriptions.push(saveDisposable, closeDisposable);
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to load compose: ${err.message}`
          );
        }
      }
    )
  );

  // ── Deploy Compose ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.deployCompose",
      async (item?: ComposeTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ComposeTreeItem)) return;

        try {
          await client.deployCompose(item.compose.composeId);
          vscode.window.showInformationMessage(
            `Deploying ${item.compose.name}...`
          );
          watchDeployment(client, item.compose.composeId, "compose", item.compose.name, refreshTree);
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Deploy failed: ${err.message}`
          );
        }
      }
    )
  );

  // ── Start / Stop / Redeploy Compose ──────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.startCompose",
      async (item?: ComposeTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ComposeTreeItem)) return;
        try {
          await client.startCompose(item.compose.composeId);
          vscode.window.showInformationMessage(`Started ${item.compose.name}`);
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Start failed: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.stopCompose",
      async (item?: ComposeTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ComposeTreeItem)) return;
        const confirm = await vscode.window.showWarningMessage(
          `Stop ${item.compose.name}?`,
          "Stop"
        );
        if (confirm !== "Stop") return;
        try {
          await client.stopCompose(item.compose.composeId);
          vscode.window.showInformationMessage(`Stopped ${item.compose.name}`);
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Stop failed: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.redeployCompose",
      async (item?: ComposeTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ComposeTreeItem)) return;
        try {
          await client.redeployCompose(item.compose.composeId);
          vscode.window.showInformationMessage(
            `Redeploying ${item.compose.name}...`
          );
          watchDeployment(client, item.compose.composeId, "compose", item.compose.name, refreshTree);
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Redeploy failed: ${err.message}`
          );
        }
      }
    )
  );
}
