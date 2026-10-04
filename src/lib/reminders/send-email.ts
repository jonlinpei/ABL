// Server-only: sends email through Resend's REST API.

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** One-click unsubscribe (RFC 8058), shown by mail apps as an "Unsubscribe" button. */
  unsubscribeUrl: string;
}

/**
 * Send one email. Without RESEND_API_KEY it's skipped (and says so), so the
 * app runs before email is set up. Returns whether it was sent.
 */
export async function sendEmail(email: OutgoingEmail): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[email] RESEND_API_KEY isn't set; skipping", email.subject);
    return { sent: false, reason: "not_configured" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.REMINDER_FROM ?? "ABL <hello@iamabl.com>",
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: {
        "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend refused the email (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return { sent: true };
}
