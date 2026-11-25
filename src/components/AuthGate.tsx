import React, { useState } from 'react';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import { api, setAuthToken } from '../services/apiClient';
import { getSecondaryDriveMemorySession } from '../services/secondaryDriveClient';
import { AuthUser } from '../types/order';
import { BrandLogo } from './BrandLogo';
import { PWAInstallButton } from './PWAInstallButton';
import { AppsScriptSetupHelper } from './AppsScriptSetupHelper';

interface AuthGateProps {
  needsAdminSetup: boolean;
  adminSetupLocked?: boolean;
  initialAdminUsername?: string;
  envAdminConfigured?: boolean;
  googleAdminEnabled?: boolean;
  ownerEmailHint: string;
  backendMode?: 'apps_script' | 'local_preview';
  backendReachable?: boolean;
  backendStatusMessage?: string;
  companyLogoDataUrl?: string;
  onAuthenticated: (user: AuthUser, deviceUnlockEnrolled?: boolean) => void;
}

async function getVerifiedGoogleAdminIdToken(emailHint: string): Promise<string> {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
    ...(emailHint ? { login_hint: emailHint } : {}),
  });

  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken(true);

  // Clean up client Firebase auth session unless Secondary Drive backup session is active
  if (!getSecondaryDriveMemorySession().connected) {
    try {
      await signOut(auth);
    } catch {
      // Ignore cleanup errors
    }
  }

  return idToken;
}

