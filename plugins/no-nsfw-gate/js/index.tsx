import { Page } from '@revenge-mod/components'
import { Design } from '@revenge-mod/discord/design'
import type { JsonStorage } from '@revenge-mod/json-storage'
import { reloadApp } from '@revenge-mod/modules/native/app'
import { Alert, ScrollView, View } from 'react-native'

// ---------------------------------------------------------------------------
// Logging: console.log -> `adb logcat | grep ReactNativeJS`
//          logger.log  -> Settings > Revenge > Developer > Debug Logs
// ---------------------------------------------------------------------------

type PluginLogger = { log(...a: unknown[]): void }
let logger: PluginLogger | undefined

function log(...args: unknown[]) {
	console.log('[bundle-update-checker]', ...args)
	try {
		logger?.log(args.map(String).join(' '))
	} catch {}
}

// ---------------------------------------------------------------------------
// Settings (stored with api.jsonStorage)
// ---------------------------------------------------------------------------

const DEFAULT_URL =
	'https://evantannermeta.github.io/revenge-next-bundle/revenge.bundle'

const INTERVALS = [
	{ label: '10 seconds', sec: 10 },
	{ label: '25 seconds', sec: 25 },
	{ label: '50 seconds', sec: 50 },
	{ label: '1 minute', sec: 60 },
	{ label: '2 minutes', sec: 120 },
]

interface Settings {
	intervalSec: number
	useCustomUrl: boolean
	customUrl: string
}

const DEFAULTS: Settings = { intervalSec: 60, useCustomUrl: false, customUrl: '' }

const effectiveUrl = (s: Settings) =>
	s.useCustomUrl && s.customUrl.trim() ? s.customUrl.trim() : DEFAULT_URL

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------

// Returns an identifier that changes whenever the bundle changes.
async function fetchVersionId(url: string): Promise<string | null> {
	const sep = url.includes('?') ? '&' : '?'
	try {
		log('HEAD request ->', url)
		const res = await fetch(`${url}${sep}t=${Date.now()}`, {
			method: 'HEAD',
			headers: { 'Cache-Control': 'no-cache' },
		})
		log('HEAD response status:', res.status)
		if (!res.ok) return null
		const id = res.headers.get('etag') ?? res.headers.get('last-modified')
		log('Version id (etag/last-modified):', String(id))
		return id
	} catch (e) {
		log('HEAD request failed (offline?):', String(e))
		return null
	}
}

function showUpdatePrompt(test: boolean, onNo: () => void) {
	log(test ? 'Showing TEST update prompt' : 'Showing update prompt')
	Alert.alert(
		test ? 'Update detected (test)' : 'Update detected',
		'A new Revenge update is available. Restart to get the latest update?',
		[
			{
				text: 'No',
				style: 'cancel',
				onPress: () => {
					log('User chose No')
					onNo()
				},
			},
			{
				text: 'Yes',
				onPress: () => {
					if (test) {
						log('TEST: user chose Yes (not restarting)')
						return
					}
					log('User chose Yes, reloading app')
					reloadApp()
				},
			},
		],
		{
			cancelable: true,
			onDismiss: () => {
				log('Prompt dismissed')
				onNo()
			},
		},
	)
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default plugin({
	// Loaded eagerly so jsonStorage.cache is ready in start().
	jsonStorage: { load: true, default: DEFAULTS },

	// Shown as the plugin's "Settings" page in Settings > Revenge > Plugins.
	SettingsComponent({ api }: { api: { jsonStorage: JsonStorage<Settings> } }) {
		const storage = api.jsonStorage
		const s: Settings = { ...DEFAULTS, ...(storage.use() ?? {}) }

		return (
			<Page>
			<ScrollView contentContainerStyle={{ gap: 16 }}>
				<Design.TableRowGroup title="Check interval">
					{INTERVALS.map(i => (
						<Design.TableRow
							key={i.sec}
							label={`${s.intervalSec === i.sec ? '✓  ' : '     '}${i.label}`}
							onPress={() => storage.set({ intervalSec: i.sec })}
						/>
					))}
				</Design.TableRowGroup>

				<Design.TableRowGroup title="Bundle link">
					<Design.TableSwitchRow
						label="Use custom link"
						subLabel="Off = default link"
						value={s.useCustomUrl}
						onValueChange={(v: boolean) => storage.set({ useCustomUrl: v })}
					/>
					{s.useCustomUrl ? (
						<View style={{ padding: 12 }}>
							<Design.TextInput
								label="Custom bundle link"
								size="md"
								placeholder={DEFAULT_URL}
								value={s.customUrl}
								onChange={(v: string) => storage.set({ customUrl: v })}
							/>
						</View>
					) : null}
					<Design.TableRow
						label="Currently checking"
						subLabel={effectiveUrl(s)}
					/>
				</Design.TableRowGroup>

				<View>
					<Design.Button
						variant="primary"
						text="Test update prompt"
						onPress={() => showUpdatePrompt(true, () => {})}
					/>
				</View>
			</ScrollView>
			</Page>
		)
	},

	start({ cleanup, jsonStorage, logger: pluginLogger }) {
		logger = pluginLogger
		log('Step 1: plugin starting')

		const storage = jsonStorage as JsonStorage<Settings>
		const getSettings = (): Settings => ({ ...DEFAULTS, ...(storage.cache ?? {}) })
		log('Step 2: loaded settings', JSON.stringify(getSettings()))

		// The loader already pulls the newest bundle on launch, so the first
		// value we see this session is our baseline. Anything different later = update.
		let known: string | null = null
		let prompting = false
		let checking = false
		let timer: ReturnType<typeof setInterval> | undefined
		let debounce: ReturnType<typeof setTimeout> | undefined
		let lastUrl = effectiveUrl(getSettings())
		let lastInterval = getSettings().intervalSec

		const check = async () => {
			if (checking || prompting) {
				log('Check skipped (already checking or prompt open)')
				return
			}
			checking = true
			try {
				log('Step 3: checking for update')
				const id = await fetchVersionId(effectiveUrl(getSettings()))
				if (!id) {
					log('No version id available, will retry next interval')
					return
				}
				if (known === null) {
					known = id
					log('Step 4: baseline set to', id)
					return
				}
				if (id === known) {
					log('Step 4: no change (still', id + ')')
					return
				}
				log('Step 4: CHANGE DETECTED', known, '->', id)
				prompting = true
				showUpdatePrompt(false, () => {
					known = id // don't nag again until it changes again
					prompting = false
				})
			} finally {
				checking = false
			}
		}

		const schedule = () => {
			if (timer) clearInterval(timer)
			const sec = getSettings().intervalSec
			log(`Scheduling checks every ${sec}s`)
			timer = setInterval(check, sec * 1000)
		}

		cleanup(
			storage.subscribe(() => {
				const s = getSettings()
				const url = effectiveUrl(s)
				if (url !== lastUrl) {
					lastUrl = url
					known = null
					log('Link changed, resetting baseline:', url)
					if (debounce) clearTimeout(debounce)
					debounce = setTimeout(check, 1500) // wait until typing stops
				}
				if (s.intervalSec !== lastInterval) {
					lastInterval = s.intervalSec
					schedule()
				}
			}),
			() => {
				log('Plugin stopping, cleaning up timers')
				if (timer) clearInterval(timer)
				if (debounce) clearTimeout(debounce)
			},
		)

		log('Step 3: first check now')
		check()
		schedule()
	},
})
