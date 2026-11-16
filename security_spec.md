# Security Specification — See How AI Learns.

## 1. Data Invariants
1. **User Isolation & PII Protection**: `users/{userId}` contains email and profile data and is readable/writable strictly by `request.auth.uid == userId` or verified admin. No blanket `isSignedIn()` reads.
2. **Built-In Dataset Immutability**: `categories` with `isBuiltIn == true` and `images` with `datasetType == 'built-in'` or `'autonomous'` cannot be created, modified, or deleted by ordinary users. Only verified admin (`dilshaanmuhvp@gmail.com` with `email_verified == true` or `admins/{uid}`) may mutate built-in catalog data.
3. **Project & Model Ownership**: `projects`, `datasets`, `models`, `modelVersions`, `trainingJobs`, and `userCorrections` strictly enforce `ownerId == request.auth.uid` on create and `incoming().ownerId == existing().ownerId` on update.
4. **Parent Existence (No Orphaned Records)**: Creating a `datasets` or `models` document requires `exists()` on the referenced `projects/{projectId}` owned by the user; creating a `modelVersions` document requires `exists()` on `models/{modelId}` owned by the user.
5. **Terminal State Locking**: Once a `trainingJobs` document reaches `status == 'completed'` or `'failed'`, ordinary users cannot update it again.
6. **Temporal Integrity & Path Hardening**: Every single-document operation validates `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars). `createdAt` and `updatedAt` are strictly validated against `request.time`.
7. **Zero Shadow Fields**: Every collection uses `keys().hasAll(...)` and `keys().hasOnly(...)` inside `isValid[Entity]()` plus `affectedKeys().hasOnly(...)` on every update action branch.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Write**: Creating a `projects` doc without `request.auth`.
2. **Identity Spoofing**: Creating a `projects` doc with `ownerId: "victim-uid"` while signed in as `"attacker-uid"`.
3. **Privilege Escalation on Signup**: Creating `users/{uid}` with `role: "admin"` instead of `"learner"`.
4. **Built-In Dataset Tampering**: Ordinary user updating or deleting a `built-in` image in `/images/{imageId}`.
5. **Shadow / Ghost Field Injection**: Creating a `models` doc with an unlisted field `isVerified: true`.
6. **ID Poisoning**: Creating `/projects/aaa...200chars...` exceeding 128 characters or containing `$`/`/`.
7. **Cross-Owner List Scraping**: Listing `/projects` without `where('ownerId', '==', uid)` or querying another user's private project.
8. **PII Read Leak**: Authenticated user A reading `/users/{userB}`.
9. **Timestamp Forgery**: Creating a `userCorrections` doc with backdated `createdAt` (`!= request.time`).
10. **Immutable Field Overwrite**: Updating a `projects` doc to change `ownerId` or `createdAt`.
11. **Terminal State Bypass**: Updating a `trainingJobs` doc whose existing `status` is `'completed'` back to `'running'`.
12. **Unverified Admin Email Spoof**: Request with `email == 'dilshaanmuhvp@gmail.com'` where `email_verified == false` attempting to mutate `systemSettings`.
