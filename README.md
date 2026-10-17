# Evan Plugins

A plugin repository for [Revenge](https://github.com/revenge-mod/revenge-bundle-next), the Discord client mod for Android.

> Revenge and its plugins are unofficial, and you use them at your own risk. Plugins run with full access to your Discord client, so only install code you trust.

## Install

1. In Revenge, open **Settings → Revenge → Plugins** and add this repository:

   ```
   https://evantannermeta.github.io/Evan-Plugins/
   ```

2. Browse the repository, install a plugin, then enable it. Reload Discord if Revenge asks you to.

## Plugins

| Plugin | What it does |
| --- | --- |
| **Plugin Browser** | Search, filter, enable, disable, uninstall and update plugins, and browse and install from this repository and the community one, all in one screen under Settings → Revenge. A Settings tab sets how often it checks for plugin updates, or turns the checks off. |
| **Message Logger** | Keeps deleted messages in chat (in red), shows what edited messages said before, and warns you about ghost pings. Saves a log with attachments (copies of the files are kept on your device) that can be copied, shared or saved as text or JSON. Other plugins can build on its ghost-ping events. |
| **Ghost Ping Notifications** | Sends an Android notification when someone pings you and then deletes the message. Needs Message Logger, which is installed with it. |
| **Staff Tags** | Shows a tag next to the names of server owners and administrators, with custom tag text for specific people. |
| **Clean URLs** | Removes tracking parameters from links you send and receive, such as `utm_*`, `fbclid` and `gclid`, plus site-specific ones like the share ID on YouTube, Spotify and X links. Links inside code blocks are left alone. |
| **Auto-updater** | Checks for new Revenge bundle releases and asks you to restart to get them. You can choose how often it checks and which bundle link it watches. |

<!-- Keep this table in step with the folders in /plugins. -->

## Notes

- **Message Logger** only keeps messages your client received. The log, edit history and saved files stay on your device and nothing is sent anywhere. Files are copied when a message is deleted, or as messages arrive if you turn on **Pre-save new attachments**. Without a saved copy, attachment links can expire and old previews may stop loading.
- **Ghost Ping Notifications** only works while Discord is still running in the background. Android may stop it after a while, and then a deleted ping can't be detected. Message text shows on the lock screen unless you turn that off in its settings.
- **Clean URLs** only removes known tracking parameters from the text of a link. It never opens, follows or shortens links, and nothing is sent anywhere.
- Message Logger and Ghost Ping Notifications include native (Kotlin) parts, so they only work on Android.
- Plugins patch Discord's internals, so a Discord update can break one until it's updated.

## Development

Each plugin lives in `plugins/<name>/` with a `manifest.json` and a JS entry file such as `js/index.tsx`.

```sh
bun install
bun run build                 # builds every JS bundle
bun run build <plugin-name>   # builds one plugin
./gradlew packageAllPlugins   # builds native (Kotlin) parts and packages every plugin
```

Native plugins add `src/main/AndroidManifest.xml`, a Kotlin file under `src/main/kotlin/`, and a `dist.android` entry in `manifest.json`. A Kotlin compile error fails the whole build, so open a pull request first. The validate workflow builds it before anything reaches `main`.

A plugin can depend on another by listing its ID in `dependencies`. Ghost Ping Notifications depends on Message Logger this way, and Revenge installs and starts the library first.

The **Checks** workflow runs Biome and a type check on pushes and pull requests that touch plugin code.

Pushing to `main` runs the release workflow. It publishes every plugin whose `version` in `manifest.json` isn't published yet, and it refuses a version lower than the newest one already published. **Bump the version whenever you change a plugin**, or the change won't reach users.

Releases are published to the `gh-pages` branch. Each artifact goes in `pool/<id>@<version>.zip`, and `index.json` is generated from that folder. To unpublish a version, delete its zip from `pool/` and run the **Publish repository index** workflow.

The workflows need a personal access token with `read:packages`, saved as the repository secret `READ_PACKAGES_TOKEN`, so they can download the Revenge API. Without it the build fails with a `401`.

This repository was generated from the [Revenge plugin template](https://github.com/revenge-mod/revenge-plugin-template), which documents the manifest format, dependencies, channels and native (Kotlin) plugins.

## License

Released under the [GPL-3.0 license](LICENSE).
