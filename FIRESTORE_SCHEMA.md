# Firestore Schema

The quiz app reads existing quiz session/student collections and writes quiz submissions to a prefixed question-bank collection.

## Existing Collections Read By This App

### `classrooms`

Path:

```txt
/classrooms/{classroomId}
```

The app first reads `/classrooms/{enteredClassCode}` directly. If that document does not exist, it queries:

```txt
classrooms where classCode == enteredClassCode
```

Document shape:

```js
{
  classCode: '176260',
  classEnabled: true,
  mode: 'quiz',
  startAt: Timestamp, // optional
  dueAt: Timestamp, // optional
  className: 'DSS grade 8 aug 31 quiz',
  createdBy: '',
  createdDate: 1788177950135,
  creatorId: 'SPwA523UClVxTpX5m8XPMu5Imiy1',
  sectionId: 'QQAP9O4UyvlaYhqz7jdE',
  sectionName: 'DSS grade 8',
  questionBankListId: 'qb_lists_v1 document id',
  randomQuestionTypeCounts: {
    mcq: 10,
    fib: 5,
    short_answer: 3,
    true_false: 2
  },
  studentDifficultyLevels: {
    '102': 'Easy',
    '103': 'Hard'
  },
  studentDifficultyUpdatedAt: Timestamp
}
```

Important fields:

- `classCode` - student-entered quiz session code.
- `classEnabled` - must be exactly `true` for login.
- `mode` - quiz session mode. Practice settings are shown only for `practice`, `reading_practice`, and `writing_practice`.
- `sectionId` - points to the student subcollection.
- `className` and `sectionName` - shown after verification.
- `questionBankListId` - optional reference to a private question list selected by the teacher. When present, the quiz app loads only that quiz session list's published questions in `questionIds` order.
- `randomQuestionTypeCounts` - optional per-type limits for randomly picking questions from the selected question list. Missing or empty means use all listed published questions.
- `studentDifficultyLevels` - optional admission-number keyed difficulty overrides. Missing student entries use the quiz session default question selection.
- `studentDifficultyUpdatedAt` - records when the teacher last changed student difficulty overrides.

Session mode values:

| Stored value | Dropdown label |
| --- | --- |
| `quiz` | Quiz |
| `practice` | Practice |
| `wpt` | WPT - Writing Proficiency Test |
| `rpt` | RPT - Reading Proficiency Test |
| `reading_practice` | Reading Practice |
| `writing_practice` | Writing Practice |

### `classSections/{sectionId}/students`

Path:

```txt
/classSections/{sectionId}/students/{studentDocId}
```

The app first reads `/classSections/{sectionId}/students/{admissionNo}` directly. If that document does not exist, it queries:

```txt
classSections/{sectionId}/students where admissionNo == enteredAdmissionNo
```

Document shape:

```js
{
  admissionNo: '102',
  name: 'Parunandi Sai Adithya',
  phone: '8328303045'
}
```

Important fields:

- `admissionNo` - student-entered admission number.
- `phone` - registered phone. The app shows the first 3 digits as a hint, asks the student for only the first 6 digits, and verifies them against this stored value.
- `name` - saved into quiz submissions as `studentName`.

### `qb_questions_v1`

Path:

```txt
/qb_questions_v1/{questionId}
```

The quiz app reads published questions:

```txt
qb_questions_v1 where status == "published"
```

Supported question types:

- `mcq` - uses `options`, with one or more `correct: true` options.
- `true_false` - uses `trueAnswer`.
- `fib` - uses `fibBanks`, including multiple banks in one question.
- `short_answer` - stores the student response but does not auto-grade.

Optional learning support fields:

- `skill` - LSRW skill. Supported values: `Listening`, `Speaking`, `Reading`, `Writing`.
- `actfl_level` - ACTFL proficiency level. Supported values: `Novice Low`, `Novice Mid`, `Novice High`, `Intermediate Low`, `Intermediate Mid`, `Intermediate High`, `Advanced Low`, `Advanced Mid`, `Advanced High`, `Superior`, `Distinguished`.
- `actfl_sublevel` - ACTFL sublevel. Supported values: `Low`, `Mid`, `High`; leave blank for `Superior` or `Distinguished`.
- `actfl_mode` - ACTFL communication mode. Supported values: `Interpersonal`, `Interpretive`, `Presentational`.
- `explanationUrl` - student-facing topic explanation URL. Step 2 can filter to questions with this field. Practice modes embed the URL in a collapsible, resizable panel.
- `explanation` - explanation text shown in the instant feedback panel when Step 2 instant feedback is enabled.
- Short-answer instant feedback stores an `aiReview` object on the submitted answer with offline marks, max marks, and the reason for the awarded points.

### `qb_lists_v1`

Path:

```txt
/qb_lists_v1/{listId}
```

Document shape:

