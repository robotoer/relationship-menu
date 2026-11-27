# Wants & Won'ts privacy policy

> **Draft for review. This is not legal advice and is not in effect.** It describes the app as [the sync plan](../spec/sync.md) says it will work at launch. Open items are marked `[FILL IN: …]` and `[LAWYER: …]` and listed in [README.md](README.md).

**Effective date:** `[FILL IN: date this takes effect]`

## The short version

- Your menus are saved in your browser. You don't need an account.
- If you're a supporter and turn on sync, menus are encrypted on your device first. We can't read them.
- A menu link contains the menu. Anyone who gets the link can read it, and our web host receives it when the link is opened.
- We count how the app is used with Google Analytics. We never send it what you write.
- Our server stores no email address and no name.
- We don't show ads and we don't sell your data.

## Who we are

Wants & Won'ts (formerly Relationship Menu) is a relationship menu app run by `[FILL IN: your legal name or business name]`, `[FILL IN: postal address]`. Privacy questions: `[FILL IN: privacy contact email]`.

`[LAWYER: confirm the data controller details, and whether an EU and/or UK representative must be named (GDPR and UK GDPR Article 27).]`

## What is stored, and where

### In your browser (everyone)

- **Your menus:** titles, groups, items, answers, notes, and any name, pronouns or note about a person.
- **A few small settings** the app needs to work.

This stays on your device. It is **not encrypted** there. Anyone who can use your unlocked device and browser can read it.

To remove it, delete menus in the app, or clear this site's data in your browser. Clearing site data removes everything. If you used the app between July 2024 and March 2026, an older copy of some menus may remain in your browser's storage until you clear the site data.

Browsers can delete stored data on their own. For example, Safari can delete a site's data after 7 days of Safari use without a visit to that site.

### In links you share

A menu link holds the menu itself in the web address. A full menu link includes your answers, notes and details about a person. A template link includes none of those.

- Anyone who has the link can read it. A link is **not encrypted** against whoever holds it.
- Apps you send it through (messages, email, chat) can see it.
- It can stay in your browser history, and your browser may sync that history to your other devices.
- When someone opens the link, the address, menu included, is sent to our web host as part of loading the page. We don't read or collect it, and we don't send it to analytics. The host can technically see it. `[FILL IN: check what request logs the host keeps for page addresses, and for how long, and say so here.]`

A **conversation link** ("Not in the same room?" on the Talk it through page) holds a whole conversation: both menus, everyone's area and topic notes, outcomes and comments. The same points apply, with one difference: the conversation is in the part of the address after `#`, which browsers don't send to our web host, so it never reaches our server or its logs. It is still readable by anyone who has the link and by the apps you send it through. Who you are on a device ("I'm …") and what you've already seen stay in that browser.

### On our sync server (only supporters who turn on sync)

Sync is optional. When you turn it on, your device creates a **sync code** of 24 words. Menus are encrypted on your device with a key made from that code, then sent to our server, which runs on Cloudflare (a Worker and a D1 database).

The server stores:

| Record | What's in it |
| --- | --- |
| Account | A random-looking account id made from your sync code; whether you're a supporter (status and plan); Stripe's customer id and subscription id; dates (created, updated, paid through, lapsed); change counters |
| Each synced menu | The encrypted menu; a random menu id; a version number and change counter; its size; when it changed; whether it was deleted |
| Pairing (adding a device) | Your sync code, encrypted with a key that exists only in the QR code; expiry and "used" times |
| Payment messages from Stripe | Each message's id and when it arrived, so it isn't handled twice |

The server does **not** store your email, your name, your card, or any menu text. It stores no password. Your sync code and your encryption key never leave your device unencrypted.

**What the server can still tell:** that an account exists, whether it supports us, how many menus it has, roughly how big each is (padded to the next 1 KiB), and when each was written and read. Combined with Stripe's records, this could link a named person to a number of encrypted menus. It still can't read them.

**What the server could do:** delete or withhold its copies, or give a new device an older version. It can't change a menu or fake a deletion without your devices noticing, and it can't delete menus stored on your devices.

