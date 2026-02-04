# Calendly-to-Notetaker Integration
## Executive & IT Briefing Document

**Prepared for:** CEO & IT Manager, Magical Teams  
**Prepared by:** Adam (Implementation Lead)  
**Date:** February 4, 2026  
**Status:** ✅ Production Ready

---

## 1. Executive Summary

### What We Built
An automated webhook service that **adds `notetaker@magicalteams.com` as an attendee** to every Google Calendar event created through Calendly bookings for Christina, Cara, and Mercedes.

### Business Value
- **Before:** Someone had to manually add the notetaker to each meeting after booking
- **After:** Notetaker is automatically added within ~10 seconds of booking, with zero manual effort
- **Result:** Time savings, consistency, and no missed meetings for the notetaker

---

## 2. How It Works (Non-Technical)

```
1. Customer books meeting via Calendly
       ↓
2. Calendly sends notification to our server (Vercel)
       ↓
3. Server checks if host is Christina, Cara, or Mercedes
       ↓
4. Server adds notetaker@magicalteams.com to the calendar event
       ↓
5. Notetaker appears on the meeting invite automatically
```

---

## 3. What Access Was Required & Why

### 3.1 Google Cloud Console
| Action | Why It Was Needed |
|--------|-------------------|
| Created a new project ("notetaker-to-calendly") | Isolated container for this integration's resources |
| Enabled Google Calendar API | Required to read/modify calendar events |
| Created a Service Account | Machine-to-machine authentication (no user passwords stored) |
| Generated a JSON key | Credentials for the service account to authenticate |

**Security Note:** Service accounts are Google's recommended approach for automated integrations. No individual user passwords are involved.

### 3.2 Google Workspace Admin Console
| Action | Why It Was Needed |
|--------|-------------------|
| Configured Domain-Wide Delegation | Allows the service account to act on behalf of users to modify their calendar events |
| Authorized specific OAuth scope | Limited to `https://www.googleapis.com/auth/calendar` (calendar access only) |

**Security Note:** Domain-Wide Delegation is required because Google Calendar events can only be modified by the event owner (or someone acting on their behalf). The scope is narrowly defined to calendar access only—no email, drive, or other data access.

### 3.3 Individual Google Calendars (Christina, Cara, Mercedes)
| Action | Why It Was Needed |
|--------|-------------------|
| Shared calendars with service account | Initially attempted before Domain-Wide Delegation; now optional but provides read access as backup |

**Security Note:** Calendar sharing with the service account is a secondary permission layer, not the primary authentication method.

### 3.4 Calendly Admin
| Action | Why It Was Needed |
|--------|-------------------|
| Generated Personal Access Token | Allows our server to query Calendly's API for event details |
| Created Webhook Subscription | Tells Calendly to notify our server when bookings occur |

**Security Note:** The webhook only receives booking data—it cannot modify or cancel Calendly bookings.

---

## 4. Security Architecture

### 4.1 Data Flow Security
```
┌─────────────┐    HTTPS     ┌─────────────┐    HTTPS     ┌─────────────┐
│   Calendly  │ ──────────→  │   Vercel    │ ──────────→  │   Google    │
│  (Webhook)  │   Encrypted  │  (Server)   │   Encrypted  │  Calendar   │
└─────────────┘              └─────────────┘              └─────────────┘
```

- All communication uses **HTTPS (TLS encryption)**
- No sensitive data is logged or stored
- Server is stateless—processes request and forgets

### 4.2 Access Controls

| System | Access Level | Scope |
|--------|--------------|-------|
| Google Calendar | Modify events | Only for Christina, Cara, Mercedes |
| Calendly | Read events | Organization-wide event notifications |
| Vercel Logs | View only | For debugging; auto-deleted after 30 days |

### 4.3 Credential Storage
All credentials are stored as **environment variables in Vercel**, which:
- Are encrypted at rest
- Are never exposed in logs
- Are only accessible to account admins

