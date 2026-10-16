/**
 * Pure link-cleaning logic. No Revenge or Discord imports, so it can be tested anywhere.
 *
 * Hermes' URL / URLSearchParams support is limited, so query strings are
 * handled by hand and everything we don't remove is left byte-for-byte intact.
 */

interface Rule {
	params?: string[]
	prefixes?: string[]
}

/** Removed on every site. */
const GLOBAL: Rule = {
	prefixes: ['utm_', 'pk_', 'mtm_', 'matomo_', 'hsa_', 'oly_'],
	params: [
		'fbclid',
		'gclid',
		'gclsrc',
		'gbraid',
		'wbraid',
		'gad_source',
		'dclid',
		'msclkid',
		'yclid',
		'twclid',
		'ttclid',
		'li_fat_id',
		'mc_eid',
		'mc_cid',
		'igshid',
		'igsh',
		'_hsenc',
		'_hsmi',
		'mkt_tok',
		'vero_id',
		'wickedid',
		'_ga',
		'_gl',
		'ref_src',
		'ref_url',
	],
}

/** Extra parameters removed only on specific sites. Keys are registrable domains. */
const BY_DOMAIN: Record<string, Rule> = {
	'youtube.com': { params: ['si', 'feature', 'pp'] },
	'youtu.be': { params: ['si', 'feature', 'pp'] },
	'spotify.com': { params: ['si', 'context'] },
	'twitter.com': { params: ['s', 't', 'cxt'] },
	'x.com': { params: ['s', 't', 'cxt'] },
	'instagram.com': { params: ['igshid', 'igsh'] },
	'tiktok.com': {
		params: [
			'_r',
			'_t',
			'is_from_webapp',
			'sender_device',
			'sender_web_id',
			'share_app_id',
			'share_link_id',
			'social_sharing',
			'tt_from',
			'u_code',
		],
	},
	'reddit.com': { params: ['share_id', 'ref', 'ref_source'] },
	'facebook.com': {
		params: ['mibextid', 'rdid', 'refsrc'],
		prefixes: ['__cft__', '__tn__'],
	},
	'linkedin.com': {
		params: ['trk', 'trackingid', 'lipi', 'refid', 'originalsubdomain'],
	},
	'amazon.com': {
		params: ['tag', 'ref', 'ref_', 'linkcode', 'linkid', 'camp', 'creative'],
		prefixes: ['pf_rd_', 'pd_rd_'],
	},
}

const HOST_RE = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i

function getHost(url: string): string | undefined {
	return HOST_RE.exec(url)?.[1]?.toLowerCase().replace(/^www\./, '')
}

function ruleFor(host: string): Rule | undefined {
	// Amazon runs many regional domains (amazon.co.uk, amazon.de, ...).
	if (/(^|\.)amazon\.[a-z.]{2,}$/.test(host)) return BY_DOMAIN['amazon.com']
	for (const domain in BY_DOMAIN)
		if (host === domain || host.endsWith(`.${domain}`)) return BY_DOMAIN[domain]
}

function matches(rule: Rule | undefined, key: string) {
	if (!rule) return false
	return (
		!!rule.params?.includes(key) || !!rule.prefixes?.some(p => key.startsWith(p))
	)
}

function shouldRemove(host: string | undefined, rawKey: string) {
	let key = rawKey
	try {
		key = decodeURIComponent(rawKey)
	} catch {}
	key = key.toLowerCase()

	return (
		matches(GLOBAL, key) || (!!host && matches(ruleFor(host), key))
	)
}

/** Cleans one URL. Returns the input unchanged if there is nothing to remove. */
export function cleanUrl(url: string): string {
	const hashAt = url.indexOf('#')
	const fragment = hashAt === -1 ? '' : url.slice(hashAt)
	const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt)

	const queryAt = beforeHash.indexOf('?')
	if (queryAt === -1) return url

	const base = beforeHash.slice(0, queryAt)
	const pairs = beforeHash.slice(queryAt + 1).split('&')
	const host = getHost(base)

	const kept = pairs.filter(
		pair => pair && !shouldRemove(host, pair.split('=')[0]),
	)
	if (kept.length === pairs.length) return url

	return base + (kept.length ? `?${kept.join('&')}` : '') + fragment
}

const URL_RE = /https?:\/\/[^\s<>]+/gi
const CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/g
const TRAILING = /[.,;:!?'"*_~|]/

/** Splits trailing punctuation / markdown / an unbalanced ")" off a matched URL. */
function peel(match: string): [url: string, tail: string] {
	let end = match.length
	while (end > 0) {
		const ch = match[end - 1]
		if (TRAILING.test(ch)) end--
		else if (ch === ')' || ch === ']') {
			const open = ch === ')' ? '(' : '['
			const segment = match.slice(0, end)
			const opens = segment.split(open).length - 1
			const closes = segment.split(ch).length - 1
			if (closes > opens) end--
			else break
		} else break
	}
	return [match.slice(0, end), match.slice(end)]
}

/** Cleans every link in a message. Links inside code spans and code blocks are left alone. */
export function cleanContent(content: string): string {
	if (!content || content.indexOf('http') === -1) return content

	return content
		.split(CODE_RE)
		.map((part, i) =>
			// Odd indexes are the captured code segments.
			i % 2
				? part
				: part.replace(URL_RE, match => {
						const [url, tail] = peel(match)
						return cleanUrl(url) + tail
					}),
		)
		.join('')
}
