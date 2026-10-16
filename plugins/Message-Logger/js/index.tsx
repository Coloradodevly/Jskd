import { Design } from '@revenge-mod/discord/design'
import { onFluxEventDispatched, Stores } from '@revenge-mod/discord/flux'
import { Clipboard } from '@revenge-mod/externals/react-native-clipboard'
import type { JsonStorage } from '@revenge-mod/json-storage'
import { getModules } from '@revenge-mod/modules/finders'
import { createFilterGenerator } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { useState } from 'react'
import { Alert, Image, Linking, ScrollView, Share } from 'react-native'

// ---------------------------------------------------------------------------
// Settings + log storage
// ---------------------------------------------------------------------------

type ExportFormat = 'text' | 'json'

interface Settings {
	enabled: boolean
	/** Also keep messages you deleted yourself. */
	logOwn: boolean
	/** Show "(deleted)" after the message, where the "(edited)" label normally goes. */
	showLabel: boolean
	/** Save attachment links with each logged message. */
	logAttachments: boolean
	/** Show image previews for saved attachments in the log. */
	showPreviews: boolean
	/** Format used by the Copy and Share buttons. */
	exportFormat: ExportFormat
	maxLogged: number
	/** JSON array of Entry, newest first. Stored as a string so clearing it is safe. */
	entries: string
}

interface FileInfo {
	name: string
	/** Original attachment link. */
	url: string
	/** Media-proxy link, usually the one that still loads images. */
	proxyUrl?: string
	type?: string
	size?: number
}

interface Entry {
	id: string
	author: string
	where: string
	content: string
	/** Number of attachments (older entries only have this). */
	attachments: number
	/** Saved attachment details, when "Save attachments" was on. */
	files?: FileInfo[]
	deletedAt: number
}

const DEFAULTS: Settings = {
	enabled: true,
	logOwn: false,
	showLabel: true,
	logAttachments: true,
	showPreviews: true,
	exportFormat: 'text',
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

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp)$/i

const isImage = (f: FileInfo) =>
	!!f.type?.startsWith('image/') || IMAGE_NAME.test(f.name)

/** Reads attachment details off a message. Field names differ between Discord versions. */
function collectFiles(message: any): FileInfo[] {
	const list = message?.attachments
	if (!Array.isArray(list)) return []

	return list
		.slice(0, 10)
		.map((a: any): FileInfo => {
			const size = a.size
			return {
				name: String(a.filename ?? a.name ?? 'file'),
				url: String(a.url ?? a.proxy_url ?? a.proxyURL ?? a.proxyUrl ?? ''),
				proxyUrl:
					a.proxy_url ?? a.proxyURL ?? a.proxyUrl
						? String(a.proxy_url ?? a.proxyURL ?? a.proxyUrl)
						: undefined,
				type: a.content_type ?? a.contentType ?? undefined,
				size: typeof size === 'number' ? size : undefined,
			}
		})
		.filter(f => f.url)
}

