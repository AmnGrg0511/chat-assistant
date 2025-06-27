// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as https from 'https';

function mapVSCodeThemeKindToShiki(themeKind: number): string {
	switch (themeKind) {
		case 1:
			return 'github-light';
		case 2:
			return 'github-dark';
		case 3:
			return 'github-dark-high-contrast';
		case 4:
			return 'github-light-high-contrast';
		default:
			return 'github-dark';
	}
}
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "chat-assistant" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('chat-assistant.open', () => {
		const panel = vscode.window.createWebviewPanel(
			'chatAssistant',
			'Chat Assistant',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist')
				]
			}
		);

		const webviewUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist'));
		const indexPath = vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist', 'index.html');
		let html = fs.readFileSync(indexPath.fsPath, 'utf8');
		html = html.replace('<head>', `<head><base href="${webviewUri}/">`);

		// Get and inject the current theme into the HTML
		html = html.replace('{{vscodeTheme}}', mapVSCodeThemeKindToShiki(vscode.window.activeColorTheme.kind));
		panel.webview.html = html;

		// Listen for theme changes and send to webview
		context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(e => {
			panel.webview.postMessage({ type: 'set-theme', theme: mapVSCodeThemeKindToShiki(e.kind) });
		}));

		// Message passing: Echo user message as assistant reply
		panel.webview.onDidReceiveMessage(
			async (message: any) => {
				if (message.type === 'user-message') {
					const { content, attachments } = message;
                    console.log(message);
					if (attachments && attachments.length > 0) {
						const files = await readFilesFromWorkspace(attachments);
						const aiReply = await callGeminiAPI(context, content, files);
						panel.webview.postMessage({ type: 'assistant-reply', content: aiReply });
					} else {
						// No files, just send prompt to Gemini
						const aiReply = await callGeminiAPI(context, content, {});
						panel.webview.postMessage({ type: 'assistant-reply', content: aiReply });
					}
				} else if (message.type === 'get-workspace-files') {
					// Get all files in the workspace
					const workspaceFolders = vscode.workspace.workspaceFolders;
					if (workspaceFolders && workspaceFolders.length > 0) {
						const query = message.query || '';
						let files: vscode.Uri[] = [];
						const excludePattern = `**/{node_modules,.git,dist,build,out,.next,.vercel,.turbo,.cache,.vscode,test,tests,coverage,__pycache__}/**`;

						if (query === '') {
							// When only '@' is typed, show files at depth 0 or 1
							files = await vscode.workspace.findFiles('{*,*/*}', excludePattern, 100); // Limit for initial display
						} else {
							// When query is present, perform a targeted search
							files = await vscode.workspace.findFiles(`**/*${query}*`, excludePattern, 200); // Limit for targeted search
						}

						const fileMap: { [relativePath: string]: string } = {};
						for (const file of files) {
							const relativePath = vscode.workspace.asRelativePath(file).replace(/\\/g, '/');
							fileMap[relativePath] = file.fsPath;
						}
						panel.webview.postMessage({ type: 'workspace-files', files: fileMap });
					} else {
						panel.webview.postMessage({ type: 'workspace-files', files: {} });
					}
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(disposable);

	// Command to set Gemini API Key
	const setApiKeyDisposable = vscode.commands.registerCommand('chat-assistant.setGeminiApiKey', async () => {
		const apiKey = await vscode.window.showInputBox({
			prompt: 'Enter your Gemini API Key',
			ignoreFocusOut: true,
			password: true // To hide the input
		});

		if (apiKey) {
			await context.secrets.store('geminiApiKey', apiKey);
			vscode.window.showInformationMessage('Gemini API Key saved securely!');
		} else {
			vscode.window.showWarningMessage('Gemini API Key not set.');
		}
	});

	context.subscriptions.push(setApiKeyDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }

async function readFilesFromWorkspace(filePaths: string[]): Promise<{ [filename: string]: string }> {
	const result: { [filename: string]: string } = {};

	for (const absPathStr of filePaths) {
		const absUri = vscode.Uri.file(absPathStr);
		const relPath = vscode.workspace.asRelativePath(absUri).replace(/\\/g, '/');
		try {
			const fileData = await vscode.workspace.fs.readFile(absUri);
			result[relPath] = Buffer.from(fileData).toString('utf8');
		} catch (e: any) {
			const errorMsg = e.message || String(e);
			console.error(`Chat Assistant: Failed to read file '${absPathStr}'. Error: ${errorMsg}`);
			result[relPath] = `[Error: Could not read file '${relPath}'. Full path attempted: ${absPathStr}. Details: ${errorMsg}]`;
		}
	}
	return result;
}

async function callGeminiAPI(context: vscode.ExtensionContext, prompt: string, files: { [filename: string]: string }): Promise<string> {
	const GEMINI_API_KEY = await context.secrets.get('geminiApiKey');
	if (!GEMINI_API_KEY) {
		vscode.window.showErrorMessage('Gemini API Key not set. Please set it using the "Set Gemini API Key" command.');
		return '[Gemini API Key not set]';
	}
	const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_API_KEY;

	return new Promise((resolve, reject) => {
		// Clean the user's prompt by removing the @file tokens for clarity.
		const cleanPrompt = prompt.replace(/@([\w\-./\\]+)/g, '').trim();

		let fullPrompt: string;

		if (Object.keys(files).length > 0) {
			// Create a well-structured block for the file contents.
			const fileContext = Object.entries(files)
				.map(([name, content]) => `Here is the content of the file '${name}':\n\`\`\`\n${content}\n\`\`\``)
				.join('\n\n');

			// Construct the final prompt for the AI with file context.
			fullPrompt = `The user's request is: "${cleanPrompt}"\n\nPlease use the following file content to fulfill the request:\n\n${fileContext}`;
		} else {
			// No files, just use the original prompt.
			fullPrompt = prompt;
		}

		const data = JSON.stringify({
			contents: [{ parts: [{ text: fullPrompt }] }]
		});
		const url = new URL(GEMINI_API_URL);
		const req = https.request({
			hostname: url.hostname,
			path: url.pathname + url.search,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			}
		}, (res) => {
			let body = '';
			res.on('data', chunk => body += chunk);
			res.on('end', () => {
				try {
					const json = JSON.parse(body);
					if (json.error) {
						resolve(`[Gemini Error] ${json.error.message || JSON.stringify(json.error)}`);
						return;
					}
					const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '[No response from Gemini]';
					resolve(text);
				} catch (e) {
					resolve(`[Error parsing Gemini response] ${e}`);
				}
			});
		});
		req.on('error', (err) => {
			resolve(`[Gemini Request Error] ${err}`);
		});
		req.write(data);
		req.end();
	});
}
