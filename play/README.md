# Releasing SomniAI on Google Play

Prompt 7.5: the Android app on Google Play's **internal testing** track, where only the testers you list can install it. What's here:

| | |
| --- | --- |
| `listing/en-US/` | The store listing: `title.txt`, `short_description.txt`, `full_description.txt`, and `graphics/` (icon, feature graphic, phone screenshots). Laid out as fastlane `supply` expects, so it can be uploaded by API later |
| `DECLARATIONS.md` | The App content answers: exact alarms, full-screen intent, the foreground service, Health Connect, usage access, ads, rating, audience |
| `../legal/PLAY_DATA_SAFETY.md` | The Data safety form |
| `brand/mark.mjs` | SomniAI's mark, from which `scripts/brand-assets.mjs` draws the launcher icon, the splash screens, the web icons and the listing graphics |

## Building a release

```
git push                              # build only what's on GitHub
node scripts/release.mjs build        # the signed bundle against production
```

It writes `android/app/build/outputs/bundle/release/app-release.aab` and stops unless every check passes:
- signed with the upload key;
- loads `https://somniai.vercel.app` over HTTPS only;
- no debug-only receivers;
- not debuggable;
- has the alarm permissions;
- no native libraries (which would need 16 KB page alignment).

The version code is the number of commits, so each upload is higher than the last. The version name is `package.json`'s.

## The upload key

`node scripts/release.mjs key` made it once:
* The key is at `%USERPROFILE%\.somniai\somniai-upload.p12`: a PKCS#12 file, RSA 4096, alias `upload`, valid 30 years.
* Its password is in `.env.deploy.local` as `ANDROID_UPLOAD_PASSWORD`.
* Neither is in the repository. `check-secrets` fails the build if the password ever reaches a tracked file, the history or the bundle.

**How Google Play uses it.** When you upload the first bundle, accept **Google-generated app signing key** (Play App Signing, the default). Google then keeps the key that signs what people install. Yours only proves an upload came from you.
* If the upload key is lost or leaks, the app isn't lost: the account owner asks for an **upload key reset** in Play Console (*Test and release > Setup > App signing*) and registers a new one.
* That takes Google a few days, and no update can be uploaded meanwhile. The backups are there to avoid that wait.

**Back it up safely: two copies, in two places, both encrypted.**

1. **Password manager.** In a password manager (Bitwarden, 1Password, KeePassXC), make an item "SomniAI Play upload key". Put in it:
   * the `.p12` file as an attachment;
   * the password;
   * the alias `upload`;
   * the SHA-256 fingerprint: `54:AD:59:06:19:E7:5E:39:AC:BB:9D:70:2E:7B:44:64:42:3D:AC:73:0B:B4:F5:1B:B0:5B:51:E3:80:6A:44:AA`.
2. **Offline copy.** On a USB drive kept away from this laptop, put the `.p12` in an encrypted archive: 7-Zip, AES-256, with "Encrypt file names" ticked. Protect it with a different long passphrase, and keep that passphrase in the password manager too. A VeraCrypt volume works as well.
3. **Test the backup once.** Copy the file back from each copy into a temporary folder and run:

   ```
   keytool -list -v -keystore <the copy> -storetype PKCS12 -alias upload
   ```

   Type the password. The SHA-256 line must match the fingerprint above. Then delete the temporary copy.

**Never** put the key or its password:
* in git, even a private repository;
* in e-mail or a chat;
* in a screenshot;
* in an unencrypted cloud folder (Google Drive, OneDrive, Dropbox);
* in an issue or a pull request.

If someone else will build releases, share the password-manager item with them rather than copying the file around. Another person can also be given access to the Play Console itself (*Users and permissions*) without the key: only uploading needs it.

If you think the key has leaked, reset it as above. Someone with the upload key alone can't publish without your Play account, but don't leave it valid.

## First release, step by step

**1. Developer account.** Create one at [play.google.com/console](https://play.google.com/console): personal account, US$25 once. Google checks your identity first, which can take a few days.
* Anonymity: on internal testing, the store page is visible only to your testers.
* Publishing beyond testing makes the developer name and contact e-mail public on Google Play.
* While the paper is under double-blind review, stay on the testing tracks.

**2. Create the app.**
* App name: **SomniAI**. Default language: English (United States).
* App or game: **App**. Free or paid: **Free**.
* Accept the declarations.

**3. App content.** Answer every section from `DECLARATIONS.md`, and Data safety from `legal/PLAY_DATA_SAFETY.md`. Three need something from you:
* **App access.** Make a reviewer account on production (`https://somniai.vercel.app/sign-up`), and give its e-mail and password in the form only.
* **Foreground service video.** Upload the recording to YouTube as *Unlisted* and paste the link. `node scripts/play-screenshots.mjs` makes the recording and prints where it is.
* **Health apps.** Paste the explanations for sleep and resting heart rate.

**4. Store listing** (*Grow users > Store presence > Main store listing*):
* the three texts from `listing/en-US/`;
* `graphics/icon.png` (512 × 512) and `graphics/featureGraphic.jpg` (1024 × 500);
* the phone screenshots in `graphics/phoneScreenshots/`, in order;
* category **Lifestyle**; contact e-mail yours;
* privacy policy `https://somniai.vercel.app/privacy`.

**5. Testers** (*Test and release > Testing > Internal testing > Testers*): make a list with the Google account e-mail of every tester (yours first), and save.

**6. The release** (*Internal testing > Create new release*):
* When asked about app signing, choose **Use Google-generated key**.
* Upload `app-release.aab`.
* Release notes, for example: "First internal test: alarms, the wake check, tonight's plan, the bedtime check, the wake buddy."
* **Next**, read every warning, then **Save and publish**. On the internal track it reaches testers within minutes, usually without a full review.

**7. Install from Google Play.**
1. On the phone, signed in with a tester address, uninstall the development build first. It's signed with a different key, so Play can't install over it.
2. Open the **opt-in link** from the Testers tab, accept, then **Download it on Google Play**.
3. Open SomniAI, sign in, set an alarm a few minutes ahead, lock the phone, and let it ring.
4. Record the result in `DEVICE_TESTS.md` under 7.5.

## Before testers rely on it

* **Wake buddy.** Production's every-minute buddy check isn't scheduled yet (`DEPLOY.md`, cron-job.org). Until it is, buddy alerts never go out, and testers should be told.
* **Google sign-in and Calendar** are off in production until their redirect addresses are registered (`DEPLOY.md`).
* **Emergency-contact texts** go only to numbers verified on the Twilio trial. The listing doesn't mention them.

## Later releases

1. Push.
2. `node scripts/release.mjs build`.
3. Upload to the track with a new release (or by API, once the first upload exists).
4. Re-check `DECLARATIONS.md` and the Data safety form if a permission, an SDK or a data source changed: the tests flag a new permission.
