/**
 * Identify legacy automatically learned quick-open rules during migration.
 * Automatic URL-template learning is disabled; hand-written rules stay intact.
 */
import { AUTO_CREATED_TAG, type WebQuickOpenEntry } from './settings/model'

export function isAutoLearnedEntry(entry: Pick<WebQuickOpenEntry, 'tags' | 'learnedFrom'>): boolean {
  return Boolean(entry.learnedFrom) || Boolean(entry.tags?.includes(AUTO_CREATED_TAG))
}
