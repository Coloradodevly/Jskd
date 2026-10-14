import { Logger } from '@revenge-mod/discord/common'
import { Design } from '@revenge-mod/discord/design'
import {
	onSettingsModulesLoaded,
	registerSettingsItem,
	registerSettingsSection,
} from '@revenge-mod/discord/modules/settings'
import { lookupModule, lookupModules } from '@revenge-mod/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withProps,
} from '@revenge-mod/modules/finders/filters'
import { isModuleExportBad } from '@revenge-mod/modules/metro/utils'

// Matches exported property names that look related to the NSFW / age gate.
const GATE_PATTERN = /nsfw|age.?(gate|verif|assur|check)|ageVerification/i
const MAX_ROWS = 60

const withGateLikeProps = createFilterGenerator<[pattern: RegExp]>(
	([pattern], _id, exports) => {
		if (isModuleExportBad(exports)) return false
		return Object.keys(exports).some(k => pattern.test(k))
	},
	([pattern]) => `dev.you.no-nsfw-gate.scan(${pattern.source})`,
	FilterScopes.Initialized,
)

function scan(): string[] {
	const lines: string[] = []
	for (const [exports, id] of lookupModules(withGateLikeProps(GATE_PATTERN))) {
		const hits = Object.keys(exports)
			.filter(k => GATE_PATTERN.test(k))
			.map(k => {
				let t = '?'
				try {
					t = typeof (exports as Record<string, unknown>)[k]
				} catch {}
				return `${k} (${t})`
			})
		lines.push(`#${id}: ${hits.join(', ')}`)
	}
	return lines
}

// Settings icon placeholder (no icon).
const NoIcon = () => null

function GateLogScreen() {
	const { TableRowGroup, TableRow } = Design
	const lines = scan().slice(0, MAX_ROWS)

	const content = (
		<TableRowGroup title="NSFW gate scan">
			{lines.length === 0 ? (
				<TableRow label="No matches yet. Open an age-gated channel, then reopen this screen." />
			) : (
				lines.map(line => <TableRow key={line} label={line} />)
			)}
		</TableRowGroup>
	)

	// Wrap in React Native's ScrollView if we can find it, so long lists scroll.
	const [RN] = lookupModule(
		withProps<typeof import('react-native')>('ScrollView', 'View', 'Text'),
	)
	const ScrollView = RN?.ScrollView
	return ScrollView ? <ScrollView>{content}</ScrollView> : content
}

export default plugin({
	start({ cleanup }) {
		// Also written to the in-app Debug Logs screen.
		const logger = new Logger('NSFWGate')
		for (const line of scan()) logger.log(`[gate-scan] ${line}`)

		cleanup(
			onSettingsModulesLoaded(() => {
				cleanup(
					registerSettingsSection('NSFW_GATE_LOG', {
						label: 'NSFWGATE-log',
						settings: ['NSFW_GATE_LOG_MAIN'],
					}),
					registerSettingsItem('NSFW_GATE_LOG_MAIN', {
						type: 'route',
						title: () => 'NSFWGATE-log',
						IconComponent: NoIcon,
						screen: {
							route: 'NsfwGateLogScreen',
							getComponent: () => GateLogScreen,
						},
					}),
				)
			}),
		)
	},
})
