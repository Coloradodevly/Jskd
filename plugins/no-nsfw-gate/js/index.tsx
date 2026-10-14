import { Design } from '@revenge-mod/discord/design'
import { getModules, lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'

type Fns = Record<string, (...args: unknown[]) => unknown>
type AlertCreators = { openAlert(key: string, element: unknown): void }

// Functions that mean "gated" when true. We force them to false.
const TARGETS: { find: string; keys: string[] }[] = [
	{ find: 'shouldNSFWGateGuild', keys: ['shouldNSFWGateGuild'] },
	{
		find: 'isFeatureAgeGated',
		keys: [
			'isFeatureAgeGated',
			'useIsFeatureAgeGated',
			'hasAgeGatedFeatures',
			'useHasAgeGatedFeatures',
		],
	},
]

function managerInfo(): string {
	try {
		const [mod] = lookupModule(
			withProps<Record<string, unknown>>('AgeGateManager', 'AgeVerificationManager'),
		)
		if (!mod) return 'Managers: not loaded yet'
		return ['AgeGateManager', 'AgeVerificationManager']
			.map(name => {
				const obj = mod[name]
				const keys = obj && typeof obj === 'object' ? Object.keys(obj) : []
				return `${name}: ${keys.join(', ') || '(none)'}`
			})
			.join('\n')
	} catch {
		return 'Managers: error reading'
	}
}

export default plugin({
	start({ cleanup }) {
		const patched: string[] = []

		for (const { find, keys } of TARGETS) {
			cleanup(
				getModules(withProps<Fns>(find), exports => {
					for (const key of keys) {
						if (typeof exports[key] !== 'function') continue
						// `after` keeps Discord's own logic (and hook order) intact,
						// then overrides the result.
						cleanup(after(exports, key, () => false))
						patched.push(key)
					}
				}),
			)
		}

		const report = () => {
			try {
				const text = `Patched: ${
					patched.length
						? patched.join(', ')
						: 'nothing yet (open the server, it may load later)'
				}\n\n${managerInfo()}`

				const [Alerts] = lookupModule(withProps<AlertCreators>('openAlert'))
				if (!Alerts) {
					console.log(`[no-nsfw-gate] ${text}`)
					return
				}
				const { AlertModal, AlertActionButton } = Design
				Alerts.openAlert(
					'no-nsfw-gate-report',
					<AlertModal
						title="No NSFW Gate"
						content={text}
						actions={<AlertActionButton text="Okay" />}
					/>,
				)
			} catch (e) {
				console.log('[no-nsfw-gate] report error', e)
			}
		}

		const timer = setTimeout(report, 30000)
		cleanup(() => clearTimeout(timer))
	},
})
