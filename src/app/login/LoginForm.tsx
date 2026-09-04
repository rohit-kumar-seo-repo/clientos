"use client";

import { useState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await loginAction(formData);
      if (result && "error" in result) {
        setError(result.error);
      }
      // On success, loginAction calls redirect() itself — this component
      // never regains control in that case.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      action={handleSubmit}
      className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm"
    >
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">
        Sign in to ClientOS
      </h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <label className="mb-1 block text-sm text-neutral-600" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      <label className="mb-1 block text-sm text-neutral-600" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        className="mb-6 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
