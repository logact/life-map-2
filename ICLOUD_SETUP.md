# iCloud Setup (EAS Build)

The app syncs via `react-native-cloud-storage`, whose config plugin in
`app.json` adds iCloud entitlements to the iOS target:

```json
[
  "react-native-cloud-storage",
  { "iCloudContainerIdentifier": "iCloud.com.logact.lifemap" }
]
```

The entitlements it injects are:

- `com.apple.developer.icloud-services`
- `com.apple.developer.icloud-container-identifiers`
- `com.apple.developer.ubiquity-container-identifiers`
- `com.apple.developer.icloud-container-environment`

For an EAS build to sign the app, the **App ID** and the **provisioning
profile** on Apple's side must include the same iCloud capability and
container. If the profile predates the plugin, the build fails with
"Provisioning profile ... doesn't include the iCloud capability".

## One-time Apple Developer portal setup

1. Go to https://developer.apple.com/account → **Certificates, Identifiers &
   Profiles → Identifiers**.
2. Create the container (first time only):
   - **+** → **iCloud Containers** → Continue
   - Description: e.g. `Life Map iCloud`
   - Identifier: exactly `iCloud.com.logact.lifemap` (with the `iCloud.`
     prefix)
3. Open the App ID `com.logact.lifemap`:
   - Enable the **iCloud** capability
   - Click **Configure/Edit** on it and check the container
     `iCloud.com.logact.lifemap`
   - Save

Note: EAS's automatic capability sync can enable the capability itself, but it
**cannot** create or assign iCloud containers — that step is always manual.

## Regenerating the provisioning profile

Any time the entitlements change (e.g. the plugin was added after the profile
was created), invalidate the stale profile so EAS mints a new one:

```bash
eas credentials -p ios
```

- Select the `production` profile → provisioning profile → **Remove
  provisioning profile**
- Do **not** revoke the distribution certificate — other apps may share it

Then rebuild:

```bash
eas build --platform ios --profile production
```

EAS generates a fresh App Store profile containing the iCloud entitlements,
and the signing errors clear.

## Troubleshooting

- **Build still fails on only
  `com.apple.developer.icloud-container-environment`**: pin the environment
  explicitly in `app.json`:

  ```json
  "ios": {
    "entitlements": {
      "com.apple.developer.icloud-container-environment": "Production"
    }
  }
  ```

- **Profile name with an old timestamp reappears** (e.g.
  `*[expo] com.logact.lifemap AppStore 2026-09-13...`): the removal in
  `eas credentials` didn't take — remove it again, or delete it directly in
  the Apple Developer portal under **Profiles**.
- **Runtime error "container not found" on device**: the App ID/container
  assignment in step 3 above wasn't saved, or the device build predates it.
- **TestFlight build shows "iCloud unavailable" although the user is signed
  in** (issue #31): the production provisioning profile predates the
  container assignment, so iOS strips the ubiquity entitlement at install.
  Verify in the portal that the App ID `com.logact.lifemap` has the container
  `iCloud.com.logact.lifemap` checked (step 3), then remove the production
  provisioning profile and rebuild as described above. On the device, also
  check Settings → Apple Account → iCloud → iCloud Drive is on and this app
  is enabled under the iCloud Drive app list. Since the fix for this issue,
  the settings screen shows which case it is: "can't reach the app's iCloud
  container" means the build/profile, the "sign into your Apple Account"
  message means the device, and the small detail line carries the native
  error code.