### One limit you should know

Like any web app that encrypts in the browser, you rely on the app code we serve. If our hosting or build process were compromised, changed code could read your menus or sync code on your device.

## Your sync code

- The 24 words are the **only** key to your synced menus.
- Your browser keeps the code on each device where sync is on, so anyone with that unlocked device can show it.
- We never receive it in a form we can read, so we can't recover or reset it.
- **If you lose every device with sync on, and the words, your synced menus can't be recovered. Not by you, not by us, not by anyone.**
- If someone else may have seen your code, or you lost a device, use **Replace sync code**. It moves your supporter status to a new code and deletes the data stored under the old one. It can't take back anything that person already copied.

Adding a device with a QR code uses a one-time link. It stops working after one use or 10 minutes. If it says it was already used and that wasn't you, replace your sync code.

## Who else holds data

### Stripe and Link (payments)

Payments go through Stripe Checkout with Stripe Managed Payments. Stripe, through its Link service, is the **merchant of record**: the seller on your receipt, shown as "Sold through Link". `[FILL IN: exact legal name of the seller, from your Stripe agreement.]`

Stripe and Link hold your email, name, card, billing country and postcode, the plan and amount, and your IP address at checkout. From us they get only the random account id and the plan. They never get menu content, or even how many menus you have.

They handle this data under their own privacy policies: `[FILL IN: links to Stripe's and Link's privacy policies and buyer terms]`.

### Cloudflare (hosting and sync)

Cloudflare serves the app and runs the sync server. Like any host, it sees your IP address, your rough location from it, and the timing and size of requests, including when your device syncs. It can also see page addresses, including menu links (see above). Our server uses IP addresses (when a pairing link is opened) and account ids (on other requests) to limit abusive traffic. It never writes IP addresses to our logs or database, and never writes account ids to logs.

`[FILL IN: where the D1 database is located.]` Cloudflare's privacy policy: `[FILL IN: link]`.

### Google Analytics

The app uses Google Analytics 4 to count how it's used.

**We send:**

- the page path (such as `/menu`), never the part of the address that holds a menu;
- a fixed list of usage events, such as "a link was copied" or "a comparison was shown", with only fixed values: template ids, ready-made group names, kinds of link or filter, counts, percentages, yes/no, performance timings and error type names;
- for the Support and checkout pages, the plan and amount.

