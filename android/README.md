# Gexart Calls — Android companion app

Uploads recordings of your client calls to the Gexart CRM. The CRM matches the number to a
contact or prospect, adds the call to their timeline, transcribes it (Workers AI Whisper) and
writes an AI summary draft (Claude), if those are configured.

## How it works (and why)

Since Android 10, apps other than the phone's own dialer cannot record call audio. So this app
**does not record calls itself**. It works with your dialer's built-in call recorder:

1. You turn on call recording in your phone's dialer (Samsung, Xiaomi, OnePlus, Vivo, Oppo and the
   Google Phone app in many regions support it).
2. After each call ends, the app reads the call log (number, direction, time, duration), finds the
   recording file the dialer saved in the folder you chose, and uploads both to the CRM.
3. By default only calls with numbers that exist in the CRM are uploaded; personal calls are skipped.

Uploads are idempotent: a call is never uploaded twice, even if a sync is retried.
Missed and zero-length calls are ignored. Calls made before you paired the app are not uploaded.

## Build and install (Android Studio)

1. Install [Android Studio](https://developer.android.com/studio) (it includes the SDK and JDK).
2. **File → Open** and choose this `android` folder. Let Gradle sync finish (first time: a few minutes).
   If Studio offers to update the Android Gradle Plugin, accept.
3. Plug in your phone with **USB debugging** on (Settings → About phone → tap Build number 7 times →
   Developer options → USB debugging), then press **Run ▶**.
   Or **Build → Build App Bundle(s) / APK(s) → Build APK(s)** and copy `app/build/outputs/apk/debug/app-debug.apk`
   to the phone to install.

## Set up on the phone

1. In the CRM: **Settings → Phone app → Create token**. Copy the CRM address and the token.
2. In the app: paste both, tap **Save & test connection**.
3. **Choose folder**: pick the folder your dialer saves recordings in.
4. **Grant call-log & phone permissions**.
5. Make a test call to a number saved as a contact in the CRM. Within about two minutes it appears
   under **Outreach → Calls** and on the contact's page.

## Notes

- `READ_CALL_LOG` is a restricted permission on the Google Play Store, so distribute the APK
  directly to your team (sideload) or via a private/managed channel.
- Revoke a lost phone's access in **Settings → Phone app → Revoke**.
- Recording laws differ by country. Inform the other party that the call is recorded.
- Only HTTPS CRM addresses are accepted.
