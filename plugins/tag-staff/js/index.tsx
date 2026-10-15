import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
import type { JsonStorage } from '@revenge-mod/json-storage'
import { getModules } from '@revenge-mod/modules/finders'
import { createFilterGenerator } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { useState } from 'react'
import { ScrollView } from 'react-native'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface Settings {
	defaultTag: string
	/** Hex color of the tag background, e.g. "5865F2". */
	color: string
	/** The server owner has every permission implicitly. */
	tagOwner: boolean
	/** JSON object: { [userId]: tagText }. Stored as a string so removing a key is safe. */
	overrides: string
}

const DEFAULTS: Settings = {
	defaultTag: 'STAFF',
	color: '5865F2',
	tagOwner: true,
	overrides: '{}',
}

const HEX = /^#?([0-9a-f]{6})$/i
const USER_ID = /^\d{15,25}$/

let overridesCache: { raw: string; value: Record<string, string> } = {
	raw: '{}',
	value: {},
}

function parseOverrides(raw: string): Record<string, string> {
	if (overridesCache.raw === raw) return overridesCache.value
	let value: Record<string, string> = {}
	try {
		const parsed = JSON.parse(raw)
		if (parsed && typeof parsed === 'object') value = parsed
	} catch {}
	overridesCache = { raw, value }
	return value
}

