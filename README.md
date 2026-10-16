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
| **Plugin Manager** | Search, filter, enable, disable, uninstall and update plugins, and browse the community repository, all in one screen. |
| **Message Logger** | Keeps deleted messages in chat (in red) and saves them to a log, including attachment links. The log can be copied or shared as text or JSON. |
| **Staff Tags** | Shows a tag next to the names of server owners and administrators, with custom tag text for specific people. |
| **Auto-updater** | Checks for Revenge bundle updates and keeps your client up to date. |

<!-- Keep this table in step with the folders in /plugins. -->

## Notes

- **Message Logger** only keeps messages your client received. The log is stored on your device and nothing is sent anywhere. Saved attachment links can expire, so old previews may stop loading.
- Plugins patch Discord's internals, so a Discord update can break one until it's updated.

## Development

Each plugin lives in `plugins/<name>/` with a `manifest.json` and a JS entry file such as `js/index.tsx`.

```sh
bun install
bun run build                 # builds every JS bundle
bun run build <plugin-name>   # builds one plugin
```

Pushing to `main` runs the release workflow. It publishes every plugin whose `version` in `manifest.json` isn't published yet, and it refuses a version lower than the newest one already published. **Bump the version whenever you change a plugin**, or the change won't reach users.

Releases are published to the `gh-pages` branch. Each artifact goes in `pool/<id>@<version>.zip`, and `index.json` is generated from that folder. To unpublish a version, delete its zip from `pool/` and run the **Publish repository index** workflow.

The workflows need a personal access token with `read:packages`, saved as the repository secret `READ_PACKAGES_TOKEN`, so they can download the Revenge API. Without it the build fails with a `401`.

This repository was generated from the [Revenge plugin template](https://github.com/revenge-mod/revenge-plugin-template), which documents the manifest format, dependencies, channels and native (Kotlin) plugins.

## License

Released under the [GPL-3.0 license](LICENSE).
