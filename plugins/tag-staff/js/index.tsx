import { Page } from '@revenge-mod/components'
import { Design } from '@revenge-mod/discord/design'
import { getModules } from '@revenge-mod/modules/finders'
import { createFilterGenerator } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { useState } from 'react'
import { ScrollView } from 'react-native'

/**
 * Finds anything exposing a class whose prototype has `generate`, which is how
 * Discord's chat row managers have historically built message rows.
 * Collects a few redacted samples so the real tag hook can be written.
 */

const MAX_SAMPLES_PER_MODULE = 2
const candidates: string[] = []
const samples: string[] = []
const errors: string[] = []

const withGenerate = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const t = typeof exports
		if (!exports || (t !== 'object' && t !== 'function')) return false
		return (
			typeof exports.prototype?.generate === 'function' ||
			typeof exports.default?.prototype?.generate === 'function'
		)
	},
	() => 'tag-probe.generate',
)

function safeGet(obj: any, key: string) {
	try {
		return obj[key]
	} catch {
		return '<throws>'
	}
}

/** Describes the shape of a value. Strings are truncated; message text is never shown. */
function shape(value: any, key = '', depth = 0): string {
	if (value == null) return String(value)

	switch (typeof value) {
		case 'string':
			return /content|text|body/i.test(key)
				? `<string ${value.length} chars>`
				: JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)
		case 'number':
		case 'boolean':
			return String(value)
		case 'function':
			return 'fn'
		case 'bigint':
			return 'bigint'
	}

	if (Array.isArray(value)) return `[${value.length}]`
	if (depth >= 2) return '{…}'

	const keys = Object.keys(value).slice(0, 40)
	return `{ ${keys
		.map(k => `${k}: ${shape(safeGet(value, k), k, depth + 1)}`)
		.join(', ')} }`
}

export default plugin({
	start({ cleanup, logger }) {
		cleanup(
			getModules(withGenerate(), (exports: any, id: number) => {
				try {
					const cls = exports.prototype?.generate ? exports : exports.default
					const proto = cls.prototype
					candidates.push(`module ${id}: ${cls.name || '(anonymous class)'}`)

					let taken = 0
					cleanup(
						after(proto, 'generate', (result: any) => {
							try {
								if (taken < MAX_SAMPLES_PER_MODULE && samples.length < 8) {
									taken++
									samples.push(`module ${id} -> ${shape(result)}`)
								}
							} catch (e) {
								errors.push(`sample failed (module ${id}): ${e}`)
							}
							return result
						}),
					)
				} catch (e) {
					errors.push(`patch failed (module ${id}): ${e}`)
					logger.error(`[tag-probe] ${e}`)
				}
			}),
		)
	},

	SettingsComponent() {
		const { Button, Text } = Design
		const [, setTick] = useState(0)

		const report = [
			`Candidates (${candidates.length}):`,
			...candidates,
			'',
			`Samples (${samples.length}):`,
			...samples,
			...(errors.length ? ['', 'Errors:', ...errors] : []),
		].join('\n\n')

		return (
			<Page>
				<ScrollView contentContainerStyle={{ gap: 12, padding: 16 }}>
					<Text variant="text-md/medium">
						Open a server chat and scroll a little, then tap Refresh. Long-press the
						text below to copy it. It has no message text, but skim it for names
						before you share it.
					</Text>
					<Button
						text="Refresh"
						variant="primary"
						size="sm"
						onPress={() => setTick(t => t + 1)}
					/>
					<Text variant="text-sm/medium" selectable>
						{report}
					</Text>
				</ScrollView>
			</Page>
		)
	},
})
