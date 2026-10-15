import { Page, SearchInput } from '@revenge-mod/components'
import { AlertActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import {
	disablePluginInActiveSlot,
	enablePluginInActiveSlot,
	getInternalPluginMeta,
	getLinkedOptionalDependents,
	getPluginDependents,
	isPluginEnabledInActiveSlot,
	isPluginErrored,
	isPluginInternal,
	isPluginPendingReload,
	pEmitter,
	pList,
	resyncPluginSources,
	runPluginLate,
	uninstallExternalPlugin,
} from '@revenge-mod/plugins/_'
import {
	installFromRepo,
	listRepoPlugins,
	listRepos,
	listUpdates,
	planInstall,
	refreshAllRepos,
	refreshRepo,
	selectSafeUpdates,
	setRepos,
	updatePlugins,
} from '@revenge-mod/plugins/_/repositories'
import { formatVersion } from '@revenge-mod/plugins/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { AnyPlugin } from '@revenge-mod/plugins/_'
import type {
	InstallPlan,
	Repo,
	PluginUpdate,
	RepoPluginListing,
} from '@revenge-mod/plugins/_/repositories'

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const ALERT_KEY = 'plugin-manager-alert'

const errorText = (e: unknown) =>
	e instanceof Error ? e.message : typeof e === 'string' ? e : String(e)

const noop = () => {}

/** Opens an alert. Buttons close it before running their action. */
function openAlert(
	title: string,
	content: string,
	buttons: { text: string; variant?: string; onPress?: () => void }[] = [
		{ text: 'Okay' },
	],
) {
	const { AlertModal, AlertActionButton, Stack } = Design

	AlertActionCreators.dismissAlert(ALERT_KEY)
	AlertActionCreators.openAlert(
		ALERT_KEY,
		<AlertModal
			title={title}
			content={content}
			actions={
				<Stack>
					{buttons.map(b => (
						<AlertActionButton
							key={b.text}
							text={b.text}
							variant={(b.variant ?? 'primary') as any}
							onPress={() => {
								AlertActionCreators.dismissAlert(ALERT_KEY)
								b.onPress?.()
							}}
						/>
					))}
				</Stack>
			}
		/>,
	)
}

/** Promise-based confirm. Resolves false on cancel. */
function confirm(title: string, content: string, confirmText: string) {
	return new Promise<boolean>(resolve =>
		openAlert(title, content, [
			{ text: confirmText, onPress: () => resolve(true) },
			{ text: 'Cancel', variant: 'secondary', onPress: () => resolve(false) },
		]),
	)
}

function versionOf(plugin: AnyPlugin) {
	try {
		return formatVersion(plugin.manifest.version as never)
	} catch {
		return String(plugin.manifest.version ?? '?')
	}
}

/** Re-renders when anything about the plugin list changes. */
function usePluginListTick() {
	const [tick, setTick] = useState(0)

	useEffect(() => {
		const bump = () => setTick(t => t + 1)
		const events = [
			'register',
			'unregister',
			'install',
			'stateUpdate',
			'statusUpdate',
			'metadataUpdate',
		] as const

		for (const e of events) pEmitter.on(e as any, bump)
		return () => {
			for (const e of events) pEmitter.off(e as any, bump)
		}
	}, [])

	return tick
}

/* -------------------------------------------------------------------------- */
/*  Actions (same flow Revenge's own plugin screen uses)                      */
/* -------------------------------------------------------------------------- */

async function enablePlugin(plugin: AnyPlugin) {
	await enablePluginInActiveSlot(plugin, true)
	await runPluginLate(plugin).catch(noop)
}

async function disablePlugin(plugin: AnyPlugin) {
	// Read before disabling, which changes the list.
	const optionals = getLinkedOptionalDependents(plugin)
	await disablePluginInActiveSlot(plugin)
	// Optional dependents are stopped by the cascade; restart them without this plugin.
	await Promise.all(optionals.map(dep => runPluginLate(dep).catch(noop)))
}

async function togglePlugin(plugin: AnyPlugin) {
	try {
		if (isPluginEnabledInActiveSlot(plugin)) {
			const dependents = getPluginDependents(plugin).filter(
				isPluginEnabledInActiveSlot,
			)

			if (dependents.length) {
				const ok = await confirm(
					`Disable ${plugin.manifest.name}?`,
					`These plugins need it and will be disabled too:\n\n${dependents
						.map(d => d.manifest.name)
						.join('\n')}`,
					'Disable',
				)
				if (!ok) return
			}

			await disablePlugin(plugin)
		} else {
			await enablePlugin(plugin)
		}
	} catch (e) {
		openAlert(`Couldn't change ${plugin.manifest.name}`, errorText(e))
	}
}

async function uninstallPlugin(plugin: AnyPlugin) {
	const ok = await confirm(
		`Uninstall ${plugin.manifest.name}?`,
		'The plugin and all of its data will be removed. This cannot be undone.',
		'Uninstall',
	)
	if (!ok) return

	try {
		await uninstallExternalPlugin(plugin)
	} catch (e) {
		openAlert('Uninstall failed', errorText(e))
	}
}

/* -------------------------------------------------------------------------- */
/*  Filters                                                                   */
/* -------------------------------------------------------------------------- */

type FilterKey = 'enabled' | 'disabled' | 'updates' | 'errors' | 'reload'

const FILTERS: Record<FilterKey, { label: string; desc: string }> = {
	enabled: { label: 'Enabled', desc: 'Plugins that are turned on' },
	disabled: { label: 'Disabled', desc: 'Plugins that are turned off' },
	updates: { label: 'Update available', desc: 'Has a newer version' },
	errors: { label: 'Has errors', desc: 'Failed to start or reported errors' },
	reload: { label: 'Needs reload', desc: 'Restart Discord to apply' },
}

function FilterPanel({
	active,
	onChange,
}: {
	active: Set<FilterKey>
	onChange: (next: Set<FilterKey>) => void
}) {
	const { TableRowGroup, TableSwitchRow } = Design

	return (
		<TableRowGroup title="Show only (all selected must match)">
			{(Object.keys(FILTERS) as FilterKey[]).map(key => (
				<TableSwitchRow
					key={key}
					label={FILTERS[key].label}
					subLabel={FILTERS[key].desc}
					value={active.has(key)}
					onValueChange={(on: boolean) => {
						const next = new Set(active)
						on ? next.add(key) : next.delete(key)
						onChange(next)
					}}
				/>
			))}
		</TableRowGroup>
	)
}

/* -------------------------------------------------------------------------- */
/*  Installed tab                                                             */
/* -------------------------------------------------------------------------- */

function InstalledPluginCard({
	plugin,
	update,
}: {
	plugin: AnyPlugin
	update?: PluginUpdate
}) {
	const { Card, Stack, Text, Button } = Design
	const enabled = isPluginEnabledInActiveSlot(plugin)
	const errored = isPluginErrored(plugin)
	const reload = isPluginPendingReload(plugin)

	const status = [
		enabled ? 'Enabled' : 'Disabled',
		errored ? 'errors' : null,
		reload ? 'needs reload' : null,
		update ? `update → v${update.available}` : null,
	]
		.filter(Boolean)
		.join(' · ')

	return (
		<Card>
			<Stack spacing={8}>
				<Text variant="heading-md/semibold">
					{plugin.manifest.name} <Text variant="text-sm/medium" color="text-muted">v{versionOf(plugin)}</Text>
				</Text>
				{plugin.manifest.description ? (
					<Text variant="text-md/medium">{plugin.manifest.description}</Text>
				) : null}
				<Text variant="text-sm/medium" color="text-muted">
					{status}
				</Text>
				<Stack spacing={8} direction="horizontal">
					<Button
						text={enabled ? 'Disable' : 'Enable'}
						variant={enabled ? 'secondary' : 'primary'}
						size="sm"
						onPress={() => togglePlugin(plugin)}
					/>
					<Button
						text="Uninstall"
						variant="destructive"
						size="sm"
						onPress={() => uninstallPlugin(plugin)}
					/>
				</Stack>
			</Stack>
		</Card>
	)
}

function InstalledTab() {
	const { Stack, Text, Button } = Design
	const tick = usePluginListTick()

	const [query, setQuery] = useState('')
	const [showFilters, setShowFilters] = useState(false)
	const [filters, setFilters] = useState<Set<FilterKey>>(new Set())
	const [updates, setUpdates] = useState<PluginUpdate[] | null>(null)
	const [checking, setChecking] = useState(false)
	const [installing, setInstalling] = useState(false)

	const updateById = useMemo(
		() => new Map((updates ?? []).map(u => [u.id, u])),
		[updates],
	)
	const safeIds = useMemo(
		() => (updates ? selectSafeUpdates(updates) : new Set<string>()),
		[updates],
	)

	const checkUpdates = useCallback(async () => {
		setChecking(true)
		try {
			const { errors } = await refreshAllRepos()
			setUpdates(await listUpdates())
			if (errors.length)
				openAlert(
					'Some repositories failed to refresh',
					errors.map(e => `${e.url}: ${errorText(e.error)}`).join('\n'),
				)
		} catch (e) {
			openAlert("Couldn't check for updates", errorText(e))
		} finally {
			setChecking(false)
		}
	}, [])

	const updateAll = async () => {
		if (!safeIds.size) return
		setInstalling(true)
		try {
			const { installed, pending, errors } = await updatePlugins(safeIds)
			await resyncPluginSources().catch(noop)
			setUpdates(await listUpdates())

			const lines = [
				installed.length ? `Updated: ${installed.join(', ')}` : null,
				pending.length
					? `Applies after reload: ${pending.join(', ')}`
					: null,
				...errors.map(e => `${e.id} failed: ${errorText(e.error)}`),
			].filter(Boolean)
			openAlert('Update finished', lines.join('\n\n') || 'Nothing changed.')
		} catch (e) {
			openAlert('Update failed', errorText(e))
		} finally {
			setInstalling(false)
		}
	}

	const plugins = useMemo(() => {
		const q = query.trim().toLowerCase()

		return [...pList.values()]
			.filter(p => !isPluginInternal(getInternalPluginMeta(p)))
			.filter(p => {
				if (q) {
					const hay = [p.manifest.id, p.manifest.name, p.manifest.description]
						.filter(Boolean)
						.join(' ')
						.toLowerCase()
					if (!hay.includes(q)) return false
				}

				const enabled = isPluginEnabledInActiveSlot(p)
				return (
					(!filters.has('enabled') || enabled) &&
					(!filters.has('disabled') || !enabled) &&
					(!filters.has('updates') || updateById.has(p.manifest.id)) &&
					(!filters.has('errors') || isPluginErrored(p)) &&
					(!filters.has('reload') || isPluginPendingReload(p))
				)
			})
			.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
		// `tick` makes this re-run when plugin state changes.
		// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	}, [query, filters, updateById, tick])

	return (
		<View style={{ gap: 12 }}>
			<Stack spacing={8}>
				<SearchInput onChange={(v: string) => setQuery(v)} />
				<Stack spacing={8} direction="horizontal">
					<Button
						text={filters.size ? `Filter (${filters.size})` : 'Filter'}
						variant={showFilters || filters.size ? 'primary' : 'secondary'}
						size="sm"
						onPress={() => setShowFilters(s => !s)}
					/>
					<Button
						text={
							safeIds.size
								? `Update all (${safeIds.size})`
								: updates
									? 'No updates'
									: 'Check for updates'
						}
						variant="secondary"
						size="sm"
						loading={checking || installing}
						disabled={checking || installing || (!!updates && !safeIds.size)}
						onPress={safeIds.size ? updateAll : checkUpdates}
					/>
					{updates ? (
						<Button
							text="Recheck"
							variant="tertiary"
							size="sm"
							disabled={checking || installing}
							onPress={checkUpdates}
						/>
					) : null}
				</Stack>
			</Stack>

			{showFilters ? (
				<FilterPanel active={filters} onChange={setFilters} />
			) : null}

			{updates && updates.length > safeIds.size ? (
				<Text variant="text-sm/medium" color="text-muted">
					{updates.length - safeIds.size} update(s) skipped because they are
					blocked or would break another plugin.
				</Text>
			) : null}

			{plugins.length === 0 ? (
				<Text variant="text-md/medium" color="text-muted">
					No installed plugins match.
				</Text>
			) : null}

			{plugins.map(p => (
				<InstalledPluginCard
					key={p.manifest.id}
					plugin={p}
					update={updateById.get(p.manifest.id)}
				/>
			))}
		</View>
	)
}

/* -------------------------------------------------------------------------- */
/*  Browse tab                                                                */
/* -------------------------------------------------------------------------- */

interface BrowseEntry {
	listing: RepoPluginListing
	repoUrl: string
	repoName: string | null
}

const COMMUNITY_REPO = 'https://revenge-mod.github.io/revenge-community-plugins'

const normalizeUrl = (url: string) => url.replace(/\/+$/, '').toLowerCase()

/**
 * Makes sure the community repository is in Revenge's repository list.
 * Only adds it when missing (a repo you disabled yourself stays disabled), and puts it
 * first, like Revenge's own default repository. Your other repositories are kept as they are.
 */
async function ensureCommunityRepo(): Promise<Repo[]> {
	const repos = await listRepos()
	const target = normalizeUrl(COMMUNITY_REPO)

	if (repos.some(r => normalizeUrl(r.url) === target)) return repos

	const userRepos = repos
		.filter(r => !r.internal)
		.map(({ url, enabled }) => ({ url, enabled }))

	await setRepos([{ url: COMMUNITY_REPO, enabled: true }, ...userRepos])
	await refreshRepo(COMMUNITY_REPO).catch(noop)

	return listRepos()
}

async function loadBrowse(
	refresh: boolean,
): Promise<{ entries: BrowseEntry[]; repos: Repo[] }> {
	await ensureCommunityRepo()
	if (refresh) await refreshAllRepos()

	const repos = (await listRepos()).filter(r => r.enabled)
	const seen = new Set<string>()
	const entries: BrowseEntry[] = []

	// Repos are listed by priority, the first one serving a plugin wins.
	for (const repo of repos) {
		for (const listing of await listRepoPlugins(repo.url)) {
			if (seen.has(listing.id)) continue
			seen.add(listing.id)
			entries.push({ listing, repoUrl: repo.url, repoName: repo.name })
		}
	}

	entries.sort((a, b) => a.listing.name.localeCompare(b.listing.name))
	return { entries, repos }
}

function describePlan(plan: InstallPlan) {
	const lines = plan.actions.map(
		a => `${a.replaces ? 'Update' : 'Install'} ${a.id} v${a.version}`,
	)
	const warnings = plan.warnings.map(w => w.message)
	return [...lines, ...warnings].join('\n')
}

function BrowseTab() {
	const { Card, Stack, Text, Button } = Design
	const tick = usePluginListTick()

	const [entries, setEntries] = useState<BrowseEntry[] | null>(null)
	const [repos, setRepoList] = useState<Repo[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [busyId, setBusyId] = useState<string | null>(null)

	const load = useCallback(async (refresh: boolean) => {
		setLoading(true)
		setError(null)
		try {
			const result = await loadBrowse(refresh)
			setEntries(result.entries)
			setRepoList(result.repos)
		} catch (e) {
			setError(errorText(e))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		load(false)
	}, [load])

	const visible = useMemo(() => {
		const q = query.trim().toLowerCase()
		return (entries ?? []).filter(
			({ listing: l }) =>
				!q ||
				[l.id, l.name, l.description, l.author]
					.filter(Boolean)
					.join(' ')
					.toLowerCase()
					.includes(q),
		)
	}, [entries, query])

	const install = async ({ listing, repoUrl }: BrowseEntry) => {
		setBusyId(listing.id)
		try {
			const plan = await planInstall(listing.id, { repos: [repoUrl] })
			setBusyId(null)

			const ok = await confirm(
				`Install ${listing.name}?`,
				`${describePlan(plan)}\n\nPlugins run with full access to your Discord client, including your messages and token. Only install plugins you trust.`,
				'Install',
			)
			if (!ok) return

			setBusyId(listing.id)
			const { pending } = await installFromRepo(plan)
			openAlert(
				`${listing.name} installed`,
				pending.length
					? 'Reload Discord to finish applying it, then enable it in the Installed tab.'
					: 'Enable it from the Installed tab.',
			)
		} catch (e) {
			openAlert('Install failed', errorText(e))
		} finally {
			setBusyId(null)
		}
	}

	return (
		<View style={{ gap: 12 }}>
			<Stack spacing={8}>
				<SearchInput onChange={(v: string) => setQuery(v)} />
				<Button
					text="Refresh repositories"
					variant="secondary"
					size="sm"
					loading={loading}
					disabled={loading}
					onPress={() => load(true)}
				/>
			</Stack>

			{repos.length ? (
				<Text variant="text-sm/medium" color="text-muted">
					Searching {repos.length} repositor{repos.length === 1 ? 'y' : 'ies'}:{' '}
					{repos.map(r => r.name ?? r.url).join(', ')}
				</Text>
			) : null}

			{error ? (
				<Text variant="text-md/medium" color="text-danger">
					Couldn't load plugins: {error}
				</Text>
			) : null}

			{!loading && !error && visible.length === 0 ? (
				<Text variant="text-md/medium" color="text-muted">
					No plugins found.
				</Text>
			) : null}

			{visible.map(entry => {
				const { listing } = entry
				const installed = pList.has(listing.id)
				const latest = listing.channels.latest ?? listing.order[0]
				// `tick` keeps the Installed state fresh after installs/uninstalls.
				void tick

				return (
					<Card key={listing.id}>
						<Stack spacing={8}>
							<Text variant="heading-md/semibold">
								{listing.name}{' '}
								{latest ? (
									<Text variant="text-sm/medium" color="text-muted">
										v{latest}
									</Text>
								) : null}
							</Text>
							{listing.description ? (
								<Text variant="text-md/medium">{listing.description}</Text>
							) : null}
							<Text variant="text-sm/medium" color="text-muted">
								{[listing.author, entry.repoName].filter(Boolean).join(' · ')}
							</Text>
							<Button
								text={installed ? 'Installed' : 'Install'}
								variant={installed ? 'secondary' : 'primary'}
								size="sm"
								loading={busyId === listing.id}
								disabled={installed || busyId !== null}
								onPress={() => install(entry)}
							/>
						</Stack>
					</Card>
				)
			})}
		</View>
	)
}

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

function PluginManager() {
	const { Stack, Button } = Design
	const [tab, setTab] = useState<'installed' | 'browse'>('installed')

	return (
		<Page>
			<ScrollView
				contentContainerStyle={{ gap: 12, paddingBottom: 32 }}
				keyboardShouldPersistTaps="handled"
			>
				<Stack spacing={8} direction="horizontal">
					<Button
						text="Installed"
						variant={tab === 'installed' ? 'primary' : 'secondary'}
						size="sm"
						onPress={() => setTab('installed')}
					/>
					<Button
						text="Browse"
						variant={tab === 'browse' ? 'primary' : 'secondary'}
						size="sm"
						onPress={() => setTab('browse')}
					/>
				</Stack>

				{tab === 'installed' ? <InstalledTab /> : <BrowseTab />}
			</ScrollView>
		</Page>
	)
}

export default plugin({
	SettingsComponent() {
		return <PluginManager />
	},
})
