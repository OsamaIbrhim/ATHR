import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { ApiConfigurationError, resolveApiBase } from './api-base'
import { BRAND_NAME } from './brand'
import { deploymentConfigPath } from './paths'

type DeploymentConfig = {
  schema_version: 1
  api_base_url: string
}

/** Set by `apiConfiguration()` / `setConfiguredApiBase()`; null until resolved. */
let configuredApiBase: string | null = null

export const getConfiguredApiBase = () => configuredApiBase
export const setConfiguredApiBase = (value: string | null) => {
  configuredApiBase = value
}

function readDeploymentConfig(): DeploymentConfig | null {
  try {
    const value = JSON.parse(fs.readFileSync(deploymentConfigPath(), 'utf8'))
    if (value?.schema_version !== 1 || typeof value.api_base_url !== 'string') {
      return null
    }
    return value
  } catch {
    return null
  }
}

export function writeDeploymentConfig(apiBaseUrl: string) {
  const target = deploymentConfigPath()
  const temporary = `${target}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    temporary,
    JSON.stringify(
      { schema_version: 1, api_base_url: apiBaseUrl } satisfies DeploymentConfig,
      null,
      2,
    ),
    { mode: 0o600 },
  )
  fs.renameSync(temporary, target)
}

export function apiConfiguration() {
  try {
    const resolved = resolveApiBase({
      environmentValue: process.env.ATHR_API_URL,
      persistedValue: readDeploymentConfig()?.api_base_url,
      packaged: app.isPackaged,
    })
    configuredApiBase = resolved.apiBase
    return {
      configured: true,
      api_base_url: resolved.apiBase,
      source: resolved.source,
      locked: resolved.locked,
    }
  } catch (error) {
    configuredApiBase = null
    return {
      configured: false,
      api_base_url: '',
      source: 'none' as const,
      locked: Boolean(String(process.env.ATHR_API_URL || '').trim()),
      error:
        error instanceof Error
          ? error.message
          : `عنوان خادم ${BRAND_NAME} غير مضبوط.`,
    }
  }
}

export function currentApiBase() {
  if (configuredApiBase) return configuredApiBase
  const configuration = apiConfiguration()
  if (configuration.configured) return configuration.api_base_url
  throw new ApiConfigurationError(
    configuration.error || `عنوان خادم ${BRAND_NAME} مطلوب.`,
  )
}
