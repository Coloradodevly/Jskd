import { Design } from '@revenge-mod/discord/design'
import type { JsonStorage } from '@revenge-mod/json-storage'
import { ScrollView, View } from 'react-native'

// Base theme names in Revenge: dark = Ash, darker = Dark, light = Light, midnight = Onyx.
type Base = 'dark' | 'darker' | 'light' | 'midnight'

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const HEX = /^#?([0-9a-f]{6})$/i

const normalizeHex = (value: string): string | undefined => {
	const m = HEX.exec(value.trim())
	return m ? `#${m[1]!.toLowerCase()}` : undefined
}

const toRgb = (hex: string): [number, number, number] => {
	const n = Number.parseInt(hex.slice(1), 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = ([r, g, b]: [number, number, number]) =>
	`#${[r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`

/** Blend `from` towards `to` by `amount` (0 to 1). */
function mix(from: string, to: string, amount: number): string {
	const a = toRgb(from)
	const b = toRgb(to)
	return toHex([0, 1, 2].map(i => a[i]! + (b[i]! - a[i]!) * amount) as [number, number, number])
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
	const [R, G, B] = [r / 255, g / 255, b / 255]
	const max = Math.max(R, G, B)
	const min = Math.min(R, G, B)
	const l = (max + min) / 2
	if (max === min) return [0, 0, l]
	const d = max - min
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
	const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
	return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
	const c = (1 - Math.abs(2 * l - 1)) * s
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
	const m = l - c / 2
	const [r, g, b] =
		h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
	return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255])
}

/** Discord's raw palette numbers: lower is lighter, higher is darker. 500 is the accent itself. */
const shade = (accent: string, n: number) =>
	n < 500 ? mix(accent, '#ffffff', ((500 - n) / 500) * 0.7) : mix(accent, '#000000', ((n - 500) / 500) * 0.6)

// ---------------------------------------------------------------------------
// Palette (navy surfaces, same family as the Evan Plugins site)
// ---------------------------------------------------------------------------

interface Surface {
	lowest: string
	lower: string
	low: string
	high: string
	higher: string
	highest: string
	text: string
	muted: string
	icon: string
	border: string
}

const SURFACES: Record<Base, Surface> = {
	// Onyx: the deepest navy
	midnight: {
		lowest: '#07080d', lower: '#0b0d15', low: '#10121c',
		high: '#151827', higher: '#1a1e30', highest: '#20253a',
		text: '#e9eaf4', muted: '#8d92b0', icon: '#aab0cc', border: '#23273d',
	},
	// Dark
	darker: {
		lowest: '#0d0f17', lower: '#11131e', low: '#161926',
		high: '#1b1f31', higher: '#212640', highest: '#282e4c',
		text: '#e9eaf4', muted: '#949ab8', icon: '#b0b6d2', border: '#2a2f4a',
	},
	// Ash: the navy used on the plugin site
	dark: {
		lowest: '#14161f', lower: '#181b27', low: '#1c1f2e',
		high: '#222640', higher: '#2a2f4d', highest: '#323860',
		text: '#e9eaf4', muted: '#9a9fbd', icon: '#b8bcd8', border: '#2f3350',
	},
	// Light
	light: {
		lowest: '#e9eaf5', lower: '#f0f1f9', low: '#f6f6fb',
		high: '#ffffff', higher: '#ffffff', highest: '#ecedf8',
		text: '#1a1c2e', muted: '#5d6280', icon: '#4a4f6e', border: '#d9dbee',
	},
}

const LEVELS = ['lowest', 'lower', 'low', 'high', 'higher', 'highest'] as const
const LEVEL_KEYS: Record<(typeof LEVELS)[number], string> = {
	lowest: 'BACKGROUND_BASE_LOWEST',
	lower: 'BACKGROUND_BASE_LOWER',
	low: 'BACKGROUND_BASE_LOW',
	high: 'BACKGROUND_SURFACE_HIGH',
	higher: 'BACKGROUND_SURFACE_HIGHER',
	highest: 'BACKGROUND_SURFACE_HIGHEST',
}

