# Quiz Activity App

Independent responsive quiz-taking app for students. It verifies a student through existing `classrooms` and `classSections/{sectionId}/students` data, loads classroom question-list questions or published question bank questions, runs the quiz from a local in-memory snapshot after Start, and writes attempts to `qb_quiz_submissions_v1`.

## Files

- `index.html` - login, quiz setup, quiz runner, result, and past-submissions navigation.
- `submissions.html` - standalone past-submissions page for the verified student.
- `styles.css` - responsive phone, tablet, and desktop layout.
- `app.js` - Firebase reads/writes, student verification, quiz state, grading, and verified-session storage.
- `submissions.js` - Firebase read and detailed answer review for the standalone past-submissions page.
- `FIRESTORE_SCHEMA.md` - collection and document schema notes.
- `firestore.rules` - starter rules for quiz-related access.

## Flow

1. Student enters `classCode`, `admissionNo`, and full `phone`.
2. On page load, Intro.js prompts for a guided tour unless `quizActivityHideGuidedTour` is saved in local storage. The header Tour button can relaunch it later.
3. App reads `/classrooms/{classCode}` first, then falls back to `classrooms where classCode == enteredCode`.
4. Login continues only when `classEnabled === true`.
5. App reads `/classSections/{sectionId}/students/{admissionNo}` first, then falls back to querying by `admissionNo`.
6. App shows the last 3 digits of the registered phone and verifies the full entered phone.
7. After verification, the Past Submissions button opens a standalone history page and the student session is stored locally so that page can load the verified student's attempts.
8. If the classroom has `questionBankListId`, the app hides manual filters, hides Load Questions, reads that `qb_lists_v1` document automatically, and loads only its published `questionIds` from `qb_questions_v1` in list order.
9. If the classroom does not have `questionBankListId`, the student loads published questions from `qb_questions_v1` using the setup filters.
10. After Start, the selected question list is local in memory so navigation continues offline until Submit.
11. Submit writes to `qb_quiz_submissions_v1`.
12. `submissions.html` reads `qb_quiz_submissions_v1` by `studentKey` and shows past submissions newest first, with expandable question-by-question review filtered by All, Correct, Incorrect, or Manual.

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

- Classroom links can include `?classCode=<class-code>` or `?code=<class-code>`; the app shows the classroom name and asks only for admission number and phone.
- MCQ, True/False, and FIB questions are auto-graded.
- Short-answer responses are stored with `isCorrect: null` for teacher review.
- Classrooms with `questionBankListId` use the teacher-selected list order and do not shuffle questions.
- Published question reads use `qb_questions_v1 where status == "published"` when no classroom list is selected.
- Student submission history uses `studentKey = sectionId_admissionNo`.
