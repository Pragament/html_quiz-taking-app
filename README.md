# Quiz Activity App

Responsive student quiz app using Firebase Authentication and Firestore. Students sign in with school email/password accounts, open assigned sessions from their section dashboard, or use homepage practice. Questions run from an in-memory snapshot after Start. Assigned practice progress, completed submissions, and explicitly saved question reactions use separate document shapes.

## Files and documentation

- `login.html` / `login.js`: email/password sign-in and profile validation.
- `index.html` / `app.js`: dashboard, Step 2 setup, questions, feedback, pause/resume, and results.
- `submissions.html`, `submission.html?id=<submissionId>`, and `submissions.js`: completed-submission history, reports, and answer review.
- `firebase.js`: shared Firebase project configuration, Auth/Firestore instances, and login redirects.
- `header.js` / `tours.js`: navigation, student identity, sign-out, and page-specific tours.
- `styles.css`: responsive layout, collapsible explanation panel, and desktop width resizing.
- [Authentication guide](FIREBASE_AUTH_STUDENT_LOGIN.md): account provisioning, profile checks, and current authorization behavior.
- [Firestore schema](FIRESTORE_SCHEMA.md): collections, IDs, queries, progress snapshots, reactions, and rule constraints.
- [Firestore rules](firestore.rules): combined student and teacher/admin permissions. Matching grants are additive; see the authorization notes below.

## Student flow

1. Sign in at `login.html`. Accounts and passwords are provisioned by the school; the student app has no registration or password-reset flow.
2. Read `studentProfiles/{authUid}`. The login/dashboard require an active profile, matching Auth UID, section, admission number, and `studentKey = sectionId_admissionNo`.
3. The dashboard queries sessions by section and submissions by student key. Pending sessions must be enabled, unarchived, not completed, and have a valid `dueAt` today or later in the browser's local timezone. They are sorted by due date ascending. `startAt` is displayed but does not gate access. Sessions without a valid due date are excluded.
4. Opening a session rechecks its section and availability. A saved assigned practice attempt resumes; **Restart from Beginning** instead opens Step 2 to review settings. Saved progress is replaced only after **Restart Practice** starts the new attempt.
5. A teacher-selected `questionBankListId`, or a complete saved class/subject/chapter scope, loads questions automatically. Other sessions show taxonomy and question filters. Completed sessions cannot be restarted through the student app.
6. Assigned sessions write a completed submission when submitted. Incomplete practice drafts stay out of completed history, reports, duplicate-submission checks, and past-performance memory.

## Modes and question order

| Mode | Question order at Start | Learning support | Saved progress |
| --- | --- | --- | --- |
| `quiz`, `wpt`, `rpt` | Random | Audio, voice speed, listen/respond, available translations | Completed submission only |
| `practice`, `reading_practice`, `writing_practice` | Loaded/list order by default; optional AI question selection memory | Instant feedback, audio, word banks, translated answer panel, explanation URL | Autosave and Pause/Resume for assigned sessions |
| Homepage practice | Practice defaults; optional AI selection | Same practice helpers and filters | No progress or completed-submission writes |

Practice instant feedback is enabled and locked on. AI selection is off by default; opting in ranks questions from prior completed answers and can reorder the remaining questions after feedback. Reading/writing practice includes ACTFL fields in this ranking. Quiz/test modes hide this option and shuffle questions by default.

For teacher lists, questions are first loaded in `questionIds` order. Admission-number difficulty overrides and optional random per-type counts determine the eligible subset. Practice preserves the surviving list order unless AI selection is enabled; quiz/test modes shuffle that subset. Non-list filters include class, subject, chapter, difficulty, question type, explanations, translations, and staff verification. The verified filter is a client-side option, not an access rule.

## Practice, explanations, and grading

- Assigned practice autosaves answer edits and question transitions to the session's submission document. Pause saves before returning to the dashboard. Resume restores question order, position, answers, feedback, settings, AI memory, and elapsed time; paused time is excluded. A UID/session-scoped browser backup can recover edits immediately before refresh.
- Homepage practice appears below Pending Quiz Sessions. It reads questions but does not save answers, progress, or results. Users can still explicitly save a question reaction.
- Practice explanation URLs accept HTTP/HTTPS and appear in an expanded-by-default, collapsible panel with a desktop resize divider, plus a link in Instant Feedback. Quiz/test modes hide them. An external site may prevent iframe embedding; the Open link remains available.
- “View translated answer” works with Original selected, showing available answers with language labels. With a translated question selected, it shows that answer, falling back to available translations if needed. It obeys the practice helper setting and is omitted when no translated answer exists.
- Short-answer word banks always use original answer words. Viewing/changing translations preserves selected words. Word-bank answers are graded in the original language; typed answers use the selected language.
- MCQ, True/False, and FIB are auto-graded. Short answers receive local assessment with an `aiReview`; cached AI models can improve semantic scoring. Short answers are correct at 90% of available marks, otherwise incorrect; `isCorrect` is null when no gradable expected answer exists. They are not universally stored as ungraded/manual-review responses.
- Displayed point totals are rounded to one decimal place. Grading still retains its numeric values.
- A collapsible left statistics sidebar is available only in practice. It starts collapsed to preserve explanation width and opens with **Show Stats**. It displays green correct and red wrong counts by topic, difficulty, skill, ACTFL level, ACTFL sublevel, and ACTFL mode for the current attempt. Only checked feedback is counted; unchecked and ungraded answers are tracked separately. Missing metadata appears as “Not specified.” Counts are rebuilt from the existing feedback snapshots after resume and reset with a restarted attempt. On smaller screens, the sidebar stacks above the question area.

