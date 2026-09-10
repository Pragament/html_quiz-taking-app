# Quiz Activity App

Independent responsive quiz-taking app for students. It verifies a student through existing quiz session records in `classrooms` and `classSections/{sectionId}/students` data, loads quiz-session question-list questions or published question bank questions, runs the quiz from a local in-memory snapshot after Start, and writes attempts to `qb_quiz_submissions_v1`.

## Files

- `index.html` - login, quiz setup, quiz runner, result, and past-submissions navigation.
- `submissions.html` - standalone past-submissions page for the verified student.
- `styles.css` - responsive phone, tablet, and desktop layout.
- `app.js` - Firebase reads/writes, student verification, quiz state, grading, and verified-session storage.
- `submissions.js` - Firebase read and detailed answer review for the standalone past-submissions page.
- `FIRESTORE_SCHEMA.md` - collection and document schema notes.
- `firestore.rules` - starter rules for quiz-related access.

## Flow

1. Student enters quiz session code, `admissionNo`, and full `phone`.
2. On page load, Intro.js prompts for a guided tour unless `quizActivityHideGuidedTour` is saved in local storage. The header Tour button can relaunch it later.
3. App reads `/classrooms/{classCode}` first, then falls back to `classrooms where classCode == enteredCode`.
4. Login continues only when `classEnabled === true`.
5. App reads `/classSections/{sectionId}/students/{admissionNo}` first, then falls back to querying by `admissionNo`.
6. App shows the last 3 digits of the registered phone and verifies the full entered phone.
7. After verification, the Past Submissions button opens a standalone history page and the student session is stored locally so that page can load the verified student's attempts.
8. If the quiz session has `questionBankListId`, the app hides manual filters, hides Load Questions, reads that `qb_lists_v1` document automatically, and loads only its published `questionIds` from `qb_questions_v1`.
9. If the quiz session has `studentDifficultyLevels[admissionNo]`, the app keeps only listed questions matching that student's assigned difficulty. Missing student entries use the quiz session default question selection.
10. If the quiz session also has `randomQuestionTypeCounts`, the app randomly picks up to that many questions per type from the selected list, then shows the picked questions in the list's original order.
11. If the quiz session does not have `questionBankListId`, the student loads published questions from `qb_questions_v1` using the setup filters.
12. After Start, the selected question list is local in memory so navigation continues offline until Submit.
13. Submit writes to `qb_quiz_submissions_v1` using one deterministic submission document per quiz session, section, and admission number.
14. `submissions.html` reads `qb_quiz_submissions_v1` by `studentKey` and shows past submissions newest first, with expandable question-by-question review filtered by All, Correct, Incorrect, or Manual. If `answers[].aiReview` exists, students also see marks, max marks, and the review reason.

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

- Quiz session links can include `?classCode=<quiz-session-code>` or `?code=<quiz-session-code>`; the app shows the quiz session name and asks only for admission number and phone.
- Quiz session links can include `&show-recent=1`; after student verification, the app opens the past-submissions page with the newest submission expanded. For these links, the app also prepopulates the last verified admission number and phone for that quiz session code from local storage.
- MCQ, True/False, and FIB questions are auto-graded.
- Short-answer responses are stored with `isCorrect: null` for teacher review.
- Quiz sessions with `questionBankListId` use the teacher-selected list. If `studentDifficultyLevels` has an entry for the verified admission number, only that difficulty is used. If `randomQuestionTypeCounts` is set, selection is random within each requested type; otherwise every matching listed published question is used.
- Published question reads use `qb_questions_v1 where status == "published"` when no quiz session list is selected.
- Student submission history uses `studentKey = sectionId_admissionNo`.
- A student can have only one submission per quiz session; duplicate attempts are blocked before write.
