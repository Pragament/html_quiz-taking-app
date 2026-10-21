# Firebase student authentication and authorization

This describes the implemented login flow and the checked-in `firestore.rules`, not a future migration plan. The student app uses Firebase Email/Password, UID-keyed profiles, and a section dashboard. Quiz-code/admission/phone verification is no longer used.

## Provisioning

A trusted admin service must create Firebase Auth users, set/reset passwords, and provision:

```txt
/studentProfiles/{authUid}
```

```js
{
  authUid: 'firebase-auth-uid',
  email: 'student@school.edu',
  sectionId: 'section-document-id',
  admissionNo: '001', // keep as a string, including leading zeroes
  studentKey: 'section-document-id_001',
  studentName: 'Student Name',
  active: true,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

The student app does not create accounts, write profiles, reset passwords, or query roster/phone records. `createdAt` and `updatedAt` are admin-maintained metadata. Student name has a display fallback; profile email is useful metadata, but new submission identity uses the authenticated user's email.

An optional roster record under `classSections/{sectionId}/students/{studentId}` may contain `authUid`, `email`, `admissionNo`, `studentKey`, and `name` for admin workflows. It is not the student app's identity source.

The checked-in rules deny profile list/write operations to all client SDK users. Provision profiles through an Admin SDK/backend that bypasses client rules, or deliberately update and review the production provisioning rules. School-admin membership alone does not grant client profile-write access here.

## Login and page access

1. `login.js` trims/lowercases the entered email and calls `signInWithEmailAndPassword`; passwords are not stored in Firestore.
2. `onAuthStateChanged` reads `studentProfiles/{user.uid}` directly. Login and dashboard require `active === true`, matching `authUid`, nonempty `sectionId`/`admissionNo`, and the exact derived student key.
3. Invalid login profiles cause sign-out and keep the login form available. The dashboard redirects when the user/profile is unavailable. Submission pages require an active profile, matching UID, and a student key; they use that key for history/detail ownership checks.
4. Firebase Auth restores the user across refreshes; the app re-reads the profile. Browser quiz state alone does not authorize access. The obsolete verified-session storage key is cleared on dashboard auth changes.
5. `firebase.js` redirects to login with a next-page target. `login.js` accepts only `index.html`, `submissions.html`, or `submission.html`, optionally with a query string. Dashboard is the default.
6. Header Sign Out calls Firebase `signOut`. Admins should synchronize profile `active` with disabled account status when revoking access.

## Assigned sessions and submission identity

The dashboard queries `classrooms` by the profile section, and submissions by the profile student key. Pending sessions must be enabled, unarchived, incomplete, and due today or later. Due dates are compared by local calendar day; future `startAt` does not delay access. Selecting or resuming a session repeats the client availability checks.

New submission IDs are exactly:

```txt
encodeURIComponent(classroomId)__encodeURIComponent(sectionId)__encodeURIComponent(admissionNo)
```

New documents include `authUid`, authenticated `email`, `classroomId`, `sectionId`, `admissionNo`, `studentKey`, and `studentName`, plus the attempt data. History uses `studentKey`, preserving access to older submissions that lack `authUid`.

The app blocks duplicate completed submissions and uses deterministic IDs. The rules validate owner/profile identity and an active same-section classroom on create, but do not enforce that submission ID format or query for another document with the same session/student identity. They also do not enforce `dueAt`/`startAt`; those pending-session constraints are client behavior.

## Practice progress

Assigned `practice`, `reading_practice`, and `writing_practice` sessions save unfinished progress into the same submission document, marked `practiceProgress: true` and `status: 'in_progress' | 'paused'`. The rules require the practice mode, schema version, answer count, current index, numeric update time, and a string snapshot below 900,000 characters.

Students may update their own unfinished practice document while keeping UID, student key, and classroom fixed, or replace it with a completed submission containing submission timestamps. Completed/historical submissions cannot be updated through the student-progress grant. Separate teacher/admin AI-review updates remain allowed.

Resume restores state after refresh. Restart opens Step 2 before replacing progress at Start. Homepage practice writes neither progress nor completed submissions; explicitly saved reactions are still supported. See [the schema](FIRESTORE_SCHEMA.md) for the snapshot fields and browser backup.

Assigned-practice documents additionally store `practiceBadgeVersion: 1` and top-level `practiceBadges` on autosave/pause and completion. Embedded `quiz.earnedPracticeBadges` supports resume, with the top-level array as a fallback. These optional learning-feedback fields use the existing owner-controlled submission/draft write paths, require no new collection or rule grant, and are not server-attested awards. Completed records retain their existing student update restrictions; historical documents are not backfilled by the client. Homepage practice does not persist badges.

## Effective checked-in permissions

[firestore.rules](firestore.rules) is the authority for the current repository. It combines student and teacher/admin grants; it is not the older minimal student-only example.

| Collection | Effective access relevant to this app |
| --- | --- |
| `studentProfiles` | Signed-in user can get their UID document, including an inactive profile so login can reject it; no client list/write |
| `qb_taxonomy_v1` | Public read; signed-in create/update with allowed type and string label; no delete |
| `qb_questions_v1` | Public read of published questions; signed-in author can read their unpublished questions, create their own, and update while retaining authorship; no delete |
| `classrooms` | Active student reads same-section sessions; creator or section admin also reads; creator creates/updates with valid list/section references; no delete |
| `qb_lists_v1` | Active students read lists; signed-in list owner also reads and can create/update/delete their own lists |
| `classSections` and nested `students` | Section-member/admin permissions; school-admin create/manage permissions as defined in the rules; ordinary student profile membership does not grant roster reads |
| `qb_quiz_submissions_v1` | Active student reads own student-key history and creates own attempts; constrained unfinished-practice updates; classroom owners/section admins review and make restricted AI-review updates; no delete |
| `qb_reactions_v1` | Public read through a legacy grant, plus the reaction write/delete paths described below |

Teacher/admin identity is determined by `schoolAdmins/{uid}` existence, section `members` entries containing lowercased email and `admin`/`viewer` role, classroom `creatorId`, and list `ownerUid`, according to the operation. The rules do not use the old proposed `request.auth.token.role` teacher/admin model. Public taxonomy/question reads mean the student login screen is not a security boundary for those published resources. The staff-verified filter is optional client filtering.

## Practice Coach scope

The floating Coach is enabled only while a practice quiz view is active, including homepage practice and assigned practice modes. It is hidden for quiz/test modes and cleared when the practice view is left. This is a client learning-tool mode check, not an extra Firestore permission. Coach text/transcripts are not persisted or automatically inserted into answers. Dictionary/spelling queries omit Firebase credentials and identity; speech recognition uses explicit browser microphone permission and may be processed by the browser's speech provider. No Auth or Firestore rules changes are needed for the Coach.

## Reaction authorization and overlapping grants

The student app writes `qb_reactions_v1/{questionId}__{authUid}` with:

- `userId` matching Firebase Auth UID, `questionId`, and `value: 'like' | 'dislike'`.
- Required `sourceType`/`sourceValue`: `'quiz-session'` / classroom ID for assigned sessions, or `'practice'` / `'homepage'`.
- `updatedAt: serverTimestamp()` and optional string `comment` up to 2,000 characters.

The student write block validates those fields, the deterministic double-underscore ID, a published question, and active same-section source sessions. Existing reactions without source fields remain readable; current app saves add them.

There are also two other matching blocks. The legacy block allows **public reaction reads**, signed-in owner writes using the **single-underscore** `questionId_uid` ID without the student block's value/comment/source/timestamp validation, and deletes by the stored owner. A further block grants source-session reads to classroom owners/section admins.

Firestore ORs matching allow expressions. Therefore the combined file does **not** enforce reaction privacy, universally deny reaction deletion, or apply the strict student validation to every possible reaction write. The app itself uses the stricter double-underscore schema and has no delete UI. Single-underscore reactions from another app are separate records; this app does not migrate/read them as its double-underscore reaction.

## Teacher AI review

Classroom owners or section admins permitted by `canReviewSubmission` can update only `answers`, `aiReviewUpdatedAt`, `aiReviewUpdatedBy`, and `aiReviewUpdatedByEmail`. The answer-list length must stay unchanged, update time is numeric, and reviewer UID/email must match Auth. This is why completed submissions are described as immutable **to students**, rather than immutable to every actor.

## Deployment and verification

1. Enable Email/Password for the project configured in `firebase.js` and provision Auth users/profiles through the trusted admin service.
2. Review the complete combined rules, including legacy/public reaction permissions, against the desired production policy. Preserve required teacher/admin workflows when changing rules.
3. Test the exact combined rules with the Firestore emulator: profile access, section isolation, published reads, practice create/update/complete, completed-submission restrictions, teacher review, both reaction ID formats, public reads, and owner deletes.
4. Deploy the reviewed rules through the project's established Firebase deployment process. Documentation edits, a Git push, and local tests do not verify or deploy the live rules.
5. Smoke-test sign-in, pending sessions, practice refresh/resume/restart, final submission, reaction edits/comments/source metadata, and submission history using real student and reviewer accounts.

Run `node --test tests/*.test.cjs` for app regression tests. Those tests mock Firestore and do not establish live authorization. No password or service-account secrets belong in these documents or browser storage.
