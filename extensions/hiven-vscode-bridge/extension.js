/**
 * Hiven VS Code / Cursor bridge (plain JS, no compile step).
 * Pushes open text documents to 127.0.0.1:19246 and handles focus commands.
 */

const vscode = require('vscode')
const http = require('http')

const SOURCE_ID = 'editor.vscode'
const BRIDGE_HOST = '127.0.0.1'
const BRIDGE_PORT = 19246

let pushTimer = null
let pollTimer = null

function appName() {
  const name = vscode.env.appName || 'VS Code'
  return name
}

function listTargets() {
  const docs = vscode.workspace.textDocuments || []
  return docs
    .filter((d) => d && !d.isClosed && d.uri && d.uri.scheme === 'file')
    .map((d) => {
      const path = d.uri.fsPath
      const title = path.split(/[/\\]/).pop() || path
      return {
        id: path,
        title,
        path,
        url: d.uri.toString(),
        appName: appName(),
        kind: 'document',
        active: vscode.window.activeTextEditor?.document?.uri?.fsPath === path,
      }
    })
}

function postJson(path, body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8')
    const req = http.request(
      {
        host: BRIDGE_HOST,
        port: BRIDGE_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
        timeout: 800,
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      },
    )
    req.on('error', () => resolve(0))
    req.on('timeout', () => {
      req.destroy()
      resolve(0)
    })
    req.write(data)
    req.end()
  })
}

function getJson(path) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: BRIDGE_HOST,
        port: BRIDGE_PORT,
        path,
        method: 'GET',
        timeout: 800,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

async function pushSnapshot() {
  const targets = listTargets()
  await postJson(`/v1/sources/${SOURCE_ID}/snapshot`, {
    appName: appName(),
    targets,
  })
}

async function pollCommands() {
  const data = await getJson(`/v1/sources/${SOURCE_ID}/commands`)
  if (!data || !Array.isArray(data.commands)) return
  for (const cmd of data.commands) {
    if (cmd.type !== 'focus' || !cmd.id) continue
    try {
      const uri = vscode.Uri.file(cmd.id)
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc, { preview: false })
    } catch {
      // file may be gone
    }
  }
}

function schedule() {
  if (pushTimer) clearInterval(pushTimer)
  if (pollTimer) clearInterval(pollTimer)
  pushTimer = setInterval(() => {
    void pushSnapshot()
  }, 1200)
  pollTimer = setInterval(() => {
    void pollCommands()
  }, 500)
  void pushSnapshot()
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  schedule()
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(() => {
      void pushSnapshot()
    }),
    vscode.workspace.onDidCloseTextDocument(() => {
      void pushSnapshot()
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void pushSnapshot()
    }),
    vscode.commands.registerCommand('hivenBridge.pushNow', () => {
      void pushSnapshot()
    }),
    {
      dispose() {
        if (pushTimer) clearInterval(pushTimer)
        if (pollTimer) clearInterval(pollTimer)
      },
    },
  )
}

function deactivate() {
  if (pushTimer) clearInterval(pushTimer)
  if (pollTimer) clearInterval(pollTimer)
}

module.exports = { activate, deactivate }
