import { Design } from '@revenge-mod/discord/design'
import type { JsonStorage } from '@revenge-mod/json-storage'
import { callNativeMethod } from '@revenge-mod/modules/native'
import { useEffect, useState } from 'react'
import { Alert, AppState, ScrollView } from 'react-native'

/**
 * Sends an Android notification for ghost pings detected by Message Logger.
 * Message Logger is a dependency (see manifest.json), so it is always started first and
 * exposes its API on `api.messageLogger`.
 */

// ---------------------------------------------------------------------------
// Message Logger's API (mirrors what that plugin exposes)
// ---------------------------------------------------------------------------

interface GhostPing {
	id: string
	author: string
	where: string
	content: string
	/** What they pinged, for example "pinged you". */
	kind: string
	how: 'deleted' | 'edited'
	at: number
}

interface MessageLoggerApi {
	/** Calls `listener` for every ghost ping. Returns a function that stops listening. */
	onGhostPing(listener: (ping: GhostPing) => void): () => void
}

// ---------------------------------------------------------------------------
// Native bridge (src/main/kotlin/.../GhostPingNotifications.kt)
// ---------------------------------------------------------------------------

declare module '@revenge-mod/modules/native' {
	export interface NativeMethods {
		'evantanner.ghost-ping-notifications.notify': [
			[title: string, body: string],
			string,
		]
		'evantanner.ghost-ping-notifications.status': [[], string]
		'evantanner.ghost-ping-notifications.requestPermission': [[], string]
	}
}

const notifyNative = (title: string, body: string) =>
	callNativeMethod('evantanner.ghost-ping-notifications.notify', [title, body])
const statusNative = () =>
	callNativeMethod('evantanner.ghost-ping-notifications.status', [])
const requestPermissionNative = () =>
	callNativeMethod('evantanner.ghost-ping-notifications.requestPermission', [])

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface Settings {
	enabled: boolean
	/** Skip the notification while Discord is open, since Message Logger already shows an alert. */
	onlyInBackground: boolean
	/** Include the message text. It is visible on the lock screen. */
	showText: boolean
}

const DEFAULTS: Settings = {
	enabled: true,
	onlyInBackground: true,
	showText: true,
}

function compose(ping: GhostPing, showText: boolean) {
	const what = ping.how === 'deleted' ? 'deleted the message' : 'edited the ping out'
	const lines = [`${ping.kind} in ${ping.where} and then ${what}.`]
	if (showText) lines.push(ping.content || '(no text)')

	return {
		title: `Ghost ping from ${ping.author}`,
		body: lines.join('\n').slice(0, 500),
	}
}

type PluginLogger = { log(...a: unknown[]): void; warn(...a: unknown[]): void }
let logger: PluginLogger | undefined

export default plugin({
	jsonStorage: { load: true, default: DEFAULTS },

	SettingsComponent({ api }) {
		const { Button, Stack, Text, TableRowGroup, TableSwitchRow } = Design
		const storage = api.jsonStorage as unknown as JsonStorage<Settings>
		const s: Settings = { ...DEFAULTS, ...(storage.use() ?? {}) }

		// undefined = not checked yet, null = the native part isn't loaded
		const [status, setStatus] = useState<{ enabled: boolean; sdk: number } | null | undefined>()
		const [refreshKey, setRefreshKey] = useState(0)

		useEffect(() => {
			let alive = true
			statusNative()
				.then(raw => alive && setStatus(JSON.parse(raw)))
				.catch(() => alive && setStatus(null))
			return () => {
				alive = false
			}
		}, [refreshKey])

		const allow = async () => {
			try {
				const result = await requestPermissionNative()
				if (result === 'granted') {
					Alert.alert('Already allowed', 'Discord can already send notifications.')
				}
				// Give the system dialog a moment, then re-check.
				setTimeout(() => setRefreshKey(k => k + 1), 2000)
			} catch (e) {
				Alert.alert("Couldn't ask for permission", String(e))
			}
		}

		const sendTest = async () => {
			try {
				const result = await notifyNative(
					'Ghost ping from Example',
					'pinged you in Example Server · #general and then deleted the message.',
				)
				if (result !== 'shown') Alert.alert("Couldn't send the notification", result)
			} catch (e) {
				Alert.alert("Couldn't send the notification", String(e))
			}
		}

		return (
			<ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
				<TableRowGroup title="Ghost Ping Notifications">
					<TableSwitchRow
						label="Send notifications"
						subLabel="When someone pings you and then deletes the message"
						value={s.enabled}
						onValueChange={(v: boolean) => storage.set({ enabled: v })}
					/>
					<TableSwitchRow
						label="Only when Discord isn't open"
						subLabel="Message Logger already shows an alert inside the app"
						value={s.onlyInBackground}
						onValueChange={(v: boolean) => storage.set({ onlyInBackground: v })}
					/>
					<TableSwitchRow
						label="Show the message text"
						subLabel="The text is visible on the lock screen"
						value={s.showText}
						onValueChange={(v: boolean) => storage.set({ showText: v })}
					/>
				</TableRowGroup>

				<Stack spacing={8}>
					<Text variant="text-md/semibold">Permission</Text>
					<Text variant="text-sm/medium">
						{status === undefined
							? 'Checking…'
							: status === null
								? 'The native part of this plugin is not loaded, so notifications cannot be sent.'
								: status.enabled
									? 'Discord is allowed to send notifications.'
									: 'Notifications are off for Discord. Allow them below, or in Android settings.'}
					</Text>
					<Stack spacing={8} direction="horizontal">
						<Button
							size="sm"
							variant="secondary"
							text="Allow notifications"
							disabled={!status || status.enabled}
							onPress={allow}
						/>
						<Button
							size="sm"
							variant="secondary"
							text="Send a test"
							disabled={!status}
							onPress={sendTest}
						/>
					</Stack>
				</Stack>

				<Text variant="text-sm/medium">
					Notifications only arrive while Discord is still running in the background.
					Android may stop it after a while, and then nothing can be detected.
				</Text>
			</ScrollView>
		)
	},

	start(api) {
		const { cleanup, jsonStorage, logger: pluginLogger } = api
		logger = pluginLogger as PluginLogger

		const messageLogger = (api as unknown as { messageLogger?: MessageLoggerApi })
			.messageLogger
		if (!messageLogger) {
			logger.warn('Message Logger did not provide its API, so there is nothing to listen to')
			return
		}

		const storage = jsonStorage as JsonStorage<Settings>
		const getSettings = (): Settings => ({ ...DEFAULTS, ...(storage.cache ?? {}) })

		cleanup(
			messageLogger.onGhostPing(ping => {
				try {
					const s = getSettings()
					if (!s.enabled) return
					// While Discord is open, Message Logger's own alert is already showing.
					if (s.onlyInBackground && AppState.currentState === 'active') return

					const { title, body } = compose(ping, s.showText)
					notifyNative(title, body)
						.then(result => {
							if (result !== 'shown') logger?.warn('Notification not shown:', result)
						})
						.catch(e => logger?.warn('Notification failed:', String(e)))
				} catch (e) {
					logger?.warn('Ghost ping notification failed:', String(e))
				}
			}),
		)

		logger.log('Listening for ghost pings from Message Logger')
	},
})
