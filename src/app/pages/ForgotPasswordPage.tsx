/**
 * "Forgot your password?" (CR3).
 *
 * The answer is the same for every address, so the page never says whether
 * an account exists. The link arrives by email and opens the same page as an
 * administrator's reset link. Same layout and form primitives as sign-in.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiRequestError } from '../../api/client.js';
import { requestPasswordReset } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { Field, inputCls } from '../../components/ui/FormFields';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    setFieldError(undefined);
    try {
      const result = await requestPasswordReset(email);
      setSent(result.message);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldError(error.fieldErrors.email);
        setFormError(error.fieldErrors.email ? 'Check the highlighted field.' : error.message);
      } else {
        setFormError('Your request could not be sent. Try again.');
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
          {sent ? (
            <>
              <h1 className="text-base font-bold text-slate-900">Check your email</h1>
              <p role="status" className="text-[13px] text-slate-600">
                {sent}
              </p>
              <p className="text-[12.5px] text-slate-500">
                Nothing arrived? Check your junk folder, or ask your system administrator to send you a link.
              </p>
              <Link to="/sign-in" className="text-[13px] font-semibold text-brand-dark hover:underline">
                Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
              <div>
                <h1 className="text-base font-bold text-slate-900">Forgot your password?</h1>
                <p className="mt-1 text-[13px] text-slate-500">
                  Enter the email address you sign in with. We will send a link to choose a new password.
                </p>
              </div>
              {formError && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">
                  {formError}
                </p>
              )}
              <Field label="Email address" htmlFor="forgot-email" required error={fieldError}>
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  className={inputCls(fieldError)}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="primary" disabled={submitting} className="mt-1 w-full">
                {submitting ? 'Sending…' : 'Send me a link'}
              </Button>
              <Link to="/sign-in" className="text-center text-[12.5px] font-semibold text-brand-dark hover:underline">
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
