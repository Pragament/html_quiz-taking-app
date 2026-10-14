# Firebase Auth Student Login Plan

The student app now implements the Firebase email/password login and section dashboard. Enable Email/Password, provision student profiles, and merge/deploy the sample student rules before rollout.

This document describes the production login model for the student quiz app.

## Goal

Use Firebase Authentication email/password accounts for students:

- Username: student school email ID.
- Password: set by an admin from a separate admin app.
- Student app: login only.
- Student app: no registration, no password creation, and no student self-service account creation.

This replaces the current quiz-session code + admission number + phone-prefix verification flow when the app is migrated to authenticated access.

## Recommended Data Model

Create one profile document per Firebase Auth user:

```txt
/studentProfiles/{authUid}
```

Example:

```js
{
  authUid: 'firebase-auth-uid',
  email: 'student@school.edu',
  sectionId: 'QQAP9O4UyvlaYhqz7jdE',
  admissionNo: '102',
  studentKey: 'QQAP9O4UyvlaYhqz7jdE_102',
  studentName: 'Student Name',
  active: true,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Optionally also keep the Auth UID on the existing student record:

```txt
/classSections/{sectionId}/students/{studentId}
```

```js
{
  admissionNo: '102',
  name: 'Student Name',
  email: 'student@school.edu',
  authUid: 'firebase-auth-uid',
  studentKey: 'QQAP9O4UyvlaYhqz7jdE_102'
}
```

The top-level `studentProfiles/{authUid}` document is preferred for the student app because it lets the app read the signed-in student's profile directly without querying student PII collections.

## Admin Responsibilities

The admin app should:

1. Create Firebase Auth email/password users.
2. Set or reset student passwords.
3. Create or update `studentProfiles/{authUid}`.
4. Optionally link `authUid` back to `classSections/{sectionId}/students/{studentId}`.
5. Disable Auth users and/or set `active: false` when access should be revoked.

The student app should not call Firebase Auth account creation APIs.

## Student App Login Flow

1. Student enters school email and password.
2. App signs in with Firebase Auth email/password.
3. App reads `/studentProfiles/{currentUser.uid}`.
4. App uses profile fields for:
   - `sectionId`
   - `admissionNo`
   - `studentKey`
   - `studentName`
5. Quiz sessions and submissions use the authenticated profile instead of trusting typed admission/phone values.

Example client login:

```js
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

const auth = getAuth();
const credential = await signInWithEmailAndPassword(auth, email, password);

const profileSnap = await getDoc(doc(db, 'studentProfiles', credential.user.uid));
if (!profileSnap.exists() || profileSnap.data().active !== true) {
  throw new Error('Student profile is not active.');
}

const profile = profileSnap.data();
```

## Submission Changes

Add `authUid` and `email` to each submission:

```js
{
  authUid: 'firebase-auth-uid',
  email: 'student@school.edu',
  sectionId: 'QQAP9O4UyvlaYhqz7jdE',
  admissionNo: '102',
  studentKey: 'QQAP9O4UyvlaYhqz7jdE_102',
  studentName: 'Student Name'
}
```

Use a deterministic submission ID that includes the quiz session and Auth UID, for example:

```txt
encodeURIComponent(classroomId)__encodeURIComponent(authUid)
```

or keep the existing shape if `studentKey` remains stable:

```txt
encodeURIComponent(classroomId)__encodeURIComponent(sectionId)__encodeURIComponent(admissionNo)
```

## Firestore Rules Direction

Production rules should rely on `request.auth`, not client-entered admission numbers.

Example:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isSelf(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    function isTeacher() {
      return signedIn() && request.auth.token.role in ['teacher', 'admin'];
    }

    match /studentProfiles/{uid} {
      allow read: if isSelf(uid);
      allow write: if isTeacher();
    }

    match /qb_taxonomy_v1/{docId} {
      allow read: if signedIn();
      allow write: if isTeacher();
    }

    match /classrooms/{classroomId} {
      allow read: if signedIn() && resource.data.classEnabled == true;
      allow write: if isTeacher();
    }

    match /classSections/{sectionId}/students/{studentId} {
      // Student app should not need this after studentProfiles is available.
      allow read, write: if isTeacher();
    }

    match /qb_questions_v1/{questionId} {
      allow read: if signedIn()
        && resource.data.status == 'published'
        && resource.data.verified == true;
      allow write: if isTeacher();
    }

    match /qb_lists_v1/{listId} {
      allow read: if signedIn();
      allow write: if isTeacher();
    }

    match /qb_quiz_submissions_v1/{submissionId} {
      allow create: if signedIn()
        && request.resource.data.authUid == request.auth.uid;

      allow read: if signedIn()
        && resource.data.authUid == request.auth.uid;

      allow update, delete: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Migration Checklist

1. Enable Email/Password sign-in in Firebase Authentication.
2. Build or update the admin app to create Auth users.
3. Backfill `studentProfiles/{authUid}` for existing students.
4. Change student app login UI to email/password only.
5. Replace local verified-session storage with Firebase Auth session state.
6. Load profile from `studentProfiles/{authUid}` after login.
7. Include `authUid` in submissions.
8. Update submission history queries to use `authUid` or authenticated `studentKey`.
9. Deploy stricter Firestore rules.
10. Remove direct student PII reads from the student app.

## Notes

- Do not use phone number as a password.
- Do not store plain-text passwords in Firestore.
- Admin password reset should happen through Firebase Auth or the Firebase Admin SDK.
- Consider requiring school-managed email domains if all student emails share a domain.
- Consider adding App Check after Auth migration to reduce abuse from non-app clients.
