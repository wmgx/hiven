/**
 * LearnedRulesContent — "learned rules" management page (P2c).
 *
 * Lists rules the user confirmed (delete to forget) and clusters they rejected
 * (restore to allow proposing again). Governance surface for the self-learning
 * layer; all copy is i18n, rule labels render in the current locale.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §8 (P2).
 */

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, Trash2, Undo2 } from 'lucide-react'
import { useT } from '../i18n'
import { useAppStore } from '../store'
import { SettingGroup, SettingsListRow } from './SettingsContent'
import { matcherShapeLabel, transformLabel } from '../components/launcher/learningLabels'
import {
  deleteLearnedRule,
  getLearningManagementState,
  restoreSuppressed,
} from '../workspace/learning/learningController'
import type { LearnedRule, Suppression } from '../workspace/learning/store'

export function LearnedRulesContent() {
  const t = useT('systemSettings')
  const locale = useAppStore((s) => s.locale)
  const [rules, setRules] = useState<LearnedRule[]>([])
  const [suppressions, setSuppressions] = useState<Suppression[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(() => {
    void getLearningManagementState()
      .then((state) => {
        setRules(state.rules)
        setSuppressions(state.suppressions)
      })
      .catch(() => {
        setRules([])
        setSuppressions([])
      })
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onDelete = (rule: LearnedRule) => {
    if (rule.id == null) return
    void deleteLearnedRule(rule.id).then(refresh)
  }
  const onRestore = (clusterKey: string) => {
    void restoreSuppressed(clusterKey).then(refresh)
  }

  if (loaded && rules.length === 0 && suppressions.length === 0) {
    return (
      <div className="sscroll">
        <div className="learned-rules-empty">{t('learnedRulesEmpty')}</div>
      </div>
    )
  }

  return (
    <div className="sscroll">
      <SettingGroup title={t('learnedRules')}>
        {rules.length === 0 ? (
          <div className="learned-rules-empty-inline">{t('learnedRulesEmpty')}</div>
        ) : (
          rules.map((rule) => (
            <SettingsListRow
              key={rule.id ?? rule.clusterKey}
              icon={<Sparkles size={15} strokeWidth={2} />}
              name={transformLabel(rule.transform, locale)}
              desc={t('learnedRuleDesc', {
                shape: matcherShapeLabel(rule.matcher, locale),
                count: String(rule.sampleCount),
              })}
            >
              <button
                type="button"
                className="learned-rules-btn learned-rules-btn-danger"
                onClick={() => onDelete(rule)}
                aria-label={t('learnedRulesDelete')}
              >
                <Trash2 size={13} strokeWidth={2.2} aria-hidden="true" />
                {t('learnedRulesDelete')}
              </button>
            </SettingsListRow>
          ))
        )}
      </SettingGroup>

      {suppressions.length > 0 && (
        <SettingGroup title={t('learnedRulesSuppressed')}>
          {suppressions.map((s) => (
            <SettingsListRow
              key={s.clusterKey}
              icon={<Undo2 size={15} strokeWidth={2} />}
              name={t('learnedRulesSuppressedItem')}
              desc={s.clusterKey}
            >
              <button
                type="button"
                className="learned-rules-btn"
                onClick={() => onRestore(s.clusterKey)}
                aria-label={t('learnedRulesRestore')}
              >
                {t('learnedRulesRestore')}
              </button>
            </SettingsListRow>
          ))}
        </SettingGroup>
      )}
    </div>
  )
}
