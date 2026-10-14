# Quiz Activity App

Independent responsive quiz-taking app for students. It signs students in with Firebase email/password and loads their section from `studentProfiles/{authUid}`, loads quiz-session question-list questions or published question bank questions, runs the quiz from a local in-memory snapshot after Start, and writes attempts to `qb_quiz_submissions_v1`.

## Files

- `login.html` / `login.js` - student email/password sign-in.
- `index.html` - student dashboard, quiz setup, quiz runner, and result.
- `firebase.js` - shared Firebase configuration and authentication redirect.
- `header.js` - consistent signed-in navigation and student identity across the dashboard, submissions list, and submission detail pages.
- `submissions.html` - past-submissions list and student progress report.
- `submission.html?id=<submissionId>` - dedicated authenticated submission detail page, including answer review, review filters, and AI feedback.
- `styles.css` - responsive phone, tablet, and desktop layout.
- `app.js` - Firebase reads/writes, student authentication, section dashboard, quiz state, and grading.
- `submissions.js` - Firebase read and detailed answer review for the standalone past-submissions page.
- `FIRESTORE_SCHEMA.md` - collection and document schema notes.
- `firestore.rules` - starter rules for quiz-related access.

## Flow

1. Students sign in at `login.html` with their school email and password using Firebase Authentication. Accounts are provisioned by the school; this app does not register accounts.
2. The app directly reads `studentProfiles/{currentUser.uid}` and requires an active, valid profile with section, admission number, and student key.
3. The dashboard queries `classrooms where sectionId == profile.sectionId`, shows enabled, unarchived quiz sessions, and sorts newest first using `createdAt`, falling back to `createdDate`. No composite index is needed.
4. Clicking a session rechecks its availability and section, then opens the existing quiz setup. Teacher-selected question lists and sessions with saved class/subject/chapter taxonomy IDs load automatically; other sessions use quiz filters. Quiz Settings show audio/listen controls for `quiz`, `wpt`, and `rpt`, while `practice`, `reading_practice`, and `writing_practice` also show instant feedback and answer-helper settings. In `reading_practice` and `writing_practice`, adaptive question memory also shows and weighs ACTFL skill, level, sublevel, and mode fields.
5. A previously submitted session is blocked from another attempt. Past Submissions uses the authenticated profile's student key, including historical submissions.
6. Existing question selection, difficulty overrides, audio, translations, instant feedback, and offline quiz navigation remain available.
7. Submissions use the existing deterministic session/section/admission document ID and now include `authUid` and `email`.
8. Dashboard returns from a quiz to the session list. Sign Out ends the Firebase session. Firebase restores login across reloads.

## Firebase setup

Enable Email/Password authentication and provision student accounts with UID-keyed profiles as described in the supplied admin schema. Deploy the student access rules by merging `firestore.rules` with the project's existing teacher/admin rules. These sample rules grant only student access and are not deployed by this change. The backend should keep profile `active` synchronized with account status.

## Run Locally

From the repository root:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/
```

The app loads Firebase, KaTeX, and Mermaid from CDNs, so internet is required for first load and Firestore operations.

## Notes

- Login always opens the section dashboard; quiz session codes are no longer required.
- Links with `?show-recent=1` open the newest submission detail page after authentication.
- MCQ, True/False, and FIB questions are auto-graded.
- Short-answer responses are stored with `isCorrect: null` for teacher review.
- Quiz sessions with `questionBankListId` use the teacher-selected list. If `studentDifficultyLevels` has an entry for the verified admission number, only that difficulty is used. If `randomQuestionTypeCounts` is set, selection is random within each requested type; otherwise every matching listed published question is used.
- Published question reads use `qb_questions_v1 where status == "published"` when no quiz session list is selected.
- Student submission history uses `studentKey = sectionId_admissionNo`.
- A student can have only one submission per quiz session; duplicate attempts are blocked before write.

## Page tours

Each page has its own Tour button walkthrough: sign-in, dashboard, submission history, and submission details. On the dashboard, the Tour button adapts to quiz setup, the quiz runner, or the result view. Automatic tour opt-out is saved separately for each page; the Tour button can always relaunch it. Steps targeting hidden or missing controls are skipped.

Dashboard quiz session colors prioritize submitted attempts (green), then overdue
(red), due today or within 3 calendar days (orange), and due in 4–6 calendar days
(yellow). Calendar days use the student's local timezone. Sessions without a due
date or due more than 6 days away retain the default card color. Status labels
accompany colors.
