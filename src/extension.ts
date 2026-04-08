import * as vscode from "vscode";

// Preview JSONL panel management
class JsonlPreviewPanel {
  private static currentPanel: JsonlPreviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _currentEditor: vscode.TextEditor | undefined;
  private _currentLine: number = 0;

  public static createOrShow(
    extensionUri: vscode.Uri,
    editor?: vscode.TextEditor
  ) {
    const column = vscode.ViewColumn.Two;

    // If we already have a panel, show it
    if (JsonlPreviewPanel.currentPanel) {
      JsonlPreviewPanel.currentPanel._panel.reveal(column);
      if (editor) {
        JsonlPreviewPanel.currentPanel._currentEditor = editor;
        JsonlPreviewPanel.currentPanel._currentLine =
          editor.selection.start.line;
        JsonlPreviewPanel.currentPanel._update();
      }
      return JsonlPreviewPanel.currentPanel;
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      "previewJsonl",
      "Preview JSONL",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    JsonlPreviewPanel.currentPanel = new JsonlPreviewPanel(
      panel,
      extensionUri,
      editor
    );
    return JsonlPreviewPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    editor?: vscode.TextEditor
  ) {
    this._panel = panel;

    // Initialize with provided editor
    if (editor) {
      this._currentEditor = editor;
      this._currentLine = editor.selection.start.line;
    } else if (
      vscode.window.activeTextEditor
    ) {
      this._currentEditor = vscode.window.activeTextEditor;
      this._currentLine = this._currentEditor.selection.start.line;
    }

    // Set initial content
    this._update();

    // Listen for panel disposal
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Update content based on view changes
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this._update();
        }
      },
      null,
      this._disposables
    );

    // Handle cursor position changes
    vscode.window.onDidChangeTextEditorSelection(
      (e) => {
        this._currentEditor = e.textEditor;
        this._currentLine = e.textEditor.selection.start.line;
        this._update();
      },
      null,
      this._disposables
    );

    // Handle active editor changes
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor) {
          this._currentEditor = editor;
          this._currentLine = editor.selection.start.line;
          this._update();
        }
      },
      null,
      this._disposables
    );

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "goToLine":
            this._goToLine(message.line);
            return;
          case "navigate":
            this._navigate(message.direction);
            return;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    JsonlPreviewPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _goToLine(lineNumber: number) {
    if (!this._currentEditor) {
      return;
    }

    const document = this._currentEditor.document;
    if (lineNumber < 1 || lineNumber > document.lineCount) {
      vscode.window.showErrorMessage(
        `Line ${lineNumber} is out of range (1-${document.lineCount})`
      );
      return;
    }

    this._currentLine = lineNumber - 1; // Convert to 0-based

    // Move cursor to the specified line
    const position = new vscode.Position(this._currentLine, 0);
    this._currentEditor.selection = new vscode.Selection(position, position);
    this._currentEditor.revealRange(new vscode.Range(position, position));

    this._update();
  }

  private _navigate(direction: "prev" | "next") {
    if (!this._currentEditor) {
      return;
    }

    const document = this._currentEditor.document;
    if (direction === "prev" && this._currentLine > 0) {
      this._currentLine--;
    } else if (
      direction === "next" &&
      this._currentLine < document.lineCount - 1
    ) {
      this._currentLine++;
    }

    // Move cursor to the new line
    const position = new vscode.Position(this._currentLine, 0);
    this._currentEditor.selection = new vscode.Selection(position, position);
    this._currentEditor.revealRange(new vscode.Range(position, position));

    this._update();
  }

  private _update() {
    this._panel.title = "Preview JSONL";
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    let jsonContent = "";
    let lineNumber = 0;
    let totalLines = 0;
    let lineText = "";

    if (this._currentEditor) {
      const document = this._currentEditor.document;
      totalLines = document.lineCount;

      // Ensure current line is within bounds
      if (this._currentLine >= totalLines) {
        this._currentLine = totalLines - 1;
      }
      if (this._currentLine < 0) {
        this._currentLine = 0;
      }

      lineNumber = this._currentLine + 1; // Convert to 1-based
      const line = document.lineAt(this._currentLine);
      lineText = line.text.trim();

      if (lineText) {
        try {
          const parsed = JSON.parse(lineText);
          jsonContent = JSON.stringify(parsed, null, 2);
        } catch (e) {
          jsonContent = "Invalid JSON on line " + lineNumber;
        }
      } else {
        jsonContent = "Empty line";
      }
    } else {
      jsonContent = "No JSONL file is active";
    }

    // Prepare content based on JSON validity
    let content = "";
    if (
      jsonContent.startsWith("Invalid") ||
      jsonContent.startsWith("No") ||
      jsonContent === "Empty line"
    ) {
      content = `<div class="error">${this._escapeHtml(jsonContent)}</div>`;
    } else {
      content = `<pre class="json-content">${this._highlightJson(
        jsonContent
      )}</pre>`;
    }

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Preview JSONL</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          margin: 0;
          padding: 20px;
          line-height: 1.6;
        }
        .navigation {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 15px;
        }
        .navigation button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 5px 10px;
          border-radius: 3px;
          cursor: pointer;
          font-size: var(--vscode-font-size);
        }
        .navigation button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        .navigation button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .copy-button {
          background-color: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: none;
          padding: 5px 10px;
          border-radius: 3px;
          cursor: pointer;
          font-size: var(--vscode-font-size);
          margin-left: auto;
        }
        .copy-button:hover {
          background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .navigation input {
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          padding: 5px;
          border-radius: 3px;
          width: 80px;
          font-size: var(--vscode-font-size);
        }
        .line-counter {
          color: var(--vscode-descriptionForeground);
        }
        pre.json-content {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          padding: 15px;
          overflow: auto;
          margin: 0;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
          line-height: 1.6;
        }
        .error {
          color: var(--vscode-errorForeground);
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
        }
        
        /* JSON syntax highlighting - no external dependencies */
        .json-key {
          color: #0451A5;
        }
        .json-string {
          color: #A31515;
        }
        .json-number {
          color: #098658;
        }
        .json-literal {
          color: #0000FF;
        }
      </style>
    </head>
    <body>
      <div class="navigation">
        <button onclick="navigate('prev')" ${lineNumber <= 1 ? "disabled" : ""
      }>&lt; Prev</button>
        <input type="number" id="lineInput" value="${lineNumber}" min="1" max="${totalLines}" onchange="goToLine(this.value)">
        <span class="line-counter">/ ${totalLines}</span>
        <button onclick="navigate('next')" ${lineNumber >= totalLines ? "disabled" : ""
      }>Next &gt;</button>
        <button class="copy-button" onclick="copyJson()">Copy JSON</button>
      </div>
      ${content}
      
      <script>
        const vscode = acquireVsCodeApi();
        
        // Store the JSON content for copying
        const jsonContent = ${JSON.stringify(jsonContent)};

        function navigate(direction) {
          vscode.postMessage({
            command: 'navigate',
            direction: direction
          });
        }

        function goToLine(line) {
          const lineNum = parseInt(line);
          if (!isNaN(lineNum)) {
            vscode.postMessage({
              command: 'goToLine',
              line: lineNum
            });
          }
        }

        function copyJson() {
          // Copy to clipboard
          navigator.clipboard.writeText(jsonContent).then(function() {
            // Change button text temporarily
            const btn = document.querySelector('.copy-button');
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(function() {
              btn.textContent = originalText;
            }, 1500);
          }).catch(function(err) {
            console.error('Failed to copy: ', err);
            alert('Failed to copy to clipboard');
          });
        }

        document.getElementById('lineInput').addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            goToLine(this.value);
          }
        });
      </script>
    </body>
    </html>`;
  }

  private _escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  private _highlightJson(json: string): string {
    // Escape HTML first
    let result = this._escapeHtml(json);

    // Highlight JSON keys (property names)
    result = result.replace(
      /(&quot;)([^&]+?)(&quot;)(\s*):/g,
      '<span class="json-key">$1$2$3</span>$4:'
    );

    // Highlight string values (not keys) - must come before numbers
    result = result.replace(
      /:(\s*)(&quot;[^&]*&quot;)/g,
      ':$1<span class="json-string">$2</span>'
    );

    // Highlight numbers (only standalone, not in strings)
    result = result.replace(
      /:(\s*)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)(?=\s*[,\}\]])/g,
      ':$1<span class="json-number">$2</span>'
    );

    // Highlight booleans and null
    result = result.replace(
      /:(\s*)(true|false|null)(?=\s*[,\}\]])/g,
      ':$1<span class="json-literal">$2</span>'
    );

    return result;
  }
}

export function activate(context: vscode.ExtensionContext) {

  const previewCommand = vscode.commands.registerCommand(
    "preview-jsonl.previewJsonl",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("a Please open a JSONL file first");
        return;
      }

      JsonlPreviewPanel.createOrShow(context.extensionUri, editor);
    }
  );

  context.subscriptions.push(previewCommand);
}

export function deactivate() { }
