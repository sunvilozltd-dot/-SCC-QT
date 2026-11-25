import type { Express, Request, Response } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  AuthedRequest,
  clearPersistentSessionCookie,
  issueSessionToken,
  parseCookies,
  SESSION_COOKIE_NAME,
} from './auth.ts';
import {
  dbConsumeWebAuthnChallenge,
  dbGetWebAuthnCredentialById,
  dbListActiveSessionsForUser,
  dbListEnrolledDevicesForUser,
  dbListWebAuthnCredentialsForUser,
  dbListWebAuthnCredentialsForUserAndDevice,
  dbRevokeSessionById,
  dbRevokeWebAuthnCredentialAndSessions,
  dbSaveWebAuthnChallenge,
  dbSaveWebAuthnCredential,
  dbTouchSession,
  dbUpdateWebAuthnCredentialCounter,
  dbValidatePersistentSessionCookie,
  getUserAuthRecordById,
} from './db.ts';
import { sanitizeDeviceId, sanitizeDeviceLabel } from './mobileSecurityDb.ts';

function resolveWebAuthnOriginAndRpId(req: Request): { origin: string; rpID: string } {
  const originHeader = String(req.headers.origin || '').trim();
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      return {
        origin: parsed.origin,
        rpID: parsed.hostname,
      };
    } catch {
      // Fallback below
    }
  }
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000')
    .split(',')[0]
    .trim();
  const protoHeader = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http'))
    .split(',')[0]
    .trim();
  const origin = `${protoHeader}://${hostHeader}`;
  const rpID = hostHeader.split(':')[0] || 'localhost';
  return { origin, rpID };
}