### 4.4 What the Integration CANNOT Do
- ❌ Read or send emails
- ❌ Access Google Drive, Docs, or any other Google services
- ❌ Cancel or modify Calendly bookings
- ❌ Access calendars of anyone not in the authorized list
- ❌ Store any booking data persistently

---

## 5. Who Is Affected?

| Person | How They're Affected |
|--------|---------------------|
| Christina, Cara, Mercedes | Their calendar events from Calendly bookings will automatically include the notetaker |
| Notetaker | Will automatically appear on relevant meetings |
| Customers booking meetings | No change—they won't notice anything different |
| IT/Admin | May see audit logs of calendar modifications |

---

## 6. Infrastructure & Costs

| Component | Provider | Cost |
|-----------|----------|------|
| Webhook Server | Vercel (Hobby tier) | Free (up to 100k requests/month) |
| Google Calendar API | Google Cloud | Free (within quota) |
| Calendly Webhook | Calendly | Included in existing plan |
| Code Repository | GitHub | Free |

**Total ongoing cost: $0/month** (within expected usage)

---

## 7. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Service Account credentials leaked | Low | Credentials stored securely in Vercel; can be rotated instantly if needed |
| Notetaker added to wrong meetings | Low | Strict host email verification; only 3 authorized hosts |
| Rate limiting by Google | Medium | Implemented automatic retry with exponential backoff |
| Calendly webhook downtime | Low | Calendly retries failed webhooks; built-in resilience |
| Vercel downtime | Low | Vercel has 99.99% uptime SLA |

---

## 8. Audit Trail & Compliance

### Where Actions Are Logged:
1. **Vercel Function Logs** - All webhook processing with timestamps
2. **Google Workspace Admin Audit Log** - Calendar modifications appear in admin console
3. **Calendly Activity Log** - Webhook deliveries are logged

### For Compliance Review:
- The service account email is: `service-account@notetaker-to-calendly.iam.gserviceaccount.com`
- All calendar modifications will appear in Google Workspace audit logs under this service account

---

## 9. How to Revoke Access (If Needed)

If the CEO or IT wants to immediately disable this integration:

### Option 1: Disable Webhooks (Stops new bookings from triggering)
1. Log into Calendly Admin
2. Delete the webhook subscription to `calendly-notetaker.vercel.app`

### Option 2: Revoke Google Access (Prevents any calendar modifications)
1. Go to Google Workspace Admin Console
2. Security → API Controls → Domain-Wide Delegation
3. Remove Client ID `102217247382299062852`

### Option 3: Delete the Service Account (Complete removal)
1. Go to Google Cloud Console
2. IAM & Admin → Service Accounts
3. Delete `service-account@notetaker-to-calendly.iam.gserviceaccount.com`

---

## 10. Maintenance & Ownership

| Responsibility | Owner |
|----------------|-------|
| Code updates | Adam (or designated developer) |
| Monitoring | Viewable in Vercel dashboard |
| Secret rotation | Recommended annually; admin access required |
| Adding/removing authorized hosts | Code change required |

---

## 11. Summary of Justifications

| Access Requested | Justification |
|------------------|---------------|
| Google Cloud Project | Industry-standard isolated environment for API credentials |
| Service Account | Secure machine-to-machine auth without storing user passwords |
| Domain-Wide Delegation | Required by Google to modify calendar events on behalf of users |
| Calendly API Token | Read-only access to fetch event details not included in webhook |
| Calendly Webhook | Real-time notification when bookings occur |

---

## 12. Approval Checklist

- [ ] CEO approves business use case
- [ ] IT Manager approves security architecture
- [ ] Domain-Wide Delegation scope reviewed and approved
- [ ] Service account credentials stored securely (confirmed in Vercel)
- [ ] Audit logging requirements met
- [ ] Rollback procedure understood

---

## Questions?

This integration was built following Google's security best practices for service account authentication and Calendly's official webhook documentation. Happy to walk through any section in detail.

**GitHub Repository:** https://github.com/magicalteams/calendly-notetaker  
**Production URL:** https://calendly-notetaker.vercel.app
