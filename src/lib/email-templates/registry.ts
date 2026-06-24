import type { ComponentType } from 'react'

import { template as welcomeTemplate } from './welcome'
import { template as picksConfirmationTemplate } from './picks-confirmation'
import { template as pickReminderTemplate } from './pick-reminder'
import { template as adminNewUserTemplate } from './admin-new-user'
import { template as migrationWelcomeTemplate } from './migration-welcome'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  welcome: welcomeTemplate,
  'picks-confirmation': picksConfirmationTemplate,
  'pick-reminder': pickReminderTemplate,
  'admin-new-user': adminNewUserTemplate,
  'migration-welcome': migrationWelcomeTemplate,
}
