# SomniAI privacy policy

Version 2, effective 16 November 2026.

SomniAI is an alarm app: an Android app and a web app on the same account. This policy says what it stores about you, why, who else sees any of it, how long it is kept, and how to get a copy or delete it. It is run by {{OPERATOR}}, who decides how your data is used (the "controller"). Questions, requests and complaints: {{CONTACT}}.

**In short.** SomniAI keeps what it needs to wake you and to plan your night, and the extra data you choose to connect (sleep from Health Connect, screen time, Google Calendar, alarm telemetry, a wake buddy). It shows no ads, sells nothing, and has no analytics or advertising trackers. You can download everything and delete everything at any time, in the app.

## What is stored, and why

### Your account

Your email address, the name you give (optional), and how you sign in: a password, stored only as a one-way hash (bcrypt), or Google sign-in. Also your settings: time zone, sleep goal, wake window, how hard alarms should try, and whether a wake check is required. Needed to have an account at all.

### Alarms and tasks

Your alarms (label, time, repeat, how they escalate, whether they are unmissable), what happened when each rang (when it rang, how it was stopped or snoozed, how the wake check went), and your tasks, typed by you or read from Google Calendar. Needed for the app to work: the alarms are planned on the server and handed to your phone, which rings them without needing the network.

### Sleep

The sleep log: when you slept and woke, for how long, typed by you or read from Health Connect. The bedtime the planner gave you for a night, and a morning report after each alarm (which stage woke you, how long the wake check took, whether you went to bed when planned). Used to plan the night, to show you your sleep, and for predictions made just for you once there are enough of your own nights.

Predictions run on SomniAI's own prediction service, which receives the numbers it needs (hours slept, bedtimes, and the like) and never your name or email address. It keeps nothing.

### Health Connect

Only in the Android app, only if you allow it in Health Connect's own permission screen, and read only: **sleep sessions** and **resting heart rate** from the last 14 days. The phone works out one night per date, and sends the server that night's times, minutes asleep and in bed, and the resting heart rate (the middle reading of that date). It is stored as that date's sleep log. SomniAI never writes to Health Connect and never reads anything else from it.

Data from Health Connect is used only to plan your nights and make your predictions. It is not used for advertising, not sold, not given to anyone, and not used to train models for other people. You can withdraw access at any time in Health Connect's settings; nights already read stay in your sleep log until you delete your account.

### Screen time before bed

Only in the Android app, and only if you turn on Usage access for SomniAI in Android's settings, after the app explains why. The phone reads which app was in front and when, and adds up the minutes you used the phone in the three hours before bed. **Only that number, the bedtime it used, and where the bedtime came from leave the phone.** Which apps you used never leaves it. Used for predictions: phone use before bed is one of the things that changes sleep.

### How you use alarms

Events from the app (an alarm rang, was snoozed, was dismissed, a wake check passed), feedback on predictions, and the escalation settings learned from your mornings. Used to make the next alarm work better for you.

### Alarm telemetry

Off until you allow it, with the text you agree to shown in full; you can stop it at any time. When on, the phone records for each wake how long until you first touched the screen or pressed a key, how many times you snoozed, how far the alarm escalated, and how the wake check went. Nothing is recorded before you allow it, and stopping drops whatever the phone hasn't sent yet. You can download or delete all of it, separately from your account, in the app.

### Weather and location

Only in the web app, and only if you press the button and your browser asks you to share your location. The page rounds the location to about 11 km before sending it; the server asks the weather service (Open-Meteo) for the current weather there, keeps the temperature and the kind of weather, and does not keep the location. The Android app does not ask for your location at all.

### Google Calendar

Only if you connect it. SomniAI asks Google for read-only access to your calendar's events (the `calendar.events.readonly` permission). It reads the next 7 days of events and turns each into a task (title, time, and the event's description), so alarms can be planned around them; it updates them when events move, and removes them when events are cancelled. It stores the Google address of the calendar and Google's lasting access grant, encrypted. Disconnecting asks Google to remove the access, deletes the grant, and removes the calendar's tasks you haven't done.

SomniAI's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Calendar data is used only to plan your alarms, is shown only to you, is never used for advertising, never sold, never read by people (unless you ask for help with it, or the law requires), and never used to train models.

### Wake buddy

Only if you pair with someone. A wake buddy is another SomniAI user you pair with: you share an invite code, they ask to pair, and you accept. Either of you can end it. Your buddy sees your name, whether your phone can receive alerts, and your phone number only if you choose to share it.

