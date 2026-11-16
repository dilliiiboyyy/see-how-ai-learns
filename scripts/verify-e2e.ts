import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const BASE = 'http://127.0.0.1:3000';

async function main() {
  const html = await fetch(BASE).then((r) => r.text());
  assert.ok(html.includes('<title>See How AI Learns.</title>'), 'HTML title must match');

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  assert.equal(health.ok, true, 'Health endpoint must return ok: true');

  const status = await fetch(`${BASE}/api/firebase/status`).then((r) => r.json());
  assert.equal(status.categories.length, 12, 'Must have 12 built-in categories');

  // 1. Verify Protected Educator API rejects unauthenticated access
  const adminUnauth = await fetch(`${BASE}/api/admin/overview`);
  assert.equal(adminUnauth.status, 401, 'Educator overview must reject unauthenticated callers');

  // 2. Start Participant Session A
  const startA = await fetch(`${BASE}/api/sessions/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'Participant Alpha' }),
  }).then((r) => r.json());
  assert.ok(startA.session?.sessionId && startA.sessionToken, 'Session A must issue ID and token');

  const headersA = {
    'x-session-id': startA.session.sessionId,
    'x-session-token': startA.sessionToken,
  };

  // 3. Session A upload validation: blank rejected (422), crisp image accepted (201)
  const blankImg = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 240, g: 240, b: 240 } },
  })
    .jpeg()
    .toBuffer();
  const blankForm = new FormData();
  blankForm.append('image', new Blob([new Uint8Array(blankImg)], { type: 'image/jpeg' }), 'blank.jpg');
  blankForm.append('categorySlug', 'cups');
  const blankRes = await fetch(`${BASE}/api/sessions/upload`, {
    method: 'POST',
    headers: headersA,
    body: blankForm,
  });
  assert.equal(blankRes.status, 422, 'Blank image must be rejected with 422');

  const svgTexture = `<svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
    <rect width="320" height="320" fill="#F4F1EA"/>
    <circle cx="160" cy="160" r="90" fill="#AD7961" stroke="#292820" stroke-width="6"/>
    <circle cx="160" cy="160" r="65" fill="#E7E1D5" stroke="#777C61" stroke-width="4"/>
    <path d="M250 130 C285 130, 285 190, 250 190" fill="none" stroke="#292820" stroke-width="8"/>
    <line x1="40" y1="60" x2="280" y2="60" stroke="#777469" stroke-width="2"/>
  </svg>`;
  const validImg = await sharp(Buffer.from(svgTexture)).jpeg({ quality: 92 }).toBuffer();
  const formA = new FormData();
  formA.append('image', new Blob([new Uint8Array(validImg)], { type: 'image/jpeg' }), 'cup-e2e.jpg');
  formA.append('categorySlug', 'cups');
  formA.append('categoryName', 'Cup');
  const upA = await fetch(`${BASE}/api/sessions/upload`, {
    method: 'POST',
    headers: headersA,
    body: formA,
  });
  assert.equal(upA.status, 201, 'Valid image in Session A must return 201');
  const upAData = await upA.json();
  assert.ok(upAData.image.storagePath.startsWith(`session-uploads/${startA.session.sessionId}/`));

  // Signed image URL must work for Session A, and unsigned access must fail (403)
  const signedRes = await fetch(`${BASE}${upAData.image.url}`);
  assert.equal(signedRes.status, 200, 'Signed session image URL must resolve');
  const unsignedPath = upAData.image.url.split('?')[0];
  const unsignedRes = await fetch(`${BASE}${unsignedPath}`);
  assert.equal(unsignedRes.status, 403, 'Unsigned session image path must be blocked (403)');

  // 4. Session A saves a session model, logs prediction, and shares de-identified feedback
  const mdlRes = await fetch(`${BASE}/api/sessions/models`, {
    method: 'POST',
    headers: { ...headersA, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Alpha Session Classifier',
      projectId: 'proj_alpha',
      categories: ['Pen', 'Cup'],
      datasetSize: 12,
      accuracy: 0.92,
      valAccuracy: 0.88,
      testAccuracy: 0.87,
      precision: 0.88,
      recall: 0.86,
      latencyMs: 12.1,
    }),
  });
  assert.equal(mdlRes.status, 201, 'Saving session model must succeed');

  const predRes = await fetch(`${BASE}/api/sessions/predictions`, {
    method: 'POST',
    headers: { ...headersA, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'smdl_alpha',
      modelName: 'Alpha Session Classifier',
      predictedLabel: 'Cup',
      confidence: 0.91,
      isUnknown: false,
    }),
  });
  assert.equal(predRes.status, 201);

  const fbBefore = await fetch(`${BASE}/api/autonomous/status`).then((r) => r.json());
  const fbRes = await fetch(`${BASE}/api/sessions/feedback`, {
    method: 'POST',
    headers: { ...headersA, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'mdl_builtin_reference',
      predictedLabel: 'Pen',
      predictedConfidence: 0.68,
      isCorrect: false,
      correctedCategory: 'Pencil',
      approveForShared: true,
    }),
  });
  assert.equal(fbRes.status, 201);
  const fbAfter = await fetch(`${BASE}/api/autonomous/status`).then((r) => r.json());
  assert.equal(
    fbAfter.sharedFeedbackCount,
    fbBefore.sharedFeedbackCount + 1,
    'Approved de-identified feedback must increment sharedFeedbackCount',
  );

  // 5. Start Participant Session B and verify strict isolation
  const startB = await fetch(`${BASE}/api/sessions/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'Participant Beta' }),
  }).then((r) => r.json());
  const headersB = {
    'x-session-id': startB.session.sessionId,
    'x-session-token': startB.sessionToken,
  };

  // Cross-session access check
  const crossCheck = await fetch(`${BASE}/api/sessions/current`, {
    headers: { 'x-session-id': startA.session.sessionId, 'x-session-token': startB.sessionToken },
  });
  assert.equal(crossCheck.status, 403, 'Session B token must be rejected when accessing Session A');

  // Session B models list must NOT contain Alpha Session Classifier
  const modelsB = await fetch(`${BASE}/api/models`, { headers: headersB }).then((r) => r.json());
  assert.equal(modelsB.sessionModels.length, 0, 'Session B must have 0 session models');
  assert.equal(
    modelsB.models.some((m: { name: string }) => m.name === 'Alpha Session Classifier'),
    false,
    'Session A private model must never appear in Session B',
  );

  // 6. Finish Session A and verify automatic file & workspace cleanup + shared preservation
  const finishA = await fetch(`${BASE}/api/sessions/finish`, {
    method: 'POST',
    headers: headersA,
  }).then((r) => r.json());
  assert.equal(finishA.ok, true, 'Finish Session A must succeed');
  assert.equal(finishA.summary.nickname, 'Participant Alpha', 'Completed summary must preserve participant nickname');
  assert.equal(finishA.summary.predictionsCount, 1);
  assert.equal(finishA.summary.modelsTrained, 1);

  const sessionAUploadDir = path.resolve(process.cwd(), '.data', 'storage', 'session-uploads', startA.session.sessionId);
  let dirExists = true;
  try {
    await fs.access(sessionAUploadDir);
  } catch {
    dirExists = false;
  }
  assert.equal(dirExists, false, 'Session A temporary upload directory must be removed after Finish Session');

  const afterFinishA = await fetch(`${BASE}/api/sessions/current`, { headers: headersA });
  assert.equal(afterFinishA.status, 401, 'Finished session token must be invalidated');

  const fbPostFinish = await fetch(`${BASE}/api/autonomous/status`).then((r) => r.json());
  assert.equal(
    fbPostFinish.sharedFeedbackCount,
    fbAfter.sharedFeedbackCount,
    'Shared de-identified feedback must remain preserved after session reset',
  );

  const statusAfter = await fetch(`${BASE}/api/firebase/status`).then((r) => r.json());
  assert.ok(statusAfter.totalImages >= 600, 'Built-in dataset must remain untouched after session reset');

  // Clean up Session B
  await fetch(`${BASE}/api/sessions/finish`, { method: 'POST', headers: headersB });

  console.log('ALL EDEX MULTI-PARTICIPANT E2E ASSERTIONS PASSED:', {
    sessionA: startA.session.sessionId,
    sessionB: startB.session.sessionId,
    adminProtected: true,
    crossSessionBlocked: true,
    sessionUploadCleanedOnDisk: true,
    sharedFeedbackPreserved: fbPostFinish.sharedFeedbackCount,
    builtInImagesIntact: statusAfter.totalImages,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
