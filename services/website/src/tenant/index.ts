import { HOST_HAMPTON } from './hosthampton'
import type { FeatureName, TenantConfig } from './types'

export type { FeatureName, TenantConfig } from './types'

/**
 * The tenant this build runs as.
 *
 * This is the ONE line a white-label clone changes: add `src/tenant/<client>.ts`
 * exporting a `TenantConfig`, then point this at it. It is a static import on
 * purpose — the config is read by client components (Nav, Footer) as well as
 * the server, so it has to be known at build time, and a static import is what
 * lets Next tree-shake every other tenant out of the bundle.
 */
export const TENANT: TenantConfig = HOST_HAMPTON

/**
 * Whether a module is on for this deployment.
 *
 * The tenant file sets the default; `FEATURE_<NAME>` in the env can switch a
 * feature OFF without a code change (any value other than exactly `true`
 * disables it once the variable is set), and ON only when the tenant file
 * already allows it — an env var cannot grant a module a tenant was not sold.
 * Server-side only: `process.env.FEATURE_*` is not visible in the browser.
 */
export function featureEnabled(name: FeatureName, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!TENANT.features[name]) return false
  const raw = env[`FEATURE_${toEnvSuffix(name)}`]
  if (raw === undefined || raw === '') return true
  return raw.trim().toLowerCase() === 'true'
}

/** `publicMcpInquiry` → `PUBLIC_MCP_INQUIRY`. */
export function toEnvSuffix(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
}
