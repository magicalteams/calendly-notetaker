import { NextResponse } from "next/server";
import { google } from "googleapis";
import crypto from "crypto";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * List of authorized host emails that trigger notetaker addition.
 * Only meetings hosted by these emails will have the notetaker added.
 */
const AUTHORIZED_HOSTS = [
    "christina@magicalteams.com",
    "cara@magicalteams.com",
    "mercedes@magicalteams.com",
];

/**
 * The notetaker email to add as an attendee.
 * Can be overridden via NOTETAKER_EMAIL environment variable.
 */
const NOTETAKER_EMAIL =
    process.env.NOTETAKER_EMAIL || "notetaker@magicalteams.com";

/**
 * Delay before making the Google Calendar API call (in milliseconds).
 * This allows Calendly's native sync to Google Calendar to complete first.
 */
const SYNC_DELAY_MS = 5000;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sleep utility - pauses execution for the specified duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Verifies the Calendly webhook signature using HMAC-SHA256.
 *
 * Calendly sends the signature in the "Calendly-Webhook-Signature" header.
 * Format: t=<timestamp>,v1=<signature>
 *
 * @param {string} payload - The raw request body as a string
 * @param {string} signatureHeader - The Calendly-Webhook-Signature header value
 * @param {string} signingKey - The webhook signing key from Calendly
 * @returns {boolean} - True if signature is valid
 */
