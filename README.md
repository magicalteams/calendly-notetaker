# Calendly to Notetaker Webhook

A Next.js webhook handler that automatically adds a notetaker email (`notetaker@magicalteams.com`) as an attendee to Google Calendar events when meetings are booked through Calendly.

## 🎯 How It Works

1. **Calendly sends a webhook** when someone books a meeting (`invitee.created` event)
2. **Webhook verifies the signature** to ensure the request is genuinely from Calendly
3. **Host check** - Only processes if the host is one of our authorized team members
4. **5-second delay** - Waits for Calendly's native Google Calendar sync to complete
5. **Google Calendar update** - Uses the Google Calendar API to add the notetaker as an attendee

## 📋 Prerequisites

- Node.js 18+
- A Google Cloud Platform account
- A Calendly account with webhook access
- Vercel account (for deployment)

## 🔧 Google Cloud Console Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Name your project (e.g., "Calendly Notetaker")
4. Click **Create**

### Step 2: Enable the Google Calendar API

1. In your project, go to **APIs & Services** → **Library**
2. Search for "**Google Calendar API**"
3. Click on it and press **Enable**

### Step 3: Create a Service Account

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **Service Account**
3. Fill in the details:
   - **Service account name**: `calendly-notetaker`
   - **Service account ID**: (auto-generated)
   - **Description**: "Service account for adding notetaker to calendar events"
4. Click **Create and Continue**
5. Skip the optional steps and click **Done**

### Step 4: Generate the JSON Key

1. Click on your newly created service account
2. Go to the **Keys** tab
3. Click **Add Key** → **Create new key**
4. Select **JSON** format
5. Click **Create** - the JSON file will download automatically
6. **Keep this file secure!** It contains credentials for your service account

### Step 5: ⭐ Share Calendars with the Service Account (CRITICAL!)

**This is the most important step!** The service account needs explicit permission to modify each calendar.

For each of the three team members (Christina, Cara, and Mercedes):

1. Open [Google Calendar](https://calendar.google.com)
2. Find their calendar in the left sidebar
3. Click the **three dots** (⋮) next to the calendar name → **Settings and sharing**
4. Scroll down to **Share with specific people or groups**
5. Click **Add people or groups**
6. Paste the service account email (looks like: `calendly-notetaker@your-project-id.iam.gserviceaccount.com`)
7. Set permissions to: **Make changes to events**
8. Click **Send**

> ⚠️ **Note**: The service account email is found in your downloaded JSON key file under `client_email`, or on the service account details page in Google Cloud Console.

## 🔐 Environment Variables

Set these in your Vercel project settings (or `.env.local` for local development):

| Variable | Description |
|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The **entire JSON content** of your service account key file (as a single string) |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Your Calendly webhook signing key for security verification |
| `NOTETAKER_EMAIL` | (Optional) Email to add as attendee. Defaults to `notetaker@magicalteams.com` |

### Setting up the Service Account Key in Vercel

1. Open your downloaded JSON key file
2. Copy the **entire contents** of the file
3. In Vercel, go to **Settings** → **Environment Variables**
4. Create a new variable:
   - **Key**: `GOOGLE_SERVICE_ACCOUNT_KEY`
   - **Value**: Paste the entire JSON content
5. Save the variable

## 📡 Calendly Webhook Setup

1. Go to [Calendly Developer Portal](https://developer.calendly.com/)
2. Navigate to **Webhooks**
3. Click **Create Webhook Subscription**
4. Configure:
   - **Callback URL**: `https://your-vercel-domain.vercel.app/api/webhook/calendly`
   - **Events**: Select `invitee.created`
   - **Signing Key**: Copy this value for your `CALENDLY_WEBHOOK_SIGNING_KEY`
5. Save the webhook

## 🚀 Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import the repository in [Vercel](https://vercel.com/new)
3. Add the environment variables (see above)
4. Deploy!

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Fill in your environment variables
# Edit .env.local with your actual values

# Run development server
npm run dev
```

Test the webhook endpoint:
```bash
# Health check
curl http://localhost:3000/api/webhook/calendly

# Test webhook (you'll need to craft a proper payload)
curl -X POST http://localhost:3000/api/webhook/calendly \
  -H "Content-Type: application/json" \
  -d '{"event":"invitee.created","payload":{...}}'
```

## 📁 Project Structure

```
├── app/
│   └── api/
│       └── webhook/
│           └── calendly/
│               └── route.js    # Main webhook handler
├── .env.example                 # Environment variables template
├── README.md                    # This file
└── package.json
```

## ✅ Authorized Hosts

The webhook only processes events for these host emails:
- `christina@magicalteams.com`
- `cara@magicalteams.com`
- `mercedes@magicalteams.com`

Meetings hosted by other emails will be logged and ignored.

## 🔍 Monitoring & Debugging

### Vercel Logs

Check your Vercel Function logs for detailed information:
1. Go to your Vercel dashboard
2. Select your project
3. Click on **Deployments** → Select latest deployment
4. Click **Functions** tab
5. Find `/api/webhook/calendly` and view logs

### Log Messages

| Emoji | Meaning |
|-------|---------|
| 🎯 | Webhook received |
| ✅ | Success (signature verified, event updated, etc.) |
| ℹ️ | Informational (event ignored, host not in list) |
| ⚠️ | Warning (missing config, skipping verification) |
| ❌ | Error (invalid signature, API failure) |
| ⏳ | Waiting (sync delay) |

## 🛠️ Troubleshooting

### "Event not found in Google Calendar"

The 5-second delay might not be enough for Calendly to sync. The event may appear shortly after.

### "403 Forbidden" from Google Calendar API

The service account doesn't have permission to modify the calendar. Make sure you've completed **Step 5** above (sharing calendars with the service account).

### "Invalid signature"

Your `CALENDLY_WEBHOOK_SIGNING_KEY` doesn't match. Verify it in your Calendly Developer Portal.

### "Host not in authorized list"

The meeting was hosted by someone not in our `AUTHORIZED_HOSTS` list. This is expected behavior if the meeting isn't from Christina, Cara, or Mercedes.

## 📄 License

MIT
