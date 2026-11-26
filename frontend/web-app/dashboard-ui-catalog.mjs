import { readFileSync } from 'node:fs'

export function readDashboardUiCatalog() {
  return JSON.parse(readFileSync(new URL('./dashboard-ui-catalog.json', import.meta.url), 'utf8'))
}
