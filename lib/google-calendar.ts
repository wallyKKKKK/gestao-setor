import { createHmac, timingSafeEqual } from "node:crypto";
import type { CreateMeetingInput } from "@/lib/api";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
const TIME_ZONE = "America/Fortaleza";

interface GoogleTokensResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

interface CalendarEventResponse {
  id: string;
  htmlLink?: string;
}

export class GoogleCalendarReconnectRequiredError extends Error {
  constructor(message = "Sua conexão com o Google Calendar expirou. Conecte novamente.") {
    super(message);
    this.name = "GoogleCalendarReconnectRequiredError";
  }
}

export function isGoogleReconnectRequiredError(error: unknown) {
  return error instanceof GoogleCalendarReconnectRequiredError;
}

async function googleTokenError(response: Response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { error?: string; error_description?: string };
    if (data.error === "invalid_grant") {
      return new GoogleCalendarReconnectRequiredError();
    }
    return new Error(data.error_description || data.error || text);
  } catch {
    return new Error(text);
  }
}

async function googleCalendarApiError(response: Response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
      };
    };
    if (response.status === 401 || data.error?.status === "UNAUTHENTICATED") {
      return new GoogleCalendarReconnectRequiredError();
    }
    return new Error(data.error?.message || text);
  } catch {
    if (response.status === 401) {
      return new GoogleCalendarReconnectRequiredError();
    }
    return new Error(text);
  }
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
}

export interface GoogleCalendarConnection {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope: string | null;
  token_type: string | null;
  calendar_id: string | null;
}

export function getGoogleCalendarConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET || clientSecret;

  return {
    clientId,
    clientSecret,
    redirectUri,
    stateSecret,
    isConfigured: Boolean(clientId && clientSecret && redirectUri && stateSecret && process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

export function signGoogleState(userId: string) {
  const { stateSecret } = getGoogleCalendarConfig();
  if (!stateSecret) throw new Error("Google OAuth state secret is missing.");

  const payload = JSON.stringify({ userId, nonce: crypto.randomUUID(), createdAt: Date.now() });
  const encodedPayload = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", stateSecret).update(encodedPayload).digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifyGoogleState(state: string) {
  const { stateSecret } = getGoogleCalendarConfig();
  if (!stateSecret) throw new Error("Google OAuth state secret is missing.");

  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid OAuth state.");

  const expected = createHmac("sha256", stateSecret).update(encodedPayload).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  const isValid = signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!isValid) throw new Error("Invalid OAuth state signature.");

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    userId: string;
    createdAt: number;
  };

  if (!payload.userId || Date.now() - payload.createdAt > 10 * 60 * 1000) {
    throw new Error("Expired OAuth state.");
  }

  return payload.userId;
}

export function buildGoogleAuthUrl(userId: string) {
  const { clientId, redirectUri, isConfigured } = getGoogleCalendarConfig();
  if (!isConfigured || !clientId || !redirectUri) throw new Error("Google Calendar integration is not configured.");

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", signGoogleState(userId));

  return url.toString();
}

export async function exchangeGoogleCodeForTokens(code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleCalendarConfig();
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google Calendar integration is not configured.");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) throw await googleTokenError(response);
  return await response.json() as GoogleTokensResponse;
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleCalendarConfig();
  if (!clientId || !clientSecret) throw new Error("Google Calendar integration is not configured.");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) throw await googleTokenError(response);
  return await response.json() as GoogleTokensResponse;
}

export function getTokenExpiration(expiresInSeconds: number) {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function addMinutesToLocalDateTime(date: string, time: string, minutesToAdd: number) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const localDate = new Date(year, month - 1, day, hours, minutes + minutesToAdd, 0);

  return [
    localDate.getFullYear(),
    String(localDate.getMonth() + 1).padStart(2, "0"),
    String(localDate.getDate()).padStart(2, "0"),
  ].join("-") + `T${String(localDate.getHours()).padStart(2, "0")}:${String(localDate.getMinutes()).padStart(2, "0")}:00`;
}

export async function createGoogleCalendarEvent(accessToken: string, meeting: CreateMeetingInput) {
  const start = `${meeting.date}T${meeting.time}:00`;
  const end = addMinutesToLocalDateTime(meeting.date, meeting.time, 60);

  const response = await fetch(GOOGLE_CALENDAR_EVENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: meeting.title,
      location: meeting.location || undefined,
      description: [
        `Motivo: ${meeting.motive}`,
        meeting.notes ? `Observações: ${meeting.notes}` : null,
        "Criado pelo WALLY Task Manager.",
      ].filter(Boolean).join("\n\n"),
      start: { dateTime: start, timeZone: TIME_ZONE },
      end: { dateTime: end, timeZone: TIME_ZONE },
    }),
  });

  if (!response.ok) throw await googleCalendarApiError(response);
  return await response.json() as CalendarEventResponse;
}

export async function listGoogleCalendarEvents(accessToken: string, timeMin: string, timeMax: string) {
  const url = new URL(GOOGLE_CALENDAR_EVENTS_URL);
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) throw await googleCalendarApiError(response);
  const data = await response.json() as { items?: GoogleCalendarEvent[] };

  return data.items || [];
}

export async function deleteGoogleCalendarEvent(accessToken: string, eventId: string) {
  const response = await fetch(`${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok && response.status !== 410) {
    throw await googleCalendarApiError(response);
  }
}
