# Firestore Schema

The quiz app reads existing classroom/student collections and writes quiz submissions to a prefixed question-bank collection.

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
  }
}
```

Important fields:

- `classCode` - student-entered code.
- `classEnabled` - must be exactly `true` for login.
- `sectionId` - points to the student subcollection.
- `className` and `sectionName` - shown after verification.
- `questionBankListId` - optional reference to a private question list selected by the teacher. When present, the quiz app loads only that list's published questions in `questionIds` order.
- `randomQuestionTypeCounts` - optional per-type limits for randomly picking questions from the selected question list. Missing or empty means use all listed published questions.

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
- `phone` - registered phone. The app shows the last 3 digits as a hint and verifies the full entered number.
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

- `ownerUid` - must match the signed-in teacher UID for the list to appear in the classroom editor.
- `name` - shown in the classroom question-list dropdown.
- `questionIds` - stores question document IDs, not embedded question snapshots. The student quiz app preserves this order when a classroom references the list.

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

That gives each admission number at most one submission within a classroom.

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
- `submissionId` is deterministic for new writes so duplicate attempts from the same admission number in the same classroom are blocked.
- `answers` stores question and answer snapshots so review still works if the question bank changes later.
- `isCorrect` is `true` or `false` for MCQ, True/False, and FIB. It is `null` for short answers.
- `submittedAt` is a server timestamp.
- `submittedAtMillis` is a device timestamp used for newest-first client sorting.

## Query Patterns

- Classroom direct read: `/classrooms/{classCode}`
- Classroom fallback query: `classrooms where classCode == enteredCode`
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