function semanticFor(base: Base, accent: string): Record<string, string> {
	const s = SURFACES[base]
	return {
		BACKGROUND_BASE_LOWEST: s.lowest,
		BACKGROUND_BASE_LOWER: s.lower,
		BACKGROUND_BASE_LOW: s.low,
		BACKGROUND_SURFACE_HIGH: s.high,
		BACKGROUND_SURFACE_HIGHER: s.higher,
		BACKGROUND_SURFACE_HIGHEST: s.highest,
		TEXT_DEFAULT: s.text,
		TEXT_MUTED: s.muted,
		HEADER_PRIMARY: s.text,
		HEADER_SECONDARY: s.muted,
		INTERACTIVE_NORMAL: s.icon,
		INTERACTIVE_HOVER: s.text,
		INTERACTIVE_ACTIVE: s.text,
		BORDER_SUBTLE: s.border,
		TEXT_LINK: base === 'light' ? mix(accent, '#000000', 0.25) : mix(accent, '#ffffff', 0.25),
	}
}

const BRAND_STEPS = [345, 360, 400, 430, 460, 500, 530, 560, 600, 630, 660, 700, 730, 760]

function colorsFor(accent: string) {
	const raw: Record<string, string> = {}
	for (const n of BRAND_STEPS) raw[`BRAND_${n}`] = shade(accent, n)

	return {
		semantic: {
			dark: semanticFor('dark', accent),
			darker: semanticFor('darker', accent),
			midnight: semanticFor('midnight', accent),
			light: semanticFor('light', accent),
		},
		raw,
	}
}

// ---------------------------------------------------------------------------
// Custom theme (driven by the settings page)
// ---------------------------------------------------------------------------

type SurfaceStyle = 'navy' | 'black' | 'slate' | 'plum'

interface Settings {
	/** Accent color, 6 hex digits (a leading # is fine). */
	accent: string
	surface: SurfaceStyle
	/** -1 darker, 0 default, 1 lighter. */
	lightness: -1 | 0 | 1
}

const DEFAULT_ACCENT = '#6d6ef0'
const DEFAULTS: Settings = { accent: DEFAULT_ACCENT, surface: 'navy', lightness: 0 }

const STYLES: { id: SurfaceStyle; label: string; hue: number; sat: number; lMul: number; lOff: number }[] = [
	{ id: 'navy', label: 'Navy', hue: 232, sat: 0.28, lMul: 1, lOff: 0 },
	{ id: 'black', label: 'AMOLED black', hue: 232, sat: 0.06, lMul: 0.55, lOff: -0.05 },
	{ id: 'slate', label: 'Slate', hue: 214, sat: 0.13, lMul: 1, lOff: 0 },
	{ id: 'plum', label: 'Plum', hue: 285, sat: 0.26, lMul: 1, lOff: 0 },
]

const LIGHTNESS = [
	{ value: -1 as const, label: 'Darker' },
	{ value: 0 as const, label: 'Default' },
	{ value: 1 as const, label: 'Lighter' },
]

const PRESETS = [
	{ label: 'Violet', color: '#6d6ef0' },
	{ label: 'Amber', color: '#e08a1e' },
	{ label: 'Mint', color: '#22b07d' },
	{ label: 'Rose', color: '#e5557a' },
	{ label: 'Sky', color: '#3aa0e8' },
]

/** Restyles the three dark bases' surfaces. The Light base keeps its own surfaces. */
function restyle(base: Exclude<Base, 'light'>, s: Settings): Record<string, string> {
	const style = STYLES.find(x => x.id === s.surface) ?? STYLES[0]!
	const out: Record<string, string> = {}
	let highest = ''

	LEVELS.forEach((level, i) => {
		const [, , l] = rgbToHsl(toRgb(SURFACES[base][level]))
		const lightness = Math.min(0.6, Math.max(0, l * style.lMul + style.lOff + s.lightness * 0.04))
		const sat = style.sat * (0.7 + (0.3 * i) / (LEVELS.length - 1))
		const hex = hslToHex(style.hue, sat, lightness)
		out[LEVEL_KEYS[level]] = hex
		highest = hex
	})

	out.BORDER_SUBTLE = mix(highest, '#ffffff', 0.07)
	return out
}

