# Firestore schema and access

This describes the current student app and the combined rules in [firestore.rules](firestore.rules). It does not assert that the checked-in rules are deployed. See [the authentication guide](FIREBASE_AUTH_STUDENT_LOGIN.md) for provisioning and the effective teacher/admin and student permissions.

## Identity and existing collections

### `studentProfiles/{authUid}`

```js
{
  authUid: 'firebase-auth-uid',
  email: 'student@school.edu',
  sectionId: 'section-id',
  admissionNo: '001',
  studentKey: 'section-id_001',
  studentName: 'Student Name',
  active: true,
  createdAt: Timestamp, // admin metadata
  updatedAt: Timestamp  // admin metadata
}
```

Login/dashboard directly read the Auth UID document and require an active profile, matching `authUid`, nonempty section/admission number, and the exact derived student key. Preserve admission numbers as strings. The current authenticated user's UID/email are used for new submissions. Name has a display fallback.

Rules permit signed-in users to get their own profile and deny client list/write operations. A trusted backend provisions profiles. The student app never reads roster phone numbers or verifies a quiz code/admission/phone prefix.

### `classrooms/{classroomId}`

```js
{
  classCode: '176260', // legacy/display metadata; not entered for student login
  className: 'Grade 8 Mathematics',
  classEnabled: true,
  archived: false,
  mode: 'practice',
  sectionId: 'section-id',
  sectionName: 'Grade 8',
  creatorId: 'teacher-auth-uid',
  startAt: Timestamp, // optional display date, not an access gate
  dueAt: Timestamp,   // required for the pending-session list
  createdAt: Timestamp, // optional; preferred creation display date
  createdDate: 1788177950135, // fallback creation date, milliseconds
  questionBankListId: 'list-id', // optional
  classId: 'class-taxonomy-id', // optional saved scope
  subjectId: 'subject-taxonomy-id',
  chapterId: 'chapter-taxonomy-id',
  randomQuestionTypeCounts: { mcq: 10, fib: 5, short_answer: 3, true_false: 2 },
  studentDifficultyLevels: { '001': 'Easy', '002': 'Hard' },
  studentDifficultyUpdatedAt: Timestamp // teacher metadata
}
```

The dashboard queries `classrooms where sectionId == profile.sectionId`, then filters enabled, unarchived, not-completed sessions with a valid `dueAt` today or later. It sorts by `dueAt` ascending using the browser's local calendar day for overdue checks. A future `startAt` does not delay access. Missing/invalid due dates are excluded, even though generic date-display helpers have fallback labels. Creation timestamps are used for display, not session sorting.

Selecting/resuming a session directly reads its document and repeats section/enabled/archived/due checks. Rules grant active students same-section reads; submission writes require an enabled, unarchived same-section classroom. Due/start scheduling is not enforced by those rules.

| Stored mode | Behavior |
| --- | --- |
| `quiz`, `wpt`, `rpt` | Random question order; no practice instant feedback, explanation iframe, AI-selection option, or cloud progress |
| `practice`, `reading_practice`, `writing_practice` | Default loaded/list order, optional AI selection, required instant feedback, answer helpers, explanation panel, and assigned-session autosave |

Audio/listen controls and available question translations work in all six modes. Reading/writing practice includes ACTFL metadata in optional adaptive ranking. Homepage practice has no classroom document and saves neither progress nor completed submissions.

`questionBankListId` takes precedence over question filters. Listed published questions are loaded in `questionIds` order, filtered by any admission-number difficulty override, and optionally sampled by random per-type counts. The surviving subset keeps list order in default practice; quiz/test mode shuffles it. Optional AI selection can rank and reorder practice questions. With no list, a complete saved class/subject/chapter scope locks those filters and loads automatically; otherwise Step 2 asks for a class and exposes filters.

### `classSections/{sectionId}` and nested `students/{studentId}`

These support teacher/admin workflows, not student login. Section `members` entries have the shape `{ email: 'lowercase@school.edu', role: 'admin' | 'viewer' }`, used by rule helpers. `schoolAdmins/{uid}` existence supplies the separate school-admin check.

