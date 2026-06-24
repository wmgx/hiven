import type { PluginSettingsBodyProps } from '@hiven/plugin'
import type { TargetLanguageCode, TranslateProfile, TranslateProvider, TranslateSettings } from './model'

const PROVIDERS: TranslateProvider[] = ['baidu', 'deepl']
const TARGETS: TargetLanguageCode[] = ['smart', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es']

function updateProfile(profiles: TranslateProfile[], id: string, patch: Partial<TranslateProfile>): TranslateProfile[] {
  return profiles.map((profile) => (profile.id === id ? { ...profile, ...patch } : profile))
}

function renameProfile(profiles: TranslateProfile[], currentId: string, nextId: string): TranslateProfile[] {
  return profiles.map((profile) => (profile.id === currentId ? { ...profile, id: nextId } : profile))
}

function nextProfileId(profiles: TranslateProfile[]): string {
  const used = new Set(profiles.map((profile) => profile.id))
  let index = profiles.length + 1
  let id = `translate-profile-${index}`
  while (used.has(id)) {
    index += 1
    id = `translate-profile-${index}`
  }
  return id
}

function labelForTarget(value: TargetLanguageCode): string {
  if (value === 'smart') return 'Smart'
  if (value === 'zh') return '中文'
  if (value === 'en') return 'English'
  if (value === 'ja') return '日本語'
  if (value === 'ko') return '한국어'
  if (value === 'fr') return 'Français'
  if (value === 'de') return 'Deutsch'
  return 'Español'
}

export function TranslateSettingsPanel(props: PluginSettingsBodyProps<TranslateSettings>) {
  const { value, setValue, resetValue } = props

  function patch(next: Partial<TranslateSettings>) {
    setValue({ ...value, ...next })
  }

  function patchProfile(id: string, profilePatch: Partial<TranslateProfile>) {
    patch({ profiles: updateProfile(value.profiles, id, profilePatch) })
  }

  function patchProfileId(currentId: string, nextId: string) {
    patch({
      profiles: renameProfile(value.profiles, currentId, nextId),
      defaultProfileId: value.defaultProfileId === currentId ? nextId : value.defaultProfileId,
    })
  }

  function addProfile() {
    const id = nextProfileId(value.profiles)
    patch({
      profiles: [
        ...value.profiles,
        {
          id,
          name: 'New profile',
          provider: 'baidu',
          enabled: true,
          endpoint: '',
          appId: '',
          secret: '',
          authKey: '',
          defaultSourceLang: 'auto',
          defaultTargetLang: 'smart',
          monthlyLimitChars: 100000,
          usedCharsMonth: '',
          usedChars: 0,
        },
      ],
      defaultProfileId: value.defaultProfileId || id,
    })
  }

  function removeProfile(id: string) {
    const profiles = value.profiles.filter((profile) => profile.id !== id)
    patch({
      profiles,
      defaultProfileId: value.defaultProfileId === id ? profiles[0]?.id ?? '' : value.defaultProfileId,
    })
  }

  return (
    <div className="translate-settings">
      <section className="translate-settings__section">
        <div className="translate-settings__head">
          <span className="translate-settings__title">Defaults</span>
          <span className="translate-settings__hint">Used when the surface opens</span>
        </div>
        <div className="translate-settings__grid">
          <label className="translate-settings__field">
            Default profile
            <select value={value.defaultProfileId} onChange={(event) => patch({ defaultProfileId: event.target.value })}>
              {value.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name || profile.id}</option>
              ))}
            </select>
          </label>
          <label className="translate-settings__field">
            Default target
            <select value={value.defaultTargetLang} onChange={(event) => patch({ defaultTargetLang: event.target.value as TargetLanguageCode })}>
              {TARGETS.map((target) => (
                <option key={target} value={target}>{labelForTarget(target)}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="translate-settings__section">
        <div className="translate-settings__head">
          <span className="translate-settings__title">API profiles</span>
          <span className="translate-settings__hint">Secrets are stored locally for now</span>
        </div>
        <div className="translate-settings__profiles">
          {value.profiles.map((profile) => (
            <div className="translate-settings__profile" key={profile.id}>
              <div className="translate-settings__profile-main">
                <input
                  value={profile.name}
                  aria-label="Profile name"
                  onChange={(event) => patchProfile(profile.id, { name: event.target.value })}
                />
                <input
                  value={profile.id}
                  aria-label="Profile id"
                  onChange={(event) => patchProfileId(profile.id, event.target.value)}
                />
                <input
                  value={profile.endpoint ?? ''}
                  aria-label="Endpoint"
                  placeholder="Endpoint"
                  onChange={(event) => patchProfile(profile.id, { endpoint: event.target.value })}
                />
                <input
                  type="password"
                  value={profile.provider === 'deepl' ? profile.authKey ?? '' : profile.secret ?? ''}
                  aria-label="Secret"
                  placeholder={profile.provider === 'deepl' ? 'Auth key' : 'Secret'}
                  onChange={(event) => patchProfile(profile.id, profile.provider === 'deepl' ? { authKey: event.target.value } : { secret: event.target.value })}
                />
                {profile.provider === 'baidu' && (
                  <input
                    value={profile.appId ?? ''}
                    aria-label="App id"
                    placeholder="App ID"
                    onChange={(event) => patchProfile(profile.id, { appId: event.target.value })}
                  />
                )}
                <input
                  type="number"
                  value={profile.monthlyLimitChars}
                  aria-label="Monthly character limit"
                  onChange={(event) => patchProfile(profile.id, { monthlyLimitChars: Number(event.target.value) || 0 })}
                />
              </div>
              <select value={profile.provider} onChange={(event) => patchProfile(profile.id, { provider: event.target.value as TranslateProvider })}>
                {PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
              </select>
              <label className="translate-settings__switch">
                <input
                  type="checkbox"
                  checked={profile.enabled}
                  onChange={(event) => patchProfile(profile.id, { enabled: event.target.checked })}
                />
                Enabled
              </label>
              <button
                className="translate-settings__button"
                type="button"
                disabled={value.profiles.length <= 1}
                onClick={() => removeProfile(profile.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="translate-settings__actions">
          <button className="translate-settings__button" type="button" onClick={addProfile}>Add profile</button>
          <button className="translate-settings__button" type="button" onClick={resetValue}>Reset</button>
        </div>
      </section>
    </div>
  )
}
