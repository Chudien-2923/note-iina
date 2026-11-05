# Release process

## Version policy

Use Semantic Versioning (`MAJOR.MINOR.PATCH`):

- **PATCH**: backward-compatible bug fixes.
- **MINOR**: backward-compatible features.
- **MAJOR**: breaking behavior or storage changes. Document migration and backup/rollback limits before release; never silently discard notes.

Keep `package.json` and `note-iina.iinaplugin/Info.json` versions identical. The initial public release is **v1.0.1**; 1.0.0 was an internal candidate, not a historical public release. The note-file schema version is separate from the plugin version; do not bump the schema just because the plugin changes.

Every public version has:

1. A dated section in `CHANGELOG.md`, including behavior changes and known verification limits.
2. An immutable annotated Git tag `vX.Y.Z` pointing at its tested commit.
3. A GitHub Release with `note-iina-X.Y.Z.iinaplgz` and `SHA256SUMS.txt` as downloadable assets.

Never move an already published version tag or silently replace its archive. Fix mistakes with a new patch version. Keep unfinished changes in `[Unreleased]`.

## Prepare and verify

1. Update both version files, installation examples in README and changelog. Move the previous comparison link to the new release and add a new `[Unreleased]` comparison.
2. Review staged files for credentials, personal notes, media, machine-specific paths and generated tool files. These must not enter the public repository.
3. On macOS with Node 20+ and Swift command-line tools, run:

   ```sh
   npm test
   npm run pack
   unzip -t note-iina-X.Y.Z.iinaplgz
   shasum -a 256 note-iina-X.Y.Z.iinaplgz
   ```

4. Manually install the archive in IINA and exercise the changed path. Do not infer GUI success from Node or JavaScriptCore tests. Record exactly what was verified, plus remaining limits. Back up course notes before tests involving real data.
5. Commit the release preparation and push `main`. Confirm the macOS CI run passes. CI runs tests, checks manifest/package version agreement, packages and validates the archive; it does not control IINA or certify its GUI.

## Publish

Use the version being released in place of `X.Y.Z`. The following is an example for **1.0.1**, not a command to republish an existing release:

```sh
git tag -a v1.0.1 -m "Note IINA v1.0.1"
git push origin v1.0.1
shasum -a 256 note-iina-1.0.1.iinaplgz > SHA256SUMS.txt
gh release create v1.0.1 \
  note-iina-1.0.1.iinaplgz SHA256SUMS.txt \
  --verify-tag --title "Note IINA v1.0.1" \
  --notes-file /path/to/reviewed-release-notes.md
```

Release notes should explain the app or changed behavior, installation, storage/backup, supported IINA version, and the verification actually performed. Mark preview versions as prereleases instead of presenting them as stable.

After publication, verify the repository is Public, the tag points at the intended commit, release assets are downloadable without authentication, and the downloaded archive matches the published checksum. Users can verify a download with `shasum -a 256 -c SHA256SUMS.txt` when both files are in the same folder.

## User upgrades and rollback

Install the new archive via IINA's **Settings → Plugins → Install Local Package…** and replace the existing plugin. Never ask users to delete note data to upgrade.

Keep previous published releases downloadable. Before rollback, back up `.iina-notes.json` and plugin draft data. An older plugin may not understand a newer storage schema; consult that release's migration notes rather than assuming downgrade compatibility.
