// The Themes API isn't in @revenge-mod/types yet, so these types come from the docs.
import type { PluginApiExtensionsOptions } from '@revenge-mod/plugins/types'

type ThemeBase = 'dark' | 'darker' | 'light' | 'midnight'

interface ThemeColors {
	semantic?: Partial<Record<ThemeBase, Record<string, string>>>
	raw?: Record<string, string>
}

interface ThemeGroupDefinition {
	name: string
	description?: string
}

interface ThemeDefinition {
	name: string
	description?: string
	getColors(): ThemeColors
}

interface FontVariant {
	path: string
	weight?: number
	italic?: boolean
}

interface FontPackDefinition {
	name: string
	description?: string
	families: Record<string, FontVariant[]>
}

interface IconPackDefinition {
	name: string
	description?: string
	icons: Record<string, string>
}

interface ThemesApi {
	registerGroup(groupId: string, group: ThemeGroupDefinition): void
	registerTheme(groupId: string, themeId: string, theme: ThemeDefinition): void
	registerFontPack(packId: string, pack: FontPackDefinition): void
	registerIconPack(packId: string, pack: IconPackDefinition): void
}

declare module '@revenge-mod/plugins/types' {
	interface PreInitPluginApi<O extends PluginApiExtensionsOptions> {
		themes: ThemesApi
	}
}
