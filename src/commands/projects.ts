import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import { ProjectTreeItem } from "../views/projectsTree";

export function registerProjectCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  refreshTree: () => void
) {
  // ── Delete Project ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dokploy.deleteProject",
      async (item?: ProjectTreeItem) => {
        const client = serverManager.getActiveClient();
        if (!client || !(item instanceof ProjectTreeItem)) return;

        const confirm = await vscode.window.showWarningMessage(
          `Delete project "${item.project.name}" and ALL its services? This cannot be undone.`,
          { modal: true },
          "Delete"
        );
        if (confirm !== "Delete") return;

        try {
          await client.deleteProject(item.project.projectId);
          vscode.window.showInformationMessage(
            `Project "${item.project.name}" deleted.`
          );
          refreshTree();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to delete project: ${err.message}`
          );
        }
      }
    )
  );

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
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? null : "Name is required"),
      });
      if (!name) return;

      const description = await vscode.window.showInputBox({
        prompt: "Description (optional)",
        placeHolder: "My awesome project",
        ignoreFocusOut: true,
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
          ignoreFocusOut: true,
          validateInput: (v) => (v.trim() ? null : "Name is required"),
        });
        if (!name) return;

        // Step 2: App Name (internal identifier, used for Docker container)
        const defaultAppName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const appName = await vscode.window.showInputBox({
          prompt: "App Name (internal identifier, lowercase with dashes)",
          value: defaultAppName,
          placeHolder: "my-app",
          ignoreFocusOut: true,
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
          ignoreFocusOut: true,
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
