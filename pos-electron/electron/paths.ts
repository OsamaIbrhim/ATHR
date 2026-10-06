import { app } from 'electron'
import * as path from 'path'

/**
 * The local data folder name. Deliberately NOT the brand name: Electron
 * derives `userData` from the product name, so renaming the product would
 * silently open a new, empty folder and strand unsynced sales. Never change it.
 */
export const DATA_DIRECTORY_NAME = 'athr-pos'

/** Must run before `app` is ready and before anything reads `userData`. */
export function pinDataDirectory() {
  app.setPath('userData', path.join(app.getPath('appData'), DATA_DIRECTORY_NAME))
}

export const dbPath = () => path.join(app.getPath('userData'), 'athr_pos.sqlite')
export const secureStatePath = () => path.join(app.getPath('userData'), 'secure-state.bin')
export const deploymentConfigPath = () => path.join(app.getPath('userData'), 'deployment-config.json')