Roster records may contain `admissionNo`, `name`, `phone`, `email`, `authUid`, and `studentKey`. The current student app does not query them. Section admins/viewers and school admins have the operation-specific grants defined in the rules; a student profile's `sectionId` does not itself grant roster access.

### `qb_taxonomy_v1/{taxonomyId}`

The app reads taxonomy documents and uses `id`, `type`, `label`, `parentId`, `classId`, `subjectId`, and `chapterId` to populate class/subject/chapter choices. `id` comes from the document ID. Recognized app filter types are `class`, `subject`, and `chapter`; rules also permit `topic` metadata.

Taxonomy is publicly readable under the current rules. Signed-in clients may create/update records with an allowed type and string label; deletes are denied.

### `qb_questions_v1/{questionId}`

Non-list loads query `status == 'published'`; lists use direct reads of their question IDs and retain published results. Published questions are publicly readable under the current combined rules. Authors have additional read/write permissions for their own questions. Staff verification is optional client filtering, not a required read-rule predicate.

Core fields read by the student app include `type`, `promptHtml`, taxonomy IDs, fallback class/subject/chapter labels, and `difficulty`.

| Type | Answer fields | Assessment |
| --- | --- | --- |
| `mcq` | `options: [{ html, correct }]` | Selected option indices must exactly match the correct indices |
| `true_false` | `trueAnswer` boolean | Boolean match |
| `fib` | `fibBanks: [{ label, answers: [...] }]` | Each filled blank must match one normalized accepted answer |
| `short_answer` | `shortAnswerHtml` expected-answer HTML | Local assessment produces `aiReview`, marks, and correctness when gradable |

Optional fields and helpers:

- `verified`: the staff-verified filter requires exactly `true`; checked by default for non-list filters.
- `explanationUrl`: validated HTTP/HTTPS topic explanation URL. Step 2 can require it. Practice embeds it in a collapsible, desktop-resizable panel expanded by default, and shows a link in Instant Feedback. Quiz/test modes hide it.
- `explanation`: explanation text rendered in practice Instant Feedback and stored on graded answers.
- `translations`: language-keyed objects containing `question`, `answer`, and/or `options` strings/arrays. Only nonempty translations are offered.
- `skill`, `actfl_level`, `actfl_sublevel`, `actfl_mode`: metadata included in snapshots and used by reading/writing practice AI ranking. The student app normalizes these strings; it does not enforce a fixed enum through its rules.

“View translated answer” obeys its practice setting. Original shows available translated answers with language labels; a selected language shows its translated answer, falling back to available answers when missing. Word banks always use original expected-answer words. Word-bank answers are graded in the original language; typed answers follow the selected language. Generated option banks and translations are part of the question snapshot used during the attempt.

### `qb_lists_v1/{listId}`

