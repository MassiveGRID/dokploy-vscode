import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import { DokployApplication } from "../api/client";
import { ApplicationTreeItem } from "../views/projectsTree";
import { detectProject, ProjectInfo } from "../utils/projectDetector";

export function registerDeployCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  refreshTree: () => void
) {
  // ── Deploy existing application ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.deploy",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client) {
          vscode.window.showErrorMessage("No Dokploy server configured.");
          return;
        }

        let applicationId: string;

        if (item instanceof ApplicationTreeItem) {
          applicationId = item.application.applicationId;
        } else {
          // Pick from list
          const projects = await client.getProjects();
          const apps = projects.flatMap((p) =>
            (p.applications || []).map((a) => ({
              label: a.name,
              description: `${p.name} · ${a.buildType}`,
              applicationId: a.applicationId,
            }))
          );

          if (apps.length === 0) {
            vscode.window.showInformationMessage("No applications found.");
            return;
          }

          const picked = await vscode.window.showQuickPick(apps, {
            placeHolder: "Select application to deploy",
          });
          if (!picked) return;
          applicationId = picked.applicationId;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Deploying...",
            cancellable: false,
          },
          async () => {
            try {
              await client.deploy(applicationId);
              vscode.window.showInformationMessage(
                "Deployment triggered successfully!"
              );
              refreshTree();
            } catch (err: any) {
              vscode.window.showErrorMessage(
                `Deploy failed: ${err.message}`
              );
            }
          }
        );
      }
    )
  );

  // ── Quick Deploy (from workspace) ────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("dokploy.quickDeploy", async () => {
      const client = serverManager.getActiveClient();
      if (!client) {
        const added = await vscode.commands.executeCommand("dokploy.addServer");
        if (!added) return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders?.length) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;
      const activeClient = serverManager.getActiveClient()!;

      // Auto-detect project type
      const autoDetect = vscode.workspace
        .getConfiguration("dokploy")
        .get<boolean>("autoDetectProjectType", true);

      let projectInfo: ProjectInfo | undefined;
      if (autoDetect) {
        projectInfo = await detectProject(workspacePath);
      }

      // Show detected info and let user confirm
      const frameworkLabel = projectInfo?.framework || "Unknown";
      const buildTypeLabel = projectInfo?.buildType || "nixpacks";
      const portLabel = projectInfo?.port?.toString() || "3000";

      const action = await vscode.window.showInformationMessage(
        `Detected: ${frameworkLabel} (${buildTypeLabel}, port ${portLabel})`,
        "Deploy",
        "Configure",
        "Cancel"
      );

      if (action === "Cancel" || !action) return;

      // Get or create project
      const projects = await activeClient.getProjects();
      const projectOptions = [
        { label: "$(add) Create New Project", projectId: "__new__" },
        ...projects.map((p) => ({
          label: p.name,
          description: `${p.applications?.length || 0} apps`,
          projectId: p.projectId,
        })),
      ];

      const selectedProject = await vscode.window.showQuickPick(
        projectOptions,
        { placeHolder: "Select project" }
      );
      if (!selectedProject) return;

      let projectId = selectedProject.projectId;
      if (projectId === "__new__") {
        const projectName = await vscode.window.showInputBox({
          prompt: "New project name",
          value: workspaceFolders[0].name,
        });
        if (!projectName) return;
        const newProject = await activeClient.createProject(projectName);
        projectId = newProject.projectId;
      }

      // Create application
      const appName = await vscode.window.showInputBox({
        prompt: "Application name",
        value: workspaceFolders[0].name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      });
      if (!appName) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Setting up ${appName}...`,
          cancellable: false,
        },
        async (progress) => {
          try {
            // Create the application
            progress.report({ message: "Creating application..." });
            const app = await activeClient.createApplication(
              projectId,
              appName
            );

            // Configure build type
            if (projectInfo?.buildType) {
              progress.report({ message: "Configuring build..." });
              await activeClient.saveBuildType(
                app.applicationId,
                projectInfo.buildType
              );
            }

            // Ask for git repo URL
            const repoUrl = await vscode.window.showInputBox({
              prompt:
                "Git repository URL (Dokploy will pull code from here)",
              placeHolder: "https://github.com/user/repo.git",
              value: await getGitRemoteUrl(workspacePath),
            });

            if (repoUrl) {
              const branch = await vscode.window.showInputBox({
                prompt: "Branch to deploy",
                value: await getGitBranch(workspacePath) || "main",
              });

              if (branch) {
                progress.report({
                  message: "Connecting git repository...",
                });
                await activeClient.saveGitProvider(
                  app.applicationId,
                  repoUrl,
                  branch
                );
              }
            }

            // Ask about domain
            const setupDomain = await vscode.window.showQuickPick(
              [
                {
                  label: "$(globe) Generate auto domain",
                  value: "auto",
                },
                {
                  label: "$(edit) Custom domain",
                  value: "custom",
                },
                { label: "$(x) Skip for now", value: "skip" },
              ],
              { placeHolder: "Set up a domain?" }
            );

            if (setupDomain?.value === "auto") {
              progress.report({ message: "Generating domain..." });
              try {
                const result = await activeClient.generateDomain(
                  app.applicationId
                );
                vscode.window.showInformationMessage(
                  `Domain generated: ${result.domain}`
                );
              } catch {
                // Some Dokploy versions may not support this
              }
            } else if (setupDomain?.value === "custom") {
              const domain = await vscode.window.showInputBox({
                prompt: "Enter your domain",
                placeHolder: "app.example.com",
              });
              if (domain) {
                await activeClient.createDomain(
                  app.applicationId,
                  domain,
                  projectInfo?.port || 3000
                );
              }
            }

            // Deploy
            const shouldDeploy = await vscode.window.showQuickPick(
              [
                { label: "$(rocket) Deploy now", value: true },
                { label: "$(x) Not yet", value: false },
              ],
              { placeHolder: "Trigger deployment?" }
            );

            if (shouldDeploy?.value) {
              progress.report({ message: "Deploying..." });
              await activeClient.deploy(app.applicationId);
              vscode.window.showInformationMessage(
                `Deployment triggered for ${appName}!`
              );
            }

            refreshTree();
          } catch (err: any) {
            vscode.window.showErrorMessage(
              `Quick deploy failed: ${err.message}`
            );
          }
        }
      );
    })
  );

  // ── Start / Stop / Redeploy ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.startApp",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ApplicationTreeItem)) return;
        try {
          await client.startApplication(item.application.applicationId);
          vscode.window.showInformationMessage(
            `Started ${item.application.name}`
          );
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Start failed: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.stopApp",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ApplicationTreeItem)) return;
        const confirm = await vscode.window.showWarningMessage(
          `Stop ${item.application.name}?`,
          "Stop"
        );
        if (confirm !== "Stop") return;
        try {
          await client.stopApplication(item.application.applicationId);
          vscode.window.showInformationMessage(
            `Stopped ${item.application.name}`
          );
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Stop failed: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.redeployApp",
      async (item?: ApplicationTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ApplicationTreeItem)) return;
        try {
          await client.redeploy(item.application.applicationId);
          vscode.window.showInformationMessage(
            `Redeploying ${item.application.name}...`
          );
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

// ── Helper: Get git remote URL from workspace ──────────────────────

async function getGitRemoteUrl(
  workspacePath: string
): Promise<string | undefined> {
  try {
    const { execSync } = require("child_process");
    const remote = execSync("git remote get-url origin", {
      cwd: workspacePath,
      encoding: "utf-8",
    }).trim();
    return remote || undefined;
  } catch {
    return undefined;
  }
}

async function getGitBranch(
  workspacePath: string
): Promise<string | undefined> {
  try {
    const { execSync } = require("child_process");
    const branch = execSync("git branch --show-current", {
      cwd: workspacePath,
      encoding: "utf-8",
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}