```js
{
  name: 'Favorites',
  ownerUid: 'firebase-auth-uid',
  questionIds: [
    'qb_questions_v1 document id'
  ],
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Important fields:

- `ownerUid` - must match the signed-in teacher UID for the list to appear in the quiz session editor.
- `name` - shown in the quiz session question-list dropdown.
- `questionIds` - stores question document IDs, not embedded question snapshots. The student quiz app preserves this order when a quiz session references the list.

## Collection Written By This App

### `qb_quiz_submissions_v1`

Path:

```txt
/qb_quiz_submissions_v1/{submissionId}
```

New submissions use a deterministic ID:

```txt
encodeURIComponent(classroomId)__encodeURIComponent(sectionId)__encodeURIComponent(admissionNo)
```

That gives each admission number at most one submission within a quiz session.

Document shape:

```js
{
  classroomId: '176260',
  sectionId: 'QQAP9O4UyvlaYhqz7jdE',
  admissionNo: '102',
  studentName: 'Parunandi Sai Adithya',
  studentKey: 'QQAP9O4UyvlaYhqz7jdE_102',

  className: 'IX',
  subject: 'Mathematics',
  chapters: ['Algebra', 'Polynomials'],
  difficulty: 'Easy',

  questionCount: 10,
  answeredCount: 8,
  gradableCount: 7,
  correctCount: 5,

  answers: [
    {
      questionId: 'question-doc-id',
      type: 'mcq',
      promptHtml: '<p>Question snapshot</p>',
      displayAnswer: 'Option A',
      isCorrect: true,
      correctAnswer: 'Option A',
      selectedOptions: [0],
      fibAnswers: [],
      trueFalseAnswer: null,
      shortAnswer: ''
    }
  ],

  submittedAt: Timestamp,
  submittedAtMillis: 1788264300000
}
```

Field notes:

- `studentKey` is `${sectionId}_${admissionNo}` and is used to load the student's past submissions.
- `submissionId` is deterministic for new writes so duplicate attempts from the same admission number in the same quiz session are blocked.
- `answers` stores question and answer snapshots so review still works if the question bank changes later.
- `isCorrect` is `true` or `false` for MCQ, True/False, and FIB. It is `null` for short answers.
- `submittedAt` is a server timestamp.
- `submittedAtMillis` is a device timestamp used for newest-first client sorting.

Assigned sessions in `practice`, `reading_practice`, and `writing_practice` modes also use this same document ID for saved progress before submission. Progress documents include `practiceProgress: true`, `progressVersion: 1`, `status: 'in_progress' | 'paused'`, `currentIndex`, `updatedAtMillis`, and `practiceState` (a JSON string containing question snapshots, raw answers, feedback, settings, elapsed time, and serialized AI memory Maps/Sets). Progress autosaves when answers change or questions advance; Pause saves before returning to the dashboard. Resume restores the stored question order and state rather than selecting questions again.

Unfinished progress is excluded from pending-session completion checks, submission history, reports, and past-performance memory. Final submission replaces the progress document with the completed submission shape above, which remains immutable. Homepage practice does not write progress. A browser backup scoped by authenticated user and session recovers edits made just before refresh while the cloud autosave was pending.

Merge and deploy the practice-draft create/update rules in `firestore.rules` with the existing production rules before enabling cloud pause/resume. They permit updates only to the owner's unfinished assigned practice document and allow a single transition to completed submission; completed submissions cannot be overwritten.

## Query Patterns

- Quiz session direct read: `/classrooms/{classCode}`
- Quiz session fallback query: `classrooms where classCode == enteredCode`
- Student direct read: `/classSections/{sectionId}/students/{admissionNo}`
- Student fallback query: `students where admissionNo == enteredAdmissionNo`
- Question list direct read: `/qb_lists_v1/{questionBankListId}`
- Listed question direct reads: `/qb_questions_v1/{questionId}` for each list `questionIds` entry
- Question read: `qb_questions_v1 where status == "published"`
- Submission history: `qb_quiz_submissions_v1 where studentKey == verifiedStudentKey`

## Suggested Indexes

The current app keeps sorting and most filtering client-side. Optional future indexes:

```txt
classrooms:
  classCode ASC

classSections/{sectionId}/students:
  admissionNo ASC

qb_questions_v1:
  status ASC

qb_quiz_submissions_v1:
  studentKey ASC
  submittedAtMillis DESC
```

## Authenticated student dashboard

The student homepage uses Firebase Authentication Email/Password and directly reads
`studentProfiles/{currentUser.uid}`. Profiles must contain matching `authUid`,
`active: true`, `sectionId`, string `admissionNo`, `studentName`, and
`studentKey = sectionId_admissionNo`, as provisioned by the admin account service.
No roster queries or phone verification are used by the student app.

The dashboard queries `classrooms where sectionId == profile.sectionId`, excludes
sessions with `classEnabled !== true` or `archived === true`, and sorts client-side
by `createdAt`, falling back to `createdDate`. This uses the single-field sectionId
index. Selecting a session rechecks its section and availability before quiz setup.

New `qb_quiz_submissions_v1` documents additionally include `authUid` and `email`.
Submission IDs retain the existing session/section/admission format. History and
duplicate checks query the authenticated profile's `studentKey` to preserve access
to historical submissions. The sample rules authorize these reads against the
active profile and constrain new submission identity fields to that profile.

Merge the sample student rules with existing teacher/admin rules before deployment.

Quiz session cards display optional `classrooms.startAt` and `classrooms.dueAt`
as date and time in the student's browser locale. Missing values display
"Not scheduled" and "No due date", respectively. These fields are informational
on the dashboard; session access continues to follow enabled and archived state.