function verifyCalendlySignature(payload, signatureHeader, signingKey) {
    if (!signatureHeader || !signingKey) {
        console.warn("⚠️ Missing signature header or signing key");
        return false;
    }

    try {
        // Parse the signature header
        const parts = signatureHeader.split(",");
        const timestampPart = parts.find((p) => p.startsWith("t="));
        const signaturePart = parts.find((p) => p.startsWith("v1="));

        if (!timestampPart || !signaturePart) {
            console.error("❌ Invalid signature header format");
            return false;
        }

        const timestamp = timestampPart.substring(2);
        const signature = signaturePart.substring(3);

        // Recreate the signed payload (timestamp.payload)
        const signedPayload = `${timestamp}.${payload}`;

        // Calculate expected signature
        const expectedSignature = crypto
            .createHmac("sha256", signingKey)
            .update(signedPayload)
            .digest("hex");

        // Compare signatures using timing-safe comparison
        const sigBuffer = Buffer.from(signature, "hex");
        const expectedBuffer = Buffer.from(expectedSignature, "hex");

        if (sigBuffer.length !== expectedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (error) {
        console.error("❌ Error verifying signature:", error.message);
        return false;
    }
}

/**
 * Initializes and returns an authenticated Google Calendar API client.
 * Uses a service account for authentication.
 *
 * @returns {google.calendar_v3.Calendar} - Authenticated Calendar API client
 */
function getCalendarClient() {
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

    if (!serviceAccountKey) {
        throw new Error(
            "GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set"
        );
    }

    // Parse the JSON key from environment variable
    const credentials = JSON.parse(serviceAccountKey);

    // Create auth client using service account credentials
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
        },
        scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    // Return the Calendar API client
    return google.calendar({ version: "v3", auth });
}

/**
 * Extracts relevant information from the Calendly webhook payload.
 *
 * @param {object} payload - The Calendly webhook payload
 * @returns {object} - Extracted event details
 */
function extractEventDetails(payload) {
    // Log raw payload structure for debugging
    console.log("🔍 Raw payload keys:", Object.keys(payload));

    const scheduledEvent = payload.scheduled_event || {};
    console.log("🔍 scheduled_event keys:", Object.keys(scheduledEvent));

    const eventMemberships = scheduledEvent.event_memberships || [];
    const invitees = payload.invitee || {};

    // Get host email from event memberships
    // The "host" is typically the user who owns the calendar
    const hostMembership = eventMemberships.find((m) => m.user);
    const hostEmail = hostMembership?.user_email?.toLowerCase() || "";

    // Get invitee email from the payload
    const inviteeEmail = invitees.email?.toLowerCase() || "";

    // Get the external calendar event ID (Google Calendar event ID)
    // Check multiple possible locations
    let externalId = scheduledEvent.external_id || "";

    // Try alternative locations if not found
    if (!externalId && scheduledEvent.calendar_event) {
        console.log("🔍 calendar_event:", scheduledEvent.calendar_event);
        externalId = scheduledEvent.calendar_event.external_id || "";
    }

    // Check if there's a location or conferencing data with the event ID
    if (!externalId && scheduledEvent.location) {
        console.log("🔍 location:", scheduledEvent.location);
    }

    // Log the scheduled_event URI - we might need to fetch details via API
    if (scheduledEvent.uri) {
        console.log("🔍 scheduled_event.uri:", scheduledEvent.uri);
    }

    // Get the calendar ID (host's calendar)
    const calendarId = hostEmail; // Typically the host's email is the calendar ID

    return {
        hostEmail,
        inviteeEmail,
        externalId,
        calendarId,
        eventName: scheduledEvent.name || "Untitled Event",
        eventUri: scheduledEvent.uri || "",
        startTime: scheduledEvent.start_time,
        endTime: scheduledEvent.end_time,
        // Include full scheduled_event for debugging
        _rawScheduledEvent: scheduledEvent,
    };
}

// ============================================================================
// MAIN WEBHOOK HANDLER
// ============================================================================

/**
 * POST /api/webhook/calendly
 *
 * Handles incoming Calendly webhook events. When an invitee.created event
 * is received, this handler:
 * 1. Verifies the webhook signature
 * 2. Checks if the host is in our authorized list
 * 3. Waits for Calendly-to-Google sync to complete
 * 4. Adds the notetaker email to the Google Calendar event
 */
export async function POST(request) {
    const startTime = Date.now();
    console.log("🎯 Received Calendly webhook at", new Date().toISOString());

    try {
        // Get the raw body for signature verification
        const rawBody = await request.text();
        const payload = JSON.parse(rawBody);

        // Get signature header
        const signatureHeader = request.headers.get("Calendly-Webhook-Signature");
        const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY?.trim();

        // Verify webhook signature (only if we have BOTH a signing key AND a signature header)
        if (signingKey && signingKey.length > 0) {
            if (signatureHeader) {
                const isValid = verifyCalendlySignature(
                    rawBody,
                    signatureHeader,
                    signingKey
                );
                if (!isValid) {
                    console.error("❌ Invalid webhook signature");
                    return NextResponse.json(
                        { error: "Invalid signature" },
                        { status: 401 }
                    );
                }
                console.log("✅ Webhook signature verified");
            } else {
                // We have a signing key but no signature header - this is suspicious
                console.warn("⚠️ Signing key configured but no signature header received");
                // Still allow the request (Calendly webhooks created via API may not have signatures)
            }
        } else {
            console.log(
                "ℹ️ Signature verification skipped (no signing key configured)"
            );
        }

        // Check event type - we only care about invitee.created
        const eventType = payload.event;
        if (eventType !== "invitee.created") {
            console.log(`ℹ️ Ignoring event type: ${eventType}`);
            return NextResponse.json({
                message: `Event type ${eventType} ignored`,
                processed: false,
            });
        }

        console.log("📅 Processing invitee.created event");

        // Extract event details from payload
        const eventDetails = extractEventDetails(payload.payload);
        console.log("📋 Event details:", {
            hostEmail: eventDetails.hostEmail,
            inviteeEmail: eventDetails.inviteeEmail,
            externalId: eventDetails.externalId,
            eventName: eventDetails.eventName,
        });

        // Check if host is in our authorized list
        if (!AUTHORIZED_HOSTS.includes(eventDetails.hostEmail)) {
            console.log(
                `ℹ️ Host email "${eventDetails.hostEmail}" is not in authorized list. Skipping.`
            );
            return NextResponse.json({
                message: "Host not in authorized list",
                processed: false,
                hostEmail: eventDetails.hostEmail,
            });
        }

        console.log(`✅ Host "${eventDetails.hostEmail}" is authorized`);

        // Validate that we have the external ID (Google Calendar event ID)
        if (!eventDetails.externalId) {
            console.error(
                "❌ No external_id found in payload - cannot update Google Calendar event"
            );
            return NextResponse.json(
                { error: "Missing external_id in payload" },
                { status: 400 }
            );
        }

        // Wait for Calendly-to-Google Calendar sync to complete
        console.log(
            `⏳ Waiting ${SYNC_DELAY_MS}ms for Calendly sync to complete...`
        );
        await sleep(SYNC_DELAY_MS);

        // Initialize Google Calendar API client
        const calendar = getCalendarClient();

        // First, get the current event to retrieve existing attendees
        console.log(
            `📥 Fetching event: ${eventDetails.externalId} from calendar: ${eventDetails.calendarId}`
        );

        let existingEvent;
        try {
            const response = await calendar.events.get({
                calendarId: eventDetails.calendarId,
                eventId: eventDetails.externalId,
            });
            existingEvent = response.data;
            console.log("✅ Successfully fetched existing event");
        } catch (error) {
            console.error("❌ Error fetching event:", error.message);

            // If event not found, it may not have synced yet
            if (error.code === 404) {
                return NextResponse.json(
                    {
                        error: "Event not found in Google Calendar - may not have synced yet",
                        externalId: eventDetails.externalId,
                    },
                    { status: 404 }
                );
            }
            throw error;
        }

        // Build the updated attendees list
        const existingAttendees = existingEvent.attendees || [];

        // Check if notetaker is already in the attendee list
        const notetakerExists = existingAttendees.some(
            (a) => a.email?.toLowerCase() === NOTETAKER_EMAIL.toLowerCase()
        );

        if (notetakerExists) {
            console.log("ℹ️ Notetaker is already an attendee. No update needed.");
            return NextResponse.json({
                message: "Notetaker already exists as attendee",
                processed: false,
                existingAttendees: existingAttendees.map((a) => a.email),
            });
        }

        // Add notetaker to attendees
        const updatedAttendees = [
            ...existingAttendees,
            {
                email: NOTETAKER_EMAIL,
                responseStatus: "needsAction",
            },
        ];

        console.log(
            `👥 Updating event with ${updatedAttendees.length} attendees (adding ${NOTETAKER_EMAIL})`
        );

        // Update the event with the new attendee list
        try {
            await calendar.events.patch({
                calendarId: eventDetails.calendarId,
                eventId: eventDetails.externalId,
                sendUpdates: "all", // Send email notifications to all attendees
                requestBody: {
                    attendees: updatedAttendees,
                },
            });
            console.log("✅ Successfully added notetaker to event");
        } catch (error) {
            console.error("❌ Error updating event:", error.message);
            throw error;
        }

        const duration = Date.now() - startTime;
        console.log(`✅ Webhook processing completed in ${duration}ms`);

        return NextResponse.json({
            success: true,
            message: "Notetaker added successfully",
            eventId: eventDetails.externalId,
            eventName: eventDetails.eventName,
            attendees: updatedAttendees.map((a) => a.email),
            processingTime: `${duration}ms`,
        });
    } catch (error) {
        console.error("❌ Webhook processing error:", error);

        // Return appropriate error response
        const statusCode = error.code || 500;
        return NextResponse.json(
            {
                error: "Failed to process webhook",
                message: error.message,
                details: error.errors || null,
            },
            { status: statusCode }
        );
    }
}

/**
 * GET /api/webhook/calendly
 *
 * Health check endpoint for the webhook.
 * Useful for verifying the deployment is working.
 */
export async function GET() {
    return NextResponse.json({
        status: "healthy",
        message: "Calendly webhook endpoint is ready",
        timestamp: new Date().toISOString(),
        config: {
            authorizedHosts: AUTHORIZED_HOSTS,
            notetakerEmail: NOTETAKER_EMAIL,
            syncDelayMs: SYNC_DELAY_MS,
        },
    });
}
