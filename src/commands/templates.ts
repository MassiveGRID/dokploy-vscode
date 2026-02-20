import * as vscode from "vscode";
import { ServerManager } from "../api/serverManager";
import { TemplatesPanel } from "../views/templates";

export function registerTemplateCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  refreshTree: () => void
) {
  context.subscriptions.push(
    vscode.commands.registerCommand("dokploy.browseTemplates", () => {
      TemplatesPanel.show(context, serverManager, refreshTree);
    })
  );
}
