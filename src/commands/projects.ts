import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import { ProjectTreeItem } from "../views/projectsTree";

export function registerProjectCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  refreshTree: () => void
) {
  // ── Create Project ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("dokploy.createProject", async () => {
      const client = serverManager.getActiveClient();
      if (!client) {
        vscode.window.showErrorMessage("No Dokploy server configured.");
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: "Project name",
        placeHolder: "my-project",
        validateInput: (v) => (v.trim() ? null : "Name is required"),
      });
      if (!name) return;

      const description = await vscode.window.showInputBox({
        prompt: "Description (optional)",
        placeHolder: "My awesome project",
      });

      try {
        await client.createProject(name, description || undefined);
        vscode.window.showInformationMessage(`Project "${name}" created!`);
        refreshTree();
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to create project: ${err.message}`
        );
      }
    })
  );

  // ── Create Application ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.createApplication",
      async (item?: ProjectTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client) {
          vscode.window.showErrorMessage("No Dokploy server configured.");
          return;
        }

        let projectId: string;
        let projectName: string = "";

        if (item instanceof ProjectTreeItem) {
          projectId = item.project.projectId;
          projectName = item.project.name;
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
          projectName = selected.label;
        }

        // Step 1: Name (display name)
        const name = await vscode.window.showInputBox({
          prompt: "Name (display name for the application)",
          placeHolder: "My App",
          validateInput: (v) => (v.trim() ? null : "Name is required"),
        });
        if (!name) return;

        // Step 2: App Name (internal identifier, used for Docker container)
        const defaultAppName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const appName = await vscode.window.showInputBox({
          prompt: "App Name (internal identifier, lowercase with dashes)",
          value: defaultAppName,
          placeHolder: "my-app",
          validateInput: (v) => {
            if (!v.trim()) return "App name is required";
            if (!/^[a-z0-9][a-z0-9-]*$/.test(v.trim()))
              return "Only lowercase letters, numbers, and dashes allowed";
            return null;
          },
        });
        if (!appName) return;

        // Step 3: Description (optional)
        const description = await vscode.window.showInputBox({
          prompt: "Description (optional)",
        });

        try {
          await client.createApplication(
            projectId,
            name,
            appName,
            description || undefined
          );
          vscode.window.showInformationMessage(
            `Application "${name}" created!`
          );
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to create application: ${err.message}`
          );
        }
      }
    )
  );
}
