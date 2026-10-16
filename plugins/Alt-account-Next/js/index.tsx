import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
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

function ProbeScreen() {
	const { Button, Text } = Design
	const [result, setResult] = useState('')
	const [running, setRunning] = useState(false)

	return (
		<ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
			<Text variant="text-md/medium">
				Tap Run probe. When it finishes, long-press the text below to select it, copy it, and paste it to
				Claude. It lists function names only, never tokens.
			</Text>
			<Button
				variant="primary"
				text={running ? 'Running…' : 'Run probe'}
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
	// Reachable from the plugin's own Settings button too, in case the Settings row doesn't appear.
	SettingsComponent: ProbeScreen,

	start({ cleanup }) {
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
						screen: {
							route: 'AccountProbeScreen',
							getComponent: () => ProbeScreen,
						},
					}),
				)
			}),
		)
	},
})
