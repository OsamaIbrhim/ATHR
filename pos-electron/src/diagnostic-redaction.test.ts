import { describe, expect, it } from 'vitest'
import {
  diagnosticFilename,
  redactDiagnostics,
  serializeDiagnostics,
} from '../electron/diagnostic-redaction'

describe('POS diagnostic redaction', () => {
  it('removes nested credentials while preserving operational identifiers', () => {
    const value = redactDiagnostics({
      terminal_id: 'terminal-1',
      deployment_sha: '3e50400290913e4f698a7e96d1d4942f56c8ee53',
      access_token: 'access-secret',
      nested: {
        device_token: 'device-secret',
        password: 'password-secret',
      },
    }) as any

    expect(value).toMatchObject({
      terminal_id: 'terminal-1',
      deployment_sha: '3e50400290913e4f698a7e96d1d4942f56c8ee53',
      access_token: '[REDACTED]',
      nested: {
        device_token: '[REDACTED]',
        password: '[REDACTED]',
      },
    })
  })

  it('redacts bearer values and JWT-shaped strings', () => {
    const report = serializeDiagnostics({
      message: 'Authorization: Bearer abc.def.ghi',
      jwt: 'eyJabcdefghijk.abcdefghijk.abcdefghijk',
    })
    expect(report).not.toContain('abc.def.ghi')
    expect(report).not.toContain('eyJabcdefghijk')
  })

  it('handles circular input without exposing or crashing', () => {
    const value: any[] = []
    value.push(value)
    expect(redactDiagnostics(value)).toEqual(['[CIRCULAR]'])
  })

  it('creates a deterministic safe JSON filename', () => {
    expect(
      diagnosticFilename(new Date('2026-07-26T18:20:30.000Z')),
    ).toBe('athr-pos-diagnostics-20260726T182030Z.json')
  })
})
