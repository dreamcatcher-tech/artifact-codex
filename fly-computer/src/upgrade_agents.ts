import { readRequiredAppEnv } from '@artifact/shared'
import {
  flyCliAppsList,
  flyCliAppStatus,
  flyCliGetMachine,
  flyCliListMachines,
  type FlyCliMachineDetail,
  type FlyCliMachineSummary,
  flyCliUpdateMachine,
} from '@artifact/tasks'
import { AGENT_METADATA_KEY } from './fly.ts'

const ACTOR_APP_PATTERN = /^actor-[a-z0-9-]+$/

async function main(): Promise<void> {
  const orgSlug = readRequiredAppEnv('FLY_ORG_SLUG')
  const templateApp = readRequiredAppEnv('FLY_AGENT_TEMPLATE_APP')

  const targetImage = await resolveAgentImage(templateApp)
  console.log(`Resolved agent template image: ${targetImage}`)

  const apps = await flyCliAppsList({ orgSlug })
  const actorApps = apps.filter((app) =>
    app.name && ACTOR_APP_PATTERN.test(app.name)
  )

  if (actorApps.length === 0) {
    console.log('No actor apps detected; exiting.')
    return
  }

  for (const app of actorApps) {
    const appName = app.name!
    console.log(`\nProcessing actor app: ${appName}`)
    await upgradeActorAppMachines(appName, targetImage)
  }
}

async function upgradeActorAppMachines(
  appName: string,
  targetImage: string,
): Promise<void> {
  const machines = await flyCliListMachines({ appName })
  if (machines.length === 0) {
    console.log('  No machines found; skipping.')
    return
  }

  for (const summary of machines) {
    if (!isAgentMachine(summary)) {
      console.log(
        `  Skipping non-agent machine ${summary.id ?? '(unknown id)'}.`,
      )
      continue
    }

    if (!summary.id) {
      console.warn('  Encountered agent machine without id; skipping.')
      continue
    }

    const detail = await flyCliGetMachine({
      appName,
      machineId: summary.id,
    })
    const currentImage = extractMachineImage(detail)
    if (currentImage === targetImage) {
      console.log(
        `  Machine ${summary.id} already on ${targetImage}; skipping.`,
      )
      continue
    }

    console.log(
      `  Updating machine ${summary.id} from ${
        currentImage ?? 'unknown'
      } to ${targetImage}.`,
    )
    await flyCliUpdateMachine({
      appName,
      machineId: summary.id,
      image: targetImage,
      restart: true,
    })
    console.log(`  Machine ${summary.id} update initiated.`)
  }
}

async function resolveAgentImage(templateApp: string): Promise<string> {
  const status = await flyCliAppStatus({ appName: templateApp })
  const templateMachineId = status.machines[0]?.id
  if (!templateMachineId) {
    throw new Error(
      `Template app "${templateApp}" has no machines; cannot determine agent image.`,
    )
  }
  const detail = await flyCliGetMachine({
    appName: templateApp,
    machineId: templateMachineId,
  })
  const image = extractMachineImage(detail)
  if (!image) {
    throw new Error(
      `Unable to determine image from template machine ${templateMachineId}.`,
    )
  }
  return image
}

function isAgentMachine(summary: FlyCliMachineSummary): boolean {
  const metadata = summary.metadata as Record<string, unknown> | undefined
  return typeof metadata?.[AGENT_METADATA_KEY] === 'string'
}

function extractMachineImage(detail: FlyCliMachineDetail): string | undefined {
  if (detail.config && typeof detail.config === 'object') {
    const image = (detail.config as { image?: unknown }).image
    if (typeof image === 'string') return image
  }
  if (typeof detail.image === 'string') {
    return detail.image
  }
  return undefined
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('Failed to upgrade agent machines:', error)
    Deno.exit(1)
  })
}
