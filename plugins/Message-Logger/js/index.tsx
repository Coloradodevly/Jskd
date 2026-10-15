import { Design } from '@revenge-mod/discord/design'
import { onFluxEventDispatched, Stores } from '@revenge-mod/discord/flux'
import type { JsonStorage } from '@revenge-mod/json-storage'
import { getModules } from '@revenge-mod/modules/finders'
import { createFilterGenerator } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'

// ---------------------------------------------------------------------------
// Settings + log storage
// ---------------------------------------------------------------------------

interface Settings {
	enabled: boolean
	/** Also keep messages you deleted yourself. */
	logOwn: boolean
	/** Show "(deleted)" after the message, where the "(edited)" label normally goes. */
	showLabel: boolean
	maxLogged: number
	/** JSON array of Entry, newest first. Stored as a string so clearing it is safe. */
	entries: string
}

interface Entry {
	id: string
	author: string
	where: string
	content: string
	attachments: number
	deletedAt: number
}

const DEFAULTS: Settings = {
	enabled: true,
	logOwn: false,
	showLabel: true,
	maxLogged: 200,
	entries: '[]',
}

function parseEntries(raw: string): Entry[] {
	try {
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

// Discord stores colors as signed 32-bit ARGB ints.
const RED = (0xff000000 | 0xed4245) | 0

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

type PluginLogger = { log(...a: unknown[]): void }
let logger: PluginLogger | undefined

function log(...args: unknown[]) {
	console.log('[message-logger]', ...args)
	try {
		logger?.log(args.map(String).join(' '))
	} catch {}
}

// ---------------------------------------------------------------------------
// Deleted-message tracking
// ---------------------------------------------------------------------------

/** Ids of messages that were deleted while we could still see them. */
const deletedIds = new Set<string>()

function describeWhere(channelId: string, guildId?: string): string {
	try {
		const st = Stores as any
		const channel = st.ChannelStore?.getChannel?.(channelId)
		const guild = guildId ? st.GuildStore?.getGuild?.(guildId) : null
		const name = channel?.name ? `#${channel.name}` : 'DM'
		return guild?.name ? `${guild.name} · ${name}` : name
	} catch {
		return channelId
	}
}

function getCachedMessage(channelId: string, id: string): any {
	try {
		return (Stores as any).MessageStore?.getMessage?.(channelId, id)
	} catch {
		return undefined
	}
}

function isOwn(message: any): boolean {
	try {
		const me = (Stores as any).UserStore?.getCurrentUser?.()?.id
		return !!me && message?.author?.id === me
	} catch {
		return false
	}
}

function makeEntry(message: any, channelId: string, guildId?: string): Entry {
	const author =
		message.author?.globalName ??
		message.author?.username ??
		(Stores as any).UserStore?.getUser?.(message.author?.id)?.username ??
		'Unknown'
	return {
		id: message.id,
		author,
		where: describeWhere(channelId, guildId),
		content: String(message.content ?? '').slice(0, 1000),
		attachments: message.attachments?.length ?? 0,
		deletedAt: Date.now(),
	}
}

// ---------------------------------------------------------------------------
// Settings screen
// ---------------------------------------------------------------------------

// Finds Discord's chat row manager: a class whose prototype has `generate`.
const withGenerate = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const t = typeof exports
		if (!exports || (t !== 'object' && t !== 'function')) return false
		return (
			typeof exports.prototype?.generate === 'function' ||
			typeof exports.default?.prototype?.generate === 'function'
		)
	},
	() => 'message-logger.generate',
)

