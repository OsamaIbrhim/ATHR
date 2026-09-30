import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { POS_APP_NAME } from './brand'

let win: BrowserWindow | undefined

export function getWindow() {
  return win as BrowserWindow
}

function appIconPath() {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.join(__dirname, '../build/icon.png')
  return fs.existsSync(candidate) ? candidate : undefined
}

export function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1100,
    minHeight: 680,
    title: POS_APP_NAME,
    backgroundColor: '#ffffff',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const allowed =
      (!app.isPackaged &&
        !!process.env.VITE_DEV_SERVER_URL &&
        url.startsWith(process.env.VITE_DEV_SERVER_URL)) ||
      (app.isPackaged && url.startsWith('file:'))
    if (!allowed) event.preventDefault()
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}
