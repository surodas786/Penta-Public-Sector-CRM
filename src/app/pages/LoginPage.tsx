/**
 * Sign-in screen.
 *
 * New in production: the approved demo had no authentication, only a role
 * switcher. Built in the approved navy/teal palette with the same form
 * primitives as every other screen (FR-010, A.6 deviation 1).
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiRequestError } from '../../api/client.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';
import { useAuth } from '../AuthContext.js';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return; // Prevents double submission (FR-013).

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      await signIn(email, password);
      // Send everyone to the role-aware landing route rather than assuming a
      // sales destination: an administrator has no commercial screens at all.
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors(error.fieldErrors);
        // The server returns one generic message for every credential failure.
        setFormError(
          Object.keys(error.fieldErrors).length > 0
            ? 'Check the highlighted fields.'
            : error.message,
        );
      } else {
        setFormError('Sign-in could not be completed. Try again.');
      }
      // Entered values are preserved so nothing has to be retyped (FR-013).
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

        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6"
        >
          <div>
            <h1 className="text-base font-bold text-slate-900">Sign in</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Accounts are created by your system administrator. There is no self-registration.
            </p>
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700"
            >
              {formError}
            </p>
          )}

          <Field label="Email address" htmlFor="login-email" required error={fieldErrors.email}>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              autoFocus
              className={inputCls(fieldErrors.email)}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="login-password" required error={fieldErrors.password}>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              className={inputCls(fieldErrors.password)}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Button type="submit" variant="primary" disabled={submitting} className="mt-1 w-full">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="text-[11.5px] leading-relaxed text-slate-500">
            Forgotten your password? Contact your system administrator. Password recovery by email
            is not enabled in this release.
          </p>
        </form>
      </div>
    </div>
  );
}
