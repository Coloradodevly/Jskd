import { Design } from '@revenge-mod/discord/design'
import { onFluxEventDispatched } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { before } from '@revenge-mod/patcher'
import { cleanContent } from './clean'

interface Settings {
	/** Clean links in messages you send or edit. */
	cleanSent: boolean
	/** Clean links in messages you receive. */
	cleanReceived: boolean
}

const DEFAULTS: Settings = { cleanSent: true, cleanReceived: true }

type Args = unknown[]

/** Cleans `args[index].content` in place. Returns the same args array. */
function cleanArgContent(args: Args, index: number) {
	const message = args[index] as { content?: unknown } | undefined
	if (message && typeof message.content === 'string')
		message.content = cleanContent(message.content)
	return args
}

/** Cleans a message object's content, and the content of the message it replies to. */
function cleanMessage(message: unknown) {
	const m = message as
		| { content?: unknown; referenced_message?: { content?: unknown } | null }
		| undefined
	if (!m) return
	if (typeof m.content === 'string') m.content = cleanContent(m.content)
	const reply = m.referenced_message
	if (reply && typeof reply.content === 'string')
		reply.content = cleanContent(reply.content)
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DEFAULTS,
	},

	start({ cleanup, jsonStorage, logger }) {
		const on = (key: keyof Settings) =>
			jsonStorage.cache?.[key] ?? DEFAULTS[key]

		// Received: clean message content as it enters Discord's stores.
		// NOTE: a Flux handler must return the payload, or the event is blocked.
		cleanup(
			onFluxEventDispatched('MESSAGE_CREATE', (payload: any) => {
				if (on('cleanReceived')) cleanMessage(payload?.message)
				return payload
			}),
			onFluxEventDispatched('MESSAGE_UPDATE', (payload: any) => {
				if (on('cleanReceived')) cleanMessage(payload?.message)
				return payload
			}),
			...['LOAD_MESSAGES_SUCCESS', 'LOAD_MESSAGES_AROUND_SUCCESS'].map(event =>
				onFluxEventDispatched(
					event as 'LOAD_MESSAGES_SUCCESS',
					(payload: any) => {
						if (on('cleanReceived'))
							for (const message of payload?.messages ?? [])
								cleanMessage(message)
						return payload
					},
				),
			),
		)

		// Sent: clean the outgoing message before Discord sends or edits it.
		const unpatches: (() => void)[] = []
		cleanup(
			getModules(withProps('sendMessage', 'receiveMessage'), (actions: any) => {
				// sendMessage(channelId, message, ...) and editMessage(channelId, messageId, message)
				unpatches.push(
					before(actions, 'sendMessage', (args: Args) =>
						on('cleanSent') ? cleanArgContent(args, 1) : args,
					),
				)
				if (typeof actions.editMessage === 'function')
					unpatches.push(
						before(actions, 'editMessage', (args: Args) =>
							on('cleanSent') ? cleanArgContent(args, 2) : args,
						),
					)
				logger.log('Patched outgoing message functions')
			}),
			() => {
				for (const unpatch of unpatches.splice(0)) unpatch()
			},
		)
	},

	SettingsComponent({ api }) {
		const { TableRow, TableRowGroup, TableSwitchRow } = Design
		const settings = api.jsonStorage.use()

		return (
			<>
				<TableRowGroup title="Clean links">
					<TableSwitchRow
						label="Messages you send"
						subLabel="Clean links before they are sent or edited"
						value={settings?.cleanSent ?? DEFAULTS.cleanSent}
						onValueChange={(cleanSent: boolean) =>
							api.jsonStorage.set({ cleanSent })
						}
					/>
					<TableSwitchRow
						label="Messages you receive"
						subLabel="Clean links in what other people send"
						value={settings?.cleanReceived ?? DEFAULTS.cleanReceived}
						onValueChange={(cleanReceived: boolean) =>
							api.jsonStorage.set({ cleanReceived })
						}
					/>
				</TableRowGroup>
				<TableRowGroup title="About">
					<TableRow
						label="What is removed"
						subLabel="Tracking parameters like utm_*, fbclid and gclid everywhere, plus site-specific ones such as the share id on YouTube, Spotify and X links. Links inside code blocks are left alone."
					/>
				</TableRowGroup>
			</>
		)
	},
})