function customColors(s: Settings) {
	const accent = normalizeHex(s.accent) ?? DEFAULT_ACCENT
	const colors = colorsFor(accent)
	for (const base of ['dark', 'darker', 'midnight'] as const) {
		Object.assign(colors.semantic[base], restyle(base, s))
	}
	return colors
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const ACCENTS = [
	{ id: 'violet', name: 'Violet', description: 'Navy with a violet accent.', accent: '#6d6ef0' },
	{ id: 'amber', name: 'Amber', description: 'Navy with a warm amber accent.', accent: '#e08a1e' },
	{ id: 'mint', name: 'Mint', description: 'Navy with a mint accent.', accent: '#22b07d' },
]

let themesApi: ThemesApi | undefined

/** Registering the same IDs again updates the theme, and Revenge applies it if it's the picked one. */
function registerCustom(s: Settings) {
	themesApi?.registerTheme('evan', 'custom', {
		name: 'Custom',
		description: "Your own accent and surface style. Change them in this plugin's settings.",
		getColors: () => customColors(s),
	})
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default plugin({
	jsonStorage: { load: true, default: DEFAULTS },

	// Registering in preInit lets a picked theme apply before Discord renders.
	preInit({ themes }) {
		themesApi = themes

		themes.registerGroup('evan', {
			name: 'Evan',
			description: 'Navy surfaces with a choice of accent. Covers Ash, Dark, Onyx and Light.',
		})

		for (const a of ACCENTS) {
			themes.registerTheme('evan', a.id, {
				name: a.name,
				description: a.description,
				getColors: () => colorsFor(a.accent),
			})
		}

		// Placeholder until the saved settings load in start().
		registerCustom(DEFAULTS)
	},

	start({ cleanup, jsonStorage }) {
		const storage = jsonStorage as JsonStorage<Settings>
		const getSettings = (): Settings => ({ ...DEFAULTS, ...(storage.cache ?? {}) })

		registerCustom(getSettings())
		cleanup(storage.subscribe(() => registerCustom(getSettings())))
	},

	SettingsComponent({ api }: { api: { jsonStorage: JsonStorage<Settings> } }) {
		const { Button, Stack, Text, TextInput, TableRow, TableRowGroup } = Design
		const storage = api.jsonStorage
		const s: Settings = { ...DEFAULTS, ...(storage.use() ?? {}) }

		const accentOk = normalizeHex(s.accent) !== undefined
		const preview = customColors(s)
		const swatches = [
			preview.semantic.midnight.BACKGROUND_BASE_LOWEST!,
			preview.semantic.dark.BACKGROUND_BASE_LOWEST!,
			preview.semantic.dark.BACKGROUND_BASE_LOW!,
			preview.semantic.dark.BACKGROUND_SURFACE_HIGH!,
			preview.semantic.dark.BACKGROUND_SURFACE_HIGHEST!,
			preview.raw.BRAND_500!,
		]

		return (
			<ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
				<Text variant="text-sm/medium">
					These settings change the Custom theme. After changing them, pick "Custom" in the Evan group under
					Settings, Revenge, Themes. Violet, Amber and Mint stay as they are.
				</Text>

				<View style={{ flexDirection: 'row', gap: 6 }}>
					{swatches.map((color, i) => (
						<View
							key={`${color}-${i}`}
							style={{ flex: 1, height: 36, borderRadius: 8, backgroundColor: color, borderWidth: 1, borderColor: '#ffffff22' }}
						/>
					))}
				</View>

				<TableRowGroup title="Accent color">
					<TextInput
						label="Hex color"
						size="md"
						placeholder="6d6ef0"
						value={s.accent}
						onChange={(v: string) => storage.set({ accent: v })}
					/>
				</TableRowGroup>
				{!accentOk && s.accent.trim() ? (
					<Text variant="text-sm/medium">Enter 6 hex digits, like 6d6ef0. Until then the default is used.</Text>
				) : null}
				<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
					{PRESETS.map(p => (
						<Button
							key={p.label}
							size="sm"
							variant="secondary"
							text={p.label}
							onPress={() => storage.set({ accent: p.color })}
						/>
					))}
				</View>

				<TableRowGroup title="Surface style">
					{STYLES.map(st => (
						<TableRow
							key={st.id}
							label={`${s.surface === st.id ? '✓  ' : '     '}${st.label}`}
							onPress={() => storage.set({ surface: st.id })}
						/>
					))}
				</TableRowGroup>

				<TableRowGroup title="Surface lightness">
					{LIGHTNESS.map(l => (
						<TableRow
							key={l.value}
							label={`${s.lightness === l.value ? '✓  ' : '     '}${l.label}`}
							onPress={() => storage.set({ lightness: l.value })}
						/>
					))}
				</TableRowGroup>

				<Stack spacing={8}>
					<Button variant="secondary" text="Reset to defaults" onPress={() => storage.set({ ...DEFAULTS })} />
				</Stack>
			</ScrollView>
		)
	},
})