export function registerWebAuthnAndSessionRoutes(
  app: Express,
  requireAuth: (req: AuthedRequest, res: Response, next: () => void) => void
): void {
  // 1. Resume persistent mobile session on app reopen
  app.get('/api/auth/session/resume', (req: Request, res: Response) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const rawCookie = cookies[SESSION_COOKIE_NAME] || '';
      const deviceId = sanitizeDeviceId(req.query.deviceId || req.headers['x-device-id'] || '');
      if (!rawCookie) {
        res.json({ status: 'unauthenticated' });
        return;
      }

      const session = dbValidatePersistentSessionCookie(rawCookie, deviceId);
      if (!session) {
        clearPersistentSessionCookie(req, res);
        res.json({ status: 'unauthenticated' });
        return;
      }

      const userRec = getUserAuthRecordById(session.user_id);
      if (!userRec || !userRec.is_active || userRec.token_version !== session.token_version) {
        dbRevokeSessionById(session.session_id, 'user_invalidated');
        clearPersistentSessionCookie(req, res);
        res.json({ status: 'unauthenticated' });
        return;
      }

      const { token_version: tv, ...safeUser } = userRec;
      const enrolledForThisDevice = dbListWebAuthnCredentialsForUserAndDevice(
        userRec.id,
        session.device_id
      );

      // If Device Unlock is enrolled on THIS device, reopen in Locked state so the phone
      // prompts for fingerprint/face/PIN via WebAuthn (with password fallback) instead of silent unlock
      if (enrolledForThisDevice.length > 0) {
        res.json({
          status: 'locked',
          deviceUnlockAvailable: true,
          deviceId: session.device_id,
          userPreview: {
            id: safeUser.id,
            name: safeUser.name,
            username: safeUser.username,
            role: safeUser.role,
          },
        });
        return;
      }

      // Persistent session without device unlock resumes smoothly without retyping password every time
      dbTouchSession(session.session_id);
      const token = issueSessionToken({
        ...safeUser,
        token_version: tv,
        session_id: session.session_id,
        device_id: session.device_id,
      });

      res.json({
        status: 'authenticated',
        token,
        user: safeUser,
        deviceUnlockAvailable: false,
        deviceId: session.device_id,
      });
    } catch {
      res.json({ status: 'unauthenticated' });
    }
  });

  // 2. Sign out — immediately revokes current persistent session & clears HttpOnly cookie
  app.post('/api/auth/logout', (req: AuthedRequest, res: Response) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const rawCookie = cookies[SESSION_COOKIE_NAME] || '';
      if (rawCookie) {
        const session = dbValidatePersistentSessionCookie(rawCookie);
        if (session) {
          dbRevokeSessionById(session.session_id, 'sign_out');
        }
      }
      const header = req.headers.authorization || '';
      if (header.startsWith('Bearer ')) {
        const token = header.slice(7).trim();
        const dot = token.indexOf('.');
        if (dot > 0) {
          try {
            const parsed = JSON.parse(
              Buffer.from(token.slice(0, dot), 'base64url').toString('utf8')
            ) as { sid?: string };
            if (parsed.sid) {
              dbRevokeSessionById(parsed.sid, 'sign_out');
            }
          } catch {
            // Ignore malformed bearer on logout
          }
        }
      }
      clearPersistentSessionCookie(req, res);
      res.json({ ok: true, message: 'Signed out and device session revoked.' });
    } catch {
      clearPersistentSessionCookie(req, res);
      res.json({ ok: true, message: 'Signed out.' });
    }
  });

  // 3. List enrolled WebAuthn devices & active persistent sessions for current user
  app.get('/api/auth/devices', requireAuth, (req: AuthedRequest, res: Response) => {
    const currentDeviceId = sanitizeDeviceId(req.query.deviceId || req.deviceId || '');
    const devices = dbListEnrolledDevicesForUser(req.user!.id, currentDeviceId);
    const sessions = dbListActiveSessionsForUser(req.user!.id, req.sessionId);
    res.json({
      devices,
      sessions,
      currentDeviceEnrolled: devices.some((d) => d.device_id === currentDeviceId),
    });
  });

  // 4. Remove an enrolled device — deactivates WebAuthn credential & revokes all sessions on that device
  app.delete('/api/auth/devices/:credentialId', requireAuth, (req: AuthedRequest, res: Response) => {
    try {
      const credentialId = String(req.params.credentialId || '').trim();
      const { removedDeviceId } = dbRevokeWebAuthnCredentialAndSessions(req.user!.id, credentialId);
      const isCurrentDevice = Boolean(req.deviceId && removedDeviceId === req.deviceId);
      if (isCurrentDevice) {
        clearPersistentSessionCookie(req, res);
      }
      res.json({
        ok: true,
        removedDeviceId,
        revokedCurrentSession: isCurrentDevice,
        devices: dbListEnrolledDevicesForUser(req.user!.id, req.deviceId),
        sessions: dbListActiveSessionsForUser(req.user!.id, req.sessionId),
        message: 'Device unlock removed and all sessions on that device have been revoked immediately.',
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to remove enrolled device.',
      });
    }
  });

  // 5. Revoke an individual persistent session
  app.delete('/api/auth/sessions/:sessionId', requireAuth, (req: AuthedRequest, res: Response) => {
    const targetSessionId = String(req.params.sessionId || '').trim();
    const sessions = dbListActiveSessionsForUser(req.user!.id, req.sessionId);
    const ownsSession = sessions.some((s) => s.session_id === targetSessionId);
    if (!ownsSession) {
      res.status(404).json({ error: 'Active session not found.' });
      return;
    }
    dbRevokeSessionById(targetSessionId, 'manual_session_revoked');
    if (req.sessionId && targetSessionId === req.sessionId) {
      clearPersistentSessionCookie(req, res);
    }
    res.json({
      ok: true,
      sessions: dbListActiveSessionsForUser(req.user!.id, req.sessionId),
      message: 'Session revoked immediately.',
    });
  });

  // 6. WebAuthn Registration Options (Enable Device Unlock on THIS phone)
  app.post(
    '/api/auth/webauthn/register/options',
    requireAuth,
    async (req: AuthedRequest, res: Response) => {
      try {
        const deviceId = sanitizeDeviceId(req.body?.device_id || req.deviceId || '');
        const preferPlatform = req.body?.prefer_platform !== false;
        const { rpID } = resolveWebAuthnOriginAndRpId(req);

        const existingCreds = dbListWebAuthnCredentialsForUser(req.user!.id);
        const options = await generateRegistrationOptions({
          rpName: 'SUNVILOZ Clean Care',
          rpID,
          userID: new TextEncoder().encode(req.user!.id),
          userName: req.user!.username,
          userDisplayName: req.user!.name,
          attestationType: 'none',
          excludeCredentials: existingCreds.map((c) => ({
            id: c.credential_id,
            transports: c.transports as AuthenticatorTransport[],
          })),
          authenticatorSelection: {
            ...(preferPlatform ? { authenticatorAttachment: 'platform' } : {}),
            residentKey: 'preferred',
            userVerification: 'required',
          },
        });

        const challengeId = dbSaveWebAuthnChallenge({
          userId: req.user!.id,
          deviceId,
          purpose: 'register',
          challenge: options.challenge,
        });

        res.json({ challengeId, options });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Could not prepare device unlock registration.',
        });
      }
    }
  );

  // 7. WebAuthn Registration Verification
  app.post(
    '/api/auth/webauthn/register/verify',
    requireAuth,
    async (req: AuthedRequest, res: Response) => {
      try {
        const challengeId = String(req.body?.challengeId || '').trim();
        const deviceId = sanitizeDeviceId(req.body?.device_id || req.deviceId || '');
        const deviceLabel = sanitizeDeviceLabel(
          req.body?.device_label,
          String(req.headers['user-agent'] || '')
        );
        const response = req.body?.response as RegistrationResponseJSON | undefined;

        if (!challengeId || !response) {
          res.status(400).json({ error: 'Missing WebAuthn registration response.' });
          return;
        }

        const stored = dbConsumeWebAuthnChallenge({
          challengeId,
          purpose: 'register',
          userId: req.user!.id,
          deviceId,
        });
        if (!stored) {
          res.status(400).json({ error: 'Registration challenge expired or invalid. Please try again.' });
          return;
        }

        const { origin, rpID } = resolveWebAuthnOriginAndRpId(req);
        const verification = await verifyRegistrationResponse({
          response,
          expectedChallenge: stored.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });

        if (!verification.verified || !verification.registrationInfo) {
          res.status(400).json({ error: 'Device unlock verification failed. Please try again.' });
          return;
        }

        const { credential, credentialBackedUp } = verification.registrationInfo;
        const publicKeyBase64Url = Buffer.from(credential.publicKey).toString('base64url');

        dbSaveWebAuthnCredential({
          credentialId: credential.id,
          userId: req.user!.id,
          deviceId,
          deviceLabel,
          publicKeyBase64Url,
          counter: credential.counter,
          transports: credential.transports || [],
          backedUp: Boolean(credentialBackedUp),
        });

        res.json({
          verified: true,
          devices: dbListEnrolledDevicesForUser(req.user!.id, deviceId),
          message: `Device Unlock enabled on ${deviceLabel}. Your phone's fingerprint, face, or screen lock is verified locally by your device.`,
        });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Device unlock registration failed. You can continue using your app password.',
        });
      }
    }
  );

  // 8. WebAuthn Authentication Options (Unlock existing per-device session)
  app.post('/api/auth/webauthn/authenticate/options', async (req: Request, res: Response) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const rawCookie = cookies[SESSION_COOKIE_NAME] || '';
      const deviceId = sanitizeDeviceId(req.body?.device_id || req.headers['x-device-id'] || '');

      const session = dbValidatePersistentSessionCookie(rawCookie, deviceId);
      if (!session) {
        res.status(401).json({
          error: 'No active session on this device. Please sign in with your app password.',
        });
        return;
      }

      const userRec = getUserAuthRecordById(session.user_id);
      if (!userRec || !userRec.is_active || userRec.token_version !== session.token_version) {
        dbRevokeSessionById(session.session_id, 'user_invalidated');
        clearPersistentSessionCookie(req, res);
        res.status(401).json({
          error: 'Your session was revoked. Please sign in with your app password.',
        });
        return;
      }

      // STRICT per-device credential binding: only credentials enrolled on THIS device_id are allowed
      const deviceCreds = dbListWebAuthnCredentialsForUserAndDevice(userRec.id, session.device_id);
      if (deviceCreds.length === 0) {
        res.status(404).json({
          error: 'Device Unlock is not enabled on this phone. Please sign in with your app password.',
        });
        return;
      }

      const { rpID } = resolveWebAuthnOriginAndRpId(req);
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: deviceCreds.map((c) => ({
          id: c.credential_id,
          transports: c.transports as AuthenticatorTransport[],
        })),
        userVerification: 'required',
      });

      const challengeId = dbSaveWebAuthnChallenge({
        userId: userRec.id,
        deviceId: session.device_id,
        purpose: 'authenticate',
        challenge: options.challenge,
      });

      res.json({ challengeId, options });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to start device unlock.',
      });
    }
  });

  // 9. WebAuthn Authentication Verification (Unlocks session with userVerification: required)
  app.post('/api/auth/webauthn/authenticate/verify', async (req: Request, res: Response) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const rawCookie = cookies[SESSION_COOKIE_NAME] || '';
      const challengeId = String(req.body?.challengeId || '').trim();
      const deviceId = sanitizeDeviceId(req.body?.device_id || req.headers['x-device-id'] || '');
      const response = req.body?.response as AuthenticationResponseJSON | undefined;

      const session = dbValidatePersistentSessionCookie(rawCookie, deviceId);
      if (!session) {
        res.status(401).json({
          error: 'Session expired or revoked. Please sign in with your app password.',
        });
        return;
      }

      const userRec = getUserAuthRecordById(session.user_id);
      if (!userRec || !userRec.is_active || userRec.token_version !== session.token_version) {
        dbRevokeSessionById(session.session_id, 'user_invalidated');
        clearPersistentSessionCookie(req, res);
        res.status(401).json({
          error: 'Session revoked. Please sign in with your app password.',
        });
        return;
      }

      if (!challengeId || !response?.id) {
        res.status(400).json({ error: 'Missing device unlock verification payload.' });
        return;
      }

      const storedChallenge = dbConsumeWebAuthnChallenge({
        challengeId,
        purpose: 'authenticate',
        userId: userRec.id,
        deviceId: session.device_id,
      });
      if (!storedChallenge) {
        res.status(400).json({ error: 'Unlock challenge expired. Please try again.' });
        return;
      }

      const cred = dbGetWebAuthnCredentialById(response.id);
      if (!cred || cred.user_id !== userRec.id || cred.device_id !== session.device_id) {
        res.status(403).json({
          error: 'This device credential is not authorized for this phone or account.',
        });
        return;
      }

      const { origin, rpID } = resolveWebAuthnOriginAndRpId(req);
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: storedChallenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: cred.credential_id,
          publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64url')),
          counter: cred.counter,
          transports: cred.transports as AuthenticatorTransport[],
        },
      });

      if (!verification.verified) {
        res.status(401).json({ error: 'Device unlock verification failed.' });
        return;
      }

      dbUpdateWebAuthnCredentialCounter(cred.credential_id, verification.authenticationInfo.newCounter);
      dbTouchSession(session.session_id);

      const { token_version: tv, ...safeUser } = userRec;
      const token = issueSessionToken({
        ...safeUser,
        token_version: tv,
        session_id: session.session_id,
        device_id: session.device_id,
      });

      res.json({
        token,
        user: safeUser,
        message: `Unlocked on ${cred.device_label}.`,
      });
    } catch (err) {
      res.status(401).json({
        error:
          err instanceof Error
            ? err.message
            : 'Device unlock failed. Please sign in with your app password.',
      });
    }
  });
}
