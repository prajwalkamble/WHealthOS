-- Feedback: the table the feature never had.
--
-- Until now in-app feedback was an email and nothing else. actions/feedback.js
-- validated the message, attributed it to the signed-in account, handed it to
-- Resend inside the request, and returned. There was no row anywhere. If Resend
-- was unreachable the submission was gone -- the person was told to try again,
-- and the only copy of what they wrote was in a browser that was about to be
-- closed.
--
-- So the email stops being the record. Feedback is written here first, and the
-- notification becomes a thing that is owed and retried rather than a thing
-- that either happened or did not.
--
-- Why delivery state lives on this row instead of in subscription_notifications:
-- that table's subscriptionId is NOT NULL and relates to a subscription, so
-- reusing it would mean altering a billing table to make the column optional.
-- Feedback is 1:1 with its notification -- one submission, one email -- so the
-- state belongs here, and the mechanics are reused instead of the table:
-- NotificationStatus, the Resend delivery webhook, the Inngest retry and the
-- hourly sweep are all shared.
--
-- Row-level security, split by who is allowed to do what.
--
-- Not the checkout_attempts shape, and the difference is deliberate. There,
-- every write belongs to the job runner because every field is commercially
-- significant -- a price, a provider plan id -- and nothing on the row is
-- authored by the person. Feedback is the opposite: the message IS theirs, and
-- the brief's requirement is that a client cannot submit feedback on behalf of
-- another user.
--
-- So INSERT is allowed as the tenant, with a WITH CHECK that pins the row to
-- them. That makes "submit feedback as somebody else" fail in the database
-- rather than relying on the action resolving the right id -- it does, and
-- this is the guarantee that holds even if it ever stopped.
--
-- UPDATE and DELETE stay with the job runner, because those columns are not
-- theirs: status, providerMessageId, attempts and the delivery timestamps are
-- the notification's own state, written only by the email job. Without the
-- split a signed-in request could mark its own feedback DELIVERED, or edit the
-- message after it had been sent.
BEGIN;

-- Mirrors FEEDBACK_TYPES in apps/web/app/lib/schema.js, which is what the
-- widget offers and what the schema validates. Deliberately not free text: the
-- email subject and the reviewer's filter both depend on this being one of two
-- known values.
CREATE TYPE "FeedbackType" AS ENUM ('FEEDBACK', 'PROBLEM');

CREATE TABLE public.feedback (
    "id"                TEXT                 NOT NULL,
    "userId"            TEXT                 NOT NULL,
    "type"              "FeedbackType"       NOT NULL,
    -- What they wrote, as they wrote it. The schema caps it at 4000
    -- characters; TEXT rather than VARCHAR so the cap lives in one place
    -- instead of two that can disagree.
    "message"           TEXT                 NOT NULL,

    -- The notification's own lifecycle, in the vocabulary the subscription
    -- outbox already uses.
    "status"            "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    -- Resend's id for the message, and how its delivery webhook finds this
    -- row. Unique, because two rows claiming one message would make the
    -- delivery status ambiguous.
    "providerMessageId" TEXT,
    "attempts"          INTEGER              NOT NULL DEFAULT 0,
    -- Our own short reason, never a provider payload and never the message.
    "lastError"         TEXT,

    "queuedAt"          TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt"        TIMESTAMP(3),
    "deliveredAt"       TIMESTAMP(3),
    "failedAt"          TIMESTAMP(3),

    "createdAt"         TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.feedback
  ADD CONSTRAINT "feedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES public.users("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "feedback_providerMessageId_key" ON public.feedback("providerMessageId");

CREATE INDEX "feedback_status_idx" ON public.feedback("status");

-- Serves two queries: a person's own feedback, and the duplicate check, which
-- looks for an identical message from the same account inside a short window.
CREATE INDEX "feedback_userId_createdAt_idx" ON public.feedback("userId", "createdAt");

-- --- Row-level security -----------------------------------------------------

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_read ON public.feedback;
CREATE POLICY feedback_read ON public.feedback
  FOR SELECT
  USING (app_is_job_runner() OR "userId" = app_current_tenant());

-- Yours to write, and only yours. The WITH CHECK is what makes submitting as
-- another account impossible rather than merely refused.
DROP POLICY IF EXISTS feedback_insert ON public.feedback;
CREATE POLICY feedback_insert ON public.feedback
  FOR INSERT
  WITH CHECK (app_is_job_runner() OR "userId" = app_current_tenant());

-- The notification's state is not. Only the job runner moves it.
DROP POLICY IF EXISTS feedback_update ON public.feedback;
CREATE POLICY feedback_update ON public.feedback
  FOR UPDATE
  USING      (app_is_job_runner())
  WITH CHECK (app_is_job_runner());

DROP POLICY IF EXISTS feedback_delete ON public.feedback;
CREATE POLICY feedback_delete ON public.feedback
  FOR DELETE
  USING (app_is_job_runner());

COMMIT;
