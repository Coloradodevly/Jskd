// Revenge's plugin system modules exist at runtime, but the published types don't
// declare them. These declarations cover the parts Plugin Browser uses, copied from
// Revenge's own source (lib/plugins/src/_internal).

declare module '@revenge-mod/plugins/_' {
	/** The parts of a plugin that Plugin Browser reads. */
	export interface AnyPlugin {
		manifest: {
			id: string
			name: string
			description?: string
			author?: string
			contributors?: string[]
			icon?: string
			version: unknown
			dependencies?: Record<string, { version?: string; optional?: boolean }>
		}
		errors: unknown[]
	}

	export interface InternalPluginMeta {
		readonly [key: string]: unknown
	}

	type Listener = (...args: any[]) => void

	export const pList: Map<string, AnyPlugin>
	export const pEmitter: {
		on(event: string, listener: Listener): unknown
		off(event: string, listener: Listener): unknown
	}

	export function getInternalPluginMeta(plugin: AnyPlugin): InternalPluginMeta
	export function isPluginInternal(meta: InternalPluginMeta): boolean
	export function isPluginEnabledInActiveSlot(plugin: AnyPlugin): boolean
	export function isPluginErrored(plugin: AnyPlugin): boolean
	export function isPluginPendingReload(plugin: AnyPlugin): boolean

	export function enablePluginInActiveSlot(
		plugin: AnyPlugin,
		requiredByUser: boolean,
	): Promise<unknown>
	export function disablePluginInActiveSlot(plugin: AnyPlugin): Promise<unknown>
	export function runPluginLate(plugin: AnyPlugin): Promise<void>
	export function uninstallExternalPlugin(plugin: AnyPlugin): Promise<void>
	export function resyncPluginSources(): Promise<void>

	export function getPluginDependents(
		plugin: AnyPlugin,
		includeOptionals?: boolean,
	): AnyPlugin[]
	export function getLinkedOptionalDependents(plugin: AnyPlugin): AnyPlugin[]
}

declare module '@revenge-mod/plugins/_/repositories' {
	export interface Repo {
		/** Absolute root URL and unique identity of the repository. */
		url: string
		enabled: boolean
		internal: boolean
		name: string | null
		description: string | null
		/** Packaged asset name or `data:` URL. */
		icon: string | null
	}

	export interface RepoConfigEntry {
		url: string
		enabled?: boolean
	}

	export interface RepoPluginListing {
		id: string
		name: string
		description: string
		author: string
		contributors?: string[]
		/** Packaged asset name or `data:` URL. */
		icon: string | null
		/** Channel pointers (for example `latest`) referencing keys of `versions`. */
		channels: Record<string, string>
		/** Keys of `versions`, newest first. */
		order: string[]
		versions: Record<
			string,
			{
				url: string | null
				sha256: string | null
				size: number
				dependencies: Record<string, { version: string; optional: boolean }>
			}
		>
	}

	export interface ResolveIssue {
		message: string
		type: string
	}

	export interface InstallPlanAction {
		id: string
		version: string
		url: string
		sha256: string
		size: number
		repo: string
		channel: string
		hold: boolean | null
		replaces: string | null
	}

	export interface InstallPlan {
		actions: InstallPlanAction[]
		warnings: ResolveIssue[]
	}

	export interface PluginUpdate {
		id: string
		/** Installed version, or the pending on-disk update. */
		installed: string
		available: string
		channel: string
		repo: string
		size: number
		includes: {
			id: string
			version: string
			replaces: string | null
			size: number
		}[]
		warnings: ResolveIssue[]
		/** Why the update can't install. */
		blocker: ResolveIssue | null
	}

	export interface PlanTarget {
		repo?: string
		channel?: string
		/** Install exactly this version and hold it. */
		version?: string
	}

	export interface PlanOptions {
		targets?: Record<string, PlanTarget>
		repos?: string[]
		skipMissingOptionals?: boolean
	}

	export function listRepos(): Promise<Repo[]>
	export function setRepos(config: RepoConfigEntry[]): Promise<null>
	export function refreshRepo(url: string): Promise<Repo>
	export function refreshAllRepos(): Promise<{
		refreshed: Repo[]
		errors: { url: string; error: unknown }[]
	}>
	export function listRepoPlugins(url: string): Promise<RepoPluginListing[]>
	export function planInstall(
		id: string,
		options?: PlanOptions,
	): Promise<InstallPlan>
	export function installFromRepo(plan: InstallPlan): Promise<{
		installed: string[]
		pending: string[]
		skipped: string[]
	}>
	export function listUpdates(): Promise<PluginUpdate[]>
	export function selectSafeUpdates(updates: PluginUpdate[]): Set<string>
	export function updatePlugins(ids: Iterable<string>): Promise<{
		installed: string[]
		pending: string[]
		errors: { id: string; error: unknown }[]
	}>
}
