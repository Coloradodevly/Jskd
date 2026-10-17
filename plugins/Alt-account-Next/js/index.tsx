import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
import type { JsonStorage } from '@revenge-mod/json-storage'
import { BundleUpdaterManager } from '@revenge-mod/discord/native'
import {
	onSettingsModulesLoaded,
	registerSettingsItem,
	registerSettingsSection,
} from '@revenge-mod/discord/modules/settings'
import { getModules } from '@revenge-mod/modules/finders'
import { createFilterGenerator } from '@revenge-mod/modules/finders/filters'
import { useState } from 'react'
import { ScrollView } from 'react-native'

// Reads function NAMES only. It never reads or prints tokens or other values.

const STORE_NAMES = [
	'MultiAccountStore',
	'AuthenticationStore',
	'UserStore',
	'GuildStore',
	'AccountSwitcherStore',
	'SwitchAccountStore',
]

const NAME_RE = /switch.*account|multi.?account|account.*switch|switchuser|accountswitch/i

function functionNames(obj: any): string[] {
	const names = new Set<string>()
	let cur = obj
	for (let depth = 0; cur && cur !== Object.prototype && depth < 4; depth++) {
		for (const n of Object.getOwnPropertyNames(cur)) {
			if (n === 'constructor') continue
			try {
				if (typeof obj[n] === 'function') names.add(n)
			} catch {}
		}
		cur = Object.getPrototypeOf(cur)
	}
	return [...names].sort()
}

// Matches any module whose exports (or default export) have a key that looks like account switching.
const withAccountKeys = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const t = typeof exports
		if (!exports || (t !== 'object' && t !== 'function')) return false
		for (const c of [exports, exports.default]) {
			if (!c || (typeof c !== 'object' && typeof c !== 'function')) continue
			try {
				if (Object.keys(c).some(k => NAME_RE.test(k))) return true
			} catch {}
		}
		return false
	},
	() => 'account-probe.scan',
)

async function runProbe(): Promise<string> {
	const lines: string[] = []

	lines.push('== Stores ==')
	for (const name of STORE_NAMES) {
		let store: any
		try {
			store = (Stores as any)[name]
		} catch {}
		if (!store) {
			lines.push(`${name}: missing`)
			continue
		}
		const fns = functionNames(store)
		lines.push(`${name}: found (${fns.length} functions)`)
		lines.push(`  ${fns.slice(0, 60).join(', ')}`)
	}

	lines.push('')
	lines.push('== Modules with account-switching keys ==')
	const found: string[] = []
	const stop = getModules(withAccountKeys(), (exports: any, id: number) => {
		try {
			const keys: string[] = []
			for (const c of [exports, exports?.default]) {
				if (!c || (typeof c !== 'object' && typeof c !== 'function')) continue
				for (const k of Object.keys(c)) if (NAME_RE.test(k)) keys.push(`${k}:${typeof c[k]}`)
			}
			if (found.length < 40) found.push(`module ${id}: ${keys.join(', ')}`)
		} catch {}
	})
	await new Promise(r => setTimeout(r, 3000))
	try {
		stop?.()
	} catch {}
	lines.push(...(found.length ? found : ['none found in 3 seconds']))

	const text = lines.join('\n')
	console.log('[account-probe]\n' + text)
	return text
}

// ---------------------------------------------------------------------------
// Probe 2: account manager, account list shape, and how Discord defines Settings rows.
// Prints key names and types only. Never prints values like tokens.
// ---------------------------------------------------------------------------

function describeKeys(obj: any, limit = 40): string {
	if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return String(typeof obj)
	let keys: string[] = []
	try {
		keys = Object.keys(obj)
	} catch {}
	return keys
		.slice(0, limit)
		.map(k => {
			let t = '?'
			try {
				t = typeof obj[k]
			} catch {}
			return `${k}:${t}`
		})
		.join(', ')
}

const hasManager = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const t = typeof exports
		if (!exports || (t !== 'object' && t !== 'function')) return false
		try {
			return !!exports.MultiAccountManagerNative || !!exports.default?.MultiAccountManagerNative
		} catch {
			return false
		}
	},
	() => 'account-probe.manager',
)

// Modules holding Discord's settings config: objects with several `type: 'route'` entries.
const hasRouteItems = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const t = typeof exports
		if (!exports || (t !== 'object' && t !== 'function')) return false
		for (const c of [exports, exports.default]) {
			if (!c || typeof c !== 'object') continue
			try {
				const values = Object.values(c) as any[]
				if (values.filter(v => v && typeof v === 'object' && v.type === 'route' && v.screen).length >= 3) {
					return true
				}
			} catch {}
		}
		return false
	},
	() => 'account-probe.routes',
)

