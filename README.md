# Nopilot for VS Code

Branch `feat/vscode-extension`: VS Code chat + workspace orchestration, retaining the Windows Teams Frida bridge. The original Web/CLI application remains on `main`.

- [Extension setup and workflow](extension/README.md)
- [Design and architecture](docs/VSCODE_DESIGN.md)

Build from CMD:

```cmd
cd extension
npm ci
npm run check
npm run build
npm test
python -B test\test_bridge.py
npm run package
```

Install the generated VSIX or open an Extension Development Host. See the extension guide for the Python bridge runtime, context/ignore, approvals, project contract, local history, web tools, optional small model and localhost agent API.