export function AuthGate({
  needsAdminSetup,
  adminSetupLocked = false,
  initialAdminUsername = 'scc@gmail.com',
  envAdminConfigured = false,
  googleAdminEnabled = false,
  ownerEmailHint,
  backendMode = 'local_preview',
  backendReachable = true,
  backendStatusMessage = '',
  companyLogoDataUrl = '',
  onAuthenticated,
}: AuthGateProps) {
  const canUseVerifiedGoogleOwnerReset = Boolean(
    googleAdminEnabled && ownerEmailHint && ownerEmailHint.includes('@')
  );
  const [authTab, setAuthTab] = useState<'signin' | 'change_password'>('signin');
  const [changeMode, setChangeMode] = useState<'credentials' | 'google_reset'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState('');

  const switchTab = (nextTab: 'signin' | 'change_password') => {
    setAuthTab(nextTab);
    setChangeMode('credentials');
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowNewPassword(false);
    setError('');
  };

  const switchChangeMode = (nextMode: 'credentials' | 'google_reset') => {
    setChangeMode(nextMode);
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowNewPassword(false);
    setError('');
  };

  const handleGoogleAdminSignIn = async () => {
    setError('');
    setGoogleSubmitting(true);
    try {
      const idToken = await getVerifiedGoogleAdminIdToken(ownerEmailHint);
      const res = await api.googleAdminAuth({ idToken });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.deviceUnlockEnrolled);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      if (msg.includes('popup-closed-by-user')) {
        setError('Google sign-in popup was closed before completing.');
      } else {
        setError(msg);
      }
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleGoogleAdminPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setGoogleSubmitting(true);
    try {
      const idToken = await getVerifiedGoogleAdminIdToken(ownerEmailHint);
      const res = await api.googleAdminAuth({ idToken, new_password: newPassword });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.deviceUnlockEnrolled);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google verification failed.';
      if (msg.includes('popup-closed-by-user')) {
        setError('Google verification popup was closed before completing.');
      } else {
        setError(msg);
      }
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (authTab === 'change_password') {
        if (newPassword.length < 6) {
          throw new Error('New password must be at least 6 characters.');
        }
        if (newPassword !== confirmPassword) {
          throw new Error('New password and confirmation do not match.');
        }
        if (password === newPassword) {
          throw new Error(
            'New password must be different from your current password. Check that your browser did not autofill the same password in both fields.'
          );
        }
        const res = await api.changePasswordWithCredentials({
          username: username.trim().toLowerCase(),
          current_password: password,
          new_password: newPassword,
        });
        setAuthToken(res.token);
        onAuthenticated(res.user, res.deviceUnlockEnrolled);
      } else {
        const res = await api.login({
          username: username.trim().toLowerCase(),
          password,
        });
        setAuthToken(res.token);
        onAuthenticated(res.user, res.deviceUnlockEnrolled);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const formKey = authTab === 'signin' ? 'signin' : `change-${changeMode}`;

  if (adminSetupLocked || needsAdminSetup) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 sm:p-8 shadow-sm">
          <BrandLogo
            logoDataUrl={companyLogoDataUrl}
            variant="light"
            subtitle="Operations, Orders & Accounts"
          />

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="flex items-center gap-2 font-bold">
              <Lock className="h-4 w-4 shrink-0 text-amber-700" />
              Admin Account Setup Locked
            </div>
            <p className="mt-2 text-xs leading-relaxed">
              Public first-time setup is permanently disabled to protect this workspace. To
              initialize the fixed initial admin account (
              <strong className="font-mono">{initialAdminUsername}</strong>):
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-amber-900">
              <li>
                <strong>Apps Script Backend:</strong> Open your owner Apps Script project and run{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-semibold">
                  setupInitialAdmin(&apos;your-password&apos;)
                </code>{' '}
                once from the Editor.
              </li>
              <li>
                <strong>Local Preview:</strong> Configure{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-semibold">
                  ADMIN_PASSWORD
                </code>{' '}
                (minimum 6 characters) or{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-semibold">
                  APPS_SCRIPT_WEBAPP_URL
                </code>{' '}
                in environment settings and reload.
              </li>
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-amber-900">
              After signing in as <strong className="font-mono">{initialAdminUsername}</strong>, you
              can change your admin username and password anytime inside{' '}
              <strong>Settings → Account &amp; Security</strong>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 sm:p-8 shadow-sm">
        <BrandLogo
          logoDataUrl={companyLogoDataUrl}
          variant="light"
          subtitle="Operations, Orders & Accounts"
        />

        <div className="mt-5 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => switchTab('signin')}
            className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
              authTab === 'signin'
                ? 'bg-white text-[#0B1F3A] shadow-2xs'
                : 'text-slate-600 hover:text-[#0B1F3A]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => switchTab('change_password')}
            className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
              authTab === 'change_password'
                ? 'bg-white text-[#0B1F3A] shadow-2xs'
                : 'text-slate-600 hover:text-[#0B1F3A]'
            }`}
          >
            Change Password
          </button>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <h1 className="text-xl font-bold text-[#0B1F3A]">
            {authTab === 'change_password'
              ? changeMode === 'google_reset'
                ? 'Reset Admin Password via Google'
                : 'Change Account Password'
              : 'Sign In to Your Account'}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            {authTab === 'change_password'
              ? changeMode === 'google_reset'
                ? `Verify your Admin Google account (${ownerEmailHint}) to set a new password right away.`
                : 'Enter your username, current password, and a new password (min 6 characters).'
              : 'Sign in with your admin email or your admin-assigned supervisor username and password.'}
          </p>
        </div>

        {!backendReachable && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
            <div className="font-bold text-amber-900">
              {backendMode === 'apps_script'
                ? 'Apps Script Backend Unreachable or Misconfigured'
                : 'Backend Service Unreachable'}
            </div>
            <p className="mt-1 leading-relaxed font-normal">
              {backendStatusMessage ||
                'Unable to reach the configured backend. Check your Apps Script deployment URL and permissions before signing in.'}
            </p>
          </div>
        )}

        {!needsAdminSetup && authTab === 'change_password' && canUseVerifiedGoogleOwnerReset && (
          <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => switchChangeMode('credentials')}
              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                changeMode === 'credentials'
                  ? 'bg-white text-[#0B1F3A] shadow-2xs'
                  : 'text-slate-600 hover:text-[#0B1F3A]'
              }`}
            >
              Use Current Password
            </button>
            <button
              type="button"
              onClick={() => switchChangeMode('google_reset')}
              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                changeMode === 'google_reset'
                  ? 'bg-white text-teal-800 shadow-2xs'
                  : 'text-slate-600 hover:text-[#0B1F3A]'
              }`}
            >
              Forgot Admin Password?
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            <div>{error}</div>
            {!needsAdminSetup && canUseVerifiedGoogleOwnerReset && changeMode !== 'google_reset' && (
              <div className="mt-2 border-t border-red-200 pt-2 text-xs font-normal text-red-800">
                Forgot your Admin password?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('change_password');
                    switchChangeMode('google_reset');
                  }}
                  className="font-semibold underline hover:text-red-950"
                >
                  Reset Admin password with Primary Google Owner ({ownerEmailHint})
                </button>
                .
              </div>
            )}
            {!needsAdminSetup && !canUseVerifiedGoogleOwnerReset && (
              <div className="mt-2 border-t border-red-200 pt-2 text-xs font-normal text-red-800">
                Forgot your Admin password? The workspace owner can reset it safely without touching
                business data by running{' '}
                <code className="font-mono font-semibold">resetAdminPasswordOwnerOnly(...)</code> in
                Apps Script
                {envAdminConfigured ? ' (or updating ADMIN_PASSWORD in Secrets for local preview)' : ''}.
              </div>
            )}
          </div>
        )}

        {!needsAdminSetup && authTab === 'change_password' && changeMode === 'google_reset' ? (
          <form
            key={formKey}
            onSubmit={handleGoogleAdminPasswordReset}
            autoComplete="off"
            className="mt-5 space-y-4"
          >
            <div className="rounded-lg border border-teal-200 bg-teal-50/70 px-3.5 py-2.5 text-xs text-teal-900">
              Admin Google Account: <strong className="font-mono">{ownerEmailHint}</strong>
            </div>

            <div>
              <label
                htmlFor="reset-new-password"
                className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]"
              >
                New Admin Password (min 6 characters) *
              </label>
              <div className="relative">
                <input
                  id="reset-new-password"
                  name="reset_new_password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new admin password"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-10 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="reset-confirm-password"
                className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]"
              >
                Confirm New Password *
              </label>
              <input
                id="reset-confirm-password"
                name="reset_confirm_password"
                type={showNewPassword ? 'text' : 'password'}
                required
                minLength={6}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new admin password"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            <button
              type="submit"
              disabled={googleSubmitting}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" />
              {googleSubmitting ? 'Verifying with Google...' : 'Verify with Google & Set Password'}
            </button>
          </form>
        ) : (
          <form key={formKey} onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor={authTab === 'change_password' ? 'cp-username' : 'signin-username'}
                className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]"
              >
                Username *
              </label>
              <input
                id={authTab === 'change_password' ? 'cp-username' : 'signin-username'}
                name={authTab === 'change_password' ? 'cp_username' : 'signin_username'}
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Admin email or supervisor username"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            <div>
              <label
                htmlFor={authTab === 'change_password' ? 'cp-current-password' : 'signin-password'}
                className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]"
              >
                {authTab === 'change_password' ? 'Current Password *' : 'Password *'}
              </label>
              <div className="relative">
                <input
                  id={authTab === 'change_password' ? 'cp-current-password' : 'signin-password'}
                  name={
                    authTab === 'change_password' ? 'cp_current_password_verify' : 'signin_password'
                  }
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={authTab === 'change_password' ? 'off' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    authTab === 'change_password'
                      ? 'Type your existing password'
                      : 'Enter your password'
                  }
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-10 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {authTab === 'change_password' && (
              <>
                <div>
                  <label
                    htmlFor="cp-new-password"
                    className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]"
                  >
                    New Password (min 6 characters) *
                  </label>
                  <div className="relative">
                    <input
                      id="cp-new-password"
                      name="cp_new_password"
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-10 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                      className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    >
                      {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="cp-confirm-password"
                    className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]"
                  >
                    Confirm New Password *
                  </label>
                  <input
                    id="cp-confirm-password"
                    name="cp_confirm_password"
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting || googleSubmitting}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              {authTab === 'change_password' ? (
                <>
                  <KeyRound className="h-4 w-4" />
                  {submitting ? 'Updating...' : 'Change Password & Sign In'}
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  {submitting ? 'Signing in...' : 'Sign In'}
                </>
              )}
            </button>
          </form>
        )}

        {authTab === 'signin' && canUseVerifiedGoogleOwnerReset && (
          <div className="mt-4">
            <div className="relative flex items-center py-1">
              <div className="grow border-t border-slate-200" />
              <span className="mx-3 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Or Primary Google Owner Sign-In
              </span>
              <div className="grow border-t border-slate-200" />
            </div>

            <button
              type="button"
              onClick={handleGoogleAdminSignIn}
              disabled={googleSubmitting || submitting}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.29v-3.1H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l4-3.1Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.1c.94-2.84 3.59-4.95 6.71-4.95Z"
                />
              </svg>
              {googleSubmitting ? 'Signing in with Google...' : 'Sign in with Google (Admin)'}
            </button>
          </div>
        )}

        <div className="mt-6 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-teal-700 shrink-0" />
            <span>Role-based private access for Admins and Field Supervisors</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Admin creates supervisor login accounts under{' '}
            <strong>Supervisors → Create Supervisor Login Account</strong>. Supervisors sign in here
            using their assigned username and password.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-2">
            <AppsScriptSetupHelper variant="primary" />
            <PWAInstallButton variant="header" />
          </div>
        </div>
      </div>
    </div>
  );
}
