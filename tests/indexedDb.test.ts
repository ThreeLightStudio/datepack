import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatePack, type DatePlan, type LegacyDatePack } from '@datepack/core';
import {
  closeStorage,
  commitPlanChange,
  commitUndo,
  commitExperienceChange,
  getAssetBlob,
  deletePack,
  listPackAssetBlobs,
  listPacks,
  loadDeviceState,
  loadPack as loadAnyPack,
  saveDeviceState,
  saveImportedPack,
  savePack,
  saveRuntimeAndAdvanceContext,
  loadRuntime,
  getCurrentPackId,
  savePackWithPendingRequest,
  savePendingRequest,
  saveDeviceFields,
} from '../src/storage/indexedDb';
import { openDB } from 'idb';

async function clearDatabase(): Promise<void> {
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database blocked'));
  });
}

beforeEach(clearDatabase);
afterEach(closeStorage);

describe('device IndexedDB persistence', () => {
  it('does not overwrite a runtime context changed while a one-shot GPS request was pending', async () => {
    const pack = createDatePack({ title: 'GPS context race' });
    await savePack(pack);
    await saveRuntimeAndAdvanceContext({
      planId: pack.plan.id,
      updatedAt: '2026-10-01T07:40:00Z',
      events: {},
    });
    await expect(
      saveDeviceFields(
        pack.plan.id,
        {
          liveContext: {
            planId: pack.plan.id,
            revision: 1,
            updatedAt: '2026-10-01T07:41:00Z',
            place: 'Stale GPS result',
          },
        },
        0,
        undefined,
        0,
      ),
    ).rejects.toThrow('context-revision-conflict');
    expect((await loadDeviceState(pack.plan.id)).contextRevision).toBe(1);
    expect((await loadDeviceState(pack.plan.id)).liveContext).toBeUndefined();
  });
  it('strips exact GPS coordinates at every device write and excludes device context from portable packs', async () => {
    const pack = createDatePack({ title: 'Private origin' });
    await savePack(pack);
    const attempt = {
      attemptedAt: '2026-10-01T07:40:00Z',
      status: 'success' as const,
      observation: {
        source: 'gps' as const,
        observedAt: '2026-10-01T07:40:00Z',
        coarseLabel: 'Seoul',
        coordinate: { lat: 37.563214, lon: 126.987654, accuracyMeters: 5 },
      },
    };
    const liveContext = {
      planId: pack.plan.id,
      revision: 1,
      updatedAt: attempt.attemptedAt,
      gpsConsent: true,
      locationAttempt: attempt,
    };
    await saveDeviceFields(pack.plan.id, { liveContext });
    await closeStorage();
    const saved = await loadDeviceState(pack.plan.id);
    expect(JSON.stringify(saved)).not.toMatch(/37\.563214|126\.987654|coordinate|accuracy/);
    expect(saved.liveContext?.locationAttempt?.observation?.observedAt).toBe(attempt.attemptedAt);
    await saveDeviceState({ ...saved, liveContext });
    const rawDb = await openDB('datepack');
    expect(JSON.stringify(await rawDb.get('device', pack.plan.id))).not.toMatch(
      /37\.563214|126\.987654|coordinate|accuracy/,
    );
    rawDb.close();
    expect(JSON.stringify(await loadPack(pack.plan.id))).not.toMatch(
      /gpsConsent|locationAttempt|37\.563214/,
    );
  });
  it('saves a memory and its image blob atomically across a storage restart', async () => {
    const pack = createDatePack({ title: 'Later memories', date: '2026-09-25' });
    await savePack(pack);
    const asset = { id: 'memory-photo', filename: 'memory.jpg', mimeType: 'image/jpeg' };
    const blob = new Blob(['image bytes'], { type: 'image/jpeg' });
    const experience = {
      id: 'memory-1',
      title: 'A place we found',
      outcome: 'note' as const,
      recordedAt: '2026-09-29T00:10:00.000Z',
      occurredOn: '2026-09-25',
      assetIds: [asset.id],
    };

    await commitExperienceChange(pack.plan.id, 0, [experience], [asset], [{ asset, blob }]);
    const rejectedAsset = { id: 'stale-photo', filename: 'stale.jpg', mimeType: 'image/jpeg' };
    await expect(
      commitExperienceChange(
        pack.plan.id,
        0,
        [...pack.experiences, { ...experience, id: 'stale-memory', assetIds: [rejectedAsset.id] }],
        [...pack.assets, rejectedAsset],
        [{ asset: rejectedAsset, blob }],
      ),
    ).rejects.toThrow('revision-conflict');
    expect(await getAssetBlob(pack.plan.id, rejectedAsset.id)).toBeUndefined();
    await closeStorage();

    expect((await loadPack(pack.plan.id))?.experiences).toEqual([experience]);
    expect(await getAssetBlob(pack.plan.id, asset.id)).toMatchObject({
      type: 'image/jpeg',
      size: blob.size,
    });
  });

  it('creates an empty AI draft and its fully identified request in one restart-safe transaction', async () => {
    const pack = createDatePack({ title: 'New date' });
    const generatedAt = '2026-09-29T10:00:00.000Z';
    const request = {
      id: 'create-request',
      planId: pack.plan.id,
      kind: 'create' as const,
      status: 'ready' as const,
      input: 'request text',
      baseRevision: 0,
      contextRevision: 0,
      generatedAt,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };
    await savePackWithPendingRequest(pack, request);
    await closeStorage();
    expect(await getCurrentPackId()).toBe(pack.plan.id);
    expect((await loadPack(pack.plan.id))?.plan.events).toEqual([]);
    expect((await loadDeviceState(pack.plan.id)).pendingRequest).toMatchObject({
      id: request.id,
      planId: pack.plan.id,
      kind: 'create',
      baseRevision: 0,
      contextRevision: 0,
      generatedAt,
    });
  });

  it('commits plan and undo atomically and rejects a concurrent stale revision', async () => {
    const initial = createDatePack({ title: 'Test', date: '2026-09-29' });
    await savePack(initial);
    const a: DatePlan = { ...initial.plan, title: 'Tab A' };
    const b: DatePlan = { ...initial.plan, title: 'Tab B' };
    const results = await Promise.allSettled([
      commitPlanChange(initial, 0, 'A', a),
      commitPlanChange(initial, 0, 'B', b),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const saved = await loadPack(initial.plan.id);
    expect(saved?.revision).toBe(1);
    const device = await loadDeviceState(initial.plan.id);
    expect(device.undoStack).toHaveLength(1);

    const invalidClonePlan = { ...saved!.plan, transient: () => 'not cloneable' } as DatePlan;
    const asset = { id: 'test-image', filename: 'image.png', mimeType: 'image/png' };
    await expect(
      commitPlanChange(
        initial,
        1,
        'broken',
        invalidClonePlan,
        [asset],
        [{ asset, blob: new Blob(['data'], { type: 'image/png' }) }],
      ),
    ).rejects.toBeTruthy();
    expect((await loadPack(initial.plan.id))?.revision).toBe(1);
    expect((await loadDeviceState(initial.plan.id)).undoStack).toHaveLength(1);
    expect(await getAssetBlob(initial.plan.id, asset.id)).toBeUndefined();
  });

  it('atomically commits an approved AI plan and marks its request applied', async () => {
    const pack = createDatePack({ title: 'AI transaction', date: '2026-09-29' });
    await savePack(pack);
    await saveDeviceState({
      planId: pack.plan.id,
      undoStack: [],
      liveContext: { planId: pack.plan.id, revision: 7, updatedAt: '2026-09-29T00:00:00Z' },
      pendingRequest: {
        id: 'request-ai',
        planId: pack.plan.id,
        kind: 'remaining-change',
        status: 'review',
        input: 'request',
        answerText: 'answer',
        responseFingerprint: 'fingerprint',
        baseRevision: 0,
        contextRevision: 7,
        generatedAt: '2026-09-29T00:00:00Z',
        createdAt: '2026-09-29T00:00:00Z',
        updatedAt: '2026-09-29T00:01:00Z',
      },
    });
    const requestUpdate = {
      id: 'request-ai',
      planId: pack.plan.id,
      kind: 'remaining-change' as const,
      status: 'applied' as const,
      input: 'request',
      answerText: 'answer',
      responseFingerprint: 'fingerprint',
      baseRevision: 0,
      contextRevision: 7,
      generatedAt: '2026-09-29T00:00:00Z',
      createdAt: '2026-09-29T00:00:00Z',
      updatedAt: '2026-09-29T00:02:00Z',
    };
    await expect(
      commitPlanChange(
        pack,
        0,
        'Expired route',
        { ...pack.plan, title: 'Rejected' },
        undefined,
        [],
        {
          requestId: 'request-ai',
          kind: 'remaining-change',
          baseRevision: 0,
          contextRevision: 7,
          generatedAt: requestUpdate.generatedAt,
          responseFingerprint: 'fingerprint',
          answerText: 'answer',
          requestUpdate,
          validateImpact: () => false,
        },
      ),
    ).rejects.toThrow('route-impact-conflict');
    expect((await loadPack(pack.plan.id))?.revision).toBe(0);
    expect((await loadDeviceState(pack.plan.id)).pendingRequest?.status).toBe('review');
    expect((await loadDeviceState(pack.plan.id)).undoStack).toHaveLength(0);
    await commitPlanChange(
      pack,
      0,
      'AI change',
      { ...pack.plan, title: 'Reviewed' },
      undefined,
      [],
      {
        requestId: 'request-ai',
        kind: 'remaining-change',
        baseRevision: 0,
        contextRevision: 7,
        generatedAt: '2026-09-29T00:00:00Z',
        responseFingerprint: 'fingerprint',
        answerText: 'answer',
        requestUpdate,
        validateImpact: (before) => before.title === pack.plan.title,
      },
    );
    expect((await loadPack(pack.plan.id))?.plan.title).toBe('Reviewed');
    expect((await loadDeviceState(pack.plan.id)).pendingRequest?.status).toBe('applied');
  });

  it('advances context revision atomically when day runtime changes', async () => {
    const pack = createDatePack({ title: 'Context changes' });
    await savePack(pack);
    const nextRevision = await saveRuntimeAndAdvanceContext({
      planId: pack.plan.id,
      updatedAt: '2026-09-29T10:00:00.000Z',
      events: { stop: { eventId: 'stop', status: 'completed' } },
    });
    expect(nextRevision).toBe(1);
    await closeStorage();
    expect((await loadDeviceState(pack.plan.id)).contextRevision).toBe(1);
    expect(await loadRuntime(pack.plan.id)).toMatchObject({
      events: { stop: { status: 'completed' } },
    });
  });

  it('rejects an answer review when runtime context changed after the request', async () => {
    const pack = createDatePack({ title: 'Context-bound request' });
    await savePack(pack);
    const generatedAt = '2026-09-29T10:00:00.000Z';
    const request = {
      id: 'context-request',
      planId: pack.plan.id,
      kind: 'remaining-change' as const,
      status: 'ready' as const,
      input: 'request',
      baseRevision: 0,
      contextRevision: 0,
      generatedAt,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };
    await savePendingRequest(request, null);
    await saveRuntimeAndAdvanceContext({
      planId: pack.plan.id,
      updatedAt: generatedAt,
      events: {},
    });
    await expect(
      savePendingRequest(
        { ...request, status: 'review', answerText: 'answer' },
        {
          id: request.id,
          kind: request.kind,
          status: request.status,
          baseRevision: 0,
          contextRevision: 0,
          generatedAt,
          updatedAt: generatedAt,
          answerText: undefined,
          responseFingerprint: undefined,
        },
      ),
    ).rejects.toThrow('context-revision-conflict');
    expect((await loadDeviceState(pack.plan.id)).pendingRequest?.status).toBe('ready');
  });

  it('retains pending requests and undo through a database restart', async () => {
    const pack = createDatePack({ title: 'Test', date: '2026-09-29' });
    await savePack(pack);
    await commitPlanChange(pack, 0, 'Rename', { ...pack.plan, title: 'Changed' });
    await saveDeviceState({
      planId: pack.plan.id,
      undoStack: [],
      pendingRequest: {
        id: 'request-1',
        planId: pack.plan.id,
        kind: 'remaining-change',
        status: 'review',
        input: 'adjust this',
        answerText: 'recovered answer',
        responseFingerprint: 'same-answer',
        baseRevision: 1,
        contextRevision: 2,
        generatedAt: '2026-09-29T00:00:00.000Z',
        createdAt: '2026-09-29T00:00:00.000Z',
        updatedAt: '2026-09-29T00:00:00.000Z',
      },
      liveContext: {
        planId: pack.plan.id,
        revision: 2,
        updatedAt: '2026-09-29T00:00:00.000Z',
        place: 'Seoul Station',
        activity: 'Waiting for the train',
        nextPlace: 'Bookstore',
        confirmedAt: '2026-09-29T00:10:00.000Z',
      },
    });
    await closeStorage();
    const reopened = await loadDeviceState(pack.plan.id);
    expect(reopened.pendingRequest?.id).toBe('request-1');
    expect(reopened.pendingRequest?.answerText).toBe('recovered answer');
    expect(reopened.liveContext?.revision).toBe(2);
    expect(reopened.liveContext).toMatchObject({
      place: 'Seoul Station',
      activity: 'Waiting for the train',
      nextPlace: 'Bookstore',
      confirmedAt: '2026-09-29T00:10:00.000Z',
    });
    expect(await loadPack(pack.plan.id)).not.toHaveProperty('liveContext');
    expect(reopened.undoStack).toHaveLength(1);
  });

  it('upgrades an earlier v3 database without losing packs, device state, or backups', async () => {
    const pack = createDatePack({ title: 'Preserve v3 data', date: '2026-09-29' });
    const old = await openDB('datepack', 3, {
      upgrade(db) {
        db.createObjectStore('packs');
        db.createObjectStore('packsV3');
        db.createObjectStore('assets', { keyPath: 'key' }).createIndex('byPack', 'packId');
        db.createObjectStore('runtime');
        db.createObjectStore('meta');
        db.createObjectStore('device');
        db.createObjectStore('sourceBackups');
      },
    });
    await old.put(
      'packsV3',
      {
        pack: {
          manifest: { ...pack.manifest, version: '3.0' },
          plan: pack.plan,
          baselinePlan: pack.originalPlan,
          experiences: pack.experiences,
          revision: pack.revision,
          assets: pack.assets,
        },
        savedAt: '2026-09-29T00:00:00.000Z',
      },
      pack.id,
    );
    await old.put(
      'device',
      {
        planId: pack.plan.id,
        liveContext: { planId: pack.plan.id, revision: 7, updatedAt: 'now' },
        undoStack: [],
      },
      pack.plan.id,
    );
    await old.put(
      'sourceBackups',
      { planId: pack.plan.id, source: 'legacy source', savedAt: 'before-upgrade' },
      pack.plan.id,
    );
    old.close();

    expect((await loadPack(pack.plan.id))?.plan.title).toBe(pack.plan.title);
    expect((await loadDeviceState(pack.plan.id)).liveContext?.revision).toBe(7);
    const upgraded = await openDB('datepack');
    expect(upgraded.version).toBe(5);
    expect(upgraded.objectStoreNames.contains('deletedPacks')).toBe(true);
    expect(await upgraded.get('sourceBackups', pack.plan.id)).toMatchObject({
      source: 'legacy source',
    });
    upgraded.close();
  });

  it('captures the first-event baseline and never moves it on the first experience', async () => {
    const blank = createDatePack({ title: 'First date', date: '2026-09-29' });
    await savePack(blank);
    const firstEvent = {
      id: 'first-stop',
      order: 0,
      title: 'First stop',
      type: 'place' as const,
      timing: { kind: 'unscheduled' as const },
    };
    const firstPlan = { ...blank.plan, events: [firstEvent] };
    await commitPlanChange(blank, 0, 'Add first stop', firstPlan);
    expect((await loadPack(blank.plan.id))?.originalPlan).toEqual(firstPlan);

    const revisedPlan = { ...firstPlan, title: 'Later edit' };
    await commitPlanChange(blank, 1, 'Rename plan', revisedPlan);
    await commitExperienceChange(blank.plan.id, 2, [
      {
        id: 'first-experience',
        eventId: firstEvent.id,
        title: firstEvent.title,
        outcome: 'completed',
        recordedAt: '2026-09-29T12:00:00.000Z',
      },
    ]);
    const afterExperience = await loadPack(blank.plan.id);
    expect(afterExperience?.originalPlan).toEqual(firstPlan);

    const initialWithEvents = createDatePack({ title: 'Imported plan', date: '2026-09-29' });
    initialWithEvents.plan = { ...initialWithEvents.plan, events: [firstEvent] };
    await savePack(initialWithEvents, undefined, false, true);
    expect((await loadPack(initialWithEvents.plan.id))?.originalPlan).toEqual(
      initialWithEvents.plan,
    );

    const importedWithEvents = createDatePack({ title: 'Imported with stops', date: '2026-09-29' });
    importedWithEvents.plan = { ...importedWithEvents.plan, events: [firstEvent] };
    const importedBaseline = structuredClone(importedWithEvents.originalPlan);
    const savedImport = await saveImportedPack(importedWithEvents, new Blob(['source']), []);
    expect(savedImport.originalPlan).toEqual(importedBaseline);

    const preserved = createDatePack({ title: 'Current plan', date: '2026-09-29' });
    preserved.plan = { ...preserved.plan, events: [firstEvent] };
    preserved.originalPlan = { ...preserved.plan, title: 'Original plan' };
    const imported = await saveImportedPack(preserved, new Blob(['v3 source']), []);
    await closeStorage();
    const roundTrip = await loadPack(preserved.plan.id);
    expect(imported.plan).toEqual(preserved.plan);
    expect(imported.originalPlan).toEqual(preserved.originalPlan);
    expect(roundTrip?.plan).toEqual(preserved.plan);
    expect(roundTrip?.originalPlan).toEqual(preserved.originalPlan);

    const localDraft = createDatePack({ title: 'Current plan', date: '2026-09-29' });
    localDraft.plan = { ...localDraft.plan, events: [firstEvent] };
    localDraft.originalPlan = { ...localDraft.plan, title: 'Established baseline' };
    const savedDraft = await savePack(localDraft);
    expect(savedDraft.originalPlan).toEqual(localDraft.originalPlan);

    const genericCreate = createDatePack({ title: 'Generic create', date: '2026-09-29' });
    genericCreate.plan = { ...genericCreate.plan, events: [firstEvent] };
    const savedGenericCreate = await savePack(genericCreate);
    expect(savedGenericCreate.originalPlan).toEqual(genericCreate.originalPlan);
  });

  it('uses create-only writes and imports conflicting content as a copy', async () => {
    const pack = createDatePack({ title: 'Original', date: '2026-09-29' });
    const creations = await Promise.allSettled([savePack(pack), savePack(pack)]);
    expect(creations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(savePack(pack)).rejects.toThrow('pack-exists');

    const imported = { ...pack, plan: { ...pack.plan, title: 'Imported' } };
    const explicitReplacement = { ...pack, plan: { ...pack.plan, title: 'Explicit replacement' } };
    await commitPlanChange(pack, 0, 'Concurrent tab', { ...pack.plan, title: 'Concurrent tab' });
    await expect(savePack(explicitReplacement, 0)).rejects.toThrow('revision-conflict');
    const copy = await saveImportedPack(imported, new Blob(['source']), []);
    expect(copy.id).not.toBe(pack.id);
    expect(copy.revision).toBe(imported.revision);
    expect(copy.plan!.title).toBe('Imported');
    expect((await loadPack(pack.id))?.plan.title).toBe('Concurrent tab');
    expect((await listPacks()).length).toBe(2);
  });

  it('migrates old bytes once and preserves the source and experience identity on retry', async () => {
    const old = await openDB('datepack', 2, {
      upgrade(db) {
        db.createObjectStore('packs');
        db.createObjectStore('assets', { keyPath: 'key' }).createIndex('byPack', 'packId');
        db.createObjectStore('runtime');
        db.createObjectStore('meta');
      },
    });
    const legacy: LegacyDatePack = {
      manifest: { format: 'datepack', version: '2.0', entry: 'plan.json' },
      plan: {
        id: 'legacy-plan',
        title: 'Old plan',
        date: '2026-09-29',
        events: [{ id: 'legacy-event', title: 'Dinner', type: 'meal', start: '18:00' }],
      },
      assets: [],
    };
    const original = { pack: legacy, savedAt: '2026-09-28T00:00:00.000Z' };
    const invalidOriginal = {
      ...original,
      pack: {
        ...legacy,
        plan: { ...legacy.plan, events: [{ ...legacy.plan.events[0]!, title: '' }] },
      },
    };
    await old.put('packs', invalidOriginal, 'legacy-plan');
    await old.put(
      'runtime',
      {
        planId: 'legacy-plan',
        updatedAt: '2026-09-28T01:00:00.000Z',
        events: { 'legacy-event': { eventId: 'legacy-event', status: 'completed' } },
      },
      'legacy-plan',
    );
    old.close();

    await expect(loadPack('legacy-plan')).rejects.toBeTruthy();
    await closeStorage();
    const failedCheck = await openDB('datepack');
    expect(await failedCheck.get('packs', 'legacy-plan')).toEqual(invalidOriginal);
    failedCheck.close();
    const retryDb = await openDB('datepack');
    await retryDb.put('packs', original, 'legacy-plan');
    retryDb.close();

    const first = await loadPack('legacy-plan');
    await closeStorage();
    const second = await loadPack('legacy-plan');
    expect(first?.experiences.map((experience) => experience.id)).toEqual([
      'experience-legacy-legacy-plan-legacy-event',
    ]);
    expect(second?.experiences).toHaveLength(1);
    expect(first?.originalPlan).toEqual(first?.plan);
    const check = await openDB('datepack');
    expect(await check.get('packs', 'legacy-plan')).toEqual(original);
    expect(await check.get('sourceBackups', 'v4:legacy-plan')).toMatchObject({ source: original });
    check.close();
  });

  it('undo restores only the plan while keeping newer context and runtime facts intact', async () => {
    const pack = createDatePack({ title: 'Test', date: '2026-09-29' });
    await savePack(pack);
    await commitPlanChange(pack, 0, 'Rename', { ...pack.plan, title: 'Changed' });
    const device = await loadDeviceState(pack.plan.id);
    device.liveContext = {
      planId: pack.plan.id,
      revision: 4,
      updatedAt: '2026-09-29T00:00:00.000Z',
    };
    device.personalJourney = {
      planId: pack.plan.id,
      updatedAt: '2026-09-29T00:00:00.000Z',
      origin: 'Home',
    };
    await saveDeviceState(device);
    const latestExperience = {
      id: 'experience-later',
      title: 'Dinner',
      outcome: 'completed' as const,
      recordedAt: '2026-09-29T01:00:00.000Z',
    };
    await commitExperienceChange(pack.plan.id, 1, [latestExperience]);
    await expect(commitExperienceChange(pack.plan.id, 1, pack.experiences)).rejects.toThrow(
      'revision-conflict',
    );
    expect((await loadPack(pack.plan.id))?.originalPlan.title).toBe('Test');
    await commitUndo(pack.plan.id, 2);
    const restored = await loadPack(pack.plan.id);
    const local = await loadDeviceState(pack.plan.id);
    expect(restored?.plan.title).toBe('Test');
    expect(restored?.revision).toBe(3);
    expect(restored?.experiences.map((experience) => experience.id)).toEqual(['experience-later']);
    expect(restored?.originalPlan.title).toBe('Test');
    expect(local.liveContext?.revision).toBe(4);
    expect(local.personalJourney?.origin).toBe('Home');
  });

  it('does not resurrect a deliberately deleted migrated legacy pack', async () => {
    const old = await openDB('datepack', 2, {
      upgrade(db) {
        db.createObjectStore('packs');
        db.createObjectStore('assets', { keyPath: 'key' }).createIndex('byPack', 'packId');
        db.createObjectStore('runtime');
        db.createObjectStore('meta');
      },
    });
    const legacy: LegacyDatePack = {
      manifest: { format: 'datepack', version: '2.0', entry: 'plan.json' },
      plan: { id: 'deleted-plan', title: 'To delete', date: '2026-09-29', events: [] },
      assets: [],
    };
    await old.put('packs', { pack: legacy, savedAt: '2026-09-29T00:00:00Z' }, 'deleted-plan');
    old.close();
    expect(await loadPack('deleted-plan')).toBeDefined();
    await deletePack('deleted-plan');
    await closeStorage();
    expect(await loadPack('deleted-plan')).toBeUndefined();
    expect(await listPacks()).toEqual([]);
    const check = await openDB('datepack');
    expect(await check.get('packs', 'deleted-plan')).toBeDefined();
    expect(await check.get('sourceBackups', 'v4:deleted-plan')).toBeDefined();
    check.close();
  });
});

async function loadPack(id: string) {
  const pack = await loadAnyPack(id);
  if (pack && pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return pack;
}
