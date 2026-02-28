import * as vscode from "vscode";
import { execSync } from "child_process";
import { ServerManager } from "../api/serverManager";
import { ApplicationTreeItem } from "../views/projectsTree";
import { watchDeployment } from "../utils/deployWatcher";

export function registerPushDeployCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  refreshTree: () => void
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.pushAndDeploy",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client) {
          vscode.window.showErrorMessage("No Dokploy server configured.");
          return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
          vscode.window.showErrorMessage("No workspace folder open.");
          return;
        }

        const cwd = workspaceFolders[0].uri.fsPath;

        // Check if git repo
        try {
          execSync("git rev-parse --is-inside-work-tree", {
            cwd,
            encoding: "utf-8",
          });
        } catch {
          vscode.window.showErrorMessage(
            "This workspace is not a git repository."
          );
          return;
        }

        // Get the application to deploy
        let applicationId: string;
        let appName: string;

        if (item instanceof ApplicationTreeItem) {
          applicationId = item.application.applicationId;
          appName = item.application.name;
        } else {
          // Pick from list
          const projects = await client.getProjects();
          const apps: { label: string; description: string; applicationId: string }[] = [];

          for (const p of projects) {
            try {
              const fullProject = await client.getProject(p.projectId);
              const environments = (fullProject as any).environments || [];
              for (const env of environments) {
                for (const app of env.applications || []) {
                  apps.push({
                    label: app.name,
                    description: `${p.name} · ${app.applicationStatus || "idle"}`,
                    applicationId: app.applicationId,
                  });
                }
              }
            } catch {}
          }

          if (apps.length === 0) {
            vscode.window.showInformationMessage("No applications found.");
            return;
          }

          const picked = await vscode.window.showQuickPick(apps, {
            placeHolder: "Select application to deploy",
          });
          if (!picked) return;
          applicationId = picked.applicationId;
          appName = picked.label;
        }

        // Check for uncommitted changes
        const status = execSync("git status --porcelain", {
          cwd,
          encoding: "utf-8",
        }).trim();

        if (status) {
          const commitFirst = await vscode.window.showQuickPick(
            [
              {
                label: "$(git-commit) Commit & Push & Deploy",
                value: "commit",
                description: `${status.split("\n").length} changed files`,
              },
              {
                label: "$(cloud-upload) Push & Deploy (uncommitted changes ignored)",
                value: "push",
              },
              { label: "$(x) Cancel", value: "cancel" },
            ],
            { placeHolder: "You have uncommitted changes" }
          );

          if (!commitFirst || commitFirst.value === "cancel") return;

          if (commitFirst.value === "commit") {
            const message = await vscode.window.showInputBox({
              prompt: "Commit message",
              value: "deploy: update",
              ignoreFocusOut: true,
              validateInput: (v) =>
                v.trim() ? null : "Commit message is required",
            });
            if (!message) return;

            try {
              execSync("git add -A", { cwd });
              execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
                cwd,
              });
            } catch (err: any) {
              vscode.window.showErrorMessage(
                `Git commit failed: ${err.message}`
              );
              return;
            }
          }
        }

        // Push & Deploy
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Deploying ${appName}`,
            cancellable: false,
          },
          async (progress) => {
            try {
              // Step 1: Git push
              progress.report({ message: "Pushing to remote..." });
              try {
                execSync("git push", { cwd, encoding: "utf-8" });
              } catch (err: any) {
                // Try push with upstream
                const branch = execSync("git branch --show-current", {
                  cwd,
                  encoding: "utf-8",
                }).trim();
                execSync(`git push -u origin ${branch}`, {
                  cwd,
                  encoding: "utf-8",
                });
              }

              // Step 2: Trigger deploy
              progress.report({ message: "Triggering deployment..." });
              await client.deploy(applicationId);
              watchDeployment(client, applicationId, "application", appName, refreshTree);

              vscode.window
                .showInformationMessage(
                  `${appName} — pushed & deploying!`,
                  "View Logs"
                )
                .then((action) => {
                  if (action === "View Logs") {
                    vscode.commands.executeCommand(
                      "dokploy.viewLogs",
                      item
                    );
                  }
                });

              refreshTree();
            } catch (err: any) {
              vscode.window.showErrorMessage(
                `Push & Deploy failed: ${err.message}`
              );
            }
          }
        );
      }
    )
  );
}
