import { AlertActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { getStore, Stores } from '@revenge-mod/discord/flux'
import { Page } from '@revenge-mod/components'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { after, instead } from '@revenge-mod/patcher'
import type { PluginApi } from '@revenge-mod/plugins/types'
import { TextInput, View } from 'react-native'

interface NSFWSettings {
	nsfwBypass: boolean
	showWarningPopup: boolean
	lockNSFWChannels: boolean
	nsfwPassword: string
}

const DEFAULTS: NSFWSettings = {
	nsfwBypass: true,
	showWarningPopup: true,
	lockNSFWChannels: false,
	nsfwPassword: '',
}

type Api = PluginApi<{ jsonStorage: NSFWSettings }>

const ALERT_KEY = 'nsfw-gate-alert'

// ---------------------------------------------------------------------------
// Alert helpers (Design is only available from `init`, so only touch it inside functions)
// ---------------------------------------------------------------------------

function closeAlert() {
	// `dismissAlert` isn't in the documented API, so call it defensively.
	;(AlertActionCreators as any).dismissAlert?.(ALERT_KEY)
}

function showConfirm(opts: {
	title: string
	content: any
	confirmText: string
	cancelText?: string
	onConfirm?: () => void
}) {
	const { AlertModal, AlertActionButton, Stack } = Design

	AlertActionCreators.openAlert(
		ALERT_KEY,
		<AlertModal
			title={opts.title}
			content={opts.content}
			actions={
				<Stack>
					<AlertActionButton
						text={opts.confirmText}
						variant="primary"
						onPress={() => {
							closeAlert()
							opts.onConfirm?.()
						}}
					/>
					{opts.cancelText && (
						<AlertActionButton
							text={opts.cancelText}
							variant="secondary"
							onPress={closeAlert}
						/>
					)}
				</Stack>
			}
		/>,
	)
}

function PasswordPrompt({ onChange }: { onChange: (v: string) => void }) {
	const { Text } = Design

	return (
		<View style={{ gap: 8 }}>
			<Text variant="text-md/medium">
				Enter your access code to enter this NSFW channel.
			</Text>
			<TextInput
				placeholder="Enter password"
				placeholderTextColor="#AAAAAA"
				secureTextEntry
				autoFocus
				onChangeText={onChange}
				style={{
					borderWidth: 1,
					borderColor: '#FFFFFF',
					borderRadius: 4,
					padding: 8,
					color: '#FFFFFF',
					backgroundColor: 'rgba(255,255,255,0.1)',
				}}
			/>
		</View>
	)
}

// ---------------------------------------------------------------------------
// Settings screen
// ---------------------------------------------------------------------------

function Settings({ api }: { api: Api }) {
	const { TableRowGroup, TableSwitchRow, Text } = Design
	const s = { ...DEFAULTS, ...api.jsonStorage.use() }
	const set = (patch: Partial<NSFWSettings>) => api.jsonStorage.set(patch)

	return (
		<Page>
			<TableRowGroup title="NSFW Gate">
				<TableSwitchRow
					label="Bypass NSFW gate"
					subLabel="Skip NSFW invite / guild gating"
					value={s.nsfwBypass}
					onValueChange={(v: boolean) => set({ nsfwBypass: v })}
				/>
				<TableSwitchRow
					label="Warn before entering NSFW channels"
					value={s.showWarningPopup}
					onValueChange={(v: boolean) => set({ showWarningPopup: v })}
				/>
				<TableSwitchRow
					label="Lock NSFW channels with a password"
					subLabel="Needs the warning popup to be on"
					value={s.lockNSFWChannels}
					onValueChange={(v: boolean) => set({ lockNSFWChannels: v })}
				/>
			</TableRowGroup>

			{s.lockNSFWChannels && (
				<View style={{ padding: 16, gap: 8 }}>
					<Text variant="text-md/medium">Access code</Text>
					<TextInput
						placeholder="Set a password"
						placeholderTextColor="#AAAAAA"
						secureTextEntry
						defaultValue={s.nsfwPassword}
						onChangeText={(v: string) => set({ nsfwPassword: v })}
						style={{
							borderWidth: 1,
							borderColor: '#FFFFFF',
							borderRadius: 4,
							padding: 8,
							color: '#FFFFFF',
						}}
					/>
					<Text variant="text-sm/medium">
						Stored as plain text on your device. This is a speed bump, not security.
					</Text>
				</View>
			)}
		</Page>
	)
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default plugin({
	jsonStorage: { load: true, default: DEFAULTS },

	start({ cleanup, jsonStorage, logger }: Api) {
		// Read settings live so toggles apply without a reload.
		const cfg = (): NSFWSettings => ({ ...DEFAULTS, ...jsonStorage.cache })

		// 1) Gate bypass. These function names come from the old Vendetta plugin
		//    and may have changed in your Discord version: verify with DevTools.
		cleanup(
			getModules(withProps('isNSFWInvite'), NSFWModule => {
				for (const key of [
					'handleNSFWGuildInvite',
					'isNSFWInvite',
					'shouldNSFWGateGuild',
				]) {
					if (typeof NSFWModule[key] !== 'function') continue

					cleanup(
						instead(NSFWModule, key, (args: any[], orig: any) =>
							cfg().nsfwBypass ? false : orig(...args),
						),
					)
				}
			}),
		)

		// 2) Mark the current user as NSFW-allowed.
		cleanup(
			getStore<any>('UserStore', UserStore => {
				cleanup(
					after(UserStore, 'getCurrentUser', (_args: any[], user: any) => {
						if (
							cfg().nsfwBypass &&
							user &&
							Object.hasOwn(user, 'nsfwAllowed')
						) {
							user.nsfwAllowed = true
						}
						return user
					}),
				)
			}),
		)

		// 3) Warning popup / password lock when navigating into an NSFW channel.
		cleanup(
			getModules(withProps('transitionToGuild'), Nav => {
				if (typeof Nav.transitionToGuild !== 'function') return

				cleanup(
					instead(Nav, 'transitionToGuild', (args: any[], orig: any) => {
						const settings = cfg()
						const path = args[0]

						if (!settings.showWarningPopup || typeof path !== 'string') {
							return orig(...args)
						}

						const channelId = path.match(/(\d+)$/)?.[1]
						const channel = channelId
							? Stores.ChannelStore.getChannel(channelId)
							: undefined

						if (!channel?.nsfw) return orig(...args)

						if (settings.lockNSFWChannels && settings.nsfwPassword) {
							let entered = ''

							showConfirm({
								title: '🔒 NSFW Channel Locked',
								content: <PasswordPrompt onChange={v => (entered = v)} />,
								confirmText: 'Unlock',
								cancelText: 'Cancel',
								onConfirm: () => {
									if (entered === cfg().nsfwPassword) {
										orig(...args)
									} else {
										showConfirm({
											title: '❌ Incorrect Password',
											content: 'The password you entered is incorrect.',
											confirmText: 'OK',
										})
									}
								},
							})
						} else {
							showConfirm({
								title: 'WARNING: Entering NSFW channel',
								content:
									'This channel contains content that may not be suitable for all audiences. Proceed with caution.',
								confirmText: 'Proceed with Caution',
								cancelText: 'Cancel',
								onConfirm: () => orig(...args),
							})
						}
					}),
				)
			}),
		)

		logger.log('NSFW Gate started')
	},

	SettingsComponent: Settings,
})
