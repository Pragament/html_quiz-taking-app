# Quiz Activity App

Independent responsive quiz-taking app for students. It verifies a student through existing `classrooms` and `classSections/{sectionId}/students` data, loads published question bank questions, runs the quiz from a local in-memory snapshot after Start, and writes attempts to `qb_quiz_submissions_v1`.

## Files

- `index.html` - login, quiz setup, quiz runner, result, and submission history views.
- `styles.css` - responsive phone, tablet, and desktop layout.
- `app.js` - Firebase reads/writes, student verification, quiz state, grading, and submission history.
- `FIRESTORE_SCHEMA.md` - collection and document schema notes.
- `firestore.rules` - starter rules for quiz-related access.

## Flow

1. Student enters `classCode`, `admissionNo`, and full `phone`.
2. App reads `/classrooms/{classCode}` first, then falls back to `classrooms where classCode == enteredCode`.
3. Login continues only when `classEnabled === true`.
4. App reads `/classSections/{sectionId}/students/{admissionNo}` first, then falls back to querying by `admissionNo`.
5. App shows the last 3 digits of the registered phone and verifies the full entered phone.
6. Student loads published questions from `qb_questions_v1`.
7. After Start, the selected/shuffled question list is local in memory so navigation continues offline until Submit.
8. Submit writes to `qb_quiz_submissions_v1`.
9. App reads `qb_quiz_submissions_v1` by `studentKey` and shows past submissions newest first.

## Run Locally

From the repository root:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/quiz-taking-app/
```

The app loads Firebase, KaTeX, and Mermaid from CDNs, so internet is required for first load and Firestore operations.

## Notes

- MCQ, True/False, and FIB questions are auto-graded.
- Short-answer responses are stored with `isCorrect: null` for teacher review.
- Published question reads use `qb_questions_v1 where status == "published"`.
- Student submission history uses `studentKey = sectionId_admissionNo`.