The full list is in [docs/analytics.md](../analytics.md) and [section 9 of the sync plan](../spec/sync.md#9-analytics).

**We never send:** anything you type (titles, groups, items, notes, names, searches), link contents, error messages, sync codes, account ids, menu ids or Stripe ids.

**Google also collects its usual visit data**, such as a cookie identifier, browser and device type, rough location from your IP address, and the site you came from (without anything after the `?`). Google handles this under its own privacy policy. We don't link analytics to sync accounts.

To opt out, use a content blocker or [Google's opt-out add-on](https://tools.google.com/dlpage/gaoptout). The app works without analytics.

`[FILL IN: confirm the GA settings before publishing: data retention (14 months is planned), Google signals, ads features, data sharing, and enhanced measurement.]`

`[LAWYER: Google Analytics sets cookies. The EU, UK and some other places require consent before that, and the app has no consent banner.]`

### Vercel (the old address)

The old address, `relationship-menu.vercel.app`, is a small hand-off page hosted by Vercel. It moves menus saved in your browser to the new address and forwards old links. It has no payments and no analytics.

- Menus saved on your device travel in the part of the address after `#`, which isn't sent to any server. For a moment that address is in your browser history, until the app clears it.
- Vercel sees visits as any host does: your IP address and the address you asked for. For an old menu link, that address includes the menu.
- The hand-off deletes nothing from your browser.

### GitHub

The source code is on GitHub. Anything you post there, such as a bug report, is public and covered by GitHub's own policy. Please don't paste real menus or sync codes.

### Others

We use no third-party error reporting. We may disclose the limited data we hold if the law requires it. We can't disclose menu text from sync, because we can't read it.

`[LAWYER: add wording for legal requests and for a sale or transfer of the project.]`

## Logs

Our sync server keeps no log of each request. It writes a line only for certain errors (server errors and rate limits) and for the daily clean-up. A line holds the kind of request (not the exact address), a status, an error code or error type, and for the clean-up, how many records were removed.

Logs never contain request contents, headers, IP addresses, account ids or menu data. `[FILL IN: how long Cloudflare keeps these logs on your plan.]`

Cloudflare, Vercel, Google and Stripe keep their own records under their own policies.

## How long we keep things

| Data | Kept |
| --- | --- |
| Menus in your browser | Until you delete them, or the browser does |
| Synced menus, active or lifetime supporters | Until you delete them |
| Synced menus after support lapses | Read-only for 12 months, then deleted along with the account record. The app warns you from 30 days before. We have no email address, so **the warning appears only in the app**. |
| Deleted menus | An encrypted "this was deleted" record is kept for 180 days so your other devices learn of it, then removed |
| Pairing records | The encrypted code is removed when first read. The link stops working after 10 minutes. What's left is removed by a daily clean-up about a day after expiry. |
| Stripe message ids | 30 days |
| Analytics | `[FILL IN: retention set in Google Analytics]` |
| Payment records | Kept by Stripe and Link as their legal duties require |

Our database provider may keep recovery copies for a short time after data is deleted. `[FILL IN: Cloudflare D1 recovery window on your plan.]`

## Deleting everything

**Synced data:** choose **Delete synced menus** in the app. It deletes your synced menus and hosted live conversations, but keeps your account, supporter status and any subscription. It turns off sync on that device. Other devices keep their local menus and take a fresh, empty server listing.

To delete the account itself, choose **Delete my account**. This also cancels any subscription, deletes the account record and ends lifetime supporter status. If the subscription can't be cancelled just then, nothing is deleted, so you can try again.

Menus on your devices stay in either case. Delete them in the app or clear the site's data on each device. Turning sync on again can upload menus kept on a device.

**Turn off sync on this device** is different. It only removes the code from that device. Your synced menus and your subscription stay.

**Payment records** are not deleted by us. Stripe and Link hold them. You can ask Stripe to delete your information for Managed Payments purchases, including your Link account. Stripe says this also cancels subscriptions bought that way. Start at [Link support](https://support.link.com/topics/sold-through-link) `[FILL IN: confirm the deletion request page or privacy email]`. Some records may be kept where the law requires.

## Your rights

Depending on where you live, you may have the right to see, correct, delete or export your data, to object to or limit its use, and to complain to a regulator.

- Your menus are already with you. You can read, edit, copy as links and delete them in the app.
- **Delete synced menus** and **Delete my account** work without contacting us.
- We don't know who owns which account. To act on a request, we may need you to make it from a device that has your sync code, or to give us a Stripe receipt.

Contact `[FILL IN: privacy contact email]`.

`[LAWYER: GDPR and UK GDPR: state the lawful basis for each use. Menus can reveal sex life or sexual orientation (Article 9), so decide whether explicit consent is needed for sync, even though we can't read it. Also add international transfer safeguards and processor agreements.]`

`[LAWYER: CCPA/CPRA and other US state laws: decide whether notices apply (including "sensitive personal information", and whether Google Analytics counts as "sharing"), and whether Washington's My Health My Data Act or similar laws apply.]`

## Staying safe

If someone in your life checks your phone or computer, remember that menus, browser history and your sync code can be seen there. See the safety resources in the [terms](terms.md#not-therapy-or-medical-advice).

## Age and children

Wants & Won'ts is for adults, **18 and over**. We don't knowingly collect data from children. If you believe a child has used sync or paid, contact us.

`[FILL IN: decide the minimum age. 18 is suggested: menus can cover sex and intimate relationships, paying needs the capacity to make a contract, and it avoids extra rules for children's data.]`

## Changes to this policy

We'll update the date above and post the new version here. For important changes, we'll also show a notice in the app. We have no email address for you. Earlier versions are in the project's public history on GitHub.
