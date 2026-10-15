import { reloadApp } from '@revenge-mod/modules/native/app'
import { Alert } from 'react-native'

const BUNDLE_URL =
	'https://evantannermeta.github.io/revenge-next-bundle/revenge.bundle'

// How often to poll while Discord is open.
const CHECK_INTERVAL_MS = 15 * 60 * 1000

// Returns an identifier that changes whenever the bundle changes.
// Uses the ETag, falling back to Last-Modified if the host doesn't send one.
async function fetchVersionId(): Promise<string | null> {
	try {
		// Cache-busting query so we don't read a stale cached response.
		const res = await fetch(`${BUNDLE_URL}?t=${Date.now()}`, {
			method: 'HEAD',
			headers: { 'Cache-Control': 'no-cache' },
		})
		if (!res.ok) return null
		return res.headers.get('etag') ?? res.headers.get('last-modified')
	} catch {
		return null // offline etc. Just try again next interval.
	}
}

export default plugin({
	start({ cleanup }) {
		// The loader already pulls the newest bundle on launch, so the first
		// value we see this session is our baseline. Anything different later = update.
		let known: string | null = null
		let prompting = false

		const check = async () => {
			const id = await fetchVersionId()
			if (!id) return

			if (known === null) {
				known = id
				return
			}
			if (id === known || prompting) return

			prompting = true
			Alert.alert(
				'Update detected',
				'A new Revenge update is available. Restart to get the latest update?',
				[
					{
						text: 'No',
						style: 'cancel',
						onPress: () => {
							known = id // don't nag again until it changes again
							prompting = false
						},
					},
					{
						text: 'Yes',
						onPress: () => {
							reloadApp()
						},
					},
				],
				{
					cancelable: true,
					onDismiss: () => {
						known = id
						prompting = false
					},
				},
			)
		}

		check()
		const interval = setInterval(check, CHECK_INTERVAL_MS)
		cleanup(() => clearInterval(interval))
	},
})
