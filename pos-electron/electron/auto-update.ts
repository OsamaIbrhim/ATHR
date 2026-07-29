import {
  app,
  BrowserWindow,
  dialog,
  net,
  shell,
} from 'electron'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { selectUpdate, UpdateManifest } from './update-policy'

const INITIAL_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
const MAX_INSTALLER_BYTES = 300 * 1024 * 1024

type AutoUpdateOptions = {
  manifestUrl: string
  window: () => BrowserWindow | undefined
  pendingOutboxCount: () => number
}

function parentWindow(options: AutoUpdateOptions) {
  const candidate = options.window()
  return candidate && !candidate.isDestroyed() ? candidate : undefined
}

function messageBox(
  options: AutoUpdateOptions,
  value: Electron.MessageBoxOptions,
) {
  const parent = parentWindow(options)
  return parent
    ? dialog.showMessageBox(parent, value)
    : dialog.showMessageBox(value)
}

function requireHttps(value: string) {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') {
    throw new Error('The update endpoint must use HTTPS')
  }
  return parsed.toString()
}

async function fetchManifest(url: string) {
  const response = await net.fetch(requireHttps(url), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  })
  if (!response.ok) {
    throw new Error(`Update manifest returned HTTP ${response.status}`)
  }
  return response.json()
}

async function downloadInstaller(manifest: UpdateManifest) {
  const response = await net.fetch(manifest.url, {
    method: 'GET',
    headers: { 'Cache-Control': 'no-cache' },
  })
  if (!response.ok) {
    throw new Error(`Installer download returned HTTP ${response.status}`)
  }

  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_INSTALLER_BYTES) {
    throw new Error('The update installer is larger than the allowed limit')
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_INSTALLER_BYTES) {
    throw new Error('The update installer size is invalid')
  }

  const checksum = createHash('sha256').update(bytes).digest('hex')
  if (checksum !== manifest.sha256) {
    throw new Error('The update installer checksum does not match the manifest')
  }

  const directory = path.join(app.getPath('userData'), 'updates')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = path.join(directory, `ATHR-POS-${manifest.version}.exe`)
  const temporary = `${target}.download`
  fs.writeFileSync(temporary, bytes, { mode: 0o600 })
  if (fs.existsSync(target)) fs.unlinkSync(target)
  fs.renameSync(temporary, target)
  return target
}

async function offerUpdate(
  options: AutoUpdateOptions,
  manifest: UpdateManifest,
) {
  const notes = manifest.notes ? `\n\n${manifest.notes}` : ''
  const offer = await messageBox(options, {
    type: 'info',
    title: 'تحديث ATHR POS',
    message: `يتوفر إصدار جديد ${manifest.version}.`,
    detail:
      `الإصدار الحالي ${app.getVersion()}.${notes}\n\n` +
      'سيتم التحقق من سلامة ملف التثبيت قبل تشغيله.',
    buttons: ['تنزيل التحديث', 'لاحقًا'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (offer.response !== 0) return

  const installer = await downloadInstaller(manifest)
  const pending = Math.max(0, Number(options.pendingOutboxCount() || 0))
  if (pending > 0) {
    await messageBox(options, {
      type: 'warning',
      title: 'التحديث جاهز بعد المزامنة',
      message: `يوجد ${pending} عملية بيع معلقة للمزامنة.`,
      detail:
        'لن يتم إغلاق نقطة البيع أو تشغيل المثبت قبل إرسال العمليات المعلقة. قم بالمزامنة ثم أعد تشغيل التطبيق.',
      buttons: ['حسنًا'],
      defaultId: 0,
      noLink: true,
    })
    return
  }

  const install = await messageBox(options, {
    type: manifest.mandatory ? 'warning' : 'info',
    title: 'تثبيت تحديث ATHR POS',
    message: `تم تنزيل الإصدار ${manifest.version} والتحقق منه.`,
    detail:
      'سيغلق التطبيق ويفتح برنامج التثبيت. احفظ أي عملية حالية قبل المتابعة.',
    buttons: ['تثبيت الآن', 'لاحقًا'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (install.response !== 0) return

  const openError = await shell.openPath(installer)
  if (openError) throw new Error(openError)
  app.quit()
}

export function configureAutoUpdates(options: AutoUpdateOptions) {
  if (!app.isPackaged || process.platform !== 'win32') return

  let checking = false
  let lastOfferedVersion = ''

  const check = async () => {
    if (checking) return
    checking = true
    try {
      const payload = await fetchManifest(options.manifestUrl)
      const manifest = selectUpdate(payload, app.getVersion())
      if (!manifest || manifest.version === lastOfferedVersion) return
      await offerUpdate(options, manifest)
      lastOfferedVersion = manifest.version
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[AUTO_UPDATE] ${message}`)
    } finally {
      checking = false
    }
  }

  const initialTimer = setTimeout(() => void check(), INITIAL_CHECK_DELAY_MS)
  const intervalTimer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  app.once('before-quit', () => {
    clearTimeout(initialTimer)
    clearInterval(intervalTimer)
  })
}
