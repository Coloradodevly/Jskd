import { Design } from '@revenge-mod/discord/design'
import { lookupModules } from '@revenge-mod/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@revenge-mod/modules/finders/filters'
import { isModuleExportBad } from '@revenge-mod/modules/metro/utils'

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
		const hits = Object.keys(exports).filter(k => GATE_PATTERN.test(k))
		lines.push(`#${id}: ${hits.join(', ')}`)
	}
	return lines
}

export default plugin({
	start({ logger }) {
		for (const line of scan()) logger.log(`[gate-scan] ${line}`)
	},

	SettingsComponent() {
		const { TableRowGroup, TableSwitchRow } = Design
		const lines = scan().slice(0, MAX_ROWS)

		return (
			<TableRowGroup>
				{lines.length === 0 ? (
					<TableSwitchRow
						label="No matches yet. Open an age-gated channel, then reopen this screen."
						value={false}
						onValueChange={() => {}}
					/>
				) : (
					lines.map(line => (
						<TableSwitchRow
							key={line}
							label={line}
							value={false}
							onValueChange={() => {}}
						/>
					))
				)}
			</TableRowGroup>
		)
	},
})
