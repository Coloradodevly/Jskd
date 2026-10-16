// Base theme names in Revenge: dark = Ash, darker = Dark, light = Light, midnight = Onyx.
type Base = 'dark' | 'darker' | 'light' | 'midnight'

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const toRgb = (hex: string): [number, number, number] => {
	const n = Number.parseInt(hex.slice(1), 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = ([r, g, b]: [number, number, number]) =>
	`#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** Blend `from` towards `to` by `amount` (0 to 1). */
function mix(from: string, to: string, amount: number): string {
	const a = toRgb(from)
	const b = toRgb(to)
	return toHex([0, 1, 2].map(i => a[i]! + (b[i]! - a[i]!) * amount) as [number, number, number])
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
// Themes
// ---------------------------------------------------------------------------

const ACCENTS = [
	{ id: 'violet', name: 'Violet', description: 'Navy with a violet accent.', accent: '#6d6ef0' },
	{ id: 'amber', name: 'Amber', description: 'Navy with a warm amber accent.', accent: '#e08a1e' },
	{ id: 'mint', name: 'Mint', description: 'Navy with a mint accent.', accent: '#22b07d' },
]

export default plugin({
	// Registering in preInit lets a picked theme apply before Discord renders.
	preInit({ themes }) {
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
	},
})