function makeEntry(
	message: any,
	channelId: string,
	guildId: string | undefined,
	saveFiles: boolean,
): Entry {
	const author =
		message.author?.globalName ??
		message.author?.username ??
		(Stores as any).UserStore?.getUser?.(message.author?.id)?.username ??
		'Unknown'

	const files = saveFiles ? collectFiles(message) : []

	// Warm the image cache now, while the links still work.
	for (const f of files) {
		if (isImage(f)) Image.prefetch(f.proxyUrl ?? f.url).catch(() => {})
	}

	return {
		id: message.id,
		author,
		where: describeWhere(channelId, guildId),
		content: String(message.content ?? '').slice(0, 1000),
		attachments: message.attachments?.length ?? 0,
		files: files.length ? files : undefined,
		deletedAt: Date.now(),
	}
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function formatSize(bytes?: number) {
	if (!bytes) return ''
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toText(entries: Entry[]) {
	return entries
		.map(e => {
			const lines = [
				`[${new Date(e.deletedAt).toLocaleString()}] ${e.author} · ${e.where}`,
				e.content || '(no text)',
			]

			if (e.files?.length) {
				lines.push(
					'Attachments:',
					...e.files.map(
						f =>
							`  - ${f.name}${f.size ? ` (${formatSize(f.size)})` : ''}: ${f.url}`,
					),
				)
			} else if (e.attachments) {
				lines.push(`Attachments: ${e.attachments} (links not saved)`)
			}

			return lines.join('\n')
		})
		.join('\n\n---\n\n')
}

function toJson(entries: Entry[]) {
	return JSON.stringify(
		{
			exportedAt: new Date().toISOString(),
			count: entries.length,
			entries: entries.map(e => ({
				...e,
				deletedAt: new Date(e.deletedAt).toISOString(),
			})),
		},
		null,
		2,
	)
}

const build = (entries: Entry[], format: ExportFormat) =>
	format === 'json' ? toJson(entries) : toText(entries)

// Android's share sheet fails on very large text, so stay well under its limit.
const SHARE_LIMIT = 300_000

// ---------------------------------------------------------------------------
// Attachment preview (settings screen)
// ---------------------------------------------------------------------------

function AttachmentView({ file, preview }: { file: FileInfo; preview: boolean }) {
	const { Button, Stack, Text } = Design
	const [failed, setFailed] = useState(false)
	const showImage = preview && isImage(file) && !failed

	return (
		<Stack spacing={4}>
			{showImage ? (
				<Image
					source={{ uri: file.proxyUrl ?? file.url }}
					style={{ width: '100%', height: 180, borderRadius: 8 }}
					resizeMode="contain"
					onError={() => setFailed(true)}
				/>
			) : null}
			<Text variant="text-sm/medium" selectable>
				{file.name}
				{file.size ? ` · ${formatSize(file.size)}` : ''}
				{failed ? ' · preview unavailable (the link may have expired)' : ''}
			</Text>
			<Button
				variant="secondary"
				size="sm"
				text="Open link"
				onPress={() => {
					Linking.openURL(file.url).catch(() => {})
				}}
			/>
		</Stack>
	)
}

// ---------------------------------------------------------------------------
// Chat row manager
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

		const copyLog = () => {
			try {
				Clipboard.setString(build(entries, s.exportFormat))
				Alert.alert('Copied', `${entries.length} message(s) copied as ${s.exportFormat}.`)
			} catch (e) {
				Alert.alert("Couldn't copy", String(e))
			}
		}

		const shareLog = async () => {
			try {
				let subset = entries
				let text = build(subset, s.exportFormat)

				// Newest entries come first, so trimming keeps the most recent ones.
				while (text.length > SHARE_LIMIT && subset.length > 1) {
					subset = subset.slice(0, Math.max(1, Math.floor(subset.length / 2)))
					text = build(subset, s.exportFormat)
				}

				if (subset.length < entries.length) {
					Alert.alert(
						'Log is large',
						`Sharing the newest ${subset.length} of ${entries.length} messages. Use Copy to export everything.`,
					)
				}

				await Share.share({ title: 'Message Logger export', message: text })
			} catch (e) {
				Alert.alert("Couldn't share", String(e))
			}
		}

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

				<TableRowGroup title="Attachments">
					<TableSwitchRow
						label="Save attachments"
						subLabel="Keeps links to deleted files in the log. Applies to new deletions."
						value={s.logAttachments}
						onValueChange={(v: boolean) => storage.set({ logAttachments: v })}
					/>
					<TableSwitchRow
						label="Show image previews"
						subLabel="Loads saved images in the log below"
						value={s.showPreviews}
						onValueChange={(v: boolean) => storage.set({ showPreviews: v })}
					/>
				</TableRowGroup>

				<Stack spacing={8}>
					<Text variant="text-md/semibold">Export</Text>
					<Stack spacing={8} direction="horizontal">
						<Button
							size="sm"
							text="Text"
							variant={s.exportFormat === 'text' ? 'primary' : 'secondary'}
							onPress={() => storage.set({ exportFormat: 'text' })}
						/>
						<Button
							size="sm"
							text="JSON"
							variant={s.exportFormat === 'json' ? 'primary' : 'secondary'}
							onPress={() => storage.set({ exportFormat: 'json' })}
						/>
					</Stack>
					<Stack spacing={8} direction="horizontal">
						<Button
							size="sm"
							variant="secondary"
							text="Copy"
							disabled={!entries.length}
							onPress={copyLog}
						/>
						<Button
							size="sm"
							variant="secondary"
							text="Share"
							disabled={!entries.length}
							onPress={shareLog}
						/>
					</Stack>
				</Stack>

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
						<Stack spacing={6}>
							<Text variant="text-md/semibold">{e.author}</Text>
							<Text variant="text-sm/medium">
								{e.where} · {new Date(e.deletedAt).toLocaleString()}
							</Text>
							<Text variant="text-md/medium" selectable>
								{e.content || '(no text)'}
							</Text>
							{e.files?.length ? (
								e.files.map(f => (
									<AttachmentView
										key={`${f.url}`}
										file={f}
										preview={s.showPreviews}
									/>
								))
							) : e.attachments ? (
								<Text variant="text-sm/medium">
									{e.attachments} attachment(s), links weren't saved
								</Text>
							) : null}
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
					const s = getSettings()
					if (!s.enabled) return payload
					if (deletedIds.has(payload.id)) return undefined // already kept

					const message = getCachedMessage(payload.channelId, payload.id)
					if (!message) {
						log('Deleted message not cached, letting it through:', payload.id)
						return payload
					}
					if (isOwn(message) && !s.logOwn) return payload

					const entry = makeEntry(message, payload.channelId, payload.guildId, s.logAttachments)
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
						save(makeEntry(message, payload.channelId, payload.guildId, s.logAttachments))
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
						// An `after` hook receives only the return value.
						after(cls.prototype, 'generate', (row: any) => {
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