async function runProbe2(): Promise<string> {
	const lines: string[] = []

	lines.push('== MultiAccountManagerNative ==')
	const managers: string[] = []
	const stopA = getModules(hasManager(), (exports: any, id: number) => {
		try {
			const m = exports.MultiAccountManagerNative ?? exports.default?.MultiAccountManagerNative
			managers.push(`module ${id}: ${functionNames(m).join(', ') || '(no functions)'}`)
			managers.push(`  keys: ${describeKeys(m)}`)
		} catch {}
	})

	lines.push('== MultiAccountStore ==')
	try {
		const store = (Stores as any).MultiAccountStore
		const valid = store.getValidUsers?.()
		const all = store.getUsers?.()
		const asArray = (x: any) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : [])
		lines.push(`getValidUsers: ${Array.isArray(valid) ? 'array' : typeof valid}, ${asArray(valid).length} account(s)`)
		lines.push(`getUsers: ${Array.isArray(all) ? 'array' : typeof all}, ${asArray(all).length} account(s)`)
		const first: any = asArray(valid)[0] ?? asArray(all)[0]
		lines.push(`first account keys: ${describeKeys(first)}`)
		lines.push(`canUseMultiAccountMobile: ${String(store.getCanUseMultiAccountMobile?.())}`)
	} catch (e) {
		lines.push(`MultiAccountStore read failed: ${String(e)}`)
	}

	lines.push('== Discord Settings config (route items) ==')
	const routes: string[] = []
	const stopB = getModules(hasRouteItems(), (exports: any, id: number) => {
		try {
			const c = exports && typeof exports === 'object' && Object.values(exports).some((v: any) => v?.type === 'route') ? exports : exports.default
			const entries = Object.entries(c) as [string, any][]
			routes.push(`module ${id}: ${entries.length} entries`)
			const routeItems = entries.filter(([, v]) => v && v.type === 'route' && v.screen)
			for (const [key, v] of routeItems.slice(0, 4)) {
				routes.push(`  ${key}: {${describeKeys(v)}}`)
				routes.push(`    screen: {${describeKeys(v.screen)}}`)
			}
			const sections = entries.filter(([, v]) => v && Array.isArray(v.settings))
			for (const [key, v] of sections.slice(0, 3)) routes.push(`  section ${key}: {${describeKeys(v)}}`)
		} catch (e) {
			routes.push(`  read failed: ${String(e)}`)
		}
	})

	await new Promise(r => setTimeout(r, 3500))
	for (const stop of [stopA, stopB]) {
		try {
			stop?.()
		} catch {}
	}

	// Splice the module results into place.
	lines.splice(1, 0, ...(managers.length ? managers : ['not found in 3.5 seconds']))
	lines.push(...(routes.length ? routes : ['no settings config module found in 3.5 seconds']))

	const text = lines.join('\n')
	console.log(`[account-probe 2]\n${text}`)
	return text
}

interface Settings {
	/** Experimental: add a row to Discord's main Settings. Needs a reload to apply. */
	registerRow: boolean
}

const DEFAULTS: Settings = { registerRow: false }

function ProbeScreen(props: { api?: { jsonStorage: JsonStorage<Settings> } }) {
	const { Button, Text, TableRowGroup, TableSwitchRow } = Design
	const [result, setResult] = useState('')
	const [running, setRunning] = useState(false)
	const storage = props?.api?.jsonStorage
	const settings: Settings = { ...DEFAULTS, ...(storage?.use() ?? {}) }

	return (
		<ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
			{storage ? (
				<>
					<TableRowGroup title="Experimental">
						<TableSwitchRow
							label="Add a row to Discord's main Settings"
							subLabel="Off by default. The last version crashed the Settings screen, so test this after you have the probe results. Takes effect after a reload."
							value={settings.registerRow}
							onValueChange={(v: boolean) => storage.set({ registerRow: v })}
						/>
					</TableRowGroup>
					<Button variant="secondary" text="Reload Revenge" onPress={() => BundleUpdaterManager.reload()} />
				</>
			) : null}

			<Text variant="text-md/medium">
				Tap Run probe 2. When it finishes, long-press the text below to select it, copy it, and paste it to
				Claude. It lists function names only, never tokens.
			</Text>
			<Button
				variant="primary"
				text={running ? 'Running…' : 'Run probe 2 (account manager and Settings rows)'}
				disabled={running}
				onPress={async () => {
					setRunning(true)
					try {
						setResult(await runProbe2())
					} catch (e) {
						setResult(`Probe failed: ${String(e)}`)
					}
					setRunning(false)
				}}
			/>
			<Button
				variant="secondary"
				text="Run probe 1 again"
				disabled={running}
				onPress={async () => {
					setRunning(true)
					try {
						setResult(await runProbe())
					} catch (e) {
						setResult(`Probe failed: ${String(e)}`)
					}
					setRunning(false)
				}}
			/>
			{result ? (
				<Text variant="text-sm/medium" selectable>
					{result}
				</Text>
			) : null}
		</ScrollView>
	)
}

// A blank icon: this also tests whether the Settings row accepts one.
const NoIcon = () => null

export default plugin({
	jsonStorage: { load: true, default: DEFAULTS },

	// Always reachable from the plugin's own Settings button.
	SettingsComponent: ProbeScreen,

	start({ cleanup, jsonStorage }) {
		const storage = jsonStorage as JsonStorage<Settings>
		if (!storage.cache?.registerRow) return

		// The last attempt crashed Discord's RouteSetting with "undefined is not a function", so this
		// row now also defines the optional hooks Discord's settings rows can have.
		cleanup(
			onSettingsModulesLoaded(() => {
				cleanup(
					registerSettingsSection('ACCOUNT_PROBE', {
						label: 'Account Probe',
						settings: ['ACCOUNT_PROBE_MAIN'],
					}),
					registerSettingsItem('ACCOUNT_PROBE_MAIN', {
						type: 'route',
						title: () => 'Account Probe',
						IconComponent: NoIcon,
						usePredicate: () => true,
						useTrailing: () => undefined,
						useDescription: () => undefined,
						useIsDisabled: () => false,
						screen: {
							route: 'AccountProbeScreen',
							getComponent: () => ProbeScreen,
						},
					} as any),
				)
			}),
		)
	},
})