export default plugin({
	jsonStorage: { load: true, default: DEFAULTS },

	SettingsComponent({ api }: { api: { jsonStorage: JsonStorage<Settings> } }) {
		const { Button, Card, Stack, Text, TextInput, TableRowGroup, TableSwitchRow } =
			Design
		const storage = api.jsonStorage
		const s: Settings = { ...DEFAULTS, ...(storage.use() ?? {}) }
		const entries = parseEntries(s.entries)
		const [maxText, setMaxText] = useState(String(s.maxLogged))

		const confirmClear = () =>
			Alert.alert('Clear the log?', `This removes all ${entries.length} saved messages.`, [
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Clear',
					style: 'destructive',
					onPress: () => {
						storage.set({ entries: '[]' })
						log('Log cleared')
					},
				},
			])

		return (
			<ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
				<TableRowGroup title="Message Logger">
					<TableSwitchRow
						label="Keep deleted messages"
						subLabel="They stay in chat and turn red"
						value={s.enabled}
						onValueChange={(v: boolean) => storage.set({ enabled: v })}
					/>
					<TableSwitchRow
						label="Include my own deleted messages"
						value={s.logOwn}
						onValueChange={(v: boolean) => storage.set({ logOwn: v })}
					/>
					<TableSwitchRow
						label='Show "(deleted)" label'
						value={s.showLabel}
						onValueChange={(v: boolean) => storage.set({ showLabel: v })}
					/>
					<TextInput
						label="Max saved messages (10 to 1000)"
						size="md"
						value={maxText}
						onChange={(v: string) => {
							setMaxText(v)
							const n = Number.parseInt(v, 10)
							if (n >= 10 && n <= 1000) storage.set({ maxLogged: n })
						}}
					/>
				</TableRowGroup>

				<Stack spacing={8}>
					<Text variant="text-md/semibold">Saved messages ({entries.length})</Text>
					{entries.length ? (
						<Button variant="secondary" text="Clear log" onPress={confirmClear} />
					) : (
						<Text variant="text-sm/medium">
							Nothing yet. Deleted messages show up here once someone deletes one
							you can see.
						</Text>
					)}
				</Stack>

				{entries.slice(0, 50).map(e => (
					<Card key={`${e.id}-${e.deletedAt}`}>
						<Stack spacing={4}>
							<Text variant="text-md/semibold">{e.author}</Text>
							<Text variant="text-sm/medium">
								{e.where} · {new Date(e.deletedAt).toLocaleString()}
							</Text>
							<Text variant="text-md/medium" selectable>
								{e.content || '(no text)'}
								{e.attachments ? `  [${e.attachments} attachment(s)]` : ''}
							</Text>
						</Stack>
					</Card>
				))}
			</ScrollView>
		)
	},

	start({ cleanup, jsonStorage, logger: pluginLogger }) {
		logger = pluginLogger
		log('Step 1: plugin starting')
		const storage = jsonStorage as JsonStorage<Settings>
		const getSettings = (): Settings => ({ ...DEFAULTS, ...(storage.cache ?? {}) })

		const save = (entry: Entry) => {
			const s = getSettings()
			const next = [entry, ...parseEntries(s.entries)].slice(0, s.maxLogged)
			storage.set({ entries: JSON.stringify(next) })
		}

		// Ask Discord's store to tell the UI something changed so rows redraw.
		const refresh = () => {
			setTimeout(() => {
				try {
					;(Stores as any).MessageStore?.emitChange?.()
				} catch {}
			}, 0)
		}

		log('Step 2: intercepting MESSAGE_DELETE and MESSAGE_DELETE_BULK')
		cleanup(
			onFluxEventDispatched('MESSAGE_DELETE', (payload: any) => {
				try {
					if (!getSettings().enabled) return payload
					if (deletedIds.has(payload.id)) return undefined // already kept

					const message = getCachedMessage(payload.channelId, payload.id)
					if (!message) {
						log('Deleted message not cached, letting it through:', payload.id)
						return payload
					}
					if (isOwn(message) && !getSettings().logOwn) return payload

					const entry = makeEntry(message, payload.channelId, payload.guildId)
					deletedIds.add(payload.id)
					save(entry)
					log('Kept deleted message', payload.id, 'from', entry.author)
					refresh()
					return undefined // block the delete so the message stays
				} catch (e) {
					log('MESSAGE_DELETE handler failed, letting it through:', String(e))
					return payload
				}
			}),

			onFluxEventDispatched('MESSAGE_DELETE_BULK', (payload: any) => {
				try {
					const s = getSettings()
					if (!s.enabled) return payload

					const found = (payload.ids as string[])
						.map(id => getCachedMessage(payload.channelId, id))
						.filter(Boolean)
					if (!found.length) return payload
					if (!s.logOwn && found.some(isOwn)) return payload

					for (const message of found) {
						deletedIds.add(message.id)
						save(makeEntry(message, payload.channelId, payload.guildId))
					}
					log(`Kept ${found.length} bulk-deleted message(s)`)
					refresh()
					return undefined
				} catch (e) {
					log('MESSAGE_DELETE_BULK handler failed, letting it through:', String(e))
					return payload
				}
			}),
		)

		log('Step 3: patching the chat row manager to color kept messages')
		cleanup(
			getModules(withGenerate(), (exports: any, id: number) => {
				try {
					const cls = exports.prototype?.generate ? exports : exports.default
					log(`Patching generate() on module ${id}`)
					cleanup(
						// Docs: after hooks receive (args, ret, self). Handle both signatures.
						after(cls.prototype, 'generate', (a: any, b: any) => {
							const row = Array.isArray(a) ? b : a
							try {
								const msg = row?.message
								if (msg?.id && deletedIds.has(msg.id)) {
									msg.textColor = RED
									if (getSettings().showLabel) {
										msg.edited = '(deleted)'
										msg.editedColor = RED
									}
								}
							} catch {}
							return row
						}),
					)
				} catch (e) {
					log(`Patch failed on module ${id}:`, String(e))
				}
			}),
		)
	},
})