## Incorrect-answer review

Practice has a second independently collapsible left panel, **Review mistakes**, stacked with Stats in the same sidebar column. It includes only checked, incorrect FIB and short-answer responses with a nonempty student answer. Skipped/unchecked drafts, whitespace-only answers, correct responses, ungraded responses, MCQ, and True/False questions are excluded. A partially completed FIB response counts as nonempty if at least one blank contains an answer.

Cards are the default; **Cards** and **Table** switch the presentation. Both show Question, Student answer, Score, Teacher correct answer, and Explanation text. Scores use the saved grading result, including short-answer partial marks. Prompts use the existing rich-content sanitizer/renderer; student answers and explanations are escaped text. The table scrolls horizontally within the panel. Opening review widens the left column on desktop; narrow layouts stack the explanation above the answer work area as needed and put both sidebars above the question.

The panel derives its contents from the current attempt and updates when feedback changes. Resume uses the existing saved answers and feedback; no new Firestore fields are required. View choice is temporary, with cards and a collapsed panel on a new/resumed attempt.

**Sort by** offers Question order (default), Score ascending, and Score descending in both cards and table views. Score sorting compares earned points divided by maximum points, so different score scales are comparable. Equal scores keep question-number order; unavailable scores come last. Sort choice survives view switches/collapse within the current attempt but resets on a new/resumed attempt and is not saved to Firestore. It changes only the review display, not the quiz question order.

## Practice question selector

The Questions header includes a single-line, horizontally scrollable numbered selector in practice modes. Tap a number to revisit a question or move ahead. Touch scrolling and left/right scroll buttons browse long attempts; arrow keys, Home/End, then Enter/Space support keyboard navigation. The active number stays visible when changing questions.

Difficulty, skill, ACTFL level, sublevel, and mode dropdowns filter the question numbers shown. Options come from the current attempt's metadata; selections combine with AND. Matching questions retain their original attempt numbers and jump destinations. Filtering does not change the active question, attempt order, answers, score, statistics, or badges. A count shows how many numbers match and notes when the active question is outside the filters. Clear filters restores all numbers; a new/resumed attempt starts with All selected. Filter choices are temporary UI state and are not saved to Firestore.

The legend identifies gray unanswered questions, amber answered-but-unchecked drafts, green correct answers, red incorrect answers, purple checked/ungraded answers, and a blue outline around the current question. Status labels are also available to screen readers.

Jumping saves the outgoing answer and restores the destination's answer and feedback without checking or grading it automatically. Already checked answers remain locked. Assigned practice also saves the selected position for resume; homepage practice keeps it only in memory. Navigation is blocked during checking, pausing, and submission. With optional AI selection, later checked questions and answer drafts retain their numbered slots while remaining unanswered slots can be reordered. Quiz/test modes do not show this selector.

**Skip** appears beside the question action in practice modes. It saves the current draft and moves to the next question without grading, changing feedback, or marking it incorrect. From the last question it wraps to question 1 and never submits automatically. It follows the full attempt order, independent of selector filters. Assigned practice saves the new position; homepage practice stays in memory. Skip is disabled during checking/submission and when the attempt contains only one question. An untouched skipped question remains “Not answered”; a retained draft remains “Answered, not checked.”

## Practice badges

Earned badges appear in the **Questions header**, beside the timer, score, and Pause controls. Expand **Badge requirements and progress** to see criteria and current counts. These are current-attempt achievements; they do not pool questions across sessions or certify ACTFL proficiency.

| Badge | Requirement |
| --- | --- |
| Topic Master, per topic | At least 10 distinct checked, gradable questions and 90% correct |
| Difficulty Champion | At least 10 distinct Hard/Very Hard questions combined and 80% correct |
| Listening / Reading / Writing / Speaking Star | At least 10 distinct questions in the skill and 80% correct |
| ACTFL Practice Star, per level | At least 10 distinct questions tagged with the level and 80% correct |
| Interpretive / Interpersonal / Presentational Explorer | At least 10 distinct questions in the communication mode and 80% correct |

Unchecked, ungraded, and missing-ID questions do not qualify. Repeated question IDs count once; eligibility uses exact ratios rather than rounded display percentages. Earned badges remain earned within the attempt even if later accuracy drops. Assigned practice snapshots restore them after refresh, and completed practice submissions retain award metadata. Restart begins a fresh attempt and fresh badges. Homepage practice badges remain in memory only. Missing metadata does not earn a badge for an unspecified category. Improvement/consistency badges and lifetime achievements are not implemented.

