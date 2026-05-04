## Plan

Switch the feedback email sender to use the verified `hfxaiguy.com` domain on Resend.

### Change

In `src/routes/api/contact-feedback.ts`:

1. Update `from:` from `"Weave Feedback <onboarding@resend.dev>"` to `"Weave Feedback <notify@hfxaiguy.com>"`.
2. Leave `to: ["anton@hfxaiguy.com"]` unchanged — now allowed since the domain is verified.
3. Keep `reply_to: email` so replies go to the contributor.

That's the only file touched. No DNS, no new secrets, no schema changes — `RESEND_API_KEY` and `LOVABLE_API_KEY` are already wired through the connector gateway.

### Verification after switch

Submit a test feedback message from the banner and confirm it arrives at `anton@hfxaiguy.com` with sender `notify@hfxaiguy.com`. If Resend rejects it, the most likely cause is that the API key is scoped to a different domain — in which case we'd need a key scoped to `hfxaiguy.com`.