// Discord stores colors as signed 32-bit ARGB ints (see tagBackgroundColor in the dump).
function toColor(hex: string): number {
	const m = HEX.exec(hex.trim())
	const rgb = Number.parseInt(m ? m[1]! : DEFAULTS.color, 16)
	return (0xff000000 | rgb) | 0
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

type PluginLogger = { log(...a: unknown[]): void }
let logger: PluginLogger | undefined
const warned = new Set<string>()

function log(...args: unknown[]) {
	console.log('[staff-tags]', ...args)
	try {
		logger?.log(args.map(String).join(' '))
	} catch {}
}

function warnOnce(key: string, ...args: unknown[]) {
	if (warned.has(key)) return
	warned.add(key)
	log(...args)
}

// ---------------------------------------------------------------------------
// Permission check
// ---------------------------------------------------------------------------

const ADMINISTRATOR = BigInt(8) // 1 << 3

function getRoles(guildId: string, guild: any): Record<string, any> | undefined {
	const s = Stores as any
	try {
		const a = s.GuildRoleStore?.getRoles?.(guildId)
		if (a) return a
	} catch {}
	try {
		const b = s.GuildStore?.getRoles?.(guildId)
		if (b) return b
	} catch {}
	return guild?.roles
}

function isAdmin(guildId: string, userId: string, tagOwner: boolean): boolean {
	try {
		const s = Stores as any
		const guild = s.GuildStore?.getGuild?.(guildId)

		if (tagOwner && guild?.ownerId === userId) return true

		const member = s.GuildMemberStore?.getMember?.(guildId, userId)
		if (!member?.roles?.length) return false

		const roles = getRoles(guildId, guild)
		if (!roles) {
			warnOnce('no-roles', 'Could not find a role source (GuildRoleStore/GuildStore)')
			return false
		}

		for (const roleId of member.roles) {
			const perms = roles[roleId]?.permissions
			if (perms != null && (BigInt(perms) & ADMINISTRATOR) === ADMINISTRATOR) {
				return true
			}
		}
	} catch (e) {
		warnOnce('admin-check', 'Admin check failed:', String(e))
	}
	return false
}

// ---------------------------------------------------------------------------
// Row patch
// ---------------------------------------------------------------------------

function applyTag(settings: Settings, row: any) {
	const msg = row?.message
	if (!msg?.authorId) return

	const overrides = parseOverrides(settings.overrides)
	const custom = overrides[msg.authorId]

	let text: string | null = null
	if (custom !== undefined) {
		// An override always wins; empty text means "use the default tag".
		text = custom || settings.defaultTag
	} else if (
		msg.guildId &&
		msg.tagText == null && // don't replace BOT / APP / etc. tags
		isAdmin(msg.guildId, msg.authorId, settings.tagOwner)
	) {
		text = settings.defaultTag
	}
	if (!text) return

	msg.tagText = text
	msg.tagBackgroundColor = toColor(settings.color)
	msg.tagTextColor = -1 // white
	msg.tagVerified = false
}

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
	() => 'staff-tags.generate',
)

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default plugin({
	jsonStorage: { load: true, default: DEFAULTS },

	SettingsComponent({ api }: { api: { jsonStorage: JsonStorage<Settings> } }) {
		const { Button, Text, TextInput, TableRow, TableRowGroup, TableSwitchRow } =
			Design
		const storage = api.jsonStorage
		const s: Settings = { ...DEFAULTS, ...(storage.use() ?? {}) }
		const overrides = parseOverrides(s.overrides)

		const [newId, setNewId] = useState('')
		const [newTag, setNewTag] = useState('')
		const [error, setError] = useState('')

		const saveOverrides = (next: Record<string, string>) =>
			storage.set({ overrides: JSON.stringify(next) })

		const addOverride = () => {
			const id = newId.trim()
			if (!USER_ID.test(id)) {
				setError('Enter a valid user ID (numbers only).')
				return
			}
			setError('')
			saveOverrides({ ...overrides, [id]: newTag.trim() })
			setNewId('')
			setNewTag('')
		}

		return (
			<ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
				<TableRowGroup title="Tag">
					<TextInput
						label="Default tag text"
						size="md"
						placeholder="STAFF"
						value={s.defaultTag}
						onChange={(v: string) => storage.set({ defaultTag: v })}
					/>
					<TextInput
						label="Tag color (hex)"
						size="md"
						placeholder="5865F2"
						value={s.color}
						onChange={(v: string) => storage.set({ color: v })}
					/>
					<TableSwitchRow
						label="Tag server owners"
						subLabel="Owners have every permission, including Administrator"
						value={s.tagOwner}
						onValueChange={(v: boolean) => storage.set({ tagOwner: v })}
					/>
				</TableRowGroup>

				<TableRowGroup title="Custom tags per person">
					{Object.keys(overrides).length === 0 ? (
						<TableRow label="No custom tags yet" />
					) : (
						Object.entries(overrides).map(([id, tag]) => (
							<TableRow
								key={id}
								label={tag || `${s.defaultTag} (default)`}
								subLabel={`${id} · tap to remove`}
								onPress={() => {
									const { [id]: _removed, ...rest } = overrides
									saveOverrides(rest)
								}}
							/>
						))
					)}
				</TableRowGroup>

				<TableRowGroup title="Add custom tag">
					<TextInput
						label="User ID"
						size="md"
						placeholder="e.g. 1494597581920272534"
						value={newId}
						onChange={(v: string) => setNewId(v)}
					/>
					<TextInput
						label="Tag text (empty = default)"
						size="md"
						placeholder={s.defaultTag}
						value={newTag}
						onChange={(v: string) => setNewTag(v)}
					/>
					{error ? <Text variant="text-sm/medium">{error}</Text> : null}
					<Button variant="primary" text="Add" onPress={addOverride} />
				</TableRowGroup>

				<Text variant="text-sm/medium">
					A custom tag is shown for that person even if they are not an
					administrator. Reopen the channel to see changes on existing messages.
				</Text>
			</ScrollView>
		)
	},

	start({ cleanup, jsonStorage, logger: pluginLogger }) {
		logger = pluginLogger
		log('Step 1: plugin starting')
		const storage = jsonStorage as JsonStorage<Settings>
		const getSettings = (): Settings => ({ ...DEFAULTS, ...(storage.cache ?? {}) })

		log('Step 2: looking for the chat row manager')
		cleanup(
			getModules(withGenerate(), (exports: any, id: number) => {
				try {
					const cls = exports.prototype?.generate ? exports : exports.default
					log(`Step 3: patching generate() on module ${id}`)
					cleanup(
						// Docs: after hooks receive (args, ret, self). Your probe's first
						// parameter was the row itself, so handle both signatures.
						after(cls.prototype, 'generate', (a: any, b: any) => {
							const ret = Array.isArray(a) ? b : a
							try {
								applyTag(getSettings(), ret)
							} catch (e) {
								warnOnce('apply', 'applyTag failed:', String(e))
							}
							return ret
						}),
					)
				} catch (e) {
					log(`Patch failed on module ${id}:`, String(e))
				}
			}),
		)
	},
})
