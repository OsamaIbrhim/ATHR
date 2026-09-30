import { app } from 'electron'
import * as path from 'path'

export const dbPath = () => path.join(app.getPath('userData'), 'athr_pos.sqlite')
export const secureStatePath = () => path.join(app.getPath('userData'), 'secure-state.bin')
export const deploymentConfigPath = () => path.join(app.getPath('userData'), 'deployment-config.json')