Assigned practice stores badge information directly in `qb_quiz_submissions_v1` on every autosave/pause and final submission: `practiceBadgeVersion: 1` plus `practiceBadges` (an array, empty when none are earned). Each badge records its identifier, name/category label, icon, threshold/minimum, and counts/accuracy when earned. The embedded practice snapshot retains the same awards for resume; final submission also evaluates final graded answers. Existing completed records are not backfilled automatically, and homepage practice remains unsaved. See [the badge schema](FIRESTORE_SCHEMA.md#badge-fields-on-practice-progress-and-submissions).

## Practice Coach

During an active practice attempt, a collapsible **Practice Coach** floats at the bottom right. Long-press/select text in the question, answer, or feedback area and choose **Open in Coach**, or open the launcher and type/paste text. It is unavailable in quiz/test modes. Text selected inside a cross-origin explanation iframe cannot be read by the parent page; paste that text into Coach instead.

Four independent tools share the Coach text (up to 2,000 characters):

- **Dictionary** looks up the chosen English word through [Free Dictionary API](https://dictionaryapi.dev/), including definitions, pronunciation text, and available examples.
- **Spelling** checks up to 12 unique English words through [Datamuse](https://www.datamuse.com/api/) and shows possible alternatives without changing the text. Names and specialist vocabulary may be absent from its word list.
- **Sentence Formation** uses the existing local `flan-t5-small` writing pipeline when ready. Otherwise it provides a clearly labeled local sentence starter/punctuation draft and sentence-structure guidance. Generated suggestions require the student's review.
- **Speech-to-Text** explicitly starts the browser microphone, offers a speech-language choice and editable transcript, and copies the transcript into Coach only. Unsupported browsers retain the typed transcript workflow. Recognition needs a secure context (HTTPS/localhost), microphone permission, and browser support; it may use the browser vendor's online speech service.

Run a text agent individually or use **Run all text agents**. Read aloud uses browser speech synthesis. Collapsing Coach stops microphone/read-aloud activity and cancels pending word lookups. Leaving practice clears Coach/transcript state; backgrounding the page stops the microphone. Coach output never changes quiz answers automatically and is not written to Firestore or persistent browser storage.

Dictionary/spelling send only requested words to their services, without app credentials or Auth identifiers. No lookups occur merely by selecting text or opening Coach. Those tools require network access. Datamuse currently announces API-key requirements from February 1, 2027; review that dependency before rollout beyond that date and keep any future secret keys on a backend rather than in the browser.

## Question reactions

Like/Dislike opens an optional editable comment prefilled from the user's current answer(s). **Save Feedback** explicitly writes `qb_reactions_v1/{questionId}__{authUid}` with `questionId`, `userId`, `value`, `sourceType`, `sourceValue`, `updatedAt`, and optional `comment` (maximum 2,000 characters). A later save updates the same reaction across sessions.

Assigned sessions use `sourceType: 'quiz-session'` and `sourceValue: classroomId`; homepage practice uses `'practice'` / `'homepage'`. Reactions are independent of scores and submissions.

## Firebase configuration and authorization

Enable Email/Password authentication and provision UID-keyed profiles through a trusted admin service. Keep profile `active` and Auth account status synchronized. The client uses the signed-in Auth UID/email for new submission identity.

The repository rules now include teacher/admin access, not just starter student rules. Review them against the deployed project before publishing changes. Editing or pushing this repository does not establish which rules are live.

Current rule details that affect deployment:

- Published questions and taxonomy are publicly readable. Staff verification is not required by question-read rules.
- Active students can read same-section sessions and their own submission history by student key. Classroom owners and section admins have additional review permissions, including restricted AI-review updates to completed submissions.
- Three matching reaction blocks coexist. The legacy block grants public reads, signed-in owner writes to `questionId_uid` IDs, and owner deletes. The student block validates `questionId__uid` writes, source context, values, comments, and timestamps. Firestore combines these grants with OR: the stricter student block does not make reactions private, deny all deletes, or require its validation for legacy-ID writes.
- Profile writes are denied by these client rules, including for signed-in admin clients; trusted profile provisioning must use a backend/Admin SDK or separately reviewed rules.

See the authentication guide and schema for the full permission map and client-versus-rule distinctions.

## Run and verify

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Firebase, KaTeX, Mermaid, and AI resources require network access initially; Firestore reads/writes require connectivity. Pause reports a save failure instead of leaving the attempt when cloud saving fails.

```bash
node --test tests/*.test.cjs
node --check app.js
node --check submissions.js
node --check login.js
```

The Node tests cover app behavior with mocked dependencies; they do not verify deployed Firestore permissions. Rule changes need separate emulator/integration checks against the complete combined rules.

## Navigation and tours

Firebase restores the signed-in session across reloads. Dashboard returns to the section homepage; Sign Out ends the Auth session. Login redirects accept only the dashboard, submission list, or submission detail pages. `?show-recent=1` opens the newest completed submission after authentication.

Tours are available for login, dashboard, setup, questions, results, submission history, and details. Opt-out is stored per tour. Pending-session colors highlight due today/within three calendar days and due in four–six days; submitted, overdue, and missing-due-date sessions are filtered out of this list even though styling/status helpers exist for them.