```js
{
  name: 'Favorites',
  ownerUid: 'teacher-auth-uid',
  questionIds: ['question-id-1', 'question-id-2'],
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Lists store question document IDs rather than embedded snapshots. Active students can read lists; owners have additional create/update/delete access. An owner-only teacher editor does not make a referenced list unreadable to active students under these rules.

## Collections written by the student app

The practice statistics sidebar adds no stored fields or collection. It derives current-attempt correct/wrong counts from the existing question metadata (`topic`/`topicId`, `difficulty`, `skill`, `actfl_level`, `actfl_sublevel`, `actfl_mode`) and `feedback`/`feedbackShown` arrays. Only checked boolean correctness contributes to green/red counts; unchecked and null/undefined correctness remain separate. Existing saved practice state therefore restores these counts without a migration. Missing metadata is displayed as “Not specified.”

The separate incorrect-answer review panel also derives from existing `questions`, raw `answers`, `feedback`, and `feedbackShown`. A row requires `feedbackShown[index] === true`, `feedback[index].isCorrect === false`, question type `fib` or `short_answer`, and a nonempty raw student response. It displays saved prompt/correct-answer/explanation metadata and the graded score. Skips, empty answers, other types, correct results, and ungraded feedback are excluded. Cards/table view choice and collapse state are not persisted, and no new collection or rules are needed.

Review score sorting is also temporary UI state. Ascending/descending use the existing earned/max score ratio, preserve question order for ties, and do not modify saved questions or grades.

The practice question-number selector also requires no new field. It reads `answers`, `feedback`, and `feedbackShown` for status colors. Jumping saves the current answer and changes the existing `currentIndex` in assigned-practice progress; resume restores that position. Selecting a question does not itself grade it. Homepage navigation remains in memory, and quiz/test modes do not expose this selector.

The selector's difficulty/skill/ACTFL filters read the existing question snapshot fields and narrow only the displayed numbers. They do not mutate the question list or progress snapshot. Filter selections are not persisted; reopening a saved attempt defaults to All.

The practice-only floating Coach does not add a Firestore collection or document field. Selected text, dictionary/spelling results, sentence suggestions, and speech transcripts remain temporary UI state and are cleared when leaving practice. They are not included in `practiceState`, completed answers, or reactions unless the user separately enters text into those forms. Dictionary/spelling make explicit online word lookups without Firebase identity; browser speech recognition may use its provider's speech service. See the README for service dependencies and browser limitations.

### Completed `qb_quiz_submissions_v1` documents

Path:

```txt
/qb_quiz_submissions_v1/{submissionId}
submissionId = encodeURIComponent(classroomId)__encodeURIComponent(sectionId)__encodeURIComponent(admissionNo)
```

```js
{
  authUid: 'firebase-auth-uid',
  email: 'student@school.edu',
  classroomId: 'classroom-id',
  sectionId: 'section-id',
  admissionNo: '001',
  studentName: 'Student Name',
  studentKey: 'section-id_001',
  quizSessionLabel: 'Grade 8 Mathematics · Grade 8',
  classId: 'class-taxonomy-id',
  subjectId: 'subject-taxonomy-id',
  chapterId: 'chapter-taxonomy-id',
  className: 'VIII',
  subject: 'Mathematics',
  chapters: ['Prime Factorisation'],
  difficulty: 'Easy',
  questionCount: 10,
  answeredCount: 8,
  gradableCount: 10,
  correctCount: 5,
  practiceBadgeVersion: 1, // practice submissions only
  practiceBadges: [/* earned current-attempt awards; empty array if none */],
  answers: [
    {
      questionId: 'question-id',
      type: 'mcq',
      promptHtml: '<p>Question snapshot</p>',
      displayAnswer: 'Option A',
      correctAnswer: 'Option A: 120',
      isCorrect: true,
      selectedOptions: [0],
      fibAnswers: [],
      trueFalseAnswer: null,
      shortAnswer: '',
      translationLanguage: '',
      explanation: 'Explanation text',
      explanationUrl: 'https://example.com/topic'
      // Also includes question taxonomy/labels, difficulty and ACTFL metadata.
      // Short-answer results additionally contain aiReview.
    }
  ],
  submittedAt: Timestamp, // serverTimestamp()
  submittedAtMillis: 1788177950135 // device milliseconds
}
```

MCQ, True/False and FIB `isCorrect` values are booleans. Short answers use local assessment with optional cached-model semantic scoring. `aiReview` includes `marks`, `maxMarks`, reasons, and assessment detail; correctness is true at 90% of available marks, false below that, and null when no expected answer is gradable. Reports count non-null answers as gradable. Score displays round to one decimal place without changing stored assessment values.

The client checks for an existing completed session/student submission and uses the deterministic ID above. Rules validate profile/Auth identity and an enabled, unarchived same-section classroom, but do not enforce that ID format or global uniqueness across alternative IDs.

Students cannot modify completed/historical submissions through the student update grant. Classroom owners and section admins may make `isAiReviewUpdate` changes: only `answers`, `aiReviewUpdatedAt` (number), `aiReviewUpdatedBy` (Auth UID), and `aiReviewUpdatedByEmail` (Auth email), preserving answer-list length. Deletes are denied.

### Unfinished assigned practice in `qb_quiz_submissions_v1`

Uses the same session/section/admission document ID as the eventual submission:

```js
{
  authUid: 'firebase-auth-uid',
  email: 'student@school.edu',
  classroomId: 'classroom-id',
  sectionId: 'section-id',
  admissionNo: '001',
  studentName: 'Student Name',
  studentKey: 'section-id_001',
  quizSessionLabel: 'Reading Practice · Grade 8',
  practiceProgress: true,
  progressVersion: 1,
  practiceBadgeVersion: 1,
  practiceBadges: [/* earned current-attempt awards; see badge shape below */],
  status: 'in_progress', // 'in_progress' | 'paused'
  questionCount: 10,
  currentIndex: 2, // zero-based
  answers: [/* raw answer state, one per question */],
  practiceState: '{"quiz":{...},"currentIndex":2,"elapsedMs":32000}',
  updatedAtMillis: 1788177950135 // device milliseconds
}
```

`practiceState` is a JSON string containing the question snapshots/order, raw answers, feedback and feedback-shown flags, reveal/translation choices, helper settings, timing, and AI memory. Maps/Sets are serialized as `{ practiceType: 'Map' | 'Set', entries: [...] }` and restored on resume. Rules require version 1, a snapshot string shorter than 900,000 characters, positive question count, matching raw-answer count, valid current index, and numeric update time. The normal Firestore document-size limit also applies.

Only assigned `practice`, `reading_practice`, and `writing_practice` sessions write this shape. Edits and question transitions autosave; Pause saves before leaving. A failed pause keeps the attempt open. Resume uses stored state instead of reselecting questions and resets the running clock from stored elapsed time. A browser backup keyed by authenticated UID and classroom can recover newer edits made immediately before refresh.

“Restart from Beginning” opens Step 2 and reloads the appropriate list or filters. Saved progress remains until Start/Restart Practice creates fresh answers using the selected settings. Other sessions' progress is unaffected.

Drafts are excluded from completed-history/report queries after loading, pending-session completion checks, duplicate checks, and historical AI memory. Final submission replaces the draft with the completed shape; there is no required `status: 'submitted'` field on completed records. Older completed records lacking `authUid` remain readable by the matching active profile's student key. Homepage practice writes neither shape.

The owner can update an unfinished draft while retaining UID, student key, and classroom, or transition it to a completed submission with timestamps. The student draft grant cannot reopen a completed record. Teacher/admin review grants are separate.

### Badge fields on practice progress and submissions

Every new assigned-practice autosave, pause, and completed submission includes top-level `practiceBadgeVersion: 1` and `practiceBadges: []` (or the earned badge objects). Consumers can read badges directly from `qb_quiz_submissions_v1/{submissionId}` without parsing `practiceState`. Example array entry:

```js
{
  id: 'topic:fractions-topic-id',
  name: 'Topic Master',
  label: 'Fractions',
  icon: '🎯',
  threshold: 90, // required accuracy percentage
  minimum: 10,   // minimum distinct checked, gradable questions
  correct: 9,    // qualifying counts when the badge was first earned
  checked: 10,
  accuracy: 90,  // rounded display percentage; eligibility uses the exact ratio
  earned: true
}
```

Badge IDs identify the topic, pooled Hard/Very Hard difficulty, skill, ACTFL level, or communication mode. They are unique within the attempt's array. Draft autosaves update the top-level list and keep `quiz.earnedPracticeBadges` inside `practiceState` synchronized. Once earned, awards remain in that attempt even when later accuracy falls. Final submission evaluates all final graded answers as checked, preserves earlier awards, and saves the resulting top-level array. Badge persistence does not depend on the header being expanded or rendered.

On resume the embedded array is used when available; a top-level `practiceBadges` array is the fallback when the embedded field is missing. Older snapshots lacking both derive any currently qualifying awards from their stored feedback. No bulk backfill of historical completed submissions is performed. Restart clears awards when the new attempt starts. Duplicate question IDs count only once, and no lifetime counter is incremented. Homepage practice still writes neither a progress document nor a completed submission; its badges stay in memory.

These are client-computed practice achievements, not server-certified proficiency. The current submission/draft rules allow the additional badge fields; no separate collection or rule change is required for this extension. Existing identity, classroom, draft-update and completed-submission restrictions still apply. See the README for badge criteria.

### `qb_reactions_v1`

The student app uses:

```txt
/qb_reactions_v1/{questionId}__{firebaseAuthUid}
```

```js
{
  questionId: 'qb_questions_v1-document-id',
  userId: 'firebase-auth-uid',
  value: 'like', // 'like' | 'dislike'
  sourceType: 'quiz-session',
  sourceValue: 'classrooms-document-id',
  comment: 'My answer(s):\nA. My selected option', // optional; up to 2,000 characters
  updatedAt: Timestamp // serverTimestamp() on each save
}
```

Assigned quizzes/practice use `'quiz-session'` / classroom ID. Homepage practice uses `'practice'` / `'homepage'`. Source fields describe the latest save; the ID remains one reaction per user/question across sessions. Older double-underscore reactions lacking source metadata can be read and gain it on the next save.

Like/Dislike opens an optional editable comment prefilled from the user's selected options, True/False, labeled filled blanks, or typed/assembled short answer. Prefill uses only the user's response, is capped at 2,000 characters, and can be edited or cleared. Save Feedback explicitly writes the record; blank comments are omitted, removing any old comment on replacement. Reaction writes are independent of quiz grading/submission and are allowed by the UI even in homepage practice.

The student write block validates active profile, UID, the double-underscore ID, published question, allowed value, exact field set, source pair, server timestamp, and comment type/length. Quiz-session sources must be enabled/unarchived and in the profile section.

**Effective combined permissions differ from that stricter block.** The file also contains a legacy reaction block with public reads, signed-in owner writes using `questionId_uid` (one underscore), and owner deletes, plus a source-session reviewer read block. Matching grants are ORed. Consequently reactions are publicly readable, the owner-delete grant remains effective, and strict field/source validation does not cover legacy-ID writes. The current student UI uses only the double-underscore ID and has no delete control. It does not migrate single-underscore reactions from other apps.

## Queries and indexes actually used

| Operation | Read/query |
| --- | --- |
| Student profile | Direct `studentProfiles/{authUid}` |
| Dashboard sessions | `classrooms where sectionId == profile.sectionId` |
| Session revalidation | Direct `classrooms/{classroomId}` |
| Taxonomy filters | Read `qb_taxonomy_v1` collection |
| Teacher list | Direct `qb_lists_v1/{questionBankListId}` |
| Listed questions | Direct `qb_questions_v1/{questionId}` for each list entry |
| Non-list questions | `qb_questions_v1 where status == 'published'` |
| History, drafts, duplicate checks, past AI memory | `qb_quiz_submissions_v1 where studentKey == profile.studentKey`, with purpose-specific client filtering |
| Submission detail / progress resume | Direct `qb_quiz_submissions_v1/{submissionId}` |
| Current question reaction | Direct `qb_reactions_v1/{questionId}__{authUid}` |

The app sorts and applies most filters client-side; it does not require a composite query index for these reads. Standard single-field indexes on `sectionId`, `status`, and `studentKey` must remain enabled. A separate consumer can query reactions by `userId` or quiz-session `sourceType`/`sourceValue`; the student app currently uses direct reaction reads. Multi-field/order-by queries added by other apps may need their own indexes.

## Rules and rollout

The checked-in file already combines student and teacher/admin access. Taxonomy and published questions are public; section membership, creator IDs, list ownership, and school-admin documents govern additional operations. Profile client writes are denied. See [the authorization guide](FIREBASE_AUTH_STUDENT_LOGIN.md#effective-checked-in-permissions) before interpreting stricter individual blocks as the entire access policy.

Review and deploy the complete intended rules through the project's Firebase deployment process. Git commits and documentation updates do not deploy rules. App tests mock Firestore; emulator tests must exercise the combined file, including public and legacy grants, not only the student additions.
