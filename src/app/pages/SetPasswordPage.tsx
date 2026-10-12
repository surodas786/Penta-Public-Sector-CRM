/**
 * Choosing a password from an invitation or reset link (SEC-030).
 *
 * The token travels in the URL fragment, which browsers never send to a
 * server or put in a Referer header. It is read once and then removed from
 * the address bar, so it does not stay in history or on screen.
 *
 * CR1: on opening, the page asks the server what the link can do, without
 * spending it, so an expired or already used link is explained before anyone
 * types a password. The link is spent only when the password is saved.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { AccountLinkStatusDto } from '../../../shared/api.js';
import { PASSWORD_MIN_LENGTH } from '../../../shared/validation.js';
import { ApiRequestError } from '../../api/client.js';
import { checkAccountLink, fetchRecoveryOptions, setPasswordWithLink } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';

/** Pure read: React may run a state initialiser twice in development. */
function readTokenFromUrl(): string {
  const match = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function SetPasswordPage() {
  const [token, setToken] = useState(readTokenFromUrl);
  // Counts links opened in this tab, so the same link opened again is checked again.
  const [opened, setOpened] = useState(0);

  // Once captured, take the token out of the address bar and history. A link
  // pasted into this same tab changes only the fragment and does not reload
  // the page, so pick up the new token and check it afresh.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    const onHashChange = () => {
      const next = readTokenFromUrl();
      window.history.replaceState(null, '', window.location.pathname);
      if (!next) return;
      setToken(next);
      setOpened((count) => count + 1);
      setDone(false);
      setStatus(null);
      setStatusError(null);
      setPassword('');
      setConfirm('');
      setErrors({});
      setFormError(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<AccountLinkStatusDto | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [selfServiceReset, setSelfServiceReset] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    checkAccountLink(token).then(
      (result) => {
        if (!cancelled) setStatus(result);
      },
      (error: unknown) => {
        if (!cancelled) setStatusError(error instanceof ApiRequestError ? error.message : 'This link could not be checked. Try again.');
      },
    );
    fetchRecoveryOptions().then(
      (options) => {
        if (!cancelled) setSelfServiceReset(options.selfServiceReset);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [token, opened]);

  const isInvitation = status?.purpose === 'invitation';
  const newLinkAdvice =
    status?.purpose === 'password_reset' && selfServiceReset ? (
      <Link to="/forgot-password" className="text-[13px] font-semibold text-brand-dark hover:underline">
        Request a new link
      </Link>
    ) : (
      <p className="text-[13px] text-slate-600">
        Ask your system administrator to send you {isInvitation ? 'a new invitation' : 'a new link'}.
      </p>
    );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    if (password !== confirm) {
      setErrors({ confirm: 'The two passwords do not match.' });
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await setPasswordWithLink(token, password);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(error.fieldErrors);
        setFormError(error.fieldErrors.password ? 'Check the highlighted field.' : error.message);
      } else {
        setFormError('Your password could not be set. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold tracking-tight text-navy">Penta</p>
          <p className="mt-0.5 text-[13px] text-slate-500">Public Sector Sales CRM</p>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6">
          {done ? (
            <>
              <h1 className="text-base font-bold text-slate-900">Password set</h1>
              <p className="text-[13px] text-slate-600">
                Your password is saved. Any session you had before has been signed out.
              </p>
              <Link to="/sign-in" className="text-[13px] font-semibold text-brand-dark hover:underline">
                Continue to sign in
              </Link>
            </>
          ) : !token ? (
            <>
              <h1 className="text-base font-bold text-slate-900">Link incomplete</h1>
              <p className="text-[13px] text-slate-600">
                Open the full link from your email. If it no longer works, ask for a new one.
              </p>
            </>
          ) : statusError ? (
            <>
              <h1 className="text-base font-bold text-slate-900">Link not checked</h1>
              <p role="alert" className="text-[13px] text-slate-600">
                {statusError}
              </p>
            </>
          ) : !status ? (
            <p className="text-[13px] text-slate-500" role="status">
              Checking your link…
            </p>
          ) : status.state === 'expired' ? (
            <>
              <h1 className="text-base font-bold text-slate-900">This link has expired</h1>
              <p className="text-[13px] text-slate-600">
                {isInvitation ? 'Invitation links work for 72 hours.' : 'Reset links work for 24 hours.'} Nothing was changed.
              </p>
              {newLinkAdvice}
            </>
          ) : status.state === 'used' ? (
            <>
              <h1 className="text-base font-bold text-slate-900">This link has already been used</h1>
              <p className="text-[13px] text-slate-600">
                Each link works once, and a newer link replaces an older one. If you have already chosen your password,
                sign in with it.
              </p>
              <Link to="/sign-in" className="text-[13px] font-semibold text-brand-dark hover:underline">
                Go to sign in
              </Link>
              {newLinkAdvice}
            </>
          ) : status.state === 'invalid' ? (
            <>
              <h1 className="text-base font-bold text-slate-900">This link does not work</h1>
              <p className="text-[13px] text-slate-600">
                It may be incomplete, or the account may no longer be active. Ask your system administrator for help.
              </p>
            </>
          ) : (
            <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
              <div>
                <h1 className="text-base font-bold text-slate-900">
                  {isInvitation ? 'Activate your account' : 'Choose a new password'}
                </h1>
                <p className="mt-1 text-[13px] text-slate-500">
                  Use at least {PASSWORD_MIN_LENGTH} characters. A short phrase is easier to remember than a complex word.
                </p>
              </div>
              {formError && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">
                  {formError}
                </p>
              )}
              <Field label="New password" htmlFor="new-password" required error={errors.password}>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  className={inputCls(errors.password)}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field label="Repeat the password" htmlFor="confirm-password" required error={errors.confirm}>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  className={inputCls(errors.confirm)}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="primary" disabled={submitting} className="mt-1 w-full">
                {submitting ? 'Saving…' : 'Set password'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
