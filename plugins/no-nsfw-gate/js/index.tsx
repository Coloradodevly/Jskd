import { Design } from '@revenge-mod/discord/design'
import { lookupModule, lookupModules } from '@revenge-mod/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withProps,
} from '@revenge-mod/modules/finders/filters'

const GATE_PATTERN = /nsfw|age.?(gate|verif|assur|check)|ageVerification/i
const BATCH = 12
const INTERVAL_MS = 15000
const MAX_TICKS = 40

const withGateLikeProps = createFilterGenerator<[pattern: RegExp]>(
	([pattern], _id, exports) => {
		if (!exports || (typeof exports !== 'object' && typeof exports !== 'function'))
			return false
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

type AlertCreators = { openAlert(key: string, element: unknown): void }

export default plugin({
	start({ cleanup }) {
		const shown = new Set<string>()
		let ticks = 0

		const tick = () => {
			try {
				const fresh = scan().filter(l => !shown.has(l))
				if (fresh.length === 0) return
				const batch = fresh.slice(0, BATCH)
				for (const l of batch) shown.add(l)

				const [Alerts] = lookupModule(withProps<AlertCreators>('openAlert'))
				if (!Alerts) {
					for (const l of batch) console.log(`[gate-scan] ${l}`)
					return
				}

				const { AlertModal, AlertActionButton } = Design
				Alerts.openAlert(
					`nsfw-gate-scan-${ticks}`,
					<AlertModal
						title={`Gate scan: ${batch.length} of ${fresh.length} new`}
						content={batch.join('\n')}
						actions={<AlertActionButton text="Okay" />}
					/>,
				)
			} catch (e) {
				console.log('[gate-scan] error', e)
			}
		}

		const id = setInterval(() => {
			tick()
			if (++ticks >= MAX_TICKS) clearInterval(id)
		}, INTERVAL_MS)
		cleanup(() => clearInterval(id))
	},
})