If an alarm isn't stopped and checked in time (an unmissable alarm, or any alarm if you choose so in the buddy settings), your buddy's phone gets an alert after the delay you set: your name, the alarm's label, and how many minutes ago it rang. At most 3 a day, never two within 30 minutes. To send it, SomniAI stores the push address of each phone you use (Firebase Cloud Messaging), and a record of every alert: when, to whom, and whether it was delivered.

**Emergency contact.** You can name a person and a phone number to text if you don't respond, after confirming that they agreed to receive these texts. The text says: your name, that you haven't confirmed you're awake, which alarm, how long ago it rang, and that they are your emergency contact. It is sent by Twilio. You are responsible for having their agreement; they can ask you, or us, to remove their number.

### Research study

Only if you join with an enrolment code, after reading and agreeing to a separate consent document. The study assigns your alarms at random to showing the wake plan or not, and records the assignments. Researchers receive only an anonymised export: a random participant code, study days instead of dates, times of day, and the measurements, never your name, email address, account or alarm names. Leaving, at any time, deletes everything collected for the study. An export a researcher already took can't be recalled, but it never contained who you are. The study enrols no one before an ethics committee has approved it.

### Error reports

When something breaks (a page that fails to show, a server error, an error in the prediction service), SomniAI records what went wrong so it can be fixed: the kind of error, its message and where in the code it happened, and the page or service involved. Before anything is stored, email addresses, ids, tokens, phone numbers and web-address details are removed, and no account is recorded with it, so a report can't be traced to you. The same error happening again only raises its count. Reports are deleted 90 days after the error last happened. SomniAI also checks every minute that its prediction service is answering and keeps a record of when it wasn't; that record holds nothing about anyone.

### Security

To stop password guessing and abuse, the server counts recent requests per account, per internet (IP) address, and per email address used to sign in (stored only as a one-way hash), and forgets each count after at most two hours. Your password is stored only as a hash. The Google Calendar grant is stored encrypted. The released Android app talks to the server only over an encrypted connection (HTTPS). The hosting provider may record the address your requests come from in its own logs.

## Who else receives data

SomniAI does not sell data, show ads or use advertising or analytics trackers. Data reaches others only as follows:

- **Your wake buddy and your emergency contact**: the alerts and texts above, because you set them up.
- **Service providers**, who process data for SomniAI and nothing else: the hosting provider and database ({{HOSTING}}); Google (sign-in with Google, Google Calendar, and Firebase Cloud Messaging for buddy alerts); Twilio (the emergency contact's texts: the number and the message); Open-Meteo (the rounded location, for the weather; web app only).
- **Researchers**: only the anonymised study export, only if you joined the study.
- **When the law requires it**, to the extent it requires.

## How long it is kept

Until you delete it or your account. Some things go sooner on their own: an invite code after a day, request counts after at most two hours, calendar tasks when the event is cancelled or you disconnect. When you delete your account, everything above is deleted from the live database at once. {{BACKUPS}}

Texts and alerts already delivered stay on the phones that received them, and Twilio and Google keep their own delivery records under their own policies.

## Your choices and rights

- **Download everything**: in the app, under *Your data*, "Download all my data" gives one file with everything stored about your account. Telemetry has its own download too.
- **Delete everything**: in the app, under *Your data*, "Delete my account". It deletes the account and everything above, asks Google to remove calendar access, takes you out of the study, and clears this phone's alarms. It can't be undone. Without the app: see [Delete your account](/delete-account).
- **Stop any one source**: disconnect Google Calendar; turn off Health Connect or Usage access in Android's settings; stop telemetry; leave the study; end a buddy pairing; remove the emergency contact.
- **Correct**: change your alarms, tasks, settings and contacts in the app.

Depending on where you live (for example under the GDPR in the EU and UK), you have the right to access, correct, delete, restrict and move your data, to object, and to withdraw consent at any time without affecting what was done before. You can also complain to your data protection authority. The legal basis for each use: providing the app you signed up for (your account, alarms, tasks and sleep log); your consent (Health Connect, screen time, Google Calendar, telemetry, location for the weather, a wake buddy, the emergency contact's texts, the study), which you can withdraw as described above; and SomniAI's legitimate interest in keeping the service secure (request counts).

## Children

SomniAI is not for children. You must be at least 16 to create an account.

## Changes

If this policy changes, the new version is published here with a new version number and date.

## Contact

{{OPERATOR}}, {{CONTACT}}.